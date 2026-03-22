// .deploy/scripts/utils/constants.js

export const DEPLOY_DIR = '.deploy';
export const CONFIG_FILE = 'config.json';
export const SECRETS_FILE = '.secrets.json';
export const REMOTE_DIR = 'remote';

export const FRONTEND_FRAMEWORKS = {
  vue: { detect: 'vue', buildDir: 'dist', type: 'static' },
  react: { detect: 'react', buildDir: 'build', type: 'static' },
  angular: { detect: '@angular/core', buildDir: 'dist', type: 'static' },
  vite: { detect: 'vite', buildDir: 'dist', type: 'static' },
  nextjs: { detect: 'next', buildDir: '.next', type: 'ssr' },
  nuxtjs: { detect: 'nuxt', buildDir: '.output', type: 'ssr' }
};

export const BACKEND_FRAMEWORKS = {
  java: {
    detect: ['pom.xml', 'build.gradle'],
    buildDir: 'target',
    buildCommand: 'mvn clean package -DskipTests',
    port: 8080,
    runtime: 'java'
  },
  nodejs: {
    detect: 'package.json',
    buildDir: 'dist',
    buildCommand: 'npm run build',
    port: 3000,
    runtime: 'node'
  },
  python: {
    detect: ['requirements.txt', 'pyproject.toml'],
    buildDir: null,
    buildCommand: null,
    port: 8000,
    runtime: 'python'
  },
  golang: {
    detect: 'go.mod',
    buildDir: null,
    buildCommand: 'go build -o app',
    port: 8080,
    runtime: 'go'
  }
};

export const PROXY_CONFIG_FILES = [
  'vite.config.js',
  'vite.config.ts',
  'vue.config.js',
  'webpack.config.js',
  'next.config.js',
  'nuxt.config.js'
];

export const HEALTH_CHECK_PATHS = [
  '/actuator/health',
  '/health',
  '/api/health',
  '/api/status'
];
