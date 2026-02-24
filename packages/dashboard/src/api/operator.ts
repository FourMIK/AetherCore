import { getRuntimeConfig } from '../config/runtime';

export interface DeployRequestPayload {
  operatorId: string;
  strategy: 'pi-ssh' | 'k8s' | 'local-compose';
  targetHost?: string;
  targetUser?: string;
  manifestPath?: string;
  imageTag?: string;
  genesisBundle?: string;
  reason?: string;
}

export async function requestDeploy(payload: DeployRequestPayload) {
  const { apiUrl } = getRuntimeConfig();
  const normalizedBase = apiUrl.replace(/\/$/, '');
  const deployEndpoint = normalizedBase ? `${normalizedBase}/operator/deploy` : '/api/operator/deploy';

  const res = await fetch(deployEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operator-id': payload.operatorId
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`deploy request failed: ${res.status} ${txt}`);
  }
  return res.json();
}
