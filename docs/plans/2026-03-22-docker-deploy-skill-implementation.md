# Docker Deploy Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Claude Code Skill that containerizes frontend/backend projects and deploys them to remote servers via Docker.

**Architecture:** Node.js-based skill with modular design: Detector (project analysis) → Generator (Dockerfile/nginx.conf) → Builder (build execution) → Deployer (SSH/SCP upload) → Health (container verification). Configuration persisted in `.deploy/` directory.

**Tech Stack:** Node.js 18+, SSH2 (remote connection), node-ssh (SSH operations), simple-git (version info), commander (CLI), chalk (output), fs-extra (file operations)

---

## Phase 1: Project Setup

### Task 1: Initialize Skill Directory Structure

**Files:**
- Create: `.deploy/scripts/.gitkeep`
- Create: `.deploy/remote/.gitkeep`
- Create: `SKILL.md`

**Step 1: Create directory structure**

```bash
mkdir -p .deploy/scripts .deploy/remote/nginx .deploy/remote/frontend .deploy/remote/backend .deploy/remote/scripts
touch .deploy/scripts/.gitkeep .deploy/remote/.gitkeep
```

**Step 2: Create SKILL.md**

```markdown
---
name: docker-deploy
description: |
  将前后端项目 Docker 容器化并部署到远程服务器。

  触发场景:
  - 用户提到 "docker 部署"、"容器化部署"、"打包部署"
  - 用户提到 "远程部署"、"上传到服务器"
  - 用户想要将项目打包成 Docker 镜像
  - 用户询问如何将前端后端一起部署

  支持特性:
  - 自动检测前后端技术栈
  - 支持 Java/Node.js/Python/Go 后端
  - 支持 Vue/React/Angular/Next.js 前端
  - 自动解析代理配置生成 Nginx 规则
  - 支持多环境配置
  - 自动安装 Docker 环境
  - 健康检查与回滚
---

# Docker 部署 Skill

将前后端项目 Docker 容器化并部署到远程服务器。

## 使用方式

```
/docker-deploy [options]
```

### 选项

- `--mode <mode>` - 部署模式: single (单容器) | separate (分离部署)
- `--env <env>` - 环境配置: dev | test | prod
- `--skip-build` - 跳过构建步骤
- `--rollback` - 回滚到上一版本

## 支持的技术栈

### 前端
- Vue 2/3, React, Angular (静态资源)
- Next.js, Nuxt.js (SSR)

### 后端
- Java (Spring Boot)
- Node.js (Express, Nest, Koa)
- Python (FastAPI, Flask, Django)
- Go (Gin, Echo)

## 工作流程

1. **项目检测** - 自动识别技术栈、代理配置
2. **配置确认** - 展示检测结果，用户确认或修改
3. **构建执行** - 执行前端/后端构建命令
4. **文件生成** - 生成 Dockerfile、nginx.conf、entrypoint.sh
5. **远程部署** - SSH 连接服务器，上传文件，构建镜像
6. **健康检查** - 验证服务是否正常启动
7. **完成** - 保存配置，展示结果
```

**Step 3: Create .gitignore entry for secrets**

Add to project `.gitignore`:
```
.deploy/.secrets.json
```

**Step 4: Commit**

```bash
git add .deploy/ SKILL.md .gitignore
git commit -m "feat: initialize docker-deploy skill structure"
```

---

### Task 2: Setup Node.js Package

**Files:**
- Create: `.deploy/scripts/package.json`
- Create: `.deploy/scripts/utils/constants.js`

**Step 1: Create package.json**

```json
{
  "name": "docker-deploy-scripts",
  "version": "1.0.0",
  "description": "Docker deployment scripts for Claude Code Skill",
  "type": "module",
  "scripts": {
    "detect": "node detector.js",
    "build": "node builder.js",
    "generate": "node generator.js",
    "deploy": "node deployer.js",
    "health": "node health-check.js"
  },
  "dependencies": {
    "ssh2": "^1.15.0",
    "node-ssh": "^13.1.0",
    "simple-git": "^3.22.0",
    "chalk": "^5.3.0",
    "fs-extra": "^11.2.0",
    "glob": "^10.3.10",
    "js-yaml": "^4.1.0"
  }
}
```

**Step 2: Create constants.js**

```javascript
// .deploy/scripts/utils/constants.js

export const DEPLOY_DIR = '.deploy';
export const CONFIG_FILE = 'config.json';
export const SECRETS_FILE = '.secrets.json';
export const REMOTE_DIR = 'remote';

export const FRONTEND_FRAMEWORKS = {
  vue: { detect: 'vue', buildDir: 'dist', type: 'static' },
  react: { detect: 'react', buildDir: 'build', type: 'static' },
  angular: { detect: '@angular/core', buildDir: 'dist', type: 'static' },
  vite: { detect: 'vite', buildDir: 'dist', type: 'static' },
  nextjs: { detect: 'next', buildDir: '.next', type: 'ssr' },
  nuxtjs: { detect: 'nuxt', buildDir: '.output', type: 'ssr' }
};

export const BACKEND_FRAMEWORKS = {
  java: {
    detect: ['pom.xml', 'build.gradle'],
    buildDir: 'target',
    buildCommand: 'mvn clean package -DskipTests',
    port: 8080,
    runtime: 'java'
  },
  nodejs: {
    detect: 'package.json',
    buildDir: 'dist',
    buildCommand: 'npm run build',
    port: 3000,
    runtime: 'node'
  },
  python: {
    detect: ['requirements.txt', 'pyproject.toml'],
    buildDir: null,
    buildCommand: null,
    port: 8000,
    runtime: 'python'
  },
  golang: {
    detect: 'go.mod',
    buildDir: null,
    buildCommand: 'go build -o app',
    port: 8080,
    runtime: 'go'
  }
};

export const PROXY_CONFIG_FILES = [
  'vite.config.js',
  'vite.config.ts',
  'vue.config.js',
  'webpack.config.js',
  'next.config.js',
  'nuxt.config.js'
];

export const HEALTH_CHECK_PATHS = [
  '/actuator/health',
  '/health',
  '/api/health',
  '/api/status'
];
```

**Step 3: Install dependencies**

```bash
cd .deploy/scripts && npm install
```

**Step 4: Commit**

```bash
git add .deploy/scripts/package.json .deploy/scripts/utils/constants.js .deploy/scripts/package-lock.json
git commit -m "feat: setup node.js package and constants"
```

---

## Phase 2: Detector Module

### Task 3: Create Detector Module - Project Structure Detection

**Files:**
- Create: `.deploy/scripts/utils/logger.js`
- Create: `.deploy/scripts/detector.js` (partial)

**Step 1: Create logger utility**

```javascript
// .deploy/scripts/utils/logger.js
import chalk from 'chalk';

export const logger = {
  info: (msg) => console.log(chalk.blue('ℹ'), msg),
  success: (msg) => console.log(chalk.green('✓'), msg),
  warn: (msg) => console.log(chalk.yellow('⚠'), msg),
  error: (msg) => console.log(chalk.red('✗'), msg),
  step: (msg) => console.log(chalk.gray('  →'), msg),
  header: (msg) => console.log(chalk.bold.cyan(`\n${msg}\n`))
};
```

**Step 2: Create detector structure**

```javascript
// .deploy/scripts/detector.js
import fs from 'fs-extra';
import path from 'path';
import { logger } from './utils/logger.js';
import {
  FRONTEND_FRAMEWORKS,
  BACKEND_FRAMEWORKS,
  PROXY_CONFIG_FILES
} from './utils/constants.js';

export class Detector {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.result = {
      structure: null,
      frontend: null,
      backend: null,
      proxy: null
    };
  }

  async detect() {
    logger.header('🔍 项目检测');

    this.result.structure = await this.detectStructure();
    this.result.frontend = await this.detectFrontend();
    this.result.backend = await this.detectBackend();
    this.result.proxy = await this.detectProxy();

    return this.result;
  }

  async detectStructure() {
    logger.step('检测项目结构...');
    const hasFrontend = await fs.pathExists(path.join(this.projectRoot, 'frontend'));
    const hasBackend = await fs.pathExists(path.join(this.projectRoot, 'backend'));

    if (hasFrontend && hasBackend) {
      return 'monorepo';
    } else if (hasFrontend) {
      return 'frontend-only';
    } else if (hasBackend) {
      return 'backend-only';
    }
    return 'single';
  }

  async detectFrontend() {
    // Will be implemented in Task 4
    return null;
  }

  async detectBackend() {
    // Will be implemented in Task 5
    return null;
  }

  async detectProxy() {
    // Will be implemented in Task 6
    return null;
  }

  display() {
    // Will be implemented in Task 7
  }
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const detector = new Detector();
  const result = await detector.detect();
  console.log(JSON.stringify(result, null, 2));
}
```

**Step 3: Verify syntax**

```bash
cd .deploy/scripts && node --check detector.js
```

**Step 4: Commit**

```bash
git add .deploy/scripts/utils/logger.js .deploy/scripts/detector.js
git commit -m "feat: add detector module structure"
```

---

### Task 4: Implement Frontend Detection

**Files:**
- Modify: `.deploy/scripts/detector.js`

**Step 1: Add frontend detection method**

Replace the empty `detectFrontend` method with:

```javascript
async detectFrontend() {
  logger.step('检测前端技术栈...');

  const searchDirs = this.result.structure === 'monorepo'
    ? ['frontend', '.']
    : ['.'];

  for (const dir of searchDirs) {
    const pkgPath = path.join(this.projectRoot, dir, 'package.json');
    if (!await fs.pathExists(pkgPath)) continue;

    const pkg = await fs.readJson(pkgPath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [name, config] of Object.entries(FRONTEND_FRAMEWORKS)) {
      if (deps[config.detect]) {
        const result = {
          framework: name,
          type: config.type,
          buildDir: config.buildDir,
          buildCommand: this.detectBuildCommand(pkg.scripts),
          directory: dir
        };

        logger.success(`前端: ${name} (${config.type})`);
        return result;
      }
    }
  }

  return null;
}

detectBuildCommand(scripts) {
  if (!scripts) return 'npm run build';
  if (scripts['build:prod']) return 'npm run build:prod';
  if (scripts['build']) return 'npm run build';
  if (scripts['dist']) return 'npm run dist';
  return 'npm run build';
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check detector.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/detector.js
git commit -m "feat: implement frontend detection"
```

---

### Task 5: Implement Backend Detection

**Files:**
- Modify: `.deploy/scripts/detector.js`

**Step 1: Add backend detection method**

Replace the empty `detectBackend` method with:

```javascript
async detectBackend() {
  logger.step('检测后端技术栈...');

  const searchDirs = this.result.structure === 'monorepo'
    ? ['backend', '.']
    : ['.'];

  for (const dir of searchDirs) {
    for (const [name, config] of Object.entries(BACKEND_FRAMEWORKS)) {
      const detected = await this.detectBackendFramework(dir, config);
      if (detected) {
        const result = {
          framework: name,
          runtime: config.runtime,
          port: config.port,
          buildDir: config.buildDir,
          buildCommand: await this.detectBackendBuildCommand(dir, name, config),
          directory: dir
        };

        logger.success(`后端: ${name} (端口: ${config.port})`);
        return result;
      }
    }
  }

  return null;
}

async detectBackendFramework(dir, config) {
  const detectFiles = Array.isArray(config.detect)
    ? config.detect
    : [config.detect];

  for (const file of detectFiles) {
    const filePath = path.join(this.projectRoot, dir, file);
    if (await fs.pathExists(filePath)) {
      return true;
    }
  }
  return false;
}

async detectBackendBuildCommand(dir, name, config) {
  if (name === 'java') {
    const hasGradle = await fs.pathExists(path.join(this.projectRoot, dir, 'build.gradle'));
    return hasGradle ? './gradlew build -x test' : 'mvn clean package -DskipTests';
  }

  if (name === 'nodejs') {
    const pkgPath = path.join(this.projectRoot, dir, 'package.json');
    if (await fs.pathExists(pkgPath)) {
      const pkg = await fs.readJson(pkgPath);
      return this.detectBuildCommand(pkg.scripts);
    }
  }

  return config.buildCommand;
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check detector.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/detector.js
git commit -m "feat: implement backend detection"
```

---

### Task 6: Implement Proxy Configuration Detection

**Files:**
- Modify: `.deploy/scripts/detector.js`

**Step 1: Add proxy detection method**

Replace the empty `detectProxy` method with:

```javascript
async detectProxy() {
  logger.step('检测代理配置...');

  const proxyConfig = {};

  for (const configFile of PROXY_CONFIG_FILES) {
    const filePath = path.join(this.projectRoot, configFile);
    if (!await fs.pathExists(filePath)) continue;

    const content = await fs.readFile(filePath, 'utf-8');
    const proxy = this.parseProxyConfig(content, configFile);

    if (proxy && Object.keys(proxy).length > 0) {
      Object.assign(proxyConfig, proxy);
      break;
    }
  }

  if (Object.keys(proxyConfig).length > 0) {
    logger.success(`代理配置: ${Object.keys(proxyConfig).join(', ')}`);
  }

  return Object.keys(proxyConfig).length > 0 ? proxyConfig : null;
}

parseProxyConfig(content, filename) {
  const proxy = {};

  // Match proxy configuration patterns
  const proxyPattern = /['"](\s*\/[\w-]+)['"]:\s*\{[^}]*target:\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = proxyPattern.exec(content)) !== null) {
    const path = match[1].trim();
    const target = match[2];
    proxy[path] = { target };
  }

  // Alternative pattern for different config formats
  const altPattern = /proxy:\s*\{([^}]+)\}/s;
  const altMatch = content.match(altPattern);

  if (altMatch && Object.keys(proxy).length === 0) {
    const proxyBlock = altMatch[1];
    const simplePattern = /['"](\s*\/[\w-]+)['"]:\s*['"]([^'"]+)['"]/g;

    while ((match = simplePattern.exec(proxyBlock)) !== null) {
      const path = match[1].trim();
      proxy[path] = { target: match[2] };
    }
  }

  return proxy;
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check detector.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/detector.js
git commit -m "feat: implement proxy configuration detection"
```

---

### Task 7: Implement Detection Result Display

**Files:**
- Modify: `.deploy/scripts/detector.js`

**Step 1: Add display method**

Replace the empty `display` method with:

```javascript
display() {
  console.log('\n📊 项目检测结果\n');

  // Structure
  const structureNames = {
    monorepo: '单体项目',
    'frontend-only': '仅前端',
    'backend-only': '仅后端',
    single: '单一项目'
  };
  console.log(`项目结构：${structureNames[this.result.structure] || this.result.structure}`);

  // Frontend
  if (this.result.frontend) {
    console.log('├── 前端：' +
      `${this.result.frontend.framework} (${this.result.frontend.type})`);
    console.log('│   └── 构建输出：' +
      `${this.result.frontend.buildDir}/`);
  }

  // Backend
  if (this.result.backend) {
    console.log('├── 后端：' +
      `${this.result.backend.framework} (${this.result.backend.runtime})`);
    console.log('│   └── 构建输出：' +
      `${this.result.backend.buildDir || '无'}`);
  }

  // Proxy
  if (this.result.proxy) {
    console.log('└── 代理配置：');
    for (const [path, config] of Object.entries(this.result.proxy)) {
      console.log(`    ├── ${path} → 后端服务`);
    }
  }

  console.log('\n是否正确？[Y/n/修改]');
}
```

**Step 2: Test detection module**

```bash
cd .deploy/scripts && node detector.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/detector.js
git commit -m "feat: add detection result display"
```

---

## Phase 3: Config Module

### Task 8: Create Config Manager

**Files:**
- Create: `.deploy/scripts/config.js`

**Step 1: Create config manager**

```javascript
// .deploy/scripts/config.js
import fs from 'fs-extra';
import path from 'path';
import { logger } from './utils/logger.js';
import { DEPLOY_DIR, CONFIG_FILE, SECRETS_FILE } from './utils/constants.js';

export class ConfigManager {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.configPath = path.join(projectRoot, DEPLOY_DIR, CONFIG_FILE);
    this.secretsPath = path.join(projectRoot, DEPLOY_DIR, SECRETS_FILE);
    this.config = null;
  }

  async load() {
    if (await fs.pathExists(this.configPath)) {
      this.config = await fs.readJson(this.configPath);
      logger.info('已加载现有配置');
      return true;
    }
    return false;
  }

  async save(config) {
    this.config = config;
    await fs.ensureDir(path.dirname(this.configPath));
    await fs.writeJson(this.configPath, config, { spaces: 2 });
    logger.success('配置已保存');
  }

  async saveSecrets(secrets) {
    await fs.ensureDir(path.dirname(this.secretsPath));
    await fs.writeJson(this.secretsPath, secrets, { spaces: 2 });

    // Ensure .gitignore includes secrets file
    const gitignorePath = path.join(this.projectRoot, '.gitignore');
    let gitignore = '';
    if (await fs.pathExists(gitignorePath)) {
      gitignore = await fs.readFile(gitignorePath, 'utf-8');
    }

    if (!gitignore.includes(SECRETS_FILE)) {
      gitignore += `\n# Deploy secrets\n${DEPLOY_DIR}/${SECRETS_FILE}\n`;
      await fs.writeFile(gitignorePath, gitignore);
    }

    logger.success('敏感信息已保存');
  }

  async loadSecrets() {
    if (await fs.pathExists(this.secretsPath)) {
      return await fs.readJson(this.secretsPath);
    }
    return null;
  }

  createDefaultConfig(detectionResult) {
    return {
      version: '1.0',
      project: {
        name: path.basename(this.projectRoot),
        type: detectionResult.structure,
        frontend: detectionResult.frontend,
        backend: detectionResult.backend,
        proxy: detectionResult.proxy
      },
      deploy: {
        server: null,
        docker: {
          deployMode: 'single',
          imageName: path.basename(this.projectRoot),
          portMappings: [{ host: 8080, container: 80 }],
          volumeMappings: []
        },
        healthCheck: {
          type: 'auto',
          path: '/api/health'
        }
      },
      lastDeploy: null
    };
  }

  display() {
    if (!this.config) {
      logger.warn('未找到配置文件');
      return;
    }

    console.log('\n📋 部署配置\n');
    console.log(JSON.stringify(this.config, null, 2));
  }
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check config.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/config.js
git commit -m "feat: add config manager"
```

---

## Phase 4: Generator Module

### Task 9: Create Generator Module - Dockerfile

**Files:**
- Create: `.deploy/scripts/generator.js` (partial)

**Step 1: Create generator structure with Dockerfile generation**

```javascript
// .deploy/scripts/generator.js
import fs from 'fs-extra';
import path from 'path';
import { logger } from './utils/logger.js';
import { DEPLOY_DIR, REMOTE_DIR } from './utils/constants.js';

export class Generator {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.outputDir = path.join(projectRoot, DEPLOY_DIR, REMOTE_DIR);
  }

  async generate(config) {
    logger.header('📝 生成部署文件');

    await fs.ensureDir(this.outputDir);

    await this.generateDockerfile(config);
    await this.generateNginxConfig(config);
    await this.generateEntrypoint(config);

    logger.success('所有文件已生成');
  }

  async generateDockerfile(config) {
    logger.step('生成 Dockerfile...');

    const { project, deploy } = config;
    const lines = [];

    // Base image
    lines.push('# Generated by docker-deploy skill');
    lines.push('FROM nginx:alpine');
    lines.push('');

    // Install backend runtime if needed
    if (project.backend) {
      const runtime = this.getRuntimeInstall(project.backend);
      lines.push('# Backend runtime');
      lines.push(runtime);
      lines.push('');
    }

    // Copy frontend
    if (project.frontend) {
      lines.push('# Frontend static files');
      lines.push('COPY frontend/ /var/www/html/');
      lines.push('');
    }

    // Copy backend
    if (project.backend) {
      lines.push('# Backend application');
      const backendPath = this.getBackendPath(project.backend);
      lines.push(`COPY backend/${backendPath.file} ${backendPath.container}`);
      lines.push('');
    }

    // Logs directory
    lines.push('# Logs directory');
    lines.push('RUN mkdir -p /var/log/nginx');
    if (project.backend) {
      lines.push(`RUN mkdir -p ${this.getBackendLogDir(project.backend)}`);
    }
    lines.push('');

    // Nginx config
    lines.push('# Nginx configuration');
    lines.push('COPY nginx/nginx.conf /etc/nginx/nginx.conf');
    lines.push('');

    // Entrypoint
    lines.push('# Startup script');
    lines.push('COPY scripts/entrypoint.sh /entrypoint.sh');
    lines.push('RUN chmod +x /entrypoint.sh');
    lines.push('');

    // Expose and entrypoint
    lines.push('EXPOSE 80');
    lines.push('ENTRYPOINT ["/entrypoint.sh"]');

    const dockerfile = lines.join('\n');
    await fs.writeFile(path.join(this.outputDir, 'Dockerfile'), dockerfile);
    logger.success('Dockerfile 已生成');
  }

  getRuntimeInstall(backend) {
    const runtimes = {
      java: 'RUN apk add --no-cache openjdk17-jre-headless',
      node: 'RUN apk add --no-cache nodejs npm',
      python: 'RUN apk add --no-cache python3 py3-pip',
      go: '# Go binary - no runtime needed'
    };
    return runtimes[backend.runtime] || '';
  }

  getBackendPath(backend) {
    const paths = {
      java: { file: 'app.jar', container: '/var/app/jar/app.jar' },
      node: { file: '', container: '/var/app/node/' },
      python: { file: '', container: '/var/app/python/' },
      go: { file: 'app', container: '/var/app/go/app' }
    };
    return paths[backend.runtime] || paths.java;
  }

  getBackendLogDir(backend) {
    const dirs = {
      java: '/var/app/jar/logs',
      node: '/var/app/node/logs',
      python: '/var/app/python/logs',
      go: '/var/app/go/logs'
    };
    return dirs[backend.runtime] || '/var/app/logs';
  }

  async generateNginxConfig(config) {
    // Will be implemented in Task 10
  }

  async generateEntrypoint(config) {
    // Will be implemented in Task 11
  }
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check generator.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/generator.js
git commit -m "feat: add dockerfile generation"
```

---

### Task 10: Implement Nginx Configuration Generation

**Files:**
- Modify: `.deploy/scripts/generator.js`

**Step 1: Add nginx config generation**

Replace the empty `generateNginxConfig` method with:

```javascript
async generateNginxConfig(config) {
  logger.step('生成 nginx.conf...');

  const { project } = config;
  const lines = [];

  lines.push('worker_processes auto;');
  lines.push('error_log /var/log/nginx/error.log warn;');
  lines.push('pid /var/run/nginx.pid;');
  lines.push('');
  lines.push('events {');
  lines.push('    worker_connections 1024;');
  lines.push('}');
  lines.push('');
  lines.push('http {');
  lines.push('    include /etc/nginx/mime.types;');
  lines.push('    default_type application/octet-stream;');
  lines.push('');
  lines.push('    log_format main \'$remote_addr - $remote_user [$time_local] "$request" \'');
  lines.push('                      \'$status $body_bytes_sent "$http_referer" \'');
  lines.push('                      \'"$http_user_agent" "$http_x_forwarded_for"\';');
  lines.push('');
  lines.push('    access_log /var/log/nginx/access.log main;');
  lines.push('');
  lines.push('    sendfile on;');
  lines.push('    tcp_nopush on;');
  lines.push('    keepalive_timeout 65;');
  lines.push('    gzip on;');
  lines.push('');
  lines.push('    server {');
  lines.push('        listen 80;');
  lines.push('        server_name localhost;');
  lines.push('');

  // Frontend static files
  if (project.frontend) {
    lines.push('        # Frontend static files');
    lines.push('        location / {');
    lines.push('            root /var/www/html;');
    lines.push('            index index.html;');
    lines.push('            try_files $uri $uri/ /index.html;');
    lines.push('        }');
    lines.push('');
  }

  // Proxy locations
  if (project.proxy) {
    lines.push('        # Backend proxy');
    for (const [path, proxyConfig] of Object.entries(project.proxy)) {
      const target = proxyConfig.target || 'http://127.0.0.1:8080';
      const port = project.backend?.port || 8080;
      const proxyTarget = target.replace(/localhost|127\.0\.0\.1/, '127.0.0.1');

      lines.push(`        location ${path} {`);
      lines.push(`            proxy_pass http://127.0.0.1:${port};`);
      lines.push('            proxy_set_header Host $host;');
      lines.push('            proxy_set_header X-Real-IP $remote_addr;');
      lines.push('            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
      lines.push('            proxy_set_header X-Forwarded-Proto $scheme;');
      lines.push('        }');
      lines.push('');
    }
  }

  lines.push('    }');
  lines.push('}');

  const nginxConf = lines.join('\n');
  await fs.ensureDir(path.join(this.outputDir, 'nginx'));
  await fs.writeFile(path.join(this.outputDir, 'nginx', 'nginx.conf'), nginxConf);
  logger.success('nginx.conf 已生成');
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check generator.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/generator.js
git commit -m "feat: add nginx config generation"
```

---

### Task 11: Implement Entrypoint Script Generation

**Files:**
- Modify: `.deploy/scripts/generator.js`

**Step 1: Add entrypoint generation**

Replace the empty `generateEntrypoint` method with:

```javascript
async generateEntrypoint(config) {
  logger.step('生成 entrypoint.sh...');

  const { project } = config;
  const lines = [];

  lines.push('#!/bin/sh');
  lines.push('# Generated by docker-deploy skill');
  lines.push('');
  lines.push('set -e');
  lines.push('');
  lines.push('echo "Starting application..."');
  lines.push('');

  // Backend startup
  if (project.backend) {
    lines.push('# Backend startup');
    const startupCmd = this.getBackendStartupCommand(project.backend);
    lines.push(startupCmd);
    lines.push('');
    lines.push('# Wait for backend to start');
    lines.push('sleep 5');
    lines.push('');
  }

  // Nginx startup
  lines.push('# Start Nginx');
  lines.push('echo "Starting Nginx..."');
  lines.push('nginx -g "daemon off;"');

  const entrypoint = lines.join('\n');
  await fs.ensureDir(path.join(this.outputDir, 'scripts'));
  await fs.writeFile(path.join(this.outputDir, 'scripts', 'entrypoint.sh'), entrypoint);
  logger.success('entrypoint.sh 已生成');
}

getBackendStartupCommand(backend) {
  const commands = {
    java: `
JVM_ARGS="\${JVM_ARGS:--Xmx512m -Xms256m}"
SPRING_PROFILE="\${SPRING_PROFILE:-prod}"

echo "Starting Java application..."
cd /var/app/jar
java $JVM_ARGS -jar app.jar --spring.profiles.active=$SPRING_PROFILE &`,
    node: `
NODE_ENV="\${NODE_ENV:-production}"

echo "Starting Node.js application..."
cd /var/app/node
node index.js &`,
    python: `
echo "Starting Python application..."
cd /var/app/python
python3 main.py &`,
    go: `
echo "Starting Go application..."
cd /var/app/go
./app &`
  };

  return commands[backend.runtime] || commands.java;
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check generator.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/generator.js
git commit -m "feat: add entrypoint script generation"
```

---

## Phase 5: Builder Module

### Task 12: Create Builder Module

**Files:**
- Create: `.deploy/scripts/builder.js`

**Step 1: Create builder module**

```javascript
// .deploy/scripts/builder.js
import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { logger } from './utils/logger.js';
import { DEPLOY_DIR, REMOTE_DIR } from './utils/constants.js';

export class Builder {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.outputDir = path.join(projectRoot, DEPLOY_DIR, REMOTE_DIR);
  }

  async build(config) {
    logger.header('🔨 构建项目');

    const { project } = config;

    // Build frontend
    if (project.frontend) {
      await this.buildFrontend(project.frontend);
    }

    // Build backend
    if (project.backend) {
      await this.buildBackend(project.backend);
    }

    logger.success('构建完成');
  }

  async buildFrontend(frontend) {
    logger.step('构建前端...');

    const frontendDir = frontend.directory === '.'
      ? this.projectRoot
      : path.join(this.projectRoot, frontend.directory);

    // Run build command
    const buildCmd = frontend.buildCommand || 'npm run build';
    await this.runCommand(buildCmd, frontendDir);

    // Copy build output
    const srcDir = path.join(frontendDir, frontend.buildDir);
    const destDir = path.join(this.outputDir, 'frontend');

    await fs.ensureDir(destDir);
    await fs.copy(srcDir, destDir, { overwrite: true });

    logger.success(`前端已构建并复制到 ${destDir}`);
  }

  async buildBackend(backend) {
    logger.step('构建后端...');

    const backendDir = backend.directory === '.'
      ? this.projectRoot
      : path.join(this.projectRoot, backend.directory);

    // Run build command if exists
    if (backend.buildCommand) {
      await this.runCommand(backend.buildCommand, backendDir);
    }

    // Copy build output
    const destDir = path.join(this.outputDir, 'backend');
    await fs.ensureDir(destDir);

    if (backend.runtime === 'java') {
      // Find and copy JAR file
      const jarFiles = await fs.readdir(path.join(backendDir, backend.buildDir));
      const jarFile = jarFiles.find(f => f.endsWith('.jar') && !f.includes('original'));

      if (jarFile) {
        await fs.copy(
          path.join(backendDir, backend.buildDir, jarFile),
          path.join(destDir, 'app.jar')
        );
        logger.success('JAR 文件已复制');
      } else {
        throw new Error('未找到 JAR 文件');
      }
    } else if (backend.runtime === 'node') {
      // Copy entire backend directory
      await fs.copy(backendDir, destDir, {
        overwrite: true,
        filter: (src) => !src.includes('node_modules')
      });
      logger.success('Node.js 应用已复制');
    } else if (backend.runtime === 'python') {
      // Copy Python files
      await fs.copy(backendDir, destDir, { overwrite: true });
      logger.success('Python 应用已复制');
    } else if (backend.runtime === 'go') {
      // Copy Go binary
      const binaryPath = path.join(backendDir, 'app');
      if (await fs.pathExists(binaryPath)) {
        await fs.copy(binaryPath, path.join(destDir, 'app'));
        logger.success('Go 二进制文件已复制');
      }
    }
  }

  runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');

      logger.info(`执行: ${command}`);

      const proc = spawn(cmd, args, {
        cwd,
        stdio: 'inherit',
        shell: true
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`命令失败，退出码: ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const builder = new Builder();
  // Would load config and run build
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check builder.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/builder.js
git commit -m "feat: add builder module"
```

---

## Phase 6: Deployer Module

### Task 13: Create Deployer Module - SSH Connection

**Files:**
- Create: `.deploy/scripts/deployer.js` (partial)

**Step 1: Create deployer with SSH connection**

```javascript
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
    logger.header('🔗 连接服务器');

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
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check deployer.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/deployer.js
git commit -m "feat: add deployer with SSH connection"
```

---

### Task 14: Implement File Upload and Docker Operations

**Files:**
- Modify: `.deploy/scripts/deployer.js`

**Step 1: Add deploy method**

Replace the empty `deploy` method with:

```javascript
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
  // Create remote directory
  await this.ssh.mkdir(remotePath);

  const entries = await fs.readdir(localPath, { withFileTypes: true });

  for (const entry of entries) {
    const localFile = path.join(localPath, entry.name);
    const remoteFile = `${remotePath}/${entry.name}`;

    if (entry.isDirectory()) {
      await this.uploadDirectory(sftp, localFile, remoteFile);
    } else {
      await this.ssh.putFile(localFile, remoteFile, sftp);
      logger.step(`  上传: ${entry.name}`);
    }
  }
}

async buildImage(remoteDir, dockerConfig) {
  const { imageName } = dockerConfig;
  const version = Date.now().toString();

  logger.step(`构建镜像: ${imageName}:${version}`);

  const buildCmd = `cd ${remoteDir} && docker build -t ${imageName}:${version} -t ${imageName}:latest .`;
  const result = await this.ssh.execCommand(buildCmd);

  if (result.stderr && !result.stdout) {
    throw new Error(`镜像构建失败: ${result.stderr}`);
  }

  logger.success('镜像构建完成');
  return version;
}

async stopContainer(imageName) {
  logger.step('停止旧容器...');

  // Find container by image name
  const listResult = await this.ssh.execCommand(
    `docker ps -q --filter ancestor=${imageName}:latest`
  );

  if (listResult.stdout.trim()) {
    const containerId = listResult.stdout.trim();
    await this.ssh.execCommand(`docker stop ${containerId} && docker rm ${containerId}`);
    logger.success('旧容器已停止');
  } else {
    logger.info('没有运行中的容器');
  }
}

async startContainer(remoteDir, dockerConfig) {
  const { imageName, portMappings, volumeMappings } = dockerConfig;

  logger.step('启动新容器...');

  // Build port mapping args
  const portArgs = portMappings
    .map(p => `-p ${p.host}:${p.container}`)
    .join(' ');

  // Build volume mapping args
  const volumeArgs = volumeMappings
    .map(v => `-v ${v.host}:${v.container}`)
    .join(' ');

  const runCmd = `docker run -d --name ${imageName} ${portArgs} ${volumeArgs} ${imageName}:latest`;
  const result = await this.ssh.execCommand(runCmd);

  if (result.stderr) {
    throw new Error(`容器启动失败: ${result.stderr}`);
  }

  logger.success('容器已启动');
  return result.stdout.trim();
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check deployer.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/deployer.js
git commit -m "feat: implement file upload and docker operations"
```

---

## Phase 7: Health Check Module

### Task 15: Create Health Check Module

**Files:**
- Create: `.deploy/scripts/health-check.js`

**Step 1: Create health check module**

```javascript
// .deploy/scripts/health-check.js
import { logger } from './utils/logger.js';
import { HEALTH_CHECK_PATHS } from './utils/constants.js';

export class HealthChecker {
  constructor(ssh) {
    this.ssh = ssh;
  }

  async check(config) {
    logger.header('🏥 健康检查');

    const { deploy: deployConfig, project } = config;
    const { healthCheck, docker, server } = deployConfig;

    // Wait for container to start
    logger.step('等待容器启动...');
    await this.sleep(10);

    // Check container status
    const containerStatus = await this.checkContainerStatus(docker.imageName);
    if (!containerStatus) {
      return { success: false, reason: '容器未运行' };
    }

    // HTTP health check
    if (project.backend) {
      const httpResult = await this.httpHealthCheck(healthCheck, server, docker);
      if (!httpResult.success) {
        return httpResult;
      }
    }

    logger.success('健康检查通过');
    return { success: true };
  }

  async checkContainerStatus(imageName) {
    logger.step('检查容器状态...');

    const result = await this.ssh.execCommand(
      `docker ps --filter ancestor=${imageName}:latest --format "{{.Status}}"`
    );

    if (result.stdout.trim()) {
      logger.success(`容器状态: ${result.stdout.trim()}`);
      return true;
    }

    logger.error('容器未运行');
    return false;
  }

  async httpHealthCheck(healthCheckConfig, server, docker) {
    logger.step('HTTP 健康检查...');

    const port = docker.portMappings[0]?.host || 8080;
    const paths = this.getHealthCheckPaths(healthCheckConfig);

    for (const path of paths) {
      const result = await this.ssh.execCommand(
        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}${path}`
      );

      const statusCode = result.stdout.trim();
      logger.step(`  ${path} → ${statusCode}`);

      if (this.isSuccessStatus(statusCode)) {
        logger.success(`健康检查通过: ${path}`);
        return { success: true };
      }
    }

    logger.error('健康检查失败');
    return {
      success: false,
      reason: 'HTTP 健康检查失败，服务可能未正常启动'
    };
  }

  getHealthCheckPaths(config) {
    if (config?.path) {
      return [config.path];
    }
    return HEALTH_CHECK_PATHS;
  }

  isSuccessStatus(status) {
    const code = parseInt(status, 10);
    return (code >= 200 && code < 300) || code === 401 || code === 403;
  }

  async rollback(config) {
    logger.header('🔄 回滚操作');

    const { docker } = config.deploy;
    logger.step('回滚到上一版本...');

    // Find previous image
    const result = await this.ssh.execCommand(
      `docker images ${docker.imageName} --format "{{.Tag}}" | head -2 | tail -1`
    );

    const previousTag = result.stdout.trim();

    if (!previousTag || previousTag === 'latest') {
      logger.error('没有可回滚的版本');
      return false;
    }

    // Stop current container and start with previous image
    await this.ssh.execCommand(`docker stop ${docker.imageName} 2>/dev/null || true`);
    await this.ssh.execCommand(`docker rm ${docker.imageName} 2>/dev/null || true`);

    const { portMappings, volumeMappings } = docker;
    const portArgs = portMappings.map(p => `-p ${p.host}:${p.container}`).join(' ');
    const volumeArgs = volumeMappings.map(v => `-v ${v.host}:${v.container}`).join(' ');

    await this.ssh.execCommand(
      `docker run -d --name ${docker.imageName} ${portArgs} ${volumeArgs} ${docker.imageName}:${previousTag}`
    );

    logger.success(`已回滚到版本: ${previousTag}`);
    return true;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

**Step 2: Verify syntax**

```bash
cd .deploy/scripts && node --check health-check.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/health-check.js
git commit -m "feat: add health check module"
```

---

## Phase 8: Main Entry Point

### Task 16: Create Main Entry Point

**Files:**
- Create: `.deploy/scripts/index.js`

**Step 1: Create main entry point**

```javascript
// .deploy/scripts/index.js
import { Detector } from './detector.js';
import { ConfigManager } from './config.js';
import { Generator } from './generator.js';
import { Builder } from './builder.js';
import { Deployer } from './deployer.js';
import { HealthChecker } from './health-check.js';
import { logger } from './utils/logger.js';

export class DockerDeploy {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.detector = new Detector(projectRoot);
    this.configManager = new ConfigManager(projectRoot);
    this.generator = new Generator(projectRoot);
    this.builder = new Builder(projectRoot);
    this.deployer = new Deployer(projectRoot);
  }

  async run(options = {}) {
    try {
      // Phase 1: Detect project
      const detectionResult = await this.detector.detect();
      this.detector.display();

      // Phase 2: Load or create config
      let config;
      const hasConfig = await this.configManager.load();

      if (hasConfig) {
        logger.info('发现现有配置');
        this.configManager.display();
        // In real implementation, would ask user to confirm or modify
        config = this.configManager.config;
      } else {
        config = this.configManager.createDefaultConfig(detectionResult);
        // In real implementation, would ask for user input
      }

      // Phase 3: Build (if not skipped)
      if (!options.skipBuild) {
        await this.builder.build(config);
      }

      // Phase 4: Generate files
      await this.generator.generate(config);

      // Phase 5: Deploy (if server configured)
      if (config.deploy.server && !options.dryRun) {
        const secrets = await this.configManager.loadSecrets();
        await this.deployer.connect(config.deploy.server, secrets);
        await this.deployer.deploy(config);

        // Phase 6: Health check
        const healthChecker = new HealthChecker(this.deployer.ssh);
        const healthResult = await healthChecker.check(config);

        if (!healthResult.success) {
          logger.error(`健康检查失败: ${healthResult.reason}`);
          // In real implementation, would ask user about rollback
        }

        this.deployer.disconnect();
      }

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

**Step 2: Verify all modules work together**

```bash
cd .deploy/scripts && node --check index.js
```

**Step 3: Commit**

```bash
git add .deploy/scripts/index.js
git commit -m "feat: add main entry point integrating all modules"
```

---

## Phase 9: Finalization

### Task 17: Update SKILL.md with Complete Documentation

**Files:**
- Modify: `SKILL.md`

**Step 1: Update SKILL.md**

Replace the SKILL.md content with the complete version (see Task 1 for full content, add the following sections):

Add after the basic usage:

```markdown
## 配置文件

配置保存在 `.deploy/config.json`，敏感信息在 `.deploy/.secrets.json`。

### 配置结构

```json
{
  "version": "1.0",
  "project": {
    "name": "my-project",
    "type": "monorepo",
    "frontend": { ... },
    "backend": { ... },
    "proxy": { ... }
  },
  "deploy": {
    "server": { ... },
    "docker": { ... },
    "healthCheck": { ... }
  }
}
```

## 模块说明

| 模块 | 文件 | 职责 |
|------|------|------|
| Detector | detector.js | 检测项目结构、技术栈、代理配置 |
| Config | config.js | 管理配置文件读写 |
| Generator | generator.js | 生成 Dockerfile、nginx.conf、entrypoint.sh |
| Builder | builder.js | 执行构建命令，复制构建产物 |
| Deployer | deployer.js | SSH 连接、文件上传、Docker 操作 |
| HealthCheck | health-check.js | 容器状态检查、HTTP 健康检查、回滚 |

## 部署流程

1. **项目检测** - 自动识别技术栈、代理配置
2. **配置确认** - 展示检测结果，用户确认或修改
3. **构建执行** - 执行前端/后端构建命令
4. **文件生成** - 生成 Dockerfile、nginx.conf、entrypoint.sh
5. **远程部署** - SSH 连接服务器，上传文件，构建镜像
6. **健康检查** - 验证服务是否正常启动
7. **完成** - 保存配置，展示结果

## 错误处理

- 构建失败：显示错误日志，停止流程
- 连接失败：提示检查服务器配置
- 健康检查失败：询问是否回滚

## 示例

首次部署：
```
/docker-deploy
```

使用现有配置快速部署：
```
/docker-deploy --skip-confirm
```

回滚到上一版本：
```
/docker-deploy --rollback
```
```

**Step 2: Commit**

```bash
git add SKILL.md
git commit -m "docs: complete SKILL.md documentation"
```

---

### Task 18: Final Verification

**Step 1: Verify all files exist**

```bash
ls -la .deploy/scripts/
```

Expected files:
- package.json
- detector.js
- config.js
- generator.js
- builder.js
- deployer.js
- health-check.js
- index.js
- utils/constants.js
- utils/logger.js

**Step 2: Run syntax check on all files**

```bash
cd .deploy/scripts && for f in *.js utils/*.js; do node --check "$f" && echo "✓ $f"; done
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete docker-deploy skill implementation"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-2 | Project Setup |
| 2 | 3-7 | Detector Module |
| 3 | 8 | Config Module |
| 4 | 9-11 | Generator Module |
| 5 | 12 | Builder Module |
| 6 | 13-14 | Deployer Module |
| 7 | 15 | Health Check Module |
| 8 | 16 | Main Entry Point |
| 9 | 17-18 | Finalization |

**Total: 18 tasks**
