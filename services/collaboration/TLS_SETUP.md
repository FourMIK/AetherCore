# TLS Configuration for gRPC Services

This document describes how to configure TLS/mTLS for secure gRPC communication between the collaboration service and Rust backend services (Signing Service, Identity Registry).

## Overview

The gRPC clients now support **TLS 1.3** with optional **mutual TLS (mTLS)** for service-to-service authentication. This ensures:

- **Encrypted Communication**: All gRPC traffic is encrypted
- **Server Authentication**: Clients verify the server's identity
- **Client Authentication** (mTLS): Servers verify the client's identity
- **No Graceful Degradation**: Security failures result in connection termination per fail-visible doctrine

## Configuration

### Environment Variables

- `NODE_ENV`: Set to `production` to automatically enable TLS
- Development mode (`NODE_ENV=development`) uses insecure connections with explicit warnings

### Client Configuration

Both `SigningServiceClient` and `IdentityRegistryClient` accept TLS configuration:

```typescript
import { SigningServiceClient } from './SigningServiceClient';

// TLS with server authentication only
const client = new SigningServiceClient({
  serverAddress: 'signing-service.aethercore.local:50052',
  useTls: true,
  caCertPath: '/etc/aethercore/certs/ca.pem',
});

// mTLS with mutual authentication
const client = new SigningServiceClient({
  serverAddress: 'signing-service.aethercore.local:50052',
  useTls: true,
  caCertPath: '/etc/aethercore/certs/ca.pem',
  clientKeyPath: '/etc/aethercore/certs/client-key.pem',
  clientCertPath: '/etc/aethercore/certs/client-cert.pem',
});
```

## Certificate Generation

### Development Certificates (Self-Signed)

For local development and testing, you can generate self-signed certificates:

```bash
# Navigate to scripts directory
cd scripts

# Generate development certificates
./generate-tactical-certs.sh
```

This generates:
- `ca.pem`: Certificate Authority root certificate
- `server-key.pem`: Server private key
- `server-cert.pem`: Server certificate
- `client-key.pem`: Client private key (for mTLS)
- `client-cert.pem`: Client certificate (for mTLS)

### Production Certificates

For production deployments, use certificates from a trusted CA:

1. **Public CA** (e.g., Let's Encrypt):
   ```bash
   certbot certonly --standalone -d signing-service.yourdomain.com
   ```

2. **Internal PKI** (recommended for service-to-service):
   - Use an internal Certificate Authority (e.g., HashiCorp Vault, CFSSL)
   - Generate certificates with proper SANs and key usage extensions
   - Implement certificate rotation policies

3. **Certificate Requirements**:
   - **TLS Version**: TLS 1.3 required
   - **Key Type**: RSA 2048-bit minimum or Ed25519
   - **Validity**: 90 days maximum (with automated rotation)
   - **Subject Alternative Names (SANs)**: Include all service hostnames

## File Permissions

Certificate files must have restricted permissions:

```bash
chmod 600 /etc/aethercore/certs/*.pem
chown aethercore:aethercore /etc/aethercore/certs/*.pem
```

## Deployment Examples

### Docker Compose

```yaml
version: '3.8'
services:
  collaboration:
    image: aethercore/collaboration:latest
    environment:
      - NODE_ENV=production
      - SIGNING_SERVICE_ADDRESS=signing-service:50052
      - IDENTITY_REGISTRY_ADDRESS=identity-registry:50051
    volumes:
      - /etc/aethercore/certs:/certs:ro
    command:
      - --ca-cert=/certs/ca.pem
      - --client-key=/certs/client-key.pem
      - --client-cert=/certs/client-cert.pem
```

### Kubernetes

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: grpc-tls-certs
type: Opaque
data:
  ca.pem: <base64-encoded-ca-cert>
  client-key.pem: <base64-encoded-key>
  client-cert.pem: <base64-encoded-cert>
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: collaboration-service
spec:
  template:
    spec:
      containers:
      - name: collaboration
        image: aethercore/collaboration:latest
        env:
        - name: NODE_ENV
          value: "production"
        volumeMounts:
        - name: tls-certs
          mountPath: /certs
          readOnly: true
      volumes:
      - name: tls-certs
        secret:
          secretName: grpc-tls-certs
          defaultMode: 0400
```

## Certificate Rotation

Implement automated certificate rotation to maintain security:

1. **Monitoring**: Track certificate expiration dates
2. **Pre-expiry Renewal**: Renew certificates 30 days before expiration
3. **Graceful Reload**: Update certificates without service interruption
4. **Validation**: Verify new certificates before deployment

### Rotation Script Example

```bash
#!/bin/bash
# cert-rotation.sh

NEW_CERT="/tmp/new-cert.pem"
ACTIVE_CERT="/etc/aethercore/certs/client-cert.pem"

# Fetch new certificate from CA
fetch_new_certificate > "$NEW_CERT"

# Validate certificate
if openssl x509 -in "$NEW_CERT" -noout -checkend 2592000; then
  # Atomic replacement
  mv "$NEW_CERT" "$ACTIVE_CERT"
  chmod 600 "$ACTIVE_CERT"
  
  # Reload service (graceful restart)
  systemctl reload aethercore-collaboration
  
  echo "Certificate rotated successfully"
else
  echo "ERROR: New certificate expires within 30 days"
  exit 1
fi
```

## Security Considerations

### Fail-Visible Doctrine

If TLS is enabled but certificates are missing or invalid:
- **Connection FAILS immediately**
- **No fallback to insecure mode**
- **Clear error messages logged**

This ensures no silent degradation of security posture.

### Network Segmentation

Deploy services in isolated network segments:
- **Backend Services**: Internal-only network (no public exposure)
- **API Gateway**: DMZ with strict firewall rules
- **mTLS Enforcement**: Required for all service-to-service communication

### Monitoring

Monitor TLS handshake failures and certificate expiration:

```bash
# Check certificate expiration
openssl x509 -in /etc/aethercore/certs/client-cert.pem -noout -dates

# Monitor TLS handshake failures (Prometheus metric)
grpc_client_tls_handshake_failures_total
```

## Troubleshooting

### Common Issues

1. **"CA certificate path not provided"**
   - Ensure `caCertPath` is set when `useTls: true`
   - Verify file exists and is readable

2. **"Certificate verify failed"**
   - Check certificate chain (CA → Server Cert)
   - Verify certificate hostname matches server address
   - Ensure certificates haven't expired

3. **"Permission denied reading certificate"**
   - Check file permissions (should be 600 or 400)
   - Verify process user has read access

4. **"Connection refused"**
   - Verify server is listening on TLS port
   - Check firewall rules
   - Ensure server TLS is properly configured

### Debug Mode

Enable gRPC debug logging:

```bash
export GRPC_TRACE=all
export GRPC_VERBOSITY=DEBUG
npm start
```

## References

- [gRPC Authentication Guide](https://grpc.io/docs/guides/auth/)
- [TLS 1.3 Specification (RFC 8446)](https://tools.ietf.org/html/rfc8446)
- [mTLS Best Practices](https://www.cloudflare.com/learning/access-management/what-is-mutual-tls/)
- [Certificate Transparency](https://certificate.transparency.dev/)
