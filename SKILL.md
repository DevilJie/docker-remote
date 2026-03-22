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
