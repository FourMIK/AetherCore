import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

export type CommandFrame = {
  id: string;
  type: string;
  target: string;
  payload?: Record<string, unknown>;
  signature: string;
};

export type UnitCommandRequest = {
  unit_id: string;
  command_json: string;
  signatures: string[];
  timestamp_ns: string;
};

export type UnitCommandResponse = {
  success: boolean;
  unit_id: string;
  message: string;
  timestamp_ns: string;
};

export type C2RouterClient = grpc.Client & {
  ExecuteUnitCommand(
    request: UnitCommandRequest,
    callback: (err: grpc.ServiceError | null, response: UnitCommandResponse) => void,
  ): void;
};

const PROTO_PATH = path.resolve(__dirname, '../../../crates/c2-router/proto/c2.proto');

export function loadC2RouterClientConstructor(protoPath = PROTO_PATH) {
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const loadedProto = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject & {
    aethercore?: {
      c2?: {
        C2Router?: grpc.ServiceClientConstructor;
      };
    };
  };

  const constructor = loadedProto?.aethercore?.c2?.C2Router;
  if (!constructor) {
    throw new Error(`Unable to load aethercore.c2.C2Router from proto: ${protoPath}`);
  }

  return constructor;
}

export function createC2RouterClient(target: string, protoPath = PROTO_PATH): C2RouterClient {
  const C2RouterClientCtor = loadC2RouterClientConstructor(protoPath);
  return new C2RouterClientCtor(target, grpc.credentials.createInsecure()) as unknown as C2RouterClient;
}

export function buildUnitCommandRequest(command: CommandFrame): UnitCommandRequest {
  return {
    unit_id: command.target,
    command_json: JSON.stringify({
      id: command.id,
      type: command.type,
      payload: command.payload ?? {},
    }),
    signatures: [command.signature],
    timestamp_ns: Date.now().toString(),
  };
}

export function dispatchCommand(
  client: C2RouterClient,
  command: CommandFrame,
  callback: (err: grpc.ServiceError | null, response: UnitCommandResponse) => void,
) {
  client.ExecuteUnitCommand(buildUnitCommandRequest(command), callback);
}
