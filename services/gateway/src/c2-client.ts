import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import fs from 'fs';

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

const PROTO_PATH = path.resolve(__dirname, 'proto/c2.proto');

function parseEnvBool(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function readOptionalFile(pathValue: string | undefined, label: string): Buffer | null {
  const normalizedPath = pathValue?.trim();
  if (!normalizedPath) {
    return null;
  }
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`${label} file not found at ${normalizedPath}`);
  }
  return fs.readFileSync(normalizedPath);
}

function createRouterCredentials(target: string): {
  credentials: grpc.ChannelCredentials;
  options: grpc.ChannelOptions;
} {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    parseEnvBool(process.env.AETHERCORE_PRODUCTION, false);
  const allowInsecure = parseEnvBool(process.env.C2_GRPC_INSECURE, !isProduction);

  if (allowInsecure) {
    if (isProduction) {
      throw new Error(
        `Refusing insecure C2 gRPC transport for ${target}. Unset C2_GRPC_INSECURE in production.`,
      );
    }
    return {
      credentials: grpc.credentials.createInsecure(),
      options: {},
    };
  }

  const caCert = readOptionalFile(process.env.C2_GRPC_CA_CERT_PATH, 'C2_GRPC_CA_CERT_PATH');
  const clientCert = readOptionalFile(
    process.env.C2_GRPC_CLIENT_CERT_PATH,
    'C2_GRPC_CLIENT_CERT_PATH',
  );
  const clientKey = readOptionalFile(process.env.C2_GRPC_CLIENT_KEY_PATH, 'C2_GRPC_CLIENT_KEY_PATH');
  const hasClientMaterial = !!clientCert || !!clientKey;

  if (hasClientMaterial && (!clientCert || !clientKey)) {
    throw new Error('Both C2_GRPC_CLIENT_CERT_PATH and C2_GRPC_CLIENT_KEY_PATH are required for mTLS');
  }

  if (isProduction && !caCert) {
    throw new Error('C2_GRPC_CA_CERT_PATH is required in production mode');
  }

  if (isProduction && !hasClientMaterial) {
    throw new Error(
      'mTLS is required in production mode (set C2_GRPC_CLIENT_CERT_PATH and C2_GRPC_CLIENT_KEY_PATH)',
    );
  }

  const serverNameOverride = process.env.C2_GRPC_SERVER_NAME_OVERRIDE?.trim();
  const options: grpc.ChannelOptions = {};
  if (serverNameOverride) {
    options['grpc.ssl_target_name_override'] = serverNameOverride;
    options['grpc.default_authority'] = serverNameOverride;
  }

  return {
    credentials: grpc.credentials.createSsl(caCert ?? undefined, clientKey ?? undefined, clientCert ?? undefined),
    options,
  };
}

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
  const channel = createRouterCredentials(target);
  return new C2RouterClientCtor(target, channel.credentials, channel.options) as unknown as C2RouterClient;
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
