# TLS Enforcement in AetherCore

## Overview

AetherCore enforces TLS (Transport Layer Security) for all network communications as part of its Fail-Visible security doctrine. This document explains the TLS enforcement rules, development exceptions, and configuration options.

## Security Rules

### Production Posture (Default)

1. **Remote WebSocket Connections**: MUST use `wss://` (WebSocket Secure)
2. **Remote HTTP Connections**: MUST use `https://` (HTTP Secure)
3. **Remote gRPC Connections**: MUST use TLS/SSL credentials
4. **Insecure protocols** (`ws://`, `http://`) are **rejected** for non-localhost endpoints

### Development Exception

For localhost/development environments ONLY, insecure protocols may be used with explicit opt-in:

**Environment Variable**: `VITE_DEV_ALLOW_INSECURE_LOCALHOST=true`

When this flag is set:
- `ws://localhost`, `ws://127.0.0.1`, `ws://[::1]` are allowed
- `http://localhost`, `http://127.0.0.1`, `http://[::1]` are allowed
- Insecure gRPC to localhost is allowed

**Important**: This flag is ONLY for development and testing. It should NEVER be enabled in production deployments.

## Configuration

### Dashboard Environment Variables

Create a `.env` file in `packages/dashboard/`:

```env
# TLS Enforcement
VITE_DEV_ALLOW_INSECURE_LOCALHOST=true  # Only for local development

# WebSocket URL (example)
VITE_GATEWAY_URL=wss://c2.aethercore.local:8443

# API URL (example)
VITE_API_URL=https://gateway.aethercore.local:3000

# TPM (for production)
VITE_TPM_ENABLED=true
```

### Production Configuration

In `config/production.yaml`:

```yaml
network:
  tls_min_version: "1.3"
  websocket:
    use_wss: true
    # ... other settings
```

## Certificate Setup for Test Beds

### Self-Signed Certificates (Development)

For local development and testing, you can generate self-signed certificates:

```bash
# Generate private key
openssl genrsa -out server.key 2048

# Generate certificate signing request
openssl req -new -key server.key -out server.csr \
  -subj "/CN=localhost/O=AetherCore Dev"

# Generate self-signed certificate
openssl x509 -req -days 365 -in server.csr -signkey server.key -out server.crt

# Generate PFX for Windows/C# services
openssl pkcs12 -export -out server.pfx -inkey server.key -in server.crt
```

### Using Certificates with Services

#### Node.js/Express (Gateway Service)

```javascript
const https = require('https');
const fs = require('fs');

const server = https.createServer({
  key: fs.readFileSync('./certs/server.key'),
  cert: fs.readFileSync('./certs/server.crt'),
}, app);

server.listen(3000);
```

#### gRPC (Rust/Tonic)

```rust
use tonic::transport::{Server, ServerTlsConfig};

let tls_config = ServerTlsConfig::new()
    .identity(Identity::from_pem(cert, key));

Server::builder()
    .tls_config(tls_config)?
    .add_service(service)
    .serve(addr)
    .await?;
```

### Trusting Self-Signed Certificates

#### System Trust Store (Linux)

```bash
# Copy certificate
sudo cp server.crt /usr/local/share/ca-certificates/aethercore-dev.crt

# Update CA certificates
sudo update-ca-certificates
```

#### Browser Trust (for testing dashboard)

1. Navigate to `https://localhost:8443`
2. Accept security warning (development only)
3. Add exception for self-signed certificate

## Connection Errors and Troubleshooting

### Common Error Messages

#### "Remote WebSocket endpoints MUST use wss://"

**Cause**: Attempting to connect to a non-localhost endpoint using `ws://`

**Solution**: Use `wss://` protocol or change endpoint to localhost for development

#### "Insecure localhost WebSocket (ws://) requires DEV_ALLOW_INSECURE_LOCALHOST=true"

**Cause**: Attempting to connect to localhost using `ws://` without the development flag

**Solution**: Either:
1. Set `VITE_DEV_ALLOW_INSECURE_LOCALHOST=true` in your `.env` file (dev only)
2. Use `wss://` with proper certificates

#### Certificate Validation Errors

**Common causes**:
- Expired certificate
- Certificate not trusted by system
- Hostname mismatch
- Self-signed certificate without trust

**Solutions**:
- For production: Use certificates from a trusted CA
- For development: Add self-signed cert to system trust store or use DEV_ALLOW_INSECURE_LOCALHOST

### Verifying TLS Connection

#### Check WebSocket Connection

```javascript
// In browser console
const ws = new WebSocket('wss://c2.aethercore.local:8443');
ws.onopen = () => console.log('Connected via TLS');
ws.onerror = (e) => console.error('Connection error:', e);
```

#### Check Certificate

```bash
# Test TLS handshake
openssl s_client -connect c2.aethercore.local:8443

# View certificate details
openssl s_client -connect c2.aethercore.local:8443 -showcerts
```

## Logging and Observability

### Connection Status Logging

The WebSocketManager logs security-relevant events:

```
[AETHERIC LINK] Carrier signal established...
[AETHERIC LINK] INSECURE LOCALHOST MODE: Using ws:// for localhost...
[CRITICAL] Bunker rejected heartbeat: TLS error
```

### Security Audit Log

Production deployments should enable audit logging in `config/production.yaml`:

```yaml
logging:
  audit_log:
    enabled: true
    path: "/var/log/aethercore/audit.log"
```

## Testing TLS Enforcement

### Unit Tests

Run endpoint validation tests:

```bash
cd packages/dashboard
pnpm test src/utils/__tests__/endpoint-validation.test.ts
```

### Integration Tests

Test full connection flow:

```bash
# Start test server with TLS
cd tests/mock-servers
pnpm run start:tls

# Run dashboard tests
cd packages/dashboard
pnpm test:e2e
```

## Security Posture Summary

| Environment | Protocol | Localhost Insecure | Remote Insecure | TLS Required |
|------------|----------|-------------------|-----------------|--------------|
| Production | wss://, https:// | ❌ Rejected | ❌ Rejected | ✅ Required |
| Development (DEV_ALLOW_INSECURE_LOCALHOST=true) | ws://, http:// | ✅ Allowed | ❌ Rejected | ⚠️ Optional for localhost only |
| Development (DEV_ALLOW_INSECURE_LOCALHOST=false) | wss://, https:// | ❌ Rejected | ❌ Rejected | ✅ Required |

## Best Practices

1. **Never deploy with DEV_ALLOW_INSECURE_LOCALHOST=true** in production
2. **Use certificates from a trusted CA** for production deployments
3. **Monitor certificate expiration** and renew before expiry
4. **Enable certificate revocation checking** in production
5. **Use TLS 1.3** as specified in production.yaml
6. **Test certificate setup** before deploying to production
7. **Document certificate renewal procedures** for operations team

## References

- [Production Configuration](../config/production.yaml)
- [Endpoint Validation Source](../packages/dashboard/src/utils/endpoint-validation.ts)
- [WebSocket Manager](../packages/dashboard/src/services/api/WebSocketManager.ts)
- [SECURITY.md](../SECURITY.md)
