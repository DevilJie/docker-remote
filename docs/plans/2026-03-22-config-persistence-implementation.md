# Docker Deploy Skill - 配置持久化实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 docker-deploy skill 添加交互式用户界面和配置持久化功能，实现首次部署收集配置、再次部署复用配置的能力。

**Architecture:** 新增 `prompter.js` 模块处理所有用户交互，使用 `inquirer` 库提供交互式命令行界面。主流程 `index.js` 根据是否存在已保存配置，调用不同的交互流程。

**Tech Stack:** Node.js 18+, inquirer ^9.2.0, fs-extra, chalk

---

## Phase 1: 依赖安装

### Task 1: 安装 inquirer 依赖

**Files:**
- Modify: `.deploy/scripts/package.json`

**Step 1: 检查现有 package.json**

```bash
cat .deploy/scripts/package.json
```

**Step 2: 安装 inquirer**

```bash
cd .deploy/scripts && npm install inquirer@^9.2.0
```

**Step 3: 验证安装**

```bash
cd .deploy/scripts && npm list inquirer
```
Expected: `inquirer@9.2.x`

**Step 4: Commit**

```bash
git add .deploy/scripts/package.json .deploy/scripts/package-lock.json
git commit -m "chore: add inquirer dependency for interactive prompts"
```

---

## Phase 2: Prompter 模块基础

### Task 2: 创建 prompter.js 骨架

**Files:**
- Create: `.deploy/scripts/prompter.js`

**Step 1: 创建 prompter.js 骨架**

```javascript
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
```

**Step 2: Commit**

```bash
git add .deploy/scripts/prompter.js
git commit -m "feat: add prompter module skeleton"
```

---

### Task 3: 实现确认检测功能

**Files:**
- Modify: `.deploy/scripts/prompter.js`

**Step 1: 实现 confirmDetection 方法**

在 `prompter.js` 中替换 `confirmDetection` 方法：

```javascript
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
        default: true
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
```

**Step 2: Commit**

```bash
git add .deploy/scripts/prompter.js
git commit -m "feat: implement detection confirmation in prompter"
```

---

### Task 4: 实现服务器信息收集

**Files:**
- Modify: `.deploy/scripts/prompter.js`

**Step 1: 实现 collectServerInfo 方法**

在 `prompter.js` 中替换 `collectServerInfo` 方法：

```javascript
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
```

**Step 2: Commit**

```bash
git add .deploy/scripts/prompter.js
git commit -m "feat: implement server info collection in prompter"
```

---

### Task 5: 实现敏感信息收集

**Files:**
- Modify: `.deploy/scripts/prompter.js`

**Step 1: 实现 collectSecrets 和 promptSaveSecrets 方法**

在 `prompter.js` 中替换 `collectSecrets` 和 `promptSaveSecrets` 方法：

```javascript
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
```

**Step 2: Commit**

```bash
git add .deploy/scripts/prompter.js
git commit -m "feat: implement secrets collection in prompter"
```

---

### Task 6: 实现 Docker 配置收集

**Files:**
- Modify: `.deploy/scripts/prompter.js`

**Step 1: 实现 collectDockerConfig 方法**

在 `prompter.js` 中替换 `collectDockerConfig` 方法：

```javascript
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

    return {
      deployMode: 'single',
      imageName: answers.imageName,
      containerName: answers.containerName,
      portMappings,
      volumeMappings: []
    };
  }

  /**
   * 解析端口映射字符串
   */
  parsePortMapping(str) {
    const [host, container] = str.split(':').map(Number);
    return { host, container };
  }
```

**Step 2: Commit**

```bash
git add .deploy/scripts/prompter.js
git commit -m "feat: implement docker config collection in prompter"
```

---

### Task 7: 实现配置修改功能

**Files:**
- Modify: `.deploy/scripts/prompter.js`

**Step 1: 实现 modifyConfig 方法**

在 `prompter.js` 中替换 `modifyConfig` 方法：

```javascript
  /**
   * 修改配置
   */
  async modifyConfig(config) {
    let modifiedConfig = { ...config };
    let modifying = true;

    while (modifying) {
      const { module } = await inquirer.prompt([
        {
          type: 'list',
          name: 'module',
          message: '选择要修改的配置模块',
          choices: [
            { name: '🖥️  服务器配置', value: 'server' },
            { name: '🔨 构建配置', value: 'build' },
            { name: '🐳 Docker 配置', value: 'docker' },
            { name: '💚 健康检查', value: 'healthCheck' },
            { name: '🔀 代理规则', value: 'proxy' },
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
        default: server.host || ''
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

    const { modifyWhich } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'modifyWhich',
        message: '选择要修改的项',
        choices: [
          { name: '前端构建命令', value: 'frontendCmd', disabled: !config.project?.frontend },
          { name: '前端输出目录', value: 'frontendDir', disabled: !config.project?.frontend },
          { name: '后端构建命令', value: 'backendCmd', disabled: !config.project?.backend },
          { name: '后端输出目录', value: 'backendDir', disabled: !config.project?.backend }
        ]
      }
    ]);

    for (const item of modifyWhich) {
      switch (item) {
        case 'frontendCmd':
          const fc = await inquirer.prompt([
            {
              type: 'input',
              name: 'buildCommand',
              message: '前端构建命令',
              default: config.project.frontend.buildCommand
            }
          ]);
          config.project.frontend.buildCommand = fc.buildCommand;
          break;
        case 'frontendDir':
          const fd = await inquirer.prompt([
            {
              type: 'input',
              name: 'buildDir',
              message: '前端输出目录',
              default: config.project.frontend.buildDir
            }
          ]);
          config.project.frontend.buildDir = fd.buildDir;
          break;
        case 'backendCmd':
          const bc = await inquirer.prompt([
            {
              type: 'input',
              name: 'buildCommand',
              message: '后端构建命令',
              default: config.project.backend.buildCommand
            }
          ]);
          config.project.backend.buildCommand = bc.buildCommand;
          break;
        case 'backendDir':
          const bd = await inquirer.prompt([
            {
              type: 'input',
              name: 'buildDir',
              message: '后端输出目录',
              default: config.project.backend.buildDir
            }
          ]);
          config.project.backend.buildDir = bd.buildDir;
          break;
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
          { name: '删除代理', value: 'remove' },
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
      config.project.proxy[newProxy.path] = { target: 'http://localhost:8080' };

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
```

**Step 2: Commit**

```bash
git add .deploy/scripts/prompter.js
git commit -m "feat: implement config modification in prompter"
```

---

## Phase 3: 主流程集成

### Task 8: 更新 index.js 主流程

**Files:**
- Modify: `.deploy/scripts/index.js`

**Step 1: 导入 Prompter 并更新 run 方法**

完整替换 `index.js`:

```javascript
// .deploy/scripts/index.js
import { Detector } from './detector.js';
import { ConfigManager } from './config.js';
import { Generator } from './generator.js';
import { Builder } from './builder.js';
import { Deployer } from './deployer.js';
import { HealthChecker } from './health-check.js';
import { Prompter } from './prompter.js';
import { logger } from './utils/logger.js';

export class DockerDeploy {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.detector = new Detector(projectRoot);
    this.configManager = new ConfigManager(projectRoot);
    this.generator = new Generator(projectRoot);
    this.builder = new Builder(projectRoot);
    this.deployer = new Deployer(projectRoot);
    this.prompter = new Prompter(projectRoot);
  }

  async run(options = {}) {
    try {
      // Phase 1: Detect project
      const detectionResult = await this.detector.detect();

      // Phase 2: Load or collect config
      let config, secrets;

      const hasConfig = await this.configManager.load();

      if (hasConfig) {
        // 已有配置
        const action = await this.prompter.promptExistingConfig(
          this.configManager.config
        );

        if (action === 'deploy') {
          config = this.configManager.config;
          secrets = await this.configManager.loadSecrets();

          // 如果没有保存的密钥，需要重新收集
          if (!secrets && config.deploy?.server) {
            secrets = await this.prompter.collectSecrets(
              config.deploy.server.authType
            );

            const saveSecrets = await this.prompter.promptSaveSecrets();
            if (saveSecrets) {
              await this.configManager.saveSecrets(secrets);
            }
          }

        } else if (action === 'modify') {
          config = await this.prompter.modifyConfig(this.configManager.config);

          // 修改后可能需要重新收集密钥
          if (config.deploy?.server) {
            secrets = await this.prompter.collectSecrets(
              config.deploy.server.authType
            );

            const saveSecrets = await this.prompter.promptSaveSecrets();
            if (saveSecrets) {
              await this.configManager.saveSecrets(secrets);
            }
          }

        } else if (action === 'redetect') {
          config = this.configManager.createDefaultConfig(detectionResult);
          const result = await this.prompter.collectNewConfig(detectionResult);

          config.deploy = {
            ...config.deploy,
            server: result.config.server,
            docker: result.config.docker,
            healthCheck: result.config.healthCheck
          };

          secrets = result.secrets;

          if (result.saveSecrets) {
            await this.configManager.saveSecrets(secrets);
          }

        } else {
          logger.info('用户取消部署');
          return { success: false, error: '用户取消' };
        }

      } else {
        // 首次部署
        const defaultConfig = this.configManager.createDefaultConfig(detectionResult);
        const result = await this.prompter.collectNewConfig(detectionResult);

        config = {
          ...defaultConfig,
          deploy: {
            ...defaultConfig.deploy,
            server: result.config.server,
            docker: result.config.docker,
            healthCheck: result.config.healthCheck
          }
        };

        secrets = result.secrets;

        if (result.saveSecrets) {
          await this.configManager.saveSecrets(secrets);
        }
      }

      // Phase 3: Build (if not skipped)
      if (!options.skipBuild) {
        await this.builder.build(config);
      } else {
        logger.info('跳过构建步骤');
      }

      // Phase 4: Generate files
      await this.generator.generate(config);

      // Phase 5: Deploy (if server configured and !options.dryRun)
      if (config.deploy?.server && !options.dryRun) {
        await this.deployer.connect(config.deploy.server, secrets);
        await this.deployer.deploy(config);

        // Phase 6: Health check
        const healthChecker = new HealthChecker(this.deployer.ssh);
        const healthResult = await healthChecker.check(config);

        if (!healthResult.success) {
          logger.error(`健康检查失败: ${healthResult.reason}`);
          // Could ask user about rollback here
        }

        this.deployer.disconnect();
      } else if (options.dryRun) {
        logger.info('Dry run 模式，跳过实际部署');
      }

      // Update last deploy time
      config.lastDeploy = new Date().toISOString();

      // Save config
      await this.configManager.save(config);

      logger.success('部署流程完成');
      return { success: true, config };

    } catch (error) {
      logger.error(`部署失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const deploy = new DockerDeploy();
  deploy.run().then(result => {
    process.exit(result.success ? 0 : 1);
  });
}
```

**Step 2: Commit**

```bash
git add .deploy/scripts/index.js
git commit -m "feat: integrate prompter into main deployment flow"
```

---

## Phase 4: 测试与完善

### Task 9: 添加 CLI 参数支持

**Files:**
- Modify: `.deploy/scripts/index.js`

**Step 1: 添加命令行参数解析**

在 `index.js` 末尾更新 CLI 入口：

```javascript
// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const options = {
    skipBuild: args.includes('--skip-build'),
    dryRun: args.includes('--dry-run')
  };

  const deploy = new DockerDeploy();
  deploy.run(options).then(result => {
    process.exit(result.success ? 0 : 1);
  });
}
```

**Step 2: 更新 SKILL.md 文档**

更新 `SKILL.md` 添加新的选项：

```markdown
### 选项

- `--mode <mode>` - 部署模式: single (单容器) | separate (分离部署)
- `--env <env>` - 环境配置: dev | test | prod
- `--skip-build` - 跳过构建步骤
- `--dry-run` - 仅生成文件，不执行实际部署
- `--rollback` - 回滚到上一版本
```

**Step 3: Commit**

```bash
git add .deploy/scripts/index.js SKILL.md
git commit -m "feat: add CLI argument support for skip-build and dry-run"
```

---

### Task 10: 最终验证与提交

**Step 1: 检查所有文件**

```bash
ls -la .deploy/scripts/
```

Expected files:
- index.js
- prompter.js
- config.js
- detector.js
- generator.js
- builder.js
- deployer.js
- health-check.js
- utils/constants.js
- utils/logger.js

**Step 2: 检查语法**

```bash
node --check .deploy/scripts/index.js
node --check .deploy/scripts/prompter.js
```

**Step 3: 最终提交**

```bash
git add -A
git commit -m "feat: complete config persistence and interactive prompts for docker-deploy skill"
```

---

## 实现总结

| 任务 | 描述 | 文件 |
|------|------|------|
| Task 1 | 安装 inquirer 依赖 | package.json |
| Task 2 | 创建 prompter.js 骨架 | prompter.js |
| Task 3 | 实现确认检测功能 | prompter.js |
| Task 4 | 实现服务器信息收集 | prompter.js |
| Task 5 | 实现敏感信息收集 | prompter.js |
| Task 6 | 实现 Docker 配置收集 | prompter.js |
| Task 7 | 实现配置修改功能 | prompter.js |
| Task 8 | 更新主流程 | index.js |
| Task 9 | 添加 CLI 参数支持 | index.js, SKILL.md |
| Task 10 | 最终验证 | - |
