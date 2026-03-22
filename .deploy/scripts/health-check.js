// .deploy/scripts/health-check.js
import { logger } from './utils/logger.js';
import { HEALTH_CHECK_PATHS } from './utils/constants.js';

export class HealthChecker {
  constructor(ssh) {
    this.ssh = ssh;
  }

  async check(config) {
    logger.header('Health Check');

    const { deploy: deployConfig, project } = config;
    const { healthCheck, docker, server } = deployConfig;

    // Wait for container to start
    logger.step('Waiting for container to start...');
    await this.sleep(10);

    // Check container status
    const containerStatus = await this.checkContainerStatus(docker.imageName);
    if (!containerStatus) {
      return { success: false, reason: 'Container not running' };
    }

    // HTTP health check
    if (project.backend) {
      const httpResult = await this.httpHealthCheck(healthCheck, server, docker);
      if (!httpResult.success) {
        return httpResult;
      }
    }

    logger.success('Health check passed');
    return { success: true };
  }

  async checkContainerStatus(imageName) {
    logger.step('Checking container status...');

    const result = await this.ssh.execCommand(
      `docker ps --filter ancestor=${imageName}:latest --format "{{.Status}}"`
    );

    if (result.stdout.trim()) {
      logger.success(`Container status: ${result.stdout.trim()}`);
      return true;
    }

    logger.error('Container not running');
    return false;
  }

  async httpHealthCheck(healthCheckConfig, server, docker) {
    logger.step('HTTP health check...');

    const port = docker.portMappings[0]?.host || 8080;
    const paths = this.getHealthCheckPaths(healthCheckConfig);

    for (const path of paths) {
      const result = await this.ssh.execCommand(
        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}${path}`
      );

      const statusCode = result.stdout.trim();
      logger.step(`  ${path} -> ${statusCode}`);

      if (this.isSuccessStatus(statusCode)) {
        logger.success(`Health check passed: ${path}`);
        return { success: true };
      }
    }

    logger.error('Health check failed');
    return {
      success: false,
      reason: 'HTTP health check failed, service may not have started properly'
    };
  }

  getHealthCheckPaths(config) {
    if (config?.path) {
      return [config.path];
    }
    return HEALTH_CHECK_PATHS;
  }

  isSuccessStatus(status) {
    const code = parseInt(status, 10);
    return (code >= 200 && code < 300) || code === 401 || code === 403;
  }

  async rollback(config) {
    logger.header('Rollback');

    const { docker } = config.deploy;
    logger.step('Rolling back to previous version...');

    // Find previous image
    const result = await this.ssh.execCommand(
      `docker images ${docker.imageName} --format "{{.Tag}}" | head -2 | tail -1`
    );

    const previousTag = result.stdout.trim();

    if (!previousTag || previousTag === 'latest') {
      logger.error('No version available for rollback');
      return false;
    }

    // Stop current container and start with previous image
    await this.ssh.execCommand(`docker stop ${docker.containerName} 2>/dev/null || true`);
    await this.ssh.execCommand(`docker rm ${docker.containerName} 2>/dev/null || true`);

    const { portMappings, volumeMappings } = docker;
    const portArgs = portMappings.map(p => `-p ${p.host}:${p.container}`).join(' ');
    const volumeArgs = volumeMappings.map(v => `-v ${v.host}:${v.container}`).join(' ');

    await this.ssh.execCommand(
      `docker run -d --name ${docker.containerName} ${portArgs} ${volumeArgs} ${docker.imageName}:${previousTag}`
    );

    logger.success(`Rolled back to version: ${previousTag}`);
    return true;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
