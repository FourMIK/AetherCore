const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PORT = process.env.PORT || '50051';
const address = `0.0.0.0:${PORT}`;
const protoPath = path.resolve(__dirname, './proto/c2.proto');

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const loaded = grpc.loadPackageDefinition(packageDefinition);
const C2Router = loaded?.aethercore?.c2?.C2Router;

if (!C2Router) {
  throw new Error(`Unable to load service aethercore.c2.C2Router from ${protoPath}`);
}

const server = new grpc.Server();

server.addService(C2Router.service, {
  ExecuteUnitCommand(call, callback) {
    callback(null, {
      success: true,
      unit_id: call.request?.target || 'mock-unit',
      message: 'mock-executed',
    });
  },
  AbortCommand(_call, callback) {
    callback(null, {
      success: true,
      command_id: 'mock-command',
      reason: 'mock-abort',
    });
  },
});

server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error) => {
  if (error) {
    console.error('[c2-router-mock] failed to bind', error);
    process.exit(1);
  }

  server.start();
  console.log(`[c2-router-mock] listening on ${address}`);
});
