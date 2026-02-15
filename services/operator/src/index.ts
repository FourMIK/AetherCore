import OperatorService from './operator-service';
import { createApp } from './http';
import pino from 'pino';
import fs from 'fs';

// Initialize structured logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  ...(process.env.NODE_ENV === 'production'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

export { OperatorService };

function isRunningInContainer(): boolean {
  return process.env.RUNNING_IN_CONTAINER === 'true' || process.env.CONTAINER === 'true' || fs.existsSync('/.dockerenv');
}

function getDefaultBunkerEndpoint(): string {
  // In containerized environments, default to service DNS name
  // Outside containers, use localhost for local development
  return isRunningInContainer() ? 'c2-router:50051' : 'localhost:50051';
}

if (process.env.RUN_HTTP_SERVER === 'true') {
  const port = parseInt(process.env.OPERATOR_HTTP_PORT || '4001', 10);
  const aetherBunkerEndpoint = process.env.AETHER_BUNKER_ENDPOINT || getDefaultBunkerEndpoint();
  
  logger.info({ port, aetherBunkerEndpoint }, 'Operator service configuration loaded');
  
  const app = createApp();
  app.listen(port, () => {
    logger.info({ port }, 'Operator HTTP server listening');
  });
}
