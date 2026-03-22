// .deploy/scripts/index.js
import { Detector } from './detector.js';
import { ConfigManager } from './config.js';
import { Generator } from './generator.js';
import { Builder } from './builder.js';
import { Deployer } from './deployer.js';
import { HealthChecker } from './health-check.js';
import { Prompter } from './prompter.js';
import { logger } from './utils/logger.js';

export class DockerDeploy {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.detector = new Detector(projectRoot);
    this.configManager = new ConfigManager(projectRoot);
    this.generator = new Generator(projectRoot);
    this.builder = new Builder(projectRoot);
    this.deployer = new Deployer(projectRoot);
    this.prompter = new Prompter(projectRoot);
  }

  async run(options = {}) {
    try {
      // Phase 1: Detect project
      const detectionResult = await this.detector.detect();

      // Phase 2: Load or collect config
      let config, secrets;

      const hasConfig = await this.configManager.load();

      if (hasConfig) {
        // 已有配置
        const action = await this.prompter.promptExistingConfig(
          this.configManager.config
        );

        if (action === 'deploy') {
          config = this.configManager.config;
          secrets = await this.configManager.loadSecrets();

          // 如果没有保存的密钥，需要重新收集
          if (!secrets && config.deploy?.server) {
            secrets = await this.prompter.collectSecrets(
              config.deploy.server.authType
            );

            const saveSecrets = await this.prompter.promptSaveSecrets();
            if (saveSecrets) {
              await this.configManager.saveSecrets(secrets);
            }
          }

        } else if (action === 'modify') {
          config = await this.prompter.modifyConfig(this.configManager.config);

          // 修改后可能需要重新收集密钥
          if (config.deploy?.server) {
            secrets = await this.prompter.collectSecrets(
              config.deploy.server.authType
            );

            const saveSecrets = await this.prompter.promptSaveSecrets();
            if (saveSecrets) {
              await this.configManager.saveSecrets(secrets);
            }
          }

        } else if (action === 'redetect') {
          config = this.configManager.createDefaultConfig(detectionResult);
          const result = await this.prompter.collectNewConfig(detectionResult);

          config.deploy = {
            ...config.deploy,
            server: result.config.server,
            docker: result.config.docker,
            healthCheck: result.config.healthCheck
          };

          secrets = result.secrets;

          if (result.saveSecrets) {
            await this.configManager.saveSecrets(secrets);
          }

        } else {
          logger.info('用户取消部署');
          return { success: false, error: '用户取消' };
        }

      } else {
        // 首次部署
        const defaultConfig = this.configManager.createDefaultConfig(detectionResult);
        const result = await this.prompter.collectNewConfig(detectionResult);

        config = {
          ...defaultConfig,
          deploy: {
            ...defaultConfig.deploy,
            server: result.config.server,
            docker: result.config.docker,
            healthCheck: result.config.healthCheck
          }
        };

        secrets = result.secrets;

        if (result.saveSecrets) {
          await this.configManager.saveSecrets(secrets);
        }
      }

      // Phase 3: Build (if not skipped)
      if (!options.skipBuild) {
        await this.builder.build(config);
      } else {
        logger.info('跳过构建步骤');
      }

      // Phase 4: Generate files
      await this.generator.generate(config);

      // Phase 5: Deploy (if server configured and !options.dryRun)
      if (config.deploy?.server && !options.dryRun) {
        await this.deployer.connect(config.deploy.server, secrets);
        await this.deployer.deploy(config);

        // Phase 6: Health check
        const healthChecker = new HealthChecker(this.deployer.ssh);
        const healthResult = await healthChecker.check(config);

        if (!healthResult.success) {
          logger.error(`健康检查失败: ${healthResult.reason}`);
          // Could ask user about rollback here
        }

        this.deployer.disconnect();
      } else if (options.dryRun) {
        logger.info('Dry run 模式，跳过实际部署');
      }

      // Update last deploy time
      config.lastDeploy = new Date().toISOString();

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
  const args = process.argv.slice(2);
  const options = {
    skipBuild: args.includes('--skip-build'),
    dryRun: args.includes('--dry-run')
  };

  const deploy = new DockerDeploy();
  deploy.run(options).then(result => {
    process.exit(result.success ? 0 : 1);
  });
}
