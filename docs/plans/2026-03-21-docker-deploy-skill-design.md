# Docker 部署 Skill 设计文档

## 概述

创建一个用于将前后端项目 Docker 容器化并部署到远程服务器的 Claude Code Skill。

## 核心功能

| 功能 | 描述 |
|------|------|
| 项目检测 | 自动检测项目结构、技术栈、代理配置 |
| 文件生成 | 生成 Dockerfile、nginx.conf、entrypoint.sh |
| 远程部署 | SSH/SCP/rsync 上传文件到服务器 |
| 容器管理 | 构建、启动、健康检查、回滚 |
| 配置管理 | 保存/复用部署配置 |

## 支持的技术栈

### 前端

| 类型 | 框架 | 部署方式 |
|------|------|----------|
| 静态资源 | Vue、React、Angular、Vite、Webpack | `/var/www/html/` |
| SSR 服务 | Next.js、Nuxt.js | `/var/app/{框架名}/` |

### 后端

| 语言 | 框架 | 部署路径 |
|------|------|----------|
| Java | Spring Boot | `/var/app/jar/` |
| Node.js | Express、Nest、Koa | `/var/app/node/` |
| Python | FastAPI、Flask、Django | `/var/app/python/` |
| Go | Gin、Echo | `/var/app/go/` |

## 文件结构

```
项目根目录/
└── .deploy/                        # 所有部署相关文件
    ├── config.json                 # 部署配置
    ├── .secrets.json               # 敏感信息（自动加入 .gitignore）
    ├── remote/                     # 生成的部署文件
    │   ├── Dockerfile              # 单容器部署
    │   ├── docker-compose.yml      # 分离部署（可选）
    │   ├── nginx/
    │   │   └── nginx.conf
    │   ├── frontend/               # 前端资源
    │   ├── backend/                # 后端资源
    │   └── scripts/
    │       └── entrypoint.sh
    └── scripts/                    # Skill 脚本（Node.js）
        ├── detector.js
        ├── builder.js
        ├── generator.js
        ├── deployer.js
        └── health-check.js

~/.deploy/                          # 全局共享配置
└── servers/
    ├── production.config.json
    └── staging.config.json
```

## 模块设计

### 1. 项目检测模块（Detector）

**职责**：检测项目类型、技术栈、代理配置

**检测流程**：

1. **项目结构检测**
   - 单仓库：含 frontend/ + backend/ 目录
   - 分离仓库：只有前端或只有后端

2. **前端技术栈检测**
   - 读取 `package.json` → 识别框架
   - 静态资源型：Vue/React/Angular + Vite/Webpack
   - SSR 型：Next.js/Nuxt.js → 询问用户
   - 构建输出目录：dist/、build/、out/

3. **后端技术栈检测**
   - `pom.xml` → Java/Spring Boot
   - `build.gradle` → Java/Gradle
   - `package.json` → Node.js
   - `requirements.txt` / `pyproject.toml` → Python
   - `go.mod` → Go

4. **代理配置解析**
   - `vite.config.js` → `server.proxy`
   - `vue.config.js` → `devServer.proxy`
   - `webpack.config.js` → `devServer.proxy`

**检测结果展示**：

```
📊 项目检测结果

项目结构：单体项目
├── 前端：Vue 3 + Vite (静态资源)
│   └── 构建输出：dist/
├── 后端：Spring Boot (Java)
│   └── 构建输出：target/*.jar
└── 代理配置：
    ├── /api → 后端服务
    └── /upload → 后端服务

是否正确？[Y/n/修改]
```

### 2. 配置管理模块（Config）

**配置文件结构**：

```json
{
  "version": "1.0",
  "project": {
    "name": "my-project",
    "type": "monorepo",
    "frontend": {
      "type": "static",
      "framework": "vue",
      "buildDir": "dist",
      "buildCommand": "npm run build"
    },
    "backend": {
      "type": "java",
      "framework": "spring-boot",
      "buildDir": "target",
      "buildCommand": "mvn clean package -DskipTests",
      "port": 8080,
      "environments": ["dev", "test", "prod"],
      "defaultEnv": "prod",
      "jvmArgs": "-Xmx1g -Xms512m"
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
      "username": "root",
      "authType": "password",
      "deployDir": "/opt/apps/my-project"
    },
    "docker": {
      "deployMode": "single",
      "imageName": "my-project",
      "portMappings": [
        { "host": 8081, "container": 80 }
      ],
      "volumeMappings": [
        { "host": "/opt/apps/my-project/logs/backend", "container": "/var/app/jar/logs" },
        { "host": "/opt/apps/my-project/logs/nginx", "container": "/var/log/nginx" }
      ]
    },
    "healthCheck": {
      "type": "auto",
      "path": "/api/user/info"
    }
  },
  "lastDeploy": {
    "version": "a1b2c3d",
    "time": "2024-03-21T14:30:00Z",
    "status": "success"
  }
}
```

**配置优先级**：

```
全局配置 < 项目配置 < 命令行参数
```

**敏感信息处理**：

`.secrets.json` 存储密码、密钥等敏感信息，自动加入 `.gitignore`。

### 3. 文件生成模块（Generator）

**Dockerfile 模板**：

```dockerfile
# 基础镜像根据技术栈动态选择
FROM nginx:alpine

# 安装后端运行时（按需）
RUN apk add --no-cache openjdk17-jre-headless

# 前端静态资源
COPY frontend/ /var/www/html/

# 后端应用
COPY backend/app.jar /var/app/jar/app.jar

# 日志目录
RUN mkdir -p /var/app/jar/logs

# Nginx 配置
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# 启动脚本
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
```

**Nginx 配置（动态生成）**：

根据前端代理配置自动生成转发规则：

```nginx
server {
    listen 80;
    server_name localhost;

    # 前端静态资源
    location / {
        root /var/www/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 后端代理（根据检测自动生成）
    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /upload {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Entrypoint 脚本**：

```bash
#!/bin/sh

# 从环境变量或配置读取参数
JVM_ARGS="${JVM_ARGS:--Xmx512m -Xms256m}"
SPRING_PROFILE="${SPRING_PROFILE:-prod}"
EXTRA_ARGS="${EXTRA_ARGS:-}"

# 启动后端
cd /var/app/jar
java $JVM_ARGS -jar app.jar -Dspring.profiles.active=$SPRING_PROFILE $EXTRA_ARGS &

# 等待后端启动
sleep 5

# 启动 Nginx
nginx -g "daemon off;"
```

### 4. 远程部署模块（Deployer）

**部署流程**：

1. 连接测试（验证连通性、认证、Docker 环境）
2. 创建部署目录
3. 上传文件（SCP 或 rsync）
4. 构建镜像
5. 停止旧容器
6. 启动新容器
7. 健康检查

**连接方式**：

| 方式 | 使用场景 |
|------|----------|
| 密码连接 | 简单快速 |
| 密钥连接 | 安全推荐 |
| SSH 配置 | 复杂环境 |

**Docker 环境检测与安装**：

如果服务器未安装 Docker，询问用户是否自动安装：

| 系统 | 安装命令 |
|------|----------|
| Ubuntu/Debian | `apt-get install -y docker.io` |
| CentOS/RHEL | `yum install -y docker-ce` |
| Alpine | `apk add docker` |

**端口映射**：

- 检测服务器已占用端口
- 推荐可用端口（优先 8080、8000、3000、9000）
- 映射到容器 Nginx 80 端口

**目录映射**：

| 容器内路径 | 宿主机路径 |
|------------|------------|
| `/var/app/jar/logs/` | `/opt/app/logs/backend/` |
| `/var/log/nginx/` | `/opt/app/logs/nginx/` |
| `/var/www/html/upload/` | `/opt/app/upload/` (可选) |

### 5. 健康检查模块（Health）

**检查流程**：

1. 等待容器启动（5-10 秒）
2. 检查容器状态
3. HTTP 健康检查
4. 处理检查结果

**后端健康检查策略**：

优先级检测：
1. `/actuator/health` (Spring Boot Actuator)
2. `/health`
3. `/api/health`
4. 用户指定的任意接口

检查标准：
- HTTP 200-299 → 成功
- HTTP 401/403 → 成功（服务正常，需要认证）
- HTTP 404/超时 → 失败

**失败处理**：

健康检查失败时询问用户：
1. 回滚到上一版本
2. 保留当前版本，稍后手动处理
3. 查看完整日志

## 构建命令自动检测

### 前端

读取 `package.json` 的 `scripts` 字段，优先级：`build:prod` > `build` > `dist`

### 后端

| 技术栈 | 检测文件 | 构建命令 |
|--------|----------|----------|
| Java (Maven) | `pom.xml` | `mvn clean package -DskipTests` |
| Java (Gradle) | `build.gradle` | `./gradlew build -x test` |
| Node.js | `package.json` | `npm run build` |
| Python | `requirements.txt` | 无需构建 |
| Go | `go.mod` | `go build -o app` |

检测失败时询问用户输入。

## 脚本实现规范

**只允许使用 Node.js**，禁止 Python、Bash 等其他语言。

脚本列表：

| 脚本 | 职责 |
|------|------|
| `detector.js` | 项目检测 |
| `builder.js` | 构建执行 |
| `generator.js` | 文件生成 |
| `deployer.js` | 远程部署 |
| `health-check.js` | 健康检查 |

## 部署流程

### 首次部署

```
Phase 1: 项目检测
  🔍 检测项目结构、技术栈、代理配置
  📋 展示检测结果 → 用户确认

Phase 2: 构建配置
  🔨 自动检测构建命令（失败则询问）
  🔨 询问后端环境配置
  🔨 询问后端启动参数

Phase 3: 部署配置
  🌐 询问部署模式（单容器/分离部署）
  🖥️ 询问服务器连接信息
  📂 询问部署目录
  🔌 询问端口映射
  📁 询问日志目录映射
  🏥 询问健康检查方式

Phase 4: 执行部署
  📦 构建前端/后端资源
  📝 生成 Dockerfile、nginx.conf 等
  🔗 连接服务器（安装 Docker 如需）
  📤 上传文件
  🔨 构建镜像
  🚀 启动容器
  🏥 健康检查

Phase 5: 完成
  💾 保存配置
  📋 展示部署结果
```

### 再次部署（快速模式）

```
📋 读取 .deploy/config.json

展示上次部署配置

[Y] 确认部署 → 直接执行 Phase 4
[M] 修改配置 → 进入配置修改模式
[Q] 退出
```

## 镜像版本管理

使用 Git commit hash 或 tag 作为镜像版本标签。

示例：`my-project:a1b2c3d`

## Skill 触发条件

```yaml
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
```

## 后续步骤

1. 使用 `superpowers:writing-plans` 技能创建详细实现计划
2. 创建 `SKILL.md` 文件
3. 实现 Node.js 脚本
4. 编写测试用例
5. 迭代优化
