// .deploy/scripts/utils/logger.js
import chalk from 'chalk';

export const logger = {
  info: (msg) => console.log(chalk.blue('ℹ'), msg),
  success: (msg) => console.log(chalk.green('✓'), msg),
  warn: (msg) => console.log(chalk.yellow('⚠'), msg),
  error: (msg) => console.log(chalk.red('✗'), msg),
  step: (msg) => console.log(chalk.gray('  →'), msg),
  header: (msg) => console.log(chalk.bold.cyan(`\n${msg}\n`))
};
