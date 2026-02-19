import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { loadUnifiedRuntimeConfig, getRuntimeConfig, setRuntimeConfig } from '../../config/runtime';

type StepState = 'pending' | 'running' | 'success' | 'error';

interface BootstrapStep {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  attempts: number;
}

interface ServiceStatus {
  name: string;
  required: boolean;
  healthy: boolean;
  health_endpoint: string;
  port: number;
  remediation_hint: string;
  startup_order: number;
  running: boolean;
}

interface ConnectivityCheck {
  api_healthy: boolean;
  websocket_reachable: boolean;
  details: string[];
}

interface StackStatus {
  ready: boolean;
  required_services: number;
  healthy_required_services: number;
  services: ServiceStatus[];
  readiness: Array<{ name: string; healthy: boolean; remediation_hint: string; last_error?: string | null }>;
}

interface DeploymentStatus {
  node_id: string;
  pid: number;
  port: number;
  started_at: number;
  status: string;
}

const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 1000;
const TIMEOUT_BUDGET_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const BootstrapOnboarding: React.FC<{ onReady: () => void; externalError?: string | null }> = ({ onReady, externalError }) => {
  const [steps, setSteps] = useState<BootstrapStep[]>([
    { id: 'environment', label: 'Device check', state: 'pending', attempts: 0 },
    { id: 'stack', label: 'Local stack boot', state: 'pending', attempts: 0 },
    { id: 'mesh', label: 'Mesh connect', state: 'pending', attempts: 0 },
    { id: 'node', label: 'First node deploy', state: 'pending', attempts: 0 },
  ]);
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [flowComplete, setFlowComplete] = useState(false);
  const [latestServiceStatus, setLatestServiceStatus] = useState<ServiceStatus[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const recommendedProfile = 'commander-edition';
  const recommendedMeshEndpoint = 'ws://127.0.0.1:8080';
  const firstNodeId = 'first-node';

  const updateStep = useCallback((id: string, patch: Partial<BootstrapStep>) => {
    setSteps((prev) => prev.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  }, []);

  const runWithRetry = useCallback(async <T,>(stepId: string, action: () => Promise<T>) => {
    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
      updateStep(stepId, { state: 'running', attempts: attempt, detail: `Attempt ${attempt}/${RETRY_LIMIT}` });
      try {
        return await Promise.race([
          action(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout exceeded (${TIMEOUT_BUDGET_MS}ms)`)), TIMEOUT_BUDGET_MS)
          ),
        ]);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < RETRY_LIMIT) {
          updateStep(stepId, { detail: `Attempt ${attempt} failed. Retrying...` });
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
    throw new Error(lastError);
  }, [updateStep]);

  const executeFlow = useCallback(async () => {
    if (!isTauriRuntime()) {
      onReady();
      return;
    }

    setIsRunning(true);
    setFlowComplete(false);
    setErrorSummary(null);

    try {
      const unified = await loadUnifiedRuntimeConfig();
      setRuntimeConfig(unified);
      if (!unified.features.bootstrap_on_startup) {
        onReady();
        return;
      }
      const dirs = await runWithRetry('environment', async () => invoke<string[]>('initialize_local_data_dirs'));
      updateStep('environment', { state: 'success', detail: `Environment ready (${dirs.length} local directories prepared)` });

      const stackStatus = await runWithRetry('stack', async () => {
        const status = await invoke<StackStatus>('start_stack');
        updateStep('stack', {
          detail: `Required services healthy ${status.healthy_required_services}/${status.required_services}`
        });
        return invoke<StackStatus>('stack_status');
      });
      const serviceStatuses = stackStatus.services;
      setLatestServiceStatus(serviceStatuses);

      const unhealthyRequired = serviceStatuses.filter((svc) => svc.required && !svc.healthy);
      if (unhealthyRequired.length > 0) {
        throw new Error(`Required services unhealthy: ${unhealthyRequired.map((svc) => svc.name).join(', ')}`);
      }
      updateStep('stack', {
        state: 'success',
        detail: `Required services healthy ${stackStatus.healthy_required_services}/${stackStatus.required_services}`,
      });

      const runtime = getRuntimeConfig();
      const apiHealth = `${runtime.apiUrl || 'http://127.0.0.1:3000'}/health`;
      const wsEndpoint = runtime.wsUrl || recommendedMeshEndpoint;
      const connectivity = await runWithRetry('mesh', () =>
        invoke<ConnectivityCheck>('verify_dashboard_connectivity', {
          apiHealthEndpoint: apiHealth,
          websocketEndpoint: wsEndpoint,
        })
      );

      if (!connectivity.api_healthy || !connectivity.websocket_reachable) {
        throw new Error(connectivity.details.join(' | '));
      }

      updateStep('mesh', { state: 'success', detail: 'Dashboard API and mesh WebSocket are reachable' });

      const existingDeployments = await invoke<DeploymentStatus[]>('get_deployment_status').catch(() => []);
      const alreadyRunning = existingDeployments.find((deployment) => deployment.node_id === firstNodeId);

      if (alreadyRunning) {
        updateStep('node', {
          state: 'success',
          detail: `Node ${firstNodeId} already running (pid ${alreadyRunning.pid})`,
        });
      } else {
        const nodeDeployment = await runWithRetry('node', () =>
          invoke<DeploymentStatus>('deploy_node', {
            config: {
              node_id: firstNodeId,
              mesh_endpoint: wsEndpoint,
              listen_port: 9000,
              data_dir: './data/first-node',
              log_level: 'info',
            },
          })
        );
        updateStep('node', {
          state: 'success',
          detail: `Node ${nodeDeployment.node_id} deployed and running on port ${nodeDeployment.port}`,
        });
      }

      await invoke<string>('set_bootstrap_state', { completed: true });
      localStorage.setItem('bootstrap.onboarding.completed', 'true');
      setFlowComplete(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorSummary(message);
      setSteps((prev) =>
        prev.map((step) =>
          step.state === 'running' ? { ...step, state: 'error', detail: message } : step
        )
      );
    } finally {
      setIsRunning(false);
    }
  }, [onReady, runWithRetry, updateStep]);

  const convertErrorToPlainLanguage = useCallback((message: string) => {
    const normalized = message.toLowerCase();
    const portMatch = message.match(/(?:port\s*|:)(\d{2,5})/i);
    const blockedPort = portMatch?.[1];

    if ((normalized.includes('refused') || normalized.includes('timed out') || normalized.includes('unreachable')) && blockedPort) {
      return {
        title: `Connection blocked by firewall on port ${blockedPort}.`,
        instructions: [
          `Allow local loopback traffic on port ${blockedPort} in your firewall policy.`,
          'After updating firewall rules, click Retry now to verify the connection path.',
        ],
      };
    }

    if (normalized.includes('timeout exceeded')) {
      return {
        title: 'Setup timed out before services finished starting.',
        instructions: [
          'Wait about 30 seconds for local services to warm up, then run Retry checks.',
          'If it keeps timing out, choose Repair deployment to restart local services cleanly.',
        ],
      };
    }

    if (normalized.includes('required services unhealthy') || normalized.includes('failed to bind')) {
      return {
        title: 'Local services did not start correctly.',
        instructions: [
          'Close other apps that might be using ports 3000 or 8080.',
          'Run Repair deployment to restart the local stack.',
          'If the issue persists, reboot the machine and relaunch AetherCore.',
        ],
      };
    }

    if (normalized.includes('websocket') || normalized.includes('/health')) {
      return {
        title: 'Dashboard could not reach the local mesh endpoints.',
        instructions: [
          'Make sure your local firewall allows loopback traffic on ports 3000 and 8080.',
          'Run Retry checks after confirming networking is enabled.',
        ],
      };
    }

    if (normalized.includes('failed to locate node binary')) {
      return {
        title: 'Node runtime is missing, so first node deployment cannot complete.',
        instructions: [
          'Reinstall or repair the desktop package so the node binary is bundled.',
          'Engineering appendix users can set NODE_BINARY_PATH to the aethercore-node binary.',
        ],
      };
    }

    return {
      title: 'Setup could not finish automatically.',
      instructions: [
        'Run Retry checks once to confirm whether this was transient.',
        'If it repeats, run Repair deployment and then Retry checks again.',
      ],
    };
  }, []);

  const runQuickSelfTest = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }

    setErrorSummary(null);
    setIsRunning(true);

    try {
      const stackStatus = await invoke<StackStatus>('stack_status');
      const serviceStatuses = stackStatus.services;
      const requiredUnhealthy = serviceStatuses.filter((svc) => svc.required && !svc.healthy);
      if (requiredUnhealthy.length > 0) {
        throw new Error(`Required services unhealthy: ${requiredUnhealthy.map((svc) => svc.name).join(', ')}`);
      }

      const runtime = getRuntimeConfig();
      const connectivity = await invoke<ConnectivityCheck>('verify_dashboard_connectivity', {
        apiHealthEndpoint: `${runtime.apiUrl || 'http://127.0.0.1:3000'}/health`,
        websocketEndpoint: runtime.wsUrl || recommendedMeshEndpoint,
      });

      if (!connectivity.api_healthy || !connectivity.websocket_reachable) {
        throw new Error(connectivity.details.join(' | '));
      }

      const deployments = await invoke<DeploymentStatus[]>('get_deployment_status');
      const nodeReady = deployments.some((deployment) => deployment.node_id === firstNodeId && deployment.status === 'Running');

      if (!nodeReady) {
        throw new Error(`First node not running: ${firstNodeId}`);
      }

      setErrorSummary('Quick self-test passed: dashboard, mesh, and node deployment are healthy.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorSummary(message);
    } finally {
      setIsRunning(false);
    }
  }, []);

  const repairDeployment = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }

    setErrorSummary(null);
    setIsRunning(true);
    try {
      await invoke<StackStatus>('repair_stack');
      await executeFlow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorSummary(message);
    } finally {
      setIsRunning(false);
    }
  }, [executeFlow]);

  useEffect(() => {
    if (externalError) {
      setErrorSummary(externalError);
    }
  }, [externalError]);

  useEffect(() => {
    void executeFlow();
  }, [executeFlow]);

  const progress = useMemo(() => {
    const complete = steps.filter((step) => step.state === 'success').length;
    return Math.round((complete / steps.length) * 100);
  }, [steps]);

  const plainLanguageError = errorSummary ? convertErrorToPlainLanguage(errorSummary) : null;

  return (
    <div className="min-h-screen bg-carbon text-tungsten p-8">
      <div className="mx-auto max-w-3xl rounded-lg border border-overmatch/40 bg-carbon-2 p-6">
        <h1 className="text-2xl font-display mb-2">Commander Edition Setup</h1>
        <p className="text-sm text-tungsten/80 mb-4">
          Tactical Glass follows a single supported first-run path: Commander Edition bootstrap.
        </p>

        <div className="mb-4 rounded border border-overmatch/30 bg-carbon p-3 text-xs">
          <p className="font-semibold">Commander Edition defaults (auto-applied)</p>
          <p>Profile: <span className="font-mono">{recommendedProfile}</span></p>
          <p>Mesh endpoint: <span className="font-mono">{recommendedMeshEndpoint}</span></p>
          <p className="text-tungsten/70 mt-1">Advanced options are hidden during first run for a deterministic setup path.</p>
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="mt-2 underline decoration-dotted"
          >
            {showAdvanced ? 'Hide Advanced' : 'Advanced'}
          </button>
          {showAdvanced && (
            <div className="mt-2 rounded border border-overmatch/20 bg-carbon-2 p-2 text-[11px] space-y-1">
              <p>Endpoint (internal): <span className="font-mono">{recommendedMeshEndpoint}</span></p>
              <p>Log level (internal): <span className="font-mono">info</span></p>
              <p>Profile internals: <span className="font-mono">{recommendedProfile}</span> / deterministic bootstrap policy</p>
            </div>
          )}
        </div>

        <div className="mb-4 h-2 w-full rounded bg-carbon">
          <div className="h-2 rounded bg-overmatch transition-all" style={{ width: `${progress}%` }} />
        </div>
        <ul className="space-y-3">
          {steps.map((step) => (
            <li key={step.id} className="rounded border border-overmatch/20 p-3">
              <div className="flex items-center justify-between">
                <span>{step.label}</span>
                <span className="text-xs uppercase">
                  {step.state === 'success' && 'PASS'}
                  {step.state === 'running' && 'RUNNING'}
                  {step.state === 'error' && 'FAIL'}
                  {step.state === 'pending' && 'WAIT'}
                </span>
              </div>
              {step.detail && <p className="mt-1 text-xs text-tungsten/80">{step.detail}</p>}
            </li>
          ))}
        </ul>

        {errorSummary && plainLanguageError && (
          <div className="mt-4 rounded border border-jamming/60 bg-jamming/10 p-4">
            <p className="font-semibold">{plainLanguageError.title}</p>
            <ul className="list-disc pl-5 text-sm mt-2 space-y-1">
              {plainLanguageError.instructions.map((instruction) => (
                <li key={instruction}>{instruction}</li>
              ))}
            </ul>
            {latestServiceStatus.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {latestServiceStatus.map((service) => (
                  <li key={service.name}>
                    {service.name}: {service.healthy ? 'healthy' : 'unhealthy'} — {service.remediation_hint}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs">Last error: {errorSummary}</p>
            <button
              type="button"
              onClick={() => void executeFlow()}
              disabled={isRunning}
              className="mt-3 rounded bg-overmatch px-3 py-1.5 text-carbon text-xs disabled:opacity-50"
            >
              Retry now
            </button>
          </div>
        )}

        {flowComplete && (
          <div className="mt-4 rounded border border-overmatch bg-overmatch/10 p-4">
            <p className="font-semibold text-lg">Mission Ready</p>
            <p className="text-sm mt-1">All launch checks passed. Core operator services are online.</p>
            <ul className="mt-3 space-y-1 text-sm">
              <li>✅ Dashboard service reachable</li>
              <li>✅ Mesh link established</li>
              <li>✅ Deployment pipeline active</li>
            </ul>
            <p className="text-xs mt-2 text-tungsten/80">Acceptance criteria: a non-technical user can complete first deployment from this guided flow without terminal usage.</p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => void runQuickSelfTest()}
                disabled={isRunning}
                className="rounded border border-overmatch/50 px-4 py-2 text-sm disabled:opacity-50"
              >
                Run quick self-test
              </button>
              <button
                type="button"
                onClick={onReady}
                className="rounded bg-overmatch px-4 py-2 text-carbon text-sm"
              >
                Open dashboard
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => void executeFlow()}
            disabled={isRunning}
            className="rounded bg-overmatch px-4 py-2 text-carbon disabled:opacity-50"
          >
            Retry checks
          </button>
          <button
            type="button"
            onClick={() => void repairDeployment()}
            disabled={isRunning}
            className="rounded border border-jamming/50 px-4 py-2 disabled:opacity-50"
          >
            Repair deployment
          </button>
        </div>
      </div>
    </div>
  );
};

export async function shouldRunBootstrapOnboarding(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  const forcedByInstaller =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('bootstrap') === '1';

  const forcedByCli = await invoke<boolean>('installer_bootstrap_requested').catch(() => false);

  if (forcedByInstaller || forcedByCli) {
    return true;
  }

  if (typeof window !== 'undefined' && localStorage.getItem('bootstrap.onboarding.completed') === 'true') {
    return false;
  }

  try {
    const state = await invoke<{ completed: boolean }>('get_bootstrap_state');
    return !state.completed;
  } catch {
    return true;
  }
}
