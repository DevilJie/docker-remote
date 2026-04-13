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
        const action = await this.prompter.promptExistingConfig(
          this.configManager.config
        );

        if (action === 'deploy') {
          config = this.configManager.config;
          secrets = await this.configManager.loadSecrets();

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

      // Phase 4: Deploy (if server configured and !options.dryRun)
      if (config.deploy?.server && !options.dryRun) {

        // Phase 4a: Connect to server
        await this.deployer.connect(config.deploy.server, secrets);

        // Phase 4b: Check Docker environment
        const dockerInstalled = await this.deployer.checkDocker();

        if (!dockerInstalled) {
          const installDecision = await this.prompter.promptDockerInstall();

          if (!installDecision.install) {
            this.deployer.disconnect();
            logger.info('用户拒绝安装 Docker，部署已终止');
            return { success: false, error: '用户拒绝安装 Docker' };
          }

          const mirrorUrl = installDecision.mirrorUrl || '';
          const installed = await this.deployer.installDocker(mirrorUrl);

          if (!installed) {
            this.deployer.disconnect();
            logger.error('Docker 安装失败，部署已终止');
            return { success: false, error: 'Docker 安装失败' };
          }
        }

        // Phase 4c: Detect deploy mode — check if container already exists
        let deployMode = 'full';
        const containerName = config.deploy.docker.containerName || config.deploy.docker.imageName;
        const exists = await this.deployer.containerExists(containerName);

        if (exists && !options.forceRebuild) {
          // 容器已存在：默认走快速更新（不重建镜像）
          // 只有用户明确 --force-rebuild 时才走完整部署
          deployMode = 'quick';
          logger.info(`检测到已有容器 ${containerName}，将执行增量更新（仅上传代码 + 重启容器）`);
        } else if (exists && options.forceRebuild) {
          logger.info(`容器已存在，但指定了 --force-rebuild，将重新构建镜像`);
        }

        // Phase 4c: Generate files & port check (only for full deploy)
        if (deployMode === 'full') {
          // 首次部署：生成 Dockerfile、nginx.conf、entrypoint.sh
          await this.generator.generate(config);

          // 端口冲突检测
          const portCheck = await this.deployer.checkAllPorts(
            config.deploy.docker.portMappings
          );

          if (portCheck.hasConflicts) {
            const resolution = await this.prompter.promptPortConflictResolution(
              portCheck.conflicts
            );

            if (resolution.cancelled) {
              this.deployer.disconnect();
              logger.info('用户取消部署');
              return { success: false, error: '用户取消' };
            }

            // Kill requested processes
            for (const pid of resolution.processesToKill) {
              await this.deployer.killProcess(pid);
            }

            // Update port mappings: keep non-conflicted, replace conflicted
            if (resolution.resolvedPortMappings.length > 0) {
              const conflictedPorts = new Set(portCheck.conflicts.map(c => c.port));
              const keptMappings = config.deploy.docker.portMappings.filter(
                m => !conflictedPorts.has(m.host)
              );
              config.deploy.docker.portMappings = [
                ...keptMappings,
                ...resolution.resolvedPortMappings
              ];
            }
          }
        }

        // Phase 4d: Execute deploy
        await this.deployer.deploy(config, deployMode);

        // Phase 4e: Health check
        const healthChecker = new HealthChecker(this.deployer.ssh);
        const healthResult = await healthChecker.check(config);

        if (!healthResult.success) {
          logger.error(`健康检查失败: ${healthResult.reason}`);
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
    dryRun: args.includes('--dry-run'),
    forceRebuild: args.includes('--force-rebuild')
  };

  const deploy = new DockerDeploy();
  deploy.run(options).then(result => {
    process.exit(result.success ? 0 : 1);
  });
}
