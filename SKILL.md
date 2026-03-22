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
- `--dry-run` - 仅生成文件，不执行实际部署
- `--rollback` - 回滚到上一版本

## 配置持久化

配置文件保存在 `.deploy/` 目录下：
- `config.json` - 部署配置（服务器、Docker、项目信息）
- `.secrets.json` - 敏感信息（密码/密钥），已加入 .gitignore

首次部署时会通过交互式问答收集配置，再次部署时可选择：
- 🚀 **直接部署** - 使用已保存的配置
- ✏️ **修改配置** - 交互式修改配置项
- 🔄 **重新检测** - 重新扫描项目结构
- ❌ **取消** - 取消部署

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

## 设计原则

### 本地构建优先 (Build Locally First)

**所有编译/打包操作必须在本地完成，Dockerfile 只负责复制已构建的产物。**

#### 为什么不在 Docker 内编译？

| 问题 | Docker 内编译 | 本地构建 |
|------|--------------|---------|
| 构建缓存 | 每次都要重新下载依赖 | 本地 Maven/NPM 缓存 |
| 镜像大小 | 包含编译工具 (Maven 500MB+) | 仅运行时 (JRE 150MB) |
| 构建速度 | 慢 (每次重新编译) | 快 (增量编译) |
| CI/CD | 复杂 (需要 Docker 缓存) | 简单 (标准构建流程) |
| 调试 | 困难 (容器内环境) | 简单 (本地环境) |

#### 正确的做法

```bash
# 1. 本地构建 (必须)
mvn clean package -DskipTests     # Java
npm run build                      # Node.js
go build -o app                    # Go

# 2. 生成 Dockerfile (只复制，不编译)
# Dockerfile 会验证构建产物存在，否则报错
```

#### 错误的做法 (禁止)

```dockerfile
# ❌ 禁止：多阶段构建编译
FROM maven:3.9 AS builder
RUN mvn clean package  # 不允许！

# ❌ 禁止：在 RUN 中编译
RUN npm run build      # 不允许！
```

#### 正确的 Dockerfile 示例

```dockerfile
# ✅ 正确：只复制已构建的产物
FROM nginx:alpine
RUN apk add --no-cache openjdk17-jre-headless
COPY backend/app.jar /var/app/jar/app.jar  # 复制本地已打包的 jar
COPY frontend/ /var/www/html/              # 复制本地已构建的前端
```
