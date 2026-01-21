import React, { useState } from 'react';
import { requestDeploy } from '../../api/operator';
import { useCommStore } from '../../store/useCommStore';

export interface DeployButtonProps {
  targetHost?: string;
  manifestPath?: string;
  defaultStrategy?: 'pi-ssh' | 'k8s' | 'local-compose';
  attestationVerified?: boolean;
}

export const DeployCodeRalphieButton: React.FC<DeployButtonProps> = ({
  targetHost,
  manifestPath,
  defaultStrategy = 'pi-ssh',
  attestationVerified = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const operator = useCommStore.getState().currentOperator;

  const handleDeploy = async () => {
    setError(null);
    setJobId(null);
    if (!operator?.id) {
      setError('Operator identity not available');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        operatorId: operator.id,
        strategy: defaultStrategy,
        targetHost,
        manifestPath,
      };
      const resp = await requestDeploy(payload);
      setJobId(resp.jobId);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        className="btn btn-primary"
        disabled={!attestationVerified || loading}
        onClick={handleDeploy}
        title={!attestationVerified ? 'Attestation required before deployment' : 'Deploy CodeRalphie to target'}
      >
        {loading ? 'Deploying…' : 'Deploy CodeRalphie'}
      </button>

      {jobId && (
        <div className="text-sm text-emerald-600">Deployment queued — job id: {jobId}</div>
      )}

      {error && <div className="text-sm text-red-600">Error: {error}</div>}
    </div>
  );
};

export default DeployCodeRalphieButton;
