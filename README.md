# Docker Deploy Skill

[English](#english) | [中文](#中文)

---

## 中文

### 概述

Docker Deploy 是一个 [Claude Code Skill](https://docs.anthropic.com/en/docs/claude-code/skills)，用于将前后端项目自动化 Docker 容器化并部署到远程服务器。

它通过自动检测项目技术栈、生成交互式配置、构建 Docker 镜像并完成远程部署，将复杂的手动部署流程简化为一条命令。

### 核心特性

- **自动技术栈检测** — 自动识别前端（Vue/React/Angular/Next.js）和后端（Java/Node.js/Python/Go）框架
- **本地构建优先** — 所有编译/打包在本地完成，Docker 镜像只包含运行时环境
- **Volume 挂载部署** — 代码通过 volume 挂载而非打入镜像，支持增量更新
- **增量部署** — 已有容器时仅上传代码并重启，无需重建镜像
- **自动 Nginx 配置** — 根据前端代理配置自动生成 Nginx 转发规则
- **配置持久化** — 首次部署后保存配置，再次部署可复用或修改
- **Docker 环境检测** — 自动检测远程服务器 Docker 是否安装，可自动安装
- **端口冲突检测** — 部署前检查宿主机端口占用情况
- **健康检查与回滚** — 部署后自动验证服务状态，支持回滚

### 支持的技术栈

| 类别 | 支持的框架 |
|------|-----------|
| 前端 | Vue 2/3, React, Angular, Next.js, Nuxt.js |
| 后端 | Java (Spring Boot), Node.js (Express/Nest/Koa), Python (FastAPI/Flask/Django), Go (Gin/Echo) |

### 快速开始

#### 安装

将此 Skill 克隆到 Claude Code 的 skills 目录：

```bash
# 克隆到 Claude Code skills 目录
git clone https://github.com/DevilJie/docker-remote.git ~/.claude/skills/docker-deploy
```

#### 使用

在 Claude Code 中直接输入：

```
/docker-deploy
```

或使用选项：

```
/docker-deploy --skip-build        # 跳过构建步骤
/docker-deploy --dry-run           # 仅生成文件，不执行部署
/docker-deploy --force-rebuild     # 强制重新构建镜像
/docker-deploy --rollback          # 回滚到上一版本
```

### 工作流程

```
首次部署:
  项目检测 → 配置收集 → 本地构建 → 文件生成 → SSH连接 → Docker环境检测
  → 端口检测 → 构建镜像 → 启动容器 → 上传代码 → 健康检查 → 保存配置

增量部署:
  加载配置 → 本地构建 → SSH连接 → 上传代码 → 重启容器 → 健康检查
```

### 目录结构

```
项目根目录/
├── .deploy/                    ← 所有部署相关文件
│   ├── config.json             ← 部署配置
│   ├── .secrets.json           ← 敏感信息（已加入 .gitignore）
│   ├── scripts/                ← 部署脚本源码
│   │   ├── index.js            ← 主入口
│   │   ├── detector.js         ← 项目结构检测
│   │   ├── generator.js        ← 生成 Dockerfile/nginx.conf
│   │   ├── builder.js          ← 本地构建执行
│   │   ├── deployer.js         ← 远程部署操作
│   │   ├── prompter.js         ← 交互式问答
│   │   ├── config.js           ← 配置持久化
│   │   ├── health-check.js     ← 健康检查
│   │   └── utils/              ← 工具函数
│   └── remote/                 ← 生成的部署文件
│       ├── Dockerfile
│       ├── nginx/nginx.conf
│       └── scripts/entrypoint.sh
└── SKILL.md                    ← Skill 定义文件
```

### 设计原则

- **所有文件统一放在 `.deploy/` 目录** — 不污染项目根目录
- **镜像不含代码** — Docker 镜像只包含运行时环境，代码通过 volume 挂载
- **增量更新无需重建镜像** — 只替换 volume 中的代码并重启容器

### 许可证

[MIT License](./LICENSE)

---

## English

### Overview

Docker Deploy is a [Claude Code Skill](https://docs.anthropic.com/en/docs/claude-code/skills) that automates Docker containerization and remote server deployment for full-stack projects.

It simplifies the complex manual deployment process into a single command by automatically detecting project tech stacks, generating interactive configurations, building Docker images, and completing remote deployment.

### Key Features

- **Auto Tech Stack Detection** — Identifies frontend (Vue/React/Angular/Next.js) and backend (Java/Node.js/Python/Go) frameworks
- **Build Locally First** — All compilation/packaging happens locally; Docker images contain only runtime environments
- **Volume-Mounted Deployment** — Code is mounted via volumes instead of being baked into images, enabling incremental updates
- **Incremental Deployment** — When a container already exists, only upload code and restart without rebuilding the image
- **Auto Nginx Configuration** — Generates Nginx routing rules based on frontend proxy configurations
- **Config Persistence** — Saves configuration after first deployment for reuse or modification
- **Docker Environment Detection** — Checks if Docker is installed on the remote server and can install it automatically
- **Port Conflict Detection** — Checks host port availability before deployment
- **Health Check & Rollback** — Automatically verifies service status after deployment with rollback support

### Supported Tech Stacks

| Category | Supported Frameworks |
|----------|---------------------|
| Frontend | Vue 2/3, React, Angular, Next.js, Nuxt.js |
| Backend | Java (Spring Boot), Node.js (Express/Nest/Koa), Python (FastAPI/Flask/Django), Go (Gin/Echo) |

### Quick Start

#### Installation

Clone this skill into your Claude Code skills directory:

```bash
# Clone to Claude Code skills directory
git clone https://github.com/DevilJie/docker-remote.git ~/.claude/skills/docker-deploy
```

#### Usage

In Claude Code, simply type:

```
/docker-deploy
```

Or with options:

```
/docker-deploy --skip-build        # Skip build step
/docker-deploy --dry-run           # Generate files only, no actual deployment
/docker-deploy --force-rebuild     # Force rebuild the Docker image
/docker-deploy --rollback          # Rollback to previous version
```

### Workflow

```
First-time Deployment:
  Project Detection → Config Collection → Local Build → File Generation → SSH Connect
  → Docker Check → Port Check → Build Image → Start Container → Upload Code → Health Check → Save Config

Incremental Deployment:
  Load Config → Local Build → SSH Connect → Upload Code → Restart Container → Health Check
```

### Directory Structure

```
project-root/
├── .deploy/                    ← All deployment-related files
│   ├── config.json             ← Deployment configuration
│   ├── .secrets.json           ← Sensitive info (in .gitignore)
│   ├── scripts/                ← Deployment script source code
│   │   ├── index.js            ← Main entry
│   │   ├── detector.js         ← Project structure detection
│   │   ├── generator.js        ← Dockerfile/nginx.conf generation
│   │   ├── builder.js          ← Local build execution
│   │   ├── deployer.js         ← Remote deployment operations
│   │   ├── prompter.js         ← Interactive prompts
│   │   ├── config.js           ← Config persistence
│   │   ├── health-check.js     ← Health check
│   │   └── utils/              ← Utility functions
│   └── remote/                 ← Generated deployment files
│       ├── Dockerfile
│       ├── nginx/nginx.conf
│       └── scripts/entrypoint.sh
└── SKILL.md                    ← Skill definition file
```

### Design Principles

- **All files under `.deploy/`** — Keeps the project root clean
- **No code in images** — Docker images contain only runtime environments; code is mounted via volumes
- **No image rebuild for updates** — Just replace code in volumes and restart the container

### License

[MIT License](./LICENSE)
