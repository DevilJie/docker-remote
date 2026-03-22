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

      // Phase 5: Deploy (if server configured and !options.dryRun)
      if (config.deploy.server) {
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
