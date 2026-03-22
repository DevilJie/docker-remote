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

    const { host, port, username, authType, deployDir } = serverConfig;

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

      // Check Docker
      await this.checkDocker();

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

  async installDocker() {
    logger.step('安装 Docker...');

    // Detect OS and install Docker
    const osResult = await this.ssh.execCommand('cat /etc/os-release');

    let installCmd;
    if (osResult.stdout.includes('Ubuntu') || osResult.stdout.includes('Debian')) {
      installCmd = 'apt-get update && apt-get install -y docker.io && systemctl start docker';
    } else if (osResult.stdout.includes('CentOS') || osResult.stdout.includes('RHEL')) {
      installCmd = 'yum install -y docker-ce && systemctl start docker';
    } else if (osResult.stdout.includes('Alpine')) {
      installCmd = 'apk add docker && rc-service docker start';
    } else {
      throw new Error('不支持的操作系统，请手动安装 Docker');
    }

    const result = await this.ssh.execCommand(installCmd, { execOptions: { pty: true } });

    if (result.stderr && !result.stdout) {
      logger.error('Docker 安装失败');
      return false;
    }

    logger.success('Docker 安装成功');
    return true;
  }

  async deploy(config) {
    const { deploy: deployConfig, project } = config;
    const { server, docker } = deployConfig;

    logger.header('📤 部署到服务器');

    // Create remote directory
    const remoteDir = server.deployDir;
    logger.step(`创建远程目录: ${remoteDir}`);
    await this.ssh.execCommand(`mkdir -p ${remoteDir}`);

    // Upload files
    await this.uploadFiles(remoteDir);

    // Build Docker image
    await this.buildImage(remoteDir, docker);

    // Stop old container
    await this.stopContainer(docker.imageName);

    // Start new container
    await this.startContainer(remoteDir, docker);

    logger.success('部署完成');
  }

  async uploadFiles(remoteDir) {
    logger.step('上传文件...');

    const localDir = path.join(this.projectRoot, DEPLOY_DIR, REMOTE_DIR);

    // Use SFTP to upload
    const sftp = await this.ssh.requestSFTP();

    // Upload files recursively
    await this.uploadDirectory(sftp, localDir, remoteDir);

    logger.success('文件上传完成');
  }

  async uploadDirectory(sftp, localPath, remotePath) {
    // Ensure remote directory exists
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

  async buildImage(remoteDir, dockerConfig) {
    logger.step('构建 Docker 镜像...');

    const { imageName, buildArgs = {} } = dockerConfig;

    // Build args string
    const buildArgsStr = Object.entries(buildArgs)
      .map(([key, value]) => `--build-arg ${key}=${value}`)
      .join(' ');

    const buildCmd = `cd ${remoteDir} && docker build ${buildArgsStr} -t ${imageName} .`;

    const result = await this.ssh.execCommand(buildCmd);

    if (result.stderr && !result.stdout) {
      throw new Error(`Docker 构建失败: ${result.stderr}`);
    }

    logger.success(`镜像构建完成: ${imageName}`);
  }

  async stopContainer(imageName) {
    logger.step('停止旧容器...');

    // Find container by image name
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

  async startContainer(remoteDir, dockerConfig) {
    logger.step('启动新容器...');

    const { imageName, containerName, ports = [], envVars = {} } = dockerConfig;

    // Build docker run command
    let runCmd = `docker run -d`;

    // Container name
    if (containerName) {
      runCmd += ` --name ${containerName}`;
    }

    // Port mappings
    for (const port of ports) {
      runCmd += ` -p ${port}`;
    }

    // Environment variables
    for (const [key, value] of Object.entries(envVars)) {
      runCmd += ` -e ${key}=${value}`;
    }

    // Image name
    runCmd += ` ${imageName}`;

    const result = await this.ssh.execCommand(runCmd);

    if (result.stderr && !result.stdout) {
      throw new Error(`容器启动失败: ${result.stderr}`);
    }

    const containerId = result.stdout.trim().substring(0, 12);
    logger.success(`容器启动成功: ${containerId}`);
  }

  disconnect() {
    if (this.connected) {
      this.ssh.dispose();
      this.connected = false;
    }
  }
}
