import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { z } from 'zod';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

// Parse TPM_ENABLED environment variable
function parseTpmEnabled(): boolean {
  const value = process.env.TPM_ENABLED;
  if (value === undefined || value === '') {
    return true; // Default: enabled
  }
  const normalized = value.toLowerCase().trim();
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  return true; // Default if invalid value
}

const TPM_ENABLED = parseTpmEnabled();

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

const PORT = process.env.PORT || 3000;
const C2_GRPC_TARGET = process.env.C2_ADDR || 'localhost:50051';
// Backend endpoint for future integration with AetherBunker services
const AETHER_BUNKER_ENDPOINT = process.env.AETHER_BUNKER_ENDPOINT || process.env.C2_ADDR || 'localhost:50051';
const PROTO_PATH = path.resolve(__dirname, '../../../crates/c2-router/proto/c2.proto');

logger.info({
  port: PORT,
  c2_target: C2_GRPC_TARGET,
  bunker_endpoint: AETHER_BUNKER_ENDPOINT,
  tpm_enabled: TPM_ENABLED,
}, 'Gateway service configuration loaded');

if (!TPM_ENABLED) {
  logger.warn('TPM is DISABLED - Hardware-rooted trust features are not active. Security guarantees reduced.');
}

const CommandSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['PURGE_NODE', 'OVERRIDE_AUTH', 'SWARM_RECONFIG', 'MARK_HOSTILE']),
  target: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
  signature: z.string().min(1, "Operator signature required"), 
});

const packageDefinition = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
const c2_proto = grpc.loadPackageDefinition(packageDefinition).c2 as any;
const client = new c2_proto.CommandService(C2_GRPC_TARGET, grpc.credentials.createInsecure());

const app = express();
app.use(cors());
app.use(express.json());
const server = createServer(app);
const wss = new WebSocketServer({ server });

let backendHealthy = false;

wss.on('connection', (ws: WebSocket) => {
  logger.info('Tactical Glass operator connected');
  ws.send(JSON.stringify({ type: 'SYSTEM_STATUS', status: backendHealthy ? 'ONLINE' : 'DEGRADED', backend: backendHealthy ? 'CONNECTED' : 'UNREACHABLE' }));

  ws.on('message', (message: string) => {
    try {
      const raw = JSON.parse(message.toString());
      if (raw.type === 'COMMAND_FRAME') {
        const validation = CommandSchema.safeParse(raw.data);
        if (!validation.success) {
          logger.warn({ validation_error: validation.error }, 'Invalid command schema');
          ws.send(JSON.stringify({ type: 'ERROR', code: 'INVALID_SCHEMA', details: validation.error }));
          return;
        }
        const cmd = validation.data;
        logger.info({ command_type: cmd.type, target: cmd.target, command_id: cmd.id }, 'Dispatching command');
        client.ExecuteCommand({
          command_id: cmd.id,
          target_id: cmd.target,
          command_type: cmd.type,
          signature: cmd.signature,
          payload: JSON.stringify(cmd.payload || {})
        }, (err: any, response: any) => {
          if (err) {
            logger.error({ error: err.message, command_id: cmd.id }, 'C2 RPC error');
            ws.send(JSON.stringify({ type: 'COMMAND_ACK', status: 'FAILED', error: err.message }));
          } else {
            logger.info({ transaction_id: response.tx_id, command_id: cmd.id }, 'Command dispatched successfully');
            ws.send(JSON.stringify({ type: 'COMMAND_ACK', status: 'SENT', transaction_id: response.tx_id }));
          }
        });
      }
    } catch (e) { 
      logger.error({ error: e instanceof Error ? e.message : String(e) }, 'Message parse error');
      ws.send(JSON.stringify({ type: 'ERROR', code: 'PARSE_ERROR', message: 'Invalid JSON format' }));
    }
  });
});

setInterval(() => {
  const deadline = new Date();
  deadline.setSeconds(deadline.getSeconds() + 5);
  client.waitForReady(deadline, (err: Error) => {
    if (err) {
      if (backendHealthy) {
        logger.error({ error: err.message }, 'CRITICAL: Backend unreachable');
        backendHealthy = false;
        broadcast({ type: 'SYSTEM_ALERT', level: 'CRITICAL', message: 'BACKEND_CONNECTION_LOST' });
      }
    } else {
      if (!backendHealthy) {
        logger.info('Backend connection restored');
        backendHealthy = true;
        broadcast({ type: 'SYSTEM_STATUS', status: 'ONLINE', backend: 'CONNECTED' });
      }
    }
  });
}, 5000);

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(msg); });
}

server.listen(PORT, () => {
  logger.info({ port: PORT, c2_core: C2_GRPC_TARGET }, '4MIK Gateway active');
});
