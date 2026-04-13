// .deploy/scripts/config.js
import fs from 'fs-extra';
import path from 'path';
import { logger } from './utils/logger.js';
import { DEPLOY_DIR, CONFIG_FILE, SECRETS_FILE, VOLUME_CONTAINER_PATHS } from './utils/constants.js';

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
      this.migrateConfig();
      logger.info('已加载现有配置');
      return true;
    }
    return false;
  }

  migrateConfig() {
    // Migrate v1.0 → v1.1: add volume mappings
    if (this.config.version === '1.0' &&
        this.config.deploy?.docker?.volumeMappings?.length === 0) {
      this.config.deploy.docker.volumeMappings = ConfigManager.getDefaultVolumeMappings({
        frontend: this.config.project?.frontend,
        backend: this.config.project?.backend
      });
      this.config.version = '1.1';
      logger.info('已自动迁移配置: 添加默认卷映射 (v1.0 → v1.1)');
    }
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
      version: '1.1',
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
          containerName: `${path.basename(this.projectRoot)}-container`,
          portMappings: [{ host: 8080, container: 80 }],
          volumeMappings: ConfigManager.getDefaultVolumeMappings(detectionResult)
        },
        healthCheck: {
          type: 'auto',
          path: '/api/health'
        }
      },
      lastDeploy: null
    };
  }

  static getDefaultVolumeMappings(detectionResult) {
    const mappings = [];

    if (detectionResult.frontend) {
      mappings.push({
        host: 'volumes/frontend',
        container: VOLUME_CONTAINER_PATHS.frontend,
        type: 'frontend'
      });
    }

    if (detectionResult.backend) {
      const runtime = detectionResult.backend.runtime;
      const backendPath = VOLUME_CONTAINER_PATHS.backend[runtime] || '/var/app/';

      mappings.push({
        host: 'volumes/backend',
        container: backendPath,
        type: 'backend'
      });

      const logPath = VOLUME_CONTAINER_PATHS.logs.backend[runtime] || '/var/app/logs/';
      mappings.push({
        host: 'volumes/logs/backend',
        container: logPath,
        type: 'log-backend'
      });
    }

    // Always map nginx logs
    mappings.push({
      host: 'volumes/logs/nginx',
      container: VOLUME_CONTAINER_PATHS.logs.nginx,
      type: 'log-nginx'
    });

    return mappings;
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
