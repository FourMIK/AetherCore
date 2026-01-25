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
  const res = await fetch('/api/operator/deploy', {
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
