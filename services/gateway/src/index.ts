import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { z } from 'zod';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const C2_GRPC_TARGET = process.env.C2_ADDR || 'localhost:50051';
const PROTO_PATH = path.resolve(__dirname, '../../../crates/c2-router/proto/c2.proto');

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
  console.log('Tactical Glass :: Operator Connected');
  ws.send(JSON.stringify({ type: 'SYSTEM_STATUS', status: backendHealthy ? 'ONLINE' : 'DEGRADED', backend: backendHealthy ? 'CONNECTED' : 'UNREACHABLE' }));

  ws.on('message', (message: string) => {
    try {
      const raw = JSON.parse(message.toString());
      if (raw.type === 'COMMAND_FRAME') {
        const validation = CommandSchema.safeParse(raw.data);
        if (!validation.success) {
          ws.send(JSON.stringify({ type: 'ERROR', code: 'INVALID_SCHEMA', details: validation.error }));
          return;
        }
        const cmd = validation.data;
        console.log(`Gateway :: Dispatching ${cmd.type} -> ${cmd.target}`);
        client.ExecuteCommand({
          command_id: cmd.id,
          target_id: cmd.target,
          command_type: cmd.type,
          signature: cmd.signature,
          payload: JSON.stringify(cmd.payload || {})
        }, (err: any, response: any) => {
          if (err) {
            console.error('Gateway :: C2 RPC Error:', err);
            ws.send(JSON.stringify({ type: 'COMMAND_ACK', status: 'FAILED', error: err.message }));
          } else {
            ws.send(JSON.stringify({ type: 'COMMAND_ACK', status: 'SENT', transaction_id: response.tx_id }));
          }
        });
      }
    } catch (e) { console.error('Gateway :: Parse Error', e); }
  });
});

setInterval(() => {
  const deadline = new Date();
  deadline.setSeconds(deadline.getSeconds() + 1);
  client.waitForReady(deadline, (err: Error) => {
    if (err) {
      if (backendHealthy) {
        console.error("Gateway :: CRITICAL :: Backend Unreachable");
        backendHealthy = false;
        broadcast({ type: 'SYSTEM_ALERT', level: 'CRITICAL', message: 'BACKEND_CONNECTION_LOST' });
      }
    } else {
      if (!backendHealthy) {
        console.info("Gateway :: STATUS :: Backend Restored");
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
  console.log(`\n=== 4MIK Gateway Active on port ${PORT} ===`);
  console.log(`[INFO] Linked to C2 Core at ${C2_GRPC_TARGET}`);
});
