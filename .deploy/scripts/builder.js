// .deploy/scripts/builder.js
import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { logger } from './utils/logger.js';
import { DEPLOY_DIR, REMOTE_DIR } from './utils/constants.js';

export class Builder {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.outputDir = path.join(projectRoot, DEPLOY_DIR, REMOTE_DIR);
  }

  async build(config) {
    logger.header('构建项目');

    const { project } = config;

    // Build frontend
    if (project.frontend) {
      await this.buildFrontend(project.frontend);
    }

    // build backend
    if (project.backend) {
      await this.buildBackend(project.backend);
    }

    logger.success('构建完成');
  }

  async buildFrontend(frontend) {
    logger.step('构建前端...');

    const frontendDir = frontend.directory === '.'
      ? path.join(this.projectRoot, frontend.directory)
      : this.projectRoot;

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
      ? path.join(this.projectRoot, backend.directory)
      : this.projectRoot;

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
      // copy entire backend directory
      await fs.copy(backendDir, destDir, {
        overwrite: true,
        filter: (src) => !src.includes('node_modules')
      });
      logger.success('Node.js 应用已复制');
    } else if (backend.runtime === 'python') {
      // copy Python files
      await fs.copy(backendDir, destDir, { overwrite: true });
      logger.success('Python 应用已复制');
    } else if (backend.runtime === 'go') {
      // copy Go binary
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
    });
  }
}

// CLI entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const builder = new Builder();
  // Would load config and run build
}
