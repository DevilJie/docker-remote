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
