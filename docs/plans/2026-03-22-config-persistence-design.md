# Docker Deploy Skill - 配置持久化与用户交互设计

> **Created:** 2026-03-22
> **Status:** Approved

## 背景

当前 docker-deploy skill 已实现核心部署功能，但缺少用户交互和配置持久化能力。用户每次部署都需要重新输入配置信息。

## 目标

1. 首次部署时，通过交互式问答收集配置并保存
2. 再次部署时，自动加载已保存配置，用户可选择直接使用或修改
3. 敏感信息（密码/密钥）单独存储，用户可选择是否保存

## 设计方案

### 文件结构

```
.deploy/scripts/
├── index.js           # 主流程（调整：调用 prompter）
├── prompter.js        # 新增：用户交互模块
├── config.js          # 配置管理（保持不变）
├── detector.js        # 项目检测（保持不变）
├── generator.js       # 文件生成（保持不变）
├── builder.js         # 构建执行（保持不变）
├── deployer.js        # 部署执行（保持不变）
├── health-check.js    # 健康检查（保持不变）
└── utils/
    ├── constants.js   # 常量（保持不变）
    └── logger.js      # 日志（保持不变）

.deploy/
├── config.json        # 部署配置（已有）
├── .secrets.json      # 敏感信息（已有，已加入 .gitignore）
└── remote/            # 生成的部署文件（已有）
```

### 依赖

新增 `inquirer` 依赖用于交互式命令行界面。

```json
{
  "dependencies": {
    "inquirer": "^9.2.0",
    ...
  }
}
```

### prompter.js 类设计

```javascript
class Prompter {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  // 首次部署：收集完整配置
  async collectNewConfig(detectionResult) { ... }

  // 已有配置：显示摘要并询问操作
  // 返回: 'deploy' | 'modify' | 'redetect' | 'cancel'
  async promptExistingConfig(config) { ... }

  // 修改配置：交互式修改
  async modifyConfig(config) { ... }

  // 收集服务器信息
  async collectServerInfo() { ... }

  // 收集敏感信息（密码/密钥）
  async collectSecrets(authType) { ... }

  // 是否保存敏感信息
  async promptSaveSecrets() { ... }

  // 确认检测结果
  async confirmDetection(detectionResult) { ... }
}
```

### 主流程 (index.js)

```javascript
async run(options = {}) {
  // 1. 检测项目
  const detectionResult = await this.detector.detect();

  // 2. 加载配置
  const hasConfig = await this.configManager.load();

  let config, secrets;

  if (hasConfig) {
    // 3a. 已有配置 → 显示摘要 + 选择操作
    const action = await this.prompter.promptExistingConfig(
      this.configManager.config
    );

    if (action === 'deploy') {
      config = this.configManager.config;
      secrets = await this.configManager.loadSecrets();
      if (!secrets) {
        secrets = await this.prompter.collectSecrets(config.deploy.server.authType);
      }
    } else if (action === 'modify') {
      config = await this.prompter.modifyConfig(this.configManager.config);
    } else if (action === 'redetect') {
      config = this.configManager.createDefaultConfig(detectionResult);
      config = await this.prompter.collectNewConfig(detectionResult);
    } else {
      return { success: false, error: '用户取消' };
    }
  } else {
    // 3b. 首次部署 → 收集完整配置
    config = await this.prompter.collectNewConfig(detectionResult);
  }

  // 4. 构建（如果未跳过）
  if (!options.skipBuild) {
    await this.builder.build(config);
  }

  // 5. 生成文件
  await this.generator.generate(config);

  // 6. 部署
  if (config.deploy.server) {
    await this.deployer.connect(config.deploy.server, secrets);
    await this.deployer.deploy(config);

    // 7. 健康检查
    const healthChecker = new HealthChecker(this.deployer.ssh);
    const healthResult = await healthChecker.check(config);
    // ...

    this.deployer.disconnect();
  }

  // 8. 保存配置
  await this.configManager.save(config);

  return { success: true, config };
}
```

## 交互流程设计

### 1. 首次部署 - collectNewConfig()

**步骤 1: 确认检测结果**

```
📊 项目检测结果
├── 项目结构: 单体项目
├── 前端: Vue (static)
├── 后端: Java Spring Boot
└── 代理配置: /api, /upload

检测结果是否正确? (Y/n/修改)
```

**步骤 2: 收集服务器信息**

```
🖥️  服务器配置

服务器 IP: _______________
SSH 端口: (22) ___________
用户名: _______________
认证方式: (○ 密码  ○ SSH密钥)
部署目录: (/opt/app) ________
```

**步骤 3: 收集敏感信息**

```
🔐 认证信息

[若选密码] 密码: _______________
[若选密钥] 密钥路径: ______________
[若选密钥] 密钥密码(可选): ________
```

**步骤 4: Docker 配置**

```
🐳 Docker 配置

镜像名称: (my-app) ________
容器名称: (my-app-container) ____
端口映射: (8080:80) ____________

是否需要添加更多端口映射? (y/N)
```

**步骤 5: 保存确认**

```
💾 配置保存

是否保存服务器认证信息供下次使用?
(Y/n) - 保存到 .deploy/.secrets.json
```

### 2. 再次部署 - promptExistingConfig()

```
📋 已保存的配置

【项目】
  名称: my-app
  前端: Vue → /var/www/html/
  后端: Java → /var/app/jar/
  代理: /api, /upload → 后端:8080

【服务器】
  地址: 192.168.1.100:22
  用户: deploy
  认证: SSH密钥
  目录: /opt/my-app

【Docker】
  镜像: my-app:latest
  端口: 8080:80

上次部署: 2026-03-22 10:30
────────────────────────────────────
请选择操作:
  ❯ 🚀 直接部署
    ✏️  修改配置
    🔄 重新检测项目
    ❌ 取消
```

### 3. 修改配置 - modifyConfig()

```
✏️  选择要修改的配置模块

  ❯ 🖥️  服务器配置
    🔨 构建配置
    🐳 Docker 配置
    💚 健康检查
    🔀 代理规则
    ✅ 完成修改
```

**各模块可修改项：**

| 模块 | 可修改项 |
|------|----------|
| 服务器 | IP、端口、用户名、认证方式、部署目录 |
| 构建 | 前端构建命令、后端构建命令、构建输出目录 |
| Docker | 镜像名、容器名、端口映射、卷挂载 |
| 健康检查 | 检查路径、超时时间 |
| 代理 | 添加/删除/修改代理规则 |

## 配置文件格式

### config.json

```json
{
  "version": "1.0",
  "project": {
    "name": "my-app",
    "type": "monorepo",
    "frontend": {
      "framework": "vue",
      "type": "static",
      "buildDir": "dist",
      "buildCommand": "npm run build",
      "directory": "frontend"
    },
    "backend": {
      "framework": "java",
      "runtime": "java",
      "port": 8080,
      "buildDir": "target",
      "buildCommand": "mvn clean package -DskipTests",
      "directory": "backend"
    },
    "proxy": {
      "/api": { "target": "http://localhost:8080" },
      "/upload": { "target": "http://localhost:8080" }
    }
  },
  "deploy": {
    "server": {
      "host": "192.168.1.100",
      "port": 22,
      "username": "deploy",
      "authType": "key",
      "deployDir": "/opt/my-app"
    },
    "docker": {
      "deployMode": "single",
      "imageName": "my-app",
      "containerName": "my-app-container",
      "portMappings": [{ "host": 8080, "container": 80 }],
      "volumeMappings": []
    },
    "healthCheck": {
      "type": "auto",
      "path": "/api/health"
    }
  },
  "lastDeploy": "2026-03-22T10:30:00.000Z"
}
```

### .secrets.json

```json
{
  "password": null,
  "keyPath": "/home/user/.ssh/id_rsa",
  "passphrase": null
}
```

## 实现任务

1. 安装 inquirer 依赖
2. 创建 prompter.js 模块
3. 实现首次部署交互流程
4. 实现再次部署交互流程
5. 实现配置修改功能
6. 调整 index.js 主流程
7. 测试完整流程
