// .deploy/scripts/prompter.js
import inquirer from 'inquirer';
import path from 'path';
import { logger } from './utils/logger.js';
import { ConfigManager } from './config.js';

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
      if (config.deploy.docker.containerName) {
        console.log(`  容器: ${config.deploy.docker.containerName}`);
      }

      const ports = config.deploy.docker.portMappings
        ?.map(p => `${p.host}:${p.container}`)
        .join(', ') || '无';
      console.log(`  端口: ${ports}`);
      console.log('');
    }

    // 部署目录
    if (config.deploy?.server?.deployDir) {
      console.log('【部署目录】');
      console.log(`  路径: ${config.deploy.server.deployDir}`);
      console.log('');
    }

    // 卷映射
    if (config.deploy?.docker?.volumeMappings?.length > 0) {
      console.log('【卷映射】');
      for (const v of config.deploy.docker.volumeMappings) {
        console.log(`  ${v.host} → ${v.container} (${v.type || 'custom'})`);
      }
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

    // Java 后端：询问 JDK 版本
    if (confirmed && detectionResult.backend?.runtime === 'java') {
      await this.collectJavaVersion(detectionResult);
    }

    return confirmed;
  }

  /**
   * 收集 Java/JDK 版本
   */
  async collectJavaVersion(detectionResult) {
    const { jdkVersion } = await inquirer.prompt([
      {
        type: 'list',
        name: 'jdkVersion',
        message: '请选择 JDK 版本',
        choices: [
          { name: 'JDK 8', value: '8' },
          { name: 'JDK 11', value: '11' },
          { name: 'JDK 17', value: '17' },
          { name: 'JDK 21', value: '21' }
        ],
        default: '17'
      }
    ]);

    detectionResult.backend.jdkVersion = jdkVersion;
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

    const projectName = path.basename(this.projectRoot);

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
        message: '服务器部署目录',
        default: `~/app/${projectName}`,
        validate: (input) => {
          if (!input.trim()) return '请输入部署目录';
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

  /**
   * 收集 Docker 配置
   */
  async collectDockerConfig(detectionResult) {
    logger.step('收集 Docker 配置...');

    const projectName = path.basename(this.projectRoot);

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'imageName',
        message: 'Docker 镜像名称',
        default: projectName,
        validate: (input) => {
          if (!input.trim()) return '请输入镜像名称';
          if (!/^[a-z0-9][a-z0-9._-]*$/i.test(input)) {
            return '镜像名称只能包含字母、数字、.、_、-';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'containerName',
        message: '容器名称',
        default: `${projectName}-container`,
        validate: (input) => {
          if (!input.trim()) return '请输入容器名称';
          return true;
        }
      },
      {
        type: 'input',
        name: 'portMapping',
        message: '端口映射 (主机端口:容器端口)',
        default: '8080:80',
        validate: (input) => {
          if (!/^\d+:\d+$/.test(input)) return '格式: 主机端口:容器端口，如 8080:80';
          return true;
        }
      },
      {
        type: 'confirm',
        name: 'addMorePorts',
        message: '是否添加更多端口映射?',
        default: false
      }
    ]);

    const portMappings = [this.parsePortMapping(answers.portMapping)];

    // 添加更多端口映射
    if (answers.addMorePorts) {
      let addMore = true;
      while (addMore) {
        const extra = await inquirer.prompt([
          {
            type: 'input',
            name: 'portMapping',
            message: '额外端口映射 (留空结束)',
            validate: (input) => {
              if (!input) return true;
              if (!/^\d+:\d+$/.test(input)) return '格式: 主机端口:容器端口';
              return true;
            }
          },
          {
            type: 'confirm',
            name: 'addMore',
            message: '继续添加?',
            default: false
          }
        ]);

        if (extra.portMapping) {
          portMappings.push(this.parsePortMapping(extra.portMapping));
        }
        addMore = extra.addMore && extra.portMapping;
      }
    }

    // 收集 volume 映射
    const defaultVolumes = ConfigManager.getDefaultVolumeMappings(detectionResult);
    const volumeMappings = await this.collectVolumeMappings(defaultVolumes);

    return {
      deployMode: 'single',
      imageName: answers.imageName,
      containerName: answers.containerName,
      portMappings,
      volumeMappings
    };
  }

  /**
   * 解析端口映射字符串
   */
  parsePortMapping(str) {
    const [host, container] = str.split(':').map(Number);
    return { host, container };
  }

  // ========== Volume Mapping Configuration ==========

  /**
   * 展示 volume 映射表格
   */
  displayVolumeMappings(mappings) {
    console.log('\n📂 卷映射配置 (Volume Mappings)\n');
    console.log('  序号  宿主机路径              →  容器路径                    类型');
    console.log('  ────  ────────────────────────  ────────────────────────────  ──────────');
    mappings.forEach((m, i) => {
      const typeLabel = { frontend: '前端', backend: '后端', 'log-backend': '后端日志', 'log-nginx': 'Nginx日志', custom: '自定义' }[m.type] || m.type;
      console.log(`  ${String(i + 1).padEnd(4)}  ${m.host.padEnd(24)} →  ${m.container.padEnd(28)} ${typeLabel}`);
    });
    console.log('');
  }

  /**
   * 收集 volume 映射配置
   * 展示默认映射，用户可确认或自定义修改
   */
  async collectVolumeMappings(defaultMappings) {
    if (!defaultMappings || defaultMappings.length === 0) {
      logger.info('未检测到需要映射的卷');
      return [];
    }

    this.displayVolumeMappings(defaultMappings);

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '卷映射配置',
        choices: [
          { name: '✅ 确认默认配置', value: 'confirm' },
          { name: '✏️  修改映射路径', value: 'modify' },
          { name: '➕ 添加自定义映射', value: 'add' },
          { name: '⏭️  跳过（不使用卷映射）', value: 'skip' }
        ],
        default: 'confirm'
      }
    ]);

    if (action === 'skip') {
      return [];
    }

    if (action === 'confirm') {
      return defaultMappings;
    }

    let mappings = JSON.parse(JSON.stringify(defaultMappings));

    if (action === 'modify') {
      mappings = await this.modifyVolumeMappings(mappings);
    }

    // 无论是否修改过，都询问是否要添加额外的自定义映射
    const { addCustom } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addCustom',
        message: '是否添加额外的自定义卷映射?',
        default: false
      }
    ]);

    if (addCustom) {
      const customMappings = await this.addCustomVolumeMappings();
      mappings = mappings.concat(customMappings);
    }

    // 展示最终配置
    this.displayVolumeMappings(mappings);

    return mappings;
  }

  /**
   * 修改已有的 volume 映射
   */
  async modifyVolumeMappings(mappings) {
    const result = [];

    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      const typeLabel = { frontend: '前端', backend: '后端', 'log-backend': '后端日志', 'log-nginx': 'Nginx日志' }[m.type] || m.type;

      console.log(`\n  [${i + 1}/${mappings.length}] ${typeLabel}映射`);

      const { modifyThis } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'modifyThis',
          message: `修改? (${m.host} → ${m.container})`,
          default: false
        }
      ]);

      if (modifyThis) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'host',
            message: '宿主机路径 (相对于部署目录)',
            default: m.host,
            validate: (input) => input.trim() ? true : '请输入路径'
          },
          {
            type: 'input',
            name: 'container',
            message: '容器路径',
            default: m.container,
            validate: (input) => {
              if (!input.trim()) return '请输入路径';
              if (!input.startsWith('/')) return '容器路径必须以 / 开头';
              return true;
            }
          }
        ]);

        result.push({ ...m, host: answers.host, container: answers.container });
      } else {
        result.push(m);
      }
    }

    return result;
  }

  /**
   * 添加自定义 volume 映射
   */
  async addCustomVolumeMappings() {
    const customMappings = [];
    let addMore = true;

    while (addMore) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: '宿主机路径 (相对于部署目录)',
          validate: (input) => input.trim() ? true : '请输入路径'
        },
        {
          type: 'input',
          name: 'container',
          message: '容器路径',
          validate: (input) => {
            if (!input.trim()) return '请输入路径';
            if (!input.startsWith('/')) return '容器路径必须以 / 开头';
            return true;
          }
        }
      ]);

      customMappings.push({
        host: answers.host,
        container: answers.container,
        type: 'custom'
      });

      const { continueAdd } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAdd',
          message: '继续添加?',
          default: false
        }
      ]);

      addMore = continueAdd;
    }

    return customMappings;
  }

  /**
   * 修改配置
   */
  async modifyConfig(config) {
    let modifiedConfig = JSON.parse(JSON.stringify(config)); // 深拷贝
    let modifying = true;

    while (modifying) {
      const { module } = await inquirer.prompt([
        {
          type: 'list',
          name: 'module',
          message: '选择要修改的配置模块',
          choices: [
            { name: '🖥️  服务器配置', value: 'server' },
            { name: '🔨 构建配置', value: 'build', disabled: !modifiedConfig.project?.frontend && !modifiedConfig.project?.backend },
            { name: '🐳 Docker 配置', value: 'docker' },
            { name: '💚 健康检查', value: 'healthCheck' },
            { name: '🔀 代理规则', value: 'proxy', disabled: !modifiedConfig.project?.proxy },
            { name: '✅ 完成修改', value: 'done' }
          ]
        }
      ]);

      if (module === 'done') {
        modifying = false;
      } else {
        switch (module) {
          case 'server':
            modifiedConfig = await this.modifyServerConfig(modifiedConfig);
            break;
          case 'build':
            modifiedConfig = await this.modifyBuildConfig(modifiedConfig);
            break;
          case 'docker':
            modifiedConfig = await this.modifyDockerConfig(modifiedConfig);
            break;
          case 'healthCheck':
            modifiedConfig = await this.modifyHealthCheckConfig(modifiedConfig);
            break;
          case 'proxy':
            modifiedConfig = await this.modifyProxyConfig(modifiedConfig);
            break;
        }
      }
    }

    return modifiedConfig;
  }

  /**
   * 修改服务器配置
   */
  async modifyServerConfig(config) {
    const server = config.deploy?.server || {};

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: '服务器 IP',
        default: server.host || '',
        validate: (input) => input.trim() ? true : '请输入服务器 IP'
      },
      {
        type: 'number',
        name: 'port',
        message: 'SSH 端口',
        default: server.port || 22
      },
      {
        type: 'input',
        name: 'username',
        message: '用户名',
        default: server.username || 'root'
      },
      {
        type: 'list',
        name: 'authType',
        message: '认证方式',
        choices: [
          { name: '密码', value: 'password' },
          { name: 'SSH 密钥', value: 'key' }
        ],
        default: server.authType || 'key'
      },
      {
        type: 'input',
        name: 'deployDir',
        message: '部署目录',
        default: server.deployDir || '/opt/app'
      }
    ]);

    config.deploy = config.deploy || {};
    config.deploy.server = answers;

    return config;
  }

  /**
   * 修改构建配置
   */
  async modifyBuildConfig(config) {
    console.log('\n当前构建配置:');

    if (config.project?.frontend) {
      console.log(`  前端构建命令: ${config.project.frontend.buildCommand}`);
      console.log(`  前端输出目录: ${config.project.frontend.buildDir}`);
    }

    if (config.project?.backend) {
      console.log(`  后端构建命令: ${config.project.backend.buildCommand}`);
      console.log(`  后端输出目录: ${config.project.backend.buildDir}`);
    }

    const choices = [];
    if (config.project?.frontend) {
      choices.push({ name: '前端构建命令', value: 'frontendCmd' });
      choices.push({ name: '前端输出目录', value: 'frontendDir' });
    }
    if (config.project?.backend) {
      choices.push({ name: '后端构建命令', value: 'backendCmd' });
      choices.push({ name: '后端输出目录', value: 'backendDir' });
    }

    const { modifyWhich } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'modifyWhich',
        message: '选择要修改的项',
        choices
      }
    ]);

    for (const item of modifyWhich) {
      if (item === 'frontendCmd' && config.project?.frontend) {
        const fc = await inquirer.prompt([
          {
            type: 'input',
            name: 'buildCommand',
            message: '前端构建命令',
            default: config.project.frontend.buildCommand
          }
        ]);
        config.project.frontend.buildCommand = fc.buildCommand;
      } else if (item === 'frontendDir' && config.project?.frontend) {
        const fd = await inquirer.prompt([
          {
            type: 'input',
            name: 'buildDir',
            message: '前端输出目录',
            default: config.project.frontend.buildDir
          }
        ]);
        config.project.frontend.buildDir = fd.buildDir;
      } else if (item === 'backendCmd' && config.project?.backend) {
        const bc = await inquirer.prompt([
          {
            type: 'input',
            name: 'buildCommand',
            message: '后端构建命令',
            default: config.project.backend.buildCommand
          }
        ]);
        config.project.backend.buildCommand = bc.buildCommand;
      } else if (item === 'backendDir' && config.project?.backend) {
        const bd = await inquirer.prompt([
          {
            type: 'input',
            name: 'buildDir',
            message: '后端输出目录',
            default: config.project.backend.buildDir
          }
        ]);
        config.project.backend.buildDir = bd.buildDir;
      }
    }

    return config;
  }

  /**
   * 修改 Docker 配置
   */
  async modifyDockerConfig(config) {
    const docker = config.deploy?.docker || {};

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'imageName',
        message: '镜像名称',
        default: docker.imageName || path.basename(this.projectRoot)
      },
      {
        type: 'input',
        name: 'containerName',
        message: '容器名称',
        default: docker.containerName || `${path.basename(this.projectRoot)}-container`
      },
      {
        type: 'input',
        name: 'ports',
        message: '端口映射 (逗号分隔，格式 host:container)',
        default: docker.portMappings?.map(p => `${p.host}:${p.container}`).join(', ') || '8080:80'
      }
    ]);

    // 询问是否修改卷映射
    const currentVolumes = docker.volumeMappings || [];
    if (currentVolumes.length > 0) {
      this.displayVolumeMappings(currentVolumes);

      const { editVolumes } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'editVolumes',
          message: '是否修改卷映射?',
          default: false
        }
      ]);

      if (editVolumes) {
        const volumeMappings = await this.collectVolumeMappings(currentVolumes);
        config.deploy = config.deploy || {};
        config.deploy.docker = {
          ...docker,
          imageName: answers.imageName,
          containerName: answers.containerName,
          portMappings: answers.ports.split(',').map(p => {
            const [host, container] = p.trim().split(':').map(Number);
            return { host, container };
          }),
          volumeMappings
        };
        return config;
      }
    }

    config.deploy = config.deploy || {};
    config.deploy.docker = {
      ...docker,
      imageName: answers.imageName,
      containerName: answers.containerName,
      portMappings: answers.ports.split(',').map(p => {
        const [host, container] = p.trim().split(':').map(Number);
        return { host, container };
      })
    };

    return config;
  }

  /**
   * 修改健康检查配置
   */
  async modifyHealthCheckConfig(config) {
    const healthCheck = config.deploy?.healthCheck || {};

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: '健康检查路径',
        default: healthCheck.path || '/api/health'
      }
    ]);

    config.deploy = config.deploy || {};
    config.deploy.healthCheck = {
      type: 'auto',
      path: answers.path
    };

    return config;
  }

  /**
   * 修改代理配置
   */
  async modifyProxyConfig(config) {
    const proxy = config.project?.proxy || {};
    const proxyPaths = Object.keys(proxy);

    console.log('\n当前代理规则:');
    proxyPaths.forEach(p => console.log(`  ${p} → 后端`));

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '代理规则操作',
        choices: [
          { name: '添加代理', value: 'add' },
          { name: '删除代理', value: 'remove', disabled: proxyPaths.length === 0 },
          { name: '返回', value: 'back' }
        ]
      }
    ]);

    if (action === 'add') {
      const newProxy = await inquirer.prompt([
        {
          type: 'input',
          name: 'path',
          message: '代理路径 (如 /api)',
          validate: (input) => {
            if (!input.trim()) return '请输入路径';
            if (!input.startsWith('/')) return '路径必须以 / 开头';
            return true;
          }
        }
      ]);

      config.project = config.project || {};
      config.project.proxy = config.project.proxy || {};
      config.project.proxy[newProxy.path] = { target: `http://localhost:${config.project?.backend?.port || 8080}` };

    } else if (action === 'remove' && proxyPaths.length > 0) {
      const { toRemove } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'toRemove',
          message: '选择要删除的代理',
          choices: proxyPaths.map(p => ({ name: p, value: p }))
        }
      ]);

      for (const p of toRemove) {
        delete config.project.proxy[p];
      }
    }

    return config;
  }

  // ========== New: Deploy Directory ==========

  /**
   * 询问宿主机部署目录
   */
  async promptDeployDir() {
    const projectName = path.basename(this.projectRoot);
    const defaultDir = `~/app/${projectName}`;

    console.log('\n📂 宿主机部署目录配置\n');
    console.log(`  将创建以下目录结构:`);
    console.log(`  ${defaultDir}/volumes/frontend/  → /var/www/html/`);
    console.log(`  ${defaultDir}/volumes/backend/   → /var/app/...`);
    console.log(`  ${defaultDir}/volumes/logs/      → 日志目录\n`);

    const { deployDir } = await inquirer.prompt([
      {
        type: 'input',
        name: 'deployDir',
        message: '部署目录 (服务器上的根路径)',
        default: defaultDir,
        validate: (input) => {
          if (!input.trim()) return '请输入部署目录';
          return true;
        }
      }
    ]);

    return deployDir;
  }

  // ========== New: Port Conflict Resolution ==========

  /**
   * 端口冲突解决
   * 返回: { resolvedPortMappings, processesToKill, cancelled }
   */
  async promptPortConflictResolution(conflicts) {
    console.log('\n⚠️  端口冲突检测\n');

    const resolvedPortMappings = [];
    const processesToKill = [];

    for (const conflict of conflicts) {
      console.log(`端口 ${conflict.port} (→ 容器端口 ${conflict.containerPort}) 已被占用:`);
      for (const proc of conflict.processes) {
        console.log(`  PID: ${proc.pid}  进程: ${proc.name}`);
        console.log(`  ${proc.command}`);
      }
      console.log('');

      let resolved = false;

      while (!resolved) {
        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: `端口 ${conflict.port} 被占用，请选择操作`,
            choices: [
              { name: '更换端口', value: 'change' },
              { name: `终止占用进程 (PID: ${conflict.processes.map(p => p.pid).join(', ')})`, value: 'kill' },
              { name: '取消部署', value: 'cancel' }
            ]
          }
        ]);

        if (action === 'cancel') {
          return { resolvedPortMappings: [], processesToKill: [], cancelled: true };

        } else if (action === 'change') {
          const { newPort } = await inquirer.prompt([
            {
              type: 'number',
              name: 'newPort',
              message: '输入新的端口号',
              validate: (input) => {
                if (input < 1 || input > 65535) return '端口范围: 1-65535';
                return true;
              }
            }
          ]);

          resolvedPortMappings.push({
            host: newPort,
            container: conflict.containerPort
          });
          resolved = true;

        } else if (action === 'kill') {
          for (const proc of conflict.processes) {
            processesToKill.push(proc.pid);
          }
          resolvedPortMappings.push({
            host: conflict.port,
            container: conflict.containerPort
          });
          resolved = true;
        }
      }
    }

    return { resolvedPortMappings, processesToKill, cancelled: false };
  }

  // ========== New: Deploy Mode ==========

  /**
   * 询问部署模式（检测到已有容器时）
   * 返回: 'quick' | 'full' | 'cancel'
   */
  async promptDeployMode(containerName) {
    console.log(`\n📋 检测到已有部署容器 (${containerName})\n`);

    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: '请选择部署方式',
        choices: [
          { name: '快速更新 (仅更新 volumes 目录中的文件，重启容器)', value: 'quick' },
          { name: '完整部署 (重建镜像和容器)', value: 'full' },
          { name: '取消', value: 'cancel' }
        ],
        default: 'quick'
      }
    ]);

    return mode;
  }

  // ========== Docker Installation ==========

  /**
   * 询问用户是否安装 Docker，以及镜像加速地址
   * 返回: { install: boolean, mirrorUrl: string|null }
   */
  async promptDockerInstall() {
    console.log('\n⚠️  服务器未安装 Docker\n');

    const { install } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'install',
        message: '是否在服务器上自动安装 Docker？（拒绝将终止部署）',
        default: true
      }
    ]);

    if (!install) {
      return { install: false, mirrorUrl: null };
    }

    const { mirrorUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'mirrorUrl',
        message: 'Docker 镜像加速地址（留空跳过，如 https://mirror.ccs.tencentyun.com）',
        default: ''
      }
    ]);

    return {
      install: true,
      mirrorUrl: mirrorUrl.trim() || null
    };
  }
}
