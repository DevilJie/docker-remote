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
    // Will be implemented in Task 14
  }

  disconnect() {
    if (this.connected) {
      this.ssh.dispose();
      this.connected = false;
    }
  }
}
