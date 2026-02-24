import test from 'node:test';
import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import {
  buildUnitCommandRequest,
  createC2RouterClient,
  dispatchCommand,
  loadC2RouterClientConstructor,
  type C2RouterClient,
  type UnitCommandRequest,
} from '../c2-client';

test('proto loads and exposes aethercore.c2.C2Router constructor', () => {
  const constructor = loadC2RouterClientConstructor();
  assert.equal(typeof constructor, 'function');
});

test('creates expected C2Router service stub with ExecuteUnitCommand RPC', () => {
  const client = createC2RouterClient('localhost:50051');
  assert.equal(typeof client.ExecuteUnitCommand, 'function');
  client.close();
});

test('dispatchCommand invokes ExecuteUnitCommand with UnitCommandRequest payload', async () => {
  let capturedRequest: UnitCommandRequest | undefined;

  const fakeClient = {
    ExecuteUnitCommand: (
      request: UnitCommandRequest,
      callback: (err: grpc.ServiceError | null, response: any) => void,
    ) => {
      capturedRequest = request;
      callback(null, {
        success: true,
        unit_id: request.unit_id,
        message: 'ok',
        timestamp_ns: request.timestamp_ns,
      });
    },
  } as unknown as C2RouterClient;

  const command = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'PURGE_NODE',
    target: 'unit-7',
    payload: { force: true },
    signature: 'sig-abc',
  };

  await new Promise<void>((resolve, reject) => {
    dispatchCommand(fakeClient, command, (err, response) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        assert.equal(response.success, true);
        assert.equal(response.unit_id, 'unit-7');
        assert.equal(response.message, 'ok');
        resolve();
      } catch (assertionErr) {
        reject(assertionErr);
      }
    });
  });

  assert.ok(capturedRequest, 'dispatch should send an RPC request');
  assert.equal(capturedRequest.unit_id, 'unit-7');
  assert.deepEqual(capturedRequest.signatures, ['sig-abc']);

  const parsedCommandJson = JSON.parse(capturedRequest.command_json);
  assert.deepEqual(parsedCommandJson, {
    id: command.id,
    type: command.type,
    payload: command.payload,
  });
});

test('buildUnitCommandRequest normalizes command payload shape', () => {
  const request = buildUnitCommandRequest({
    id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'MARK_HOSTILE',
    target: 'unit-99',
    signature: 'sig-xyz',
  });

  assert.equal(request.unit_id, 'unit-99');
  assert.deepEqual(request.signatures, ['sig-xyz']);
  assert.deepEqual(JSON.parse(request.command_json), {
    id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'MARK_HOSTILE',
    payload: {},
  });
});
