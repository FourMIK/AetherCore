import test from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { loadConfig } from '../config';
import { OAuthTokenManager } from '../token-manager';
import { LatticeRestAdapter } from '../rest-adapter';
import { LatticeGrpcAdapter } from '../grpc-adapter';

const smokeEnabled = process.env.LATTICE_SANDBOX_SMOKE === '1';

test(
  'optional sandbox smoke: REST and gRPC can each ingest at least one event window',
  { skip: !smokeEnabled },
  async () => {
    const previousMode = process.env.LATTICE_INTEGRATION_MODE;
    const previousProtocol = process.env.LATTICE_PROTOCOL_MODE;
    process.env.LATTICE_INTEGRATION_MODE = 'standard';
    process.env.LATTICE_PROTOCOL_MODE = 'hybrid';

    const config = loadConfig();
    const logger = pino({ enabled: false });
    const tokenManager = new OAuthTokenManager(config, logger, () => undefined, () => undefined);
    const restAdapter = new LatticeRestAdapter(config, tokenManager, logger);
    const grpcAdapter = new LatticeGrpcAdapter(config, tokenManager, logger);

    try {
      const [restEntities, restTasks, grpcEntities, grpcTasks] = await Promise.all([
        restAdapter.pullEntities(null),
        restAdapter.pullTasks(null),
        grpcAdapter.pullEntities(null),
        grpcAdapter.pullTasks(null),
      ]);

      assert.ok(Array.isArray(restEntities.events));
      assert.ok(Array.isArray(restTasks.events));
      assert.ok(Array.isArray(grpcEntities.events));
      assert.ok(Array.isArray(grpcTasks.events));
    } finally {
      grpcAdapter.close();
      if (previousMode === undefined) {
        delete process.env.LATTICE_INTEGRATION_MODE;
      } else {
        process.env.LATTICE_INTEGRATION_MODE = previousMode;
      }
      if (previousProtocol === undefined) {
        delete process.env.LATTICE_PROTOCOL_MODE;
      } else {
        process.env.LATTICE_PROTOCOL_MODE = previousProtocol;
      }
    }
  },
);
