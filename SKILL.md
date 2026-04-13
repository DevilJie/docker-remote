---
name: docker-deploy
description: |
  将前后端项目 Docker 容器化并部署到远程服务器。

  触发场景:
  - 用户提到 "docker 部署"、"容器化部署"、"打包部署"
  - 用户提到 "远程部署"、"上传到服务器"
  - 用户想要将项目打包成 Docker 镜像
  - 用户询问如何将前端后端一起部署
  - 用户提到 "增量部署"、"更新部署"、"重新部署"

  支持特性:
  - 自动检测前后端技术栈
  - 支持 Java/Node.js/Python/Go 后端
  - 支持 Vue/React/Angular/Next.js 前端
  - 自动解析代理配置生成 Nginx 规则
  - 首次构建 + 增量更新（只上传代码重启容器，不重复构建镜像）
  - 自动检测并安装 Docker 环境（需用户确认）
  - 端口映射配置 + 冲突检测
  - 健康检查与回滚
---

# Docker 部署 Skill

将前后端项目 Docker 容器化并部署到远程服务器。

## 核心原则（必须严格遵守）

### 原则一：所有文件统一放在 .deploy/ 目录

**所有生成的配置文件、脚本、部署产物，都必须放在项目根目录的 `.deploy/` 隐藏文件夹下。**

```
项目根目录/
├── .deploy/                    ← 所有部署相关文件的根目录
│   ├── config.json             ← 部署配置（服务器、Docker、端口映射等）
│   ├── .secrets.json           ← 敏感信息（密码/密钥）
│   ├── scripts/                ← 部署脚本源码
│   │   ├── index.js            ← 主入口
│   │   ├── deployer.js         ← 远程部署操作
│   │   ├── generator.js        ← 生成 Dockerfile/nginx.conf
│   │   ├── builder.js          ← 本地构建执行
│   │   ├── prompter.js         ← 交互式问答
│   │   ├── config.js           ← 配置持久化
│   │   ├── detector.js         ← 项目结构检测
│   │   ├── health-check.js     ← 健康检查
│   │   └── utils/
│   │       ├── constants.js    ← 常量定义
│   │       └── logger.js       ← 日志工具
│   └── remote/                 ← 生成的部署文件（发送到服务器的）
│       ├── Dockerfile          ← 只包含运行时环境，不含代码
│       ├── nginx/
│       │   └── nginx.conf
│       ├── scripts/
│       │   └── entrypoint.sh
│       ├── frontend/           ← 前端构建产物
│       └── backend/            ← 后端构建产物
├── src/                        ← 项目源代码
└── ...                         ← 其他项目文件
```

**禁止**在项目根目录创建 `deploy/`（非隐藏）目录。所有部署相关内容一律放入 `.deploy/`。

### 原则二：镜像不含代码，代码通过 volume 挂载

Docker 镜像**只包含运行时环境**（Nginx + JRE/Node/Python 等运行时），**不包含任何应用代码**。前后端编译产物通过 volume 挂载到容器内。

```
Docker 镜像 (只构建一次，不含代码)      宿主机 volume 目录 (每次更新替换)
┌──────────────────────┐              ┌─────────────────────────────┐
│ Nginx                │              │ ~/app/{项目名}/              │
│ 后端运行时 (JRE等)    │   volume     │ ├── volumes/frontend/   ──────► /var/www/html/
│ nginx.conf           │◄─────────────│ ├── volumes/backend/    ──────► /var/app/
│ entrypoint.sh        │              │ └── volumes/logs/       ──────► 日志目录
└──────────────────────┘              └─────────────────────────────┘
```

所以增量更新只需要：把本地编译好的前后端产物上传到服务器上对应的 volume 目录，替换掉旧文件，然后重启容器即可。

```
首次部署:  构建 → 生成文件 → 上传 → 构建镜像 → 启动容器 → 上传代码到 volume
增量部署:  构建 → 上传代码到 volume → 重启容器（不碰镜像）
强制重建:  构建 → 生成文件 → 上传 → 重建镜像 → 重启容器 → 上传代码到 volume (--force-rebuild)
```

## 使用方式

```
/docker-deploy [options]
```

### 选项

- `--skip-build` - 跳过构建步骤
- `--dry-run` - 仅生成文件，不执行实际部署
- `--force-rebuild` - 强制重新构建镜像（即使容器已存在）
- `--rollback` - 回滚到上一版本

## 配置持久化

配置文件保存在 `.deploy/` 目录下：
- `config.json` - 部署配置（服务器、Docker、项目信息）
- `.secrets.json` - 敏感信息（密码/密钥），已加入 .gitignore

首次部署时会通过交互式问答收集配置，再次部署时可选择：
- 直接部署 - 使用已保存的配置
- 修改配置 - 交互式修改配置项
- 重新检测 - 重新扫描项目结构
- 取消 - 取消部署

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

系统会自动判断是首次部署还是增量部署（通过检测远程服务器上是否已存在同名容器）。

### 首次部署（服务器上无容器）

1. **项目检测** - 自动识别技术栈、代理配置
2. **配置收集** - 交互式收集部署所需信息（见下方详细说明）
3. **本地构建** - 在本地执行前端/后端构建命令
4. **文件生成** - 生成 Dockerfile、nginx.conf、entrypoint.sh（全部在 `.deploy/remote/` 下）
5. **SSH 连接** - 连接服务器
6. **Docker 环境检测**
   - **已安装**：继续
   - **未安装**：询问用户是否自动安装
     - 用户同意：询问镜像加速地址（可选），安装 Docker 并配置加速器
     - 用户拒绝：终止部署
7. **端口冲突检测** - 检查宿主机端口是否被占用，有冲突则询问用户处理方式
8. **构建镜像** - `docker build`（只包含运行时环境，不含代码）
9. **启动容器** - `docker run`（挂载 volume 目录）
10. **上传代码** - 将前后端编译产物上传到 volume 目录
11. **健康检查** - 验证服务是否正常启动
12. **保存配置** - 保存到 `.deploy/config.json`

### 增量部署（服务器上已有容器）

1. **配置加载** - 读取 `.deploy/config.json` 中保存的配置
2. **本地构建** - 在本地执行前端/后端构建命令
3. **SSH 连接** - 连接服务器
4. **上传代码** - 将编译产物上传到 volume 目录，替换旧文件
5. **重启容器** - `docker restart`（不重建镜像！）
6. **健康检查** - 验证服务是否正常启动

## 配置收集步骤（首次部署）

项目检测完成后，必须按以下顺序向用户收集配置。

### 步骤 1: 服务器连接信息

- **服务器 IP 地址或域名**（必填）
- **SSH 端口**（默认 22）
- **SSH 用户名**（默认 root）
- **SSH 认证方式**（密码 / 密钥文件）
- **服务器上的部署目录**（默认 `~/app/{项目名}`）

### 步骤 2: Docker 配置

- **Docker 镜像名称**（默认项目名）
- **Docker 容器名称**（默认 `{项目名}-container`）
- **端口映射**（必填！宿主机端口:容器端口，默认 8080:80）
  - 必须询问用户宿主机映射到哪个端口
  - 可添加多个端口映射
- **卷映射配置**（展示默认映射，用户可确认或修改）

### 步骤 3: 后端运行时配置（如检测到后端）

**如果是 Java 后端，必须询问 JDK 版本**：
- JDK 8 / JDK 11 / JDK 17 / JDK 21
- 默认推荐 JDK 17

### 步骤 4: 确认配置

将收集到的所有配置以表格形式展示给用户确认，确认后再开始执行构建和部署。

## 服务器目录结构

部署完成后，服务器上的目录结构如下：

```
~/app/{项目名}/
├── Dockerfile                  ← 镜像构建文件
├── nginx/
│   └── nginx.conf              ← Nginx 配置
├── scripts/
│   └── entrypoint.sh           ← 启动脚本
├── volumes/                    ← volume 映射的宿主机目录
│   ├── frontend/               ← 前端编译产物 → 挂载到 /var/www/html/
│   ├── backend/                ← 后端编译产物 → 挂载到 /var/app/
│   └── logs/                   ← 日志目录
│       ├── nginx/              ← Nginx 日志
│       └── backend/            ← 后端日志
```

增量更新时，只需替换 `volumes/frontend/` 和 `volumes/backend/` 中的文件，然后 `docker restart` 即可。

## 设计原则

### 本地构建优先 (Build Locally First)

所有编译/打包操作必须在本地完成，Dockerfile 不执行任何编译命令。

### Dockerfile 结构

Dockerfile 只包含三部分：

1. **基础镜像** - `FROM nginx:alpine`
2. **运行时安装** - 根据后端语言安装对应运行时
3. **配置文件** - nginx.conf、entrypoint.sh

**不包含**任何 `COPY frontend/` 或 `COPY backend/` 指令。代码完全通过 volume 挂载。

各后端语言的运行时安装命令和 volume 挂载路径：

| 语言 | 运行时安装 | 编译产物 | volume 挂载路径 |
|------|-----------|---------|----------------|
| Java (Spring Boot) | `openjdk{version}-jre fontconfig dejavu-fonts wqy-zenhei` | `app.jar` | `/var/app/jar/` |
| Node.js (Express/Nest) | `nodejs npm` | 项目目录 | `/var/app/node/` |
| Python (FastAPI/Flask) | `python3 py3-pip` | 项目目录 | `/var/app/python/` |
| Go (Gin/Echo) | 无需安装（编译为二进制） | `app` 二进制 | `/var/app/go/` |

Dockerfile 示例（以 Java 后端为例）：

```dockerfile
FROM nginx:alpine

# Java 运行时 + 字体（避免验证码等图片生成报错）
RUN apk add --no-cache openjdk17-jre fontconfig font-dejavu wqy-zenhei && fc-cache -fv

# 创建 volume 挂载点目录
RUN mkdir -p /var/www/html && chown -R nginx:nginx /var/www/html
RUN mkdir -p /var/app/jar
RUN mkdir -p /var/log/nginx /var/app/jar/logs

# 只 COPY 配置文件，不 COPY 代码
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
```

Dockerfile 示例（以 Node.js 后端为例）：

```dockerfile
FROM nginx:alpine

# Node.js 运行时
RUN apk add --no-cache nodejs npm

# 创建 volume 挂载点目录
RUN mkdir -p /var/www/html && chown -R nginx:nginx /var/www/html
RUN mkdir -p /var/app/node
RUN mkdir -p /var/log/nginx /var/app/node/logs

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
```

Dockerfile 示例（以 Go 后端为例）：

```dockerfile
FROM nginx:alpine

# Go 编译为静态二进制，无需运行时

RUN mkdir -p /var/www/html && chown -R nginx:nginx /var/www/html
RUN mkdir -p /var/app/go
RUN mkdir -p /var/log/nginx /var/app/go/logs

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
```

### Java 字体支持（重要）

Java 后端在 Alpine 容器中必须安装字体库，否则涉及图片生成的功能会报错：

```
java.lang.NoClassDefFoundError: Could not initialize class sun.font.SunFontManager
```

所有 Java 项目的 Dockerfile 必须包含：`fontconfig`、`font-dejavu`（注意包名）、`wqy-zenhei`、`fc-cache -fv`
