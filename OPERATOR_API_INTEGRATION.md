# Operator API Integration Guide

## Overview
This document provides instructions for integrating the DeployCodeRalphieButton component into the AddNodeWizard.tsx attestation section.

## Integration Steps

### 1. Import the Component
Add the following import to `packages/dashboard/src/components/onboarding/AddNodeWizard.tsx`:

```typescript
import { DeployCodeRalphieButton } from './DeployCodeRalphieButton';
```

### 2. Add State for Attestation Verification
In the AddNodeWizard component, add a state variable to track attestation verification:

```typescript
const [attestationVerified, setAttestationVerified] = useState(false);
```

### 3. Update Attestation Stage to Mark Verification Complete
In the attestation stage section (around line 226-241), update the mock verification to set the attestation as verified:

```typescript
{stage === 'attestation' && (
  <div className="space-y-4">
    <h3 className="font-display text-xl text-tungsten">TPM Attestation</h3>
    <p className="text-tungsten/70">
      Verifying TPM attestation and cryptographic signatures...
    </p>
    <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
      <div className="h-full bg-overmatch animate-pulse w-3/4" />
    </div>
    <div className="text-xs text-tungsten/50 space-y-2">
      <div>✓ TPM Present: Verified</div>
      <div>✓ Attestation Key: Generated</div>
      <div>✓ CodeRalphie Identity: Verified</div>
    </div>
    
    {/* Add deployment button here */}
    <div className="pt-4 mt-4 border-t border-tungsten/10">
      <DeployCodeRalphieButton
        targetHost={nodeId ? \`\${nodeId}.local\` : undefined}
        defaultStrategy="pi-ssh"
        attestationVerified={true}
      />
    </div>
  </div>
)}
```

### 4. Alternative: Dynamic Attestation Verification
For a more realistic flow, you can simulate attestation verification after a delay:

```typescript
// In the attestation stage's useEffect or handleNext logic:
useEffect(() => {
  if (stage === 'attestation') {
    setTimeout(() => {
      setAttestationVerified(true);
    }, 2000); // Simulate 2s attestation verification
  }
}, [stage]);
```

## Environment Configuration

### Operator Service Configuration
The operator service requires the following environment variables:

- `RUN_HTTP_SERVER=true` - Enable HTTP server
- `OPERATOR_HTTP_PORT=4001` - HTTP port (default: 4001)
- `ALLOWED_OPERATOR_IDS=operator-1,operator-2` - Comma-separated list of allowed operator IDs
- `OPERATOR_AUDIT_LOG_PATH=/var/log/aethercore/operator-deploy.log` - Audit log path
- `OPERATOR_SSH_KEY_PATH=/home/operator/.ssh/id_rsa` - SSH key path
- `CODE_RALPHIE_PATH=/opt/code-ralphie` - CodeRalphie installation path
- `OPERATOR_KUBECONFIG=/etc/kubernetes/admin.conf` - Kubernetes config path

### Starting the Operator Service
```bash
cd services/operator
RUN_HTTP_SERVER=true ALLOWED_OPERATOR_IDS=operator-1 npm start
```

## Security Notes

1. **Auth Placeholder**: The current implementation uses a simple `x-operator-id` header check. This is a placeholder for the project's auth layer integration.

2. **Integration Points**: The `ensureOperatorAuth` middleware in `services/operator/src/http.ts` should be replaced with the project's actual authentication middleware.

3. **Audit Logging**: All deployment requests are logged to the configured audit log path with timestamps and operator information.

4. **Input Sanitization**: Host names are sanitized, and Kubernetes manifest paths are validated against a whitelist directory.

## Testing

### Manual Testing
1. Start the operator service with `RUN_HTTP_SERVER=true`
2. Use curl to test the endpoint:

```bash
curl -X POST http://localhost:4001/api/operator/deploy \
  -H "Content-Type: application/json" \
  -H "x-operator-id: operator-1" \
  -d '{
    "strategy": "pi-ssh",
    "targetHost": "192.168.1.100",
    "operatorId": "operator-1"
  }'
```

Expected response:
```json
{
  "jobId": "deploy-1234567890-uuid"
}
```

## API Reference

### POST /api/operator/deploy

**Headers:**
- `x-operator-id`: Operator identifier (required)
- `content-type`: application/json

**Request Body:**
```typescript
{
  operatorId: string;
  strategy: 'pi-ssh' | 'k8s' | 'local-compose';
  targetHost?: string;      // Required for pi-ssh
  targetUser?: string;      // Optional for pi-ssh (default: 'pi')
  manifestPath?: string;    // Required for k8s
  imageTag?: string;
  genesisBundle?: string;
  reason?: string;
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "deploy-1234567890-uuid"
}
```

**Error Responses:**
- 400: Missing required fields
- 401: Missing operator ID header
- 500: Deployment error
