import OperatorService from './operator-service';
import { createApp } from './http';
import pino from 'pino';
import { getDefaultC2Endpoint } from '@aethercore/shared';

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

if (process.env.RUN_HTTP_SERVER === 'true') {
  const port = parseInt(process.env.OPERATOR_HTTP_PORT || '4001', 10);
  const aetherBunkerEndpoint = process.env.AETHER_BUNKER_ENDPOINT || getDefaultC2Endpoint();
  
  logger.info({ port, aetherBunkerEndpoint }, 'Operator service configuration loaded');
  
  const app = createApp();
  app.listen(port, () => {
    logger.info({ port }, 'Operator HTTP server listening');
  });
}
