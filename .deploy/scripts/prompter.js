// .deploy/scripts/prompter.js
import inquirer from 'inquirer';
import path from 'path';
import { logger } from './utils/logger.js';

export class Prompter {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * 首次部署：收集完整配置
   */
  async collectNewConfig(detectionResult) {
    logger.header('配置收集');

    // 步骤1: 确认检测结果
    const detectionConfirmed = await this.confirmDetection(detectionResult);
    if (!detectionConfirmed) {
      // 允许用户修改检测结果
      await this.modifyDetection(detectionResult);
    }

    // 步骤2: 收集服务器信息
    const server = await this.collectServerInfo();

    // 步骤3: 收集敏感信息
    const secrets = await this.collectSecrets(server.authType);

    // 步骤4: 收集 Docker 配置
    const docker = await this.collectDockerConfig(detectionResult);

    // 步骤5: 询问是否保存敏感信息
    const saveSecrets = await this.promptSaveSecrets();

    return {
      config: {
        server,
        docker,
        healthCheck: { type: 'auto', path: '/api/health' }
      },
      secrets,
      saveSecrets
    };
  }

  /**
   * 已有配置：显示摘要并询问操作
   * 返回: 'deploy' | 'modify' | 'redetect' | 'cancel'
   */
  async promptExistingConfig(config) {
    this.displayConfigSummary(config);

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '请选择操作',
        choices: [
          { name: '🚀 直接部署', value: 'deploy' },
          { name: '✏️  修改配置', value: 'modify' },
          { name: '🔄 重新检测项目', value: 'redetect' },
          { name: '❌ 取消', value: 'cancel' }
        ]
      }
    ]);

    return action;
  }

  /**
   * 显示配置摘要
   */
  displayConfigSummary(config) {
    console.log('\n📋 已保存的配置\n');

    // 项目信息
    console.log('【项目】');
    console.log(`  名称: ${config.project?.name || '未设置'}`);

    if (config.project?.frontend) {
      console.log(`  前端: ${config.project.frontend.framework} → /var/www/html/`);
    }

    if (config.project?.backend) {
      console.log(`  后端: ${config.project.backend.framework} → /var/app/${config.project.backend.runtime}/`);
    }

    if (config.project?.proxy) {
      const proxyPaths = Object.keys(config.project.proxy);
      console.log(`  代理: ${proxyPaths.join(', ')} → 后端:${config.project?.backend?.port || 8080}`);
    }

    console.log('');

    // 服务器信息
    if (config.deploy?.server) {
      console.log('【服务器】');
      console.log(`  地址: ${config.deploy.server.host}:${config.deploy.server.port}`);
      console.log(`  用户: ${config.deploy.server.username}`);
      console.log(`  认证: ${config.deploy.server.authType === 'key' ? 'SSH密钥' : '密码'}`);
      console.log(`  目录: ${config.deploy.server.deployDir}`);
      console.log('');
    }

    // Docker 信息
    if (config.deploy?.docker) {
      console.log('【Docker】');
      console.log(`  镜像: ${config.deploy.docker.imageName}:latest`);

      const ports = config.deploy.docker.portMappings
        ?.map(p => `${p.host}:${p.container}`)
        .join(', ') || '无';
      console.log(`  端口: ${ports}`);
      console.log('');
    }

    // 上次部署时间
    if (config.lastDeploy) {
      const date = new Date(config.lastDeploy);
      console.log(`上次部署: ${date.toLocaleString('zh-CN')}`);
    }

    console.log('');
  }

  // 以下方法将在后续任务中实现
  async confirmDetection(detectionResult) { return true; }
  async modifyDetection(detectionResult) {}
  async collectServerInfo() { return {}; }
  async collectSecrets(authType) { return {}; }
  async collectDockerConfig(detectionResult) { return {}; }
  async promptSaveSecrets() { return false; }
  async modifyConfig(config) { return config; }
}
