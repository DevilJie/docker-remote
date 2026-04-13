// .deploy/scripts/deployer.js
import fs from 'fs-extra';
import path from 'path';
import { NodeSSH } from 'node-ssh';
import { logger } from './utils/logger.js';
import { DEPLOY_DIR, REMOTE_DIR } from './utils/constants.js';

export class Deployer {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.ssh = new NodeSSH();
    this.connected = false;
  }

  async connect(serverConfig, secrets) {
    logger.header('连接服务器');

    const { host, port, username, authType } = serverConfig;

    logger.step(`连接到 ${username}@${host}:${port}...`);

    try {
      const config = {
        host,
        port: port || 22,
        username
      };

      if (authType === 'password') {
        config.password = secrets.password;
      } else if (authType === 'key') {
        config.privateKeyPath = secrets.keyPath;
        if (secrets.passphrase) {
          config.passphrase = secrets.passphrase;
        }
      }

      await this.ssh.connect(config);
      this.connected = true;

      logger.success('SSH 连接成功');

      return true;
    } catch (error) {
      logger.error(`连接失败: ${error.message}`);
      throw error;
    }
  }

  async checkDocker() {
    logger.step('检查 Docker 环境...');

    const result = await this.ssh.execCommand('docker --version');

    if (result.stderr && !result.stdout) {
      logger.warn('服务器未安装 Docker');
      return false;
    }

    logger.success(`Docker 已安装: ${result.stdout.trim()}`);
    return true;
  }

  async installDocker(mirrorUrl = '') {
    logger.step('安装 Docker...');

    const osResult = await this.ssh.execCommand('cat /etc/os-release');

    let installCmd;
    if (osResult.stdout.includes('Ubuntu') || osResult.stdout.includes('Debian')) {
      installCmd = 'apt-get update && apt-get install -y docker.io && systemctl start docker && systemctl enable docker';
    } else if (osResult.stdout.includes('CentOS') || osResult.stdout.includes('RHEL')) {
      installCmd = 'yum install -y yum-utils && yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo && yum install -y docker-ce docker-ce-cli containerd.io && systemctl start docker && systemctl enable docker';
    } else if (osResult.stdout.includes('Alpine')) {
      installCmd = 'apk add docker docker-cli && rc-service docker start && rc-update add docker default';
    } else {
      throw new Error('不支持的操作系统，请手动安装 Docker');
    }

    const result = await this.ssh.execCommand(installCmd, { execOptions: { pty: true } });

    if (result.code !== 0 && result.stderr) {
      logger.error(`Docker 安装失败: ${result.stderr}`);
      return false;
    }

    logger.success('Docker 安装成功');

    // 配置镜像加速器
    if (mirrorUrl) {
      await this.configureDockerMirror(mirrorUrl);
    }

    return true;
  }

  async configureDockerMirror(mirrorUrl) {
    logger.step('配置 Docker 镜像加速器...');

    // 创建 /etc/docker 目录（如果不存在）
    await this.ssh.execCommand('mkdir -p /etc/docker');

    // 生成 daemon.json 配置
    const daemonJson = JSON.stringify({
      "registry-mirrors": [mirrorUrl]
    }, null, 2);

    // 写入配置并重启 Docker
    const writeCmd = `cat > /etc/docker/daemon.json << 'EOF'\n${daemonJson}\nEOF`;
    const writeResult = await this.ssh.execCommand(writeCmd);

    if (writeResult.code !== 0) {
      logger.warn(`镜像加速器配置失败: ${writeResult.stderr}`);
      return false;
    }

    // 重启 Docker 使配置生效
    await this.ssh.execCommand('systemctl daemon-reload && systemctl restart docker');

    logger.success(`镜像加速器已配置: ${mirrorUrl}`);
    return true;
  }

  // ========== Port Conflict Detection ==========

  async checkPortAvailability(port) {
    // Try ss first (standard on modern Linux)
    const ssResult = await this.ssh.execCommand(
      `ss -tulnp 2>/dev/null | grep ':${port} '`
    );

    if (ssResult.stdout.trim()) {
      return this.parseSsOutput(ssResult.stdout, port);
    }

    // Fallback to lsof
    const lsofResult = await this.ssh.execCommand(
      `lsof -i :${port} -P -n 2>/dev/null | tail -n +2`
    );

    if (lsofResult.stdout.trim()) {
      return this.parseLsofOutput(lsofResult.stdout, port);
    }

    return { available: true, processes: [] };
  }

  parseSsOutput(output, port) {
    const processes = [];
    const lines = output.trim().split('\n');

    for (const line of lines) {
      // ss output: LISTEN  0  128  *:8080  *:*  users:(("nginx",pid=1234,fd=6))
      const pidMatch = line.match(/pid=(\d+)/);
      const nameMatch = line.match(/\("([^"]+)"/);

      if (pidMatch) {
        processes.push({
          pid: pidMatch[1],
          name: nameMatch ? nameMatch[1] : 'unknown',
          command: line.trim()
        });
      }
    }

    return { available: processes.length === 0, processes };
  }

  parseLsofOutput(output, port) {
    const processes = [];
    const lines = output.trim().split('\n');

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        processes.push({
          pid: parts[1],
          name: parts[0],
          command: line.trim()
        });
      }
    }

    return { available: processes.length === 0, processes };
  }

  async checkAllPorts(portMappings) {
    const conflicts = [];

    for (const mapping of portMappings) {
      const check = await this.checkPortAvailability(mapping.host);
      if (!check.available) {
        conflicts.push({
          port: mapping.host,
          containerPort: mapping.container,
          processes: check.processes
        });
      }
    }

    return { hasConflicts: conflicts.length > 0, conflicts };
  }

  async killProcess(pid) {
    logger.step(`终止进程 PID: ${pid}`);
    const result = await this.ssh.execCommand(`kill -9 ${pid}`);

    if (result.stderr && !result.stdout && result.code !== 0) {
      throw new Error(`终止进程 ${pid} 失败: ${result.stderr}`);
    }

    logger.success(`进程 ${pid} 已终止`);
    return true;
  }

  // ========== Container Lifecycle ==========

  async containerExists(containerName) {
    if (!containerName) return false;

    const result = await this.ssh.execCommand(
      `docker ps -a -q --filter name=^/${containerName}$`
    );

    return result.stdout.trim().length > 0;
  }

  async containerIsRunning(containerName) {
    if (!containerName) return false;

    const result = await this.ssh.execCommand(
      `docker ps -q --filter name=^/${containerName}$`
    );

    return result.stdout.trim().length > 0;
  }

  // ========== Volume Path Resolution ==========

  resolveVolumePaths(docker, deployDir) {
    if (!docker.volumeMappings || docker.volumeMappings.length === 0) {
      return docker;
    }

    return {
      ...docker,
      volumeMappings: docker.volumeMappings.map(v => ({
        ...v,
        host: `${deployDir}/${v.host}`
      }))
    };
  }

  // ========== Deploy Branching ==========

  async deploy(config, mode = 'full') {
    const { deploy: deployConfig, project } = config;
    const { server, docker } = deployConfig;
    const remoteDir = server.deployDir;

    const resolvedDocker = this.resolveVolumePaths(docker, remoteDir);

    if (mode === 'quick') {
      await this.quickUpdate(config, resolvedDocker, remoteDir);
    } else {
      await this.fullDeploy(config, resolvedDocker, remoteDir);
    }
  }

  async fullDeploy(config, docker, remoteDir) {
    logger.header('首次部署（构建镜像 + 启动容器）');

    // Create remote directory
    logger.step(`创建远程目录: ${remoteDir}`);
    await this.ssh.execCommand(`mkdir -p ${remoteDir}`);

    // Create volume host directories
    if (docker.volumeMappings) {
      for (const vol of docker.volumeMappings) {
        await this.ssh.execCommand(`mkdir -p ${vol.host}`);
        logger.info(`  创建卷目录: ${vol.host}`);
      }
    }

    // Upload Docker build context (Dockerfile, nginx.conf, entrypoint.sh)
    await this.uploadFiles(remoteDir);

    // Build Docker image (only on first deploy)
    await this.buildImage(remoteDir, docker);

    // Stop old container
    await this.stopContainerByName(docker.containerName || docker.imageName);

    // Start new container (with volume mounts)
    await this.startContainer(remoteDir, docker);

    // Upload build artifacts to volume directories
    // 镜像不包含代码，代码通过 volume 挂载，所以首次也要上传
    await this.uploadArtifactsToVolumes(config, docker);

    logger.success('完整部署完成');
  }

  async quickUpdate(config, docker, remoteDir) {
    logger.header('增量更新（仅更新代码，不重建镜像）');

    // Ensure volume directories exist
    if (docker.volumeMappings) {
      for (const vol of docker.volumeMappings) {
        await this.ssh.execCommand(`mkdir -p ${vol.host}`);
      }
    }

    // Upload build artifacts to volume directories
    await this.uploadArtifactsToVolumes(config, docker);

    // Restart container
    const containerName = docker.containerName || docker.imageName;
    logger.step(`重启容器: ${containerName}`);
    const result = await this.ssh.execCommand(`docker restart ${containerName}`);

    if (result.stderr && !result.stdout) {
      throw new Error(`容器重启失败: ${result.stderr}`);
    }

    logger.success(`容器已重启: ${containerName}`);
  }

  // ========== Upload Build Artifacts to Volumes ==========

  /**
   * 将前后端编译产物上传到 volume 映射的宿主机目录
   * 首次部署和增量更新共用此方法
   */
  async uploadArtifactsToVolumes(config, docker) {
    const localRemoteDir = path.join(this.projectRoot, DEPLOY_DIR, REMOTE_DIR);

    if (!docker.volumeMappings || docker.volumeMappings.length === 0) {
      logger.warn('未配置卷映射，跳过产物上传');
      return;
    }

    for (const vol of docker.volumeMappings) {
      if (vol.type === 'frontend') {
        const localFrontendDir = path.join(localRemoteDir, 'frontend');
        if (await fs.pathExists(localFrontendDir)) {
          logger.step(`上传前端资源 → ${vol.host}`);
          await this.ssh.execCommand(`rm -rf ${vol.host}/*`);
          await this.uploadDirectoryToRemote(localFrontendDir, vol.host);
          logger.success('前端资源已上传');
        }
      } else if (vol.type === 'backend') {
        const localBackendDir = path.join(localRemoteDir, 'backend');
        if (await fs.pathExists(localBackendDir)) {
          logger.step(`上传后端资源 → ${vol.host}`);
          await this.ssh.execCommand(`rm -rf ${vol.host}/*`);
          await this.uploadDirectoryToRemote(localBackendDir, vol.host);
          logger.success('后端资源已上传');
        }
      }
    }
  }

  // ========== File Upload ==========

  async uploadFiles(remoteDir) {
    logger.step('上传文件...');

    const localDir = path.join(this.projectRoot, DEPLOY_DIR, REMOTE_DIR);

    const sftp = await this.ssh.requestSFTP();

    await this.uploadDirectory(sftp, localDir, remoteDir);

    logger.success('文件上传完成');
  }

  async uploadDirectoryToRemote(localPath, remotePath) {
    const sftp = await this.ssh.requestSFTP();
    await this.uploadDirectory(sftp, localPath, remotePath);
  }

  async uploadDirectory(sftp, localPath, remotePath) {
    await this.execSFTP(sftp, 'mkdir', remotePath);

    const entries = await fs.readdir(localPath);

    for (const entry of entries) {
      const localFile = path.join(localPath, entry);
      const remoteFile = `${remotePath}/${entry}`;
      const stats = await fs.stat(localFile);

      if (stats.isDirectory()) {
        await this.uploadDirectory(sftp, localFile, remoteFile);
      } else {
        await this.uploadFile(sftp, localFile, remoteFile);
      }
    }
  }

  async uploadFile(sftp, localPath, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) {
          reject(err);
        } else {
          logger.info(`  上传: ${path.basename(localPath)}`);
          resolve();
        }
      });
    });
  }

  async execSFTP(sftp, method, ...args) {
    return new Promise((resolve, reject) => {
      sftp[method](...args, (err, result) => {
        if (err && err.code !== 4) { // Ignore "file exists" error
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  // ========== Docker Operations ==========

  async buildImage(remoteDir, dockerConfig) {
    const { imageName, buildArgs = {} } = dockerConfig;

    const version = Date.now().toString();
    logger.step(`构建镜像: ${imageName}:${version}`);

    const buildArgsStr = Object.entries(buildArgs)
      .map(([key, value]) => `--build-arg ${key}=${value}`)
      .join(' ');

    const buildCmd = `cd ${remoteDir} && docker build -t ${imageName}:${version} -t ${imageName}:latest ${buildArgsStr} .`;

    const result = await this.ssh.execCommand(buildCmd);

    if (result.stderr && !result.stdout) {
      throw new Error(`Docker 构建失败: ${result.stderr}`);
    }

    logger.success(`镜像构建完成: ${imageName}:${version}`);
    return version;
  }

  async stopContainer(imageName) {
    logger.step('停止旧容器...');

    const result = await this.ssh.execCommand(
      `docker ps -q --filter ancestor=${imageName}`
    );

    if (result.stdout.trim()) {
      const containerIds = result.stdout.trim().split('\n');

      for (const containerId of containerIds) {
        if (containerId) {
          await this.ssh.execCommand(`docker stop ${containerId}`);
          await this.ssh.execCommand(`docker rm ${containerId}`);
          logger.info(`  停止容器: ${containerId.substring(0, 12)}`);
        }
      }
    } else {
      logger.info('  没有运行中的旧容器');
    }
  }

  async stopContainerByName(containerName) {
    if (!containerName) return;

    logger.step(`停止容器: ${containerName}`);

    const result = await this.ssh.execCommand(
      `docker ps -q --filter name=^/${containerName}$`
    );

    if (result.stdout.trim()) {
      await this.ssh.execCommand(`docker stop ${containerName}`);
      await this.ssh.execCommand(`docker rm ${containerName}`);
      logger.info(`  容器 ${containerName} 已停止并移除`);
    } else {
      logger.info(`  容器 ${containerName} 未运行`);
    }
  }

  async startContainer(remoteDir, dockerConfig) {
    logger.step('启动新容器...');

    const {
      imageName,
      containerName,
      portMappings = [],
      volumeMappings = [],
      envVars = {}
    } = dockerConfig;

    let runCmd = `docker run -d`;

    if (containerName) {
      runCmd += ` --name ${containerName}`;
    }

    // Port mappings
    for (const p of portMappings) {
      runCmd += ` -p ${p.host}:${p.container}`;
    }

    // Volume mappings
    for (const v of volumeMappings) {
      runCmd += ` -v ${v.host}:${v.container}`;
    }

    // Environment variables
    for (const [key, value] of Object.entries(envVars)) {
      runCmd += ` -e ${key}=${value}`;
    }

    // Restart policy
    runCmd += ` --restart unless-stopped`;

    runCmd += ` ${imageName}:latest`;

    const result = await this.ssh.execCommand(runCmd);

    if (result.stderr && !result.stdout) {
      throw new Error(`容器启动失败: ${result.stderr}`);
    }

    const containerId = result.stdout.trim();
    logger.success(`容器启动成功: ${containerId.substring(0, 12)}`);
    return containerId;
  }

  disconnect() {
    if (this.connected) {
      this.ssh.dispose();
      this.connected = false;
    }
  }
}
