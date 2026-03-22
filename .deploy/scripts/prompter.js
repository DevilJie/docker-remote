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

  /**
   * 确认检测结果
   */
  async confirmDetection(detectionResult) {
    this.displayDetectionResult(detectionResult);

    const { confirmed } = await inquirer.prompt([
      {
        type: 'list',
        name: 'confirmed',
        message: '检测结果是否正确?',
        choices: [
          { name: '✅ 正确', value: true },
          { name: '❌ 需要修改', value: false }
        ],
        default: 0
      }
    ]);

    return confirmed;
  }

  /**
   * 显示检测结果
   */
  displayDetectionResult(result) {
    console.log('\n📊 项目检测结果\n');

    const structureNames = {
      monorepo: '单体项目',
      'frontend-only': '仅前端',
      'backend-only': '仅后端',
      single: '单一项目'
    };

    console.log(`项目结构: ${structureNames[result.structure] || result.structure}`);

    if (result.frontend) {
      console.log(`├── 前端: ${result.frontend.framework} (${result.frontend.type})`);
      console.log(`│   └── 构建输出: ${result.frontend.buildDir}/`);
    }

    if (result.backend) {
      console.log(`├── 后端: ${result.backend.framework} (${result.backend.runtime})`);
      console.log(`│   └── 构建输出: ${result.backend.buildDir || '无'}`);
    }

    if (result.proxy) {
      const proxyPaths = Object.keys(result.proxy);
      console.log(`└── 代理配置: ${proxyPaths.join(', ')}`);
    }

    console.log('');
  }

  /**
   * 修改检测结果
   */
  async modifyDetection(detectionResult) {
    // 简单实现：允许用户跳过前端或后端
    const { skipFrontend, skipBackend } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'skipFrontend',
        message: '是否跳过前端部署?',
        default: false
      },
      {
        type: 'confirm',
        name: 'skipBackend',
        message: '是否跳过后端部署?',
        default: false
      }
    ]);

    if (skipFrontend) {
      detectionResult.frontend = null;
    }
    if (skipBackend) {
      detectionResult.backend = null;
    }
  }

  /**
   * 收集服务器信息
   */
  async collectServerInfo() {
    logger.step('收集服务器配置...');

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: '服务器 IP 地址',
        validate: (input) => {
          if (!input.trim()) return '请输入服务器 IP';
          return true;
        }
      },
      {
        type: 'number',
        name: 'port',
        message: 'SSH 端口',
        default: 22,
        validate: (input) => {
          if (input < 1 || input > 65535) return '端口范围: 1-65535';
          return true;
        }
      },
      {
        type: 'input',
        name: 'username',
        message: 'SSH 用户名',
        default: 'root',
        validate: (input) => {
          if (!input.trim()) return '请输入用户名';
          return true;
        }
      },
      {
        type: 'list',
        name: 'authType',
        message: '认证方式',
        choices: [
          { name: '密码', value: 'password' },
          { name: 'SSH 密钥', value: 'key' }
        ],
        default: 'key'
      },
      {
        type: 'input',
        name: 'deployDir',
        message: '部署目录',
        default: '/opt/app',
        validate: (input) => {
          if (!input.trim()) return '请输入部署目录';
          if (!input.startsWith('/')) return '请输入绝对路径';
          return true;
        }
      }
    ]);

    return {
      host: answers.host,
      port: answers.port,
      username: answers.username,
      authType: answers.authType,
      deployDir: answers.deployDir
    };
  }

  /**
   * 收集敏感信息（密码/密钥）
   */
  async collectSecrets(authType) {
    logger.step('收集认证信息...');

    if (authType === 'password') {
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: 'SSH 密码',
          mask: '*',
          validate: (input) => {
            if (!input) return '请输入密码';
            return true;
          }
        }
      ]);

      return {
        password: answers.password,
        keyPath: null,
        passphrase: null
      };
    } else {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'keyPath',
          message: 'SSH 私钥路径',
          default: '~/.ssh/id_rsa',
          validate: (input) => {
            if (!input.trim()) return '请输入密钥路径';
            return true;
          }
        },
        {
          type: 'password',
          name: 'passphrase',
          message: '密钥密码 (可选，留空表示无密码)',
          mask: '*'
        }
      ]);

      return {
        password: null,
        keyPath: answers.keyPath,
        passphrase: answers.passphrase || null
      };
    }
  }

  /**
   * 询问是否保存敏感信息
   */
  async promptSaveSecrets() {
    const { saveSecrets } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'saveSecrets',
        message: '是否保存认证信息供下次使用? (保存到 .deploy/.secrets.json)',
        default: true
      }
    ]);

    return saveSecrets;
  }

  // 以下方法将在后续任务中实现
  async collectDockerConfig(detectionResult) { return {}; }
  async modifyConfig(config) { return config; }
}
