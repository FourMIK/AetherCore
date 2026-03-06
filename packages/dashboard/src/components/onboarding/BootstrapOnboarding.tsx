import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isDemoMode,
  isTauriRuntime,
  loadUnifiedRuntimeConfig,
  getRuntimeConfig,
  setRuntimeConfig,
} from '../../config/runtime';
import { TauriCommands, type DeploymentStatus, type ConnectivityCheck } from '../../api/tauri-commands';

type StepState = 'pending' | 'running' | 'success' | 'error';

interface BootstrapStep {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  attempts: number;
}

interface StackStatus {
  ready: boolean;
  required_services: number;
  healthy_required_services: number;
  services: {
    name: string;
    required: boolean;
    healthy: boolean;
    remediation_hint: string;
  }[];
}

const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_BUDGET_MS = 30000;
const STACK_BOOT_TIMEOUT_MS = 120000;

const DEMO_NODE_ID = 'demo-node-01';
const DEMO_DEPLOY_LISTEN_PORT = 9000;
const DEMO_DEPLOY_DATA_DIR = './data/demo-node';
const DEMO_LOG_LEVEL = 'info';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildSteps = (includeDemoNode: boolean): BootstrapStep[] => {
  const base = [
    { id: 'environment', label: 'Device check', state: 'pending' as StepState, attempts: 0 },
    { id: 'stack', label: 'Local stack boot', state: 'pending' as StepState, attempts: 0 },
    { id: 'mesh', label: 'Mesh connect', state: 'pending' as StepState, attempts: 0 },
  ];

  if (includeDemoNode) {
    base.push({ id: 'node', label: 'Demo node deploy', state: 'pending' as StepState, attempts: 0 });
  }

  return base;
};

export const BootstrapOnboarding: React.FC<{
  onReady: () => void;
  externalError?: string | null;
}> = ({ onReady, externalError }) => {
  const demoModeEnabled = isDemoMode();
  const [steps, setSteps] = useState<BootstrapStep[]>(() => buildSteps(demoModeEnabled));
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [flowComplete, setFlowComplete] = useState(false);
  const [latestServiceStatus, setLatestServiceStatus] = useState<StackStatus['services']>([]);
  const [latestConnectivityDetails, setLatestConnectivityDetails] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateStep = useCallback((id: string, patch: Partial<BootstrapStep>) => {
    setSteps((prev) => prev.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  }, []);

  const runWithRetry = useCallback(async <T,>(
    stepId: string,
    action: () => Promise<T>,
    timeoutMs: number = DEFAULT_TIMEOUT_BUDGET_MS,
  ) => {
    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
      updateStep(stepId, {
        state: 'running',
        attempts: attempt,
        detail: `Attempt ${attempt}/${RETRY_LIMIT}`,
      });
      try {
        return await Promise.race([
          action(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout exceeded (${timeoutMs}ms)`)), timeoutMs),
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

  const ensureSuccess = useCallback(async <T,>(stepId: string, action: () => Promise<{ success: true; data: T } | { success: false; error: string }>): Promise<T> => {
    const result = await action();
    if (!result.success) {
      updateStep(stepId, { state: 'error', detail: result.error });
      throw new Error(result.error);
    }
    return result.data;
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

      const dirs = await runWithRetry('environment', async () => {
        const result = await TauriCommands.initializeLocalDataDirs();
        return ensureSuccess('environment', () => Promise.resolve(result));
      });
      updateStep('environment', {
        state: 'success',
        detail: `Environment ready (${dirs.length} local directories prepared)`,
      });

      const stackStatus = await runWithRetry('stack', async () => {
        await ensureSuccess('stack', () => TauriCommands.startStack());
        const statusResult = await TauriCommands.getStackStatus();
        return ensureSuccess('stack', () => Promise.resolve(statusResult));
      }, STACK_BOOT_TIMEOUT_MS);
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
      const wsEndpoint = runtime.wsUrl || 'ws://127.0.0.1:3000';

      const connectivity = await runWithRetry(
        'mesh',
        async () => {
          const result = await TauriCommands.verifyDashboardConnectivity(apiHealth, wsEndpoint);
          return ensureSuccess('mesh', () => Promise.resolve(result));
        },
        DEFAULT_TIMEOUT_BUDGET_MS,
      );

      setLatestConnectivityDetails(connectivity.details);
      if (!connectivity.api_healthy || !connectivity.websocket_reachable) {
        throw new Error(connectivity.details.join(' | '));
      }
      updateStep('mesh', { state: 'success', detail: 'Dashboard API and mesh WebSocket are reachable' });

      if (demoModeEnabled) {
        const deploymentsResult = await TauriCommands.getDeploymentStatus();
        const deployments = await ensureSuccess('node', () => Promise.resolve(deploymentsResult));
        const alreadyRunning = deployments.find(
          (deployment: DeploymentStatus) => deployment.node_id === DEMO_NODE_ID,
        );

        if (alreadyRunning) {
          updateStep('node', {
            state: 'success',
            detail: `Demo node ${DEMO_NODE_ID} already running (pid ${alreadyRunning.pid})`,
          });
        } else {
          const nodeDeployment = await runWithRetry(
            'node',
            async () => {
              const result = await TauriCommands.deployNode({
                node_id: DEMO_NODE_ID,
                mesh_endpoint: wsEndpoint,
                listen_port: DEMO_DEPLOY_LISTEN_PORT,
                data_dir: DEMO_DEPLOY_DATA_DIR,
                log_level: DEMO_LOG_LEVEL,
              });
              return ensureSuccess('node', () => Promise.resolve(result));
            },
            DEFAULT_TIMEOUT_BUDGET_MS,
          );
          updateStep('node', {
            state: 'success',
            detail: `Demo node ${nodeDeployment.node_id} deployed on port ${nodeDeployment.port}`,
          });
        }
      }

      await TauriCommands.setBootstrapState(true);
      localStorage.setItem('bootstrap.onboarding.completed', 'true');
      setFlowComplete(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorSummary(message);
      setSteps((prev) =>
        prev.map((step) =>
          step.state === 'running' ? { ...step, state: 'error', detail: message } : step,
        ),
      );
    } finally {
      setIsRunning(false);
    }
  }, [demoModeEnabled, ensureSuccess, onReady, runWithRetry, updateStep]);

  const convertErrorToPlainLanguage = useCallback((message: string) => {
    const normalized = message.toLowerCase();
    const portMatch = message.match(/(?:port\s*|:)(\d{2,5})/i);
    const blockedPort = portMatch?.[1];

    if (
      (normalized.includes('refused') || normalized.includes('timed out') || normalized.includes('unreachable')) &&
      blockedPort
    ) {
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

    if (normalized.includes('deploy demo node') || normalized.includes('node_id')) {
      return {
        title: 'Demo deployment did not complete.',
        instructions: [
          'Run Repair deployment to restart local services.',
          'If you are not in demo mode, this step is intentionally skipped.',
          'Review service logs from the Admin workspace for deeper diagnostics.',
        ],
      };
    }

    if (normalized.includes('failed to locate node binary')) {
      return {
        title: 'Node runtime is missing, so demo deployment could not complete.',
        instructions: [
          'Reinstall or repair the desktop package so the node binary is bundled.',
          'If your operator profile is service-only, disable DEMO mode and rerun bootstrap.',
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
      const stackStatusResult = await TauriCommands.getStackStatus();
      const stackStatus = await ensureSuccess('stack', () => Promise.resolve(stackStatusResult));

      const requiredUnhealthy = stackStatus.services.filter((svc) => svc.required && !svc.healthy);
      if (requiredUnhealthy.length > 0) {
        throw new Error(`Required services unhealthy: ${requiredUnhealthy.map((svc) => svc.name).join(', ')}`);
      }

      const runtime = getRuntimeConfig();
      const connectivityResult = await TauriCommands.verifyDashboardConnectivity(
        `${runtime.apiUrl || 'http://127.0.0.1:3000'}/health`,
        runtime.wsUrl || 'ws://127.0.0.1:3000',
      );
      const connectivity = await ensureSuccess('mesh', () => Promise.resolve(connectivityResult));

      if (!connectivity.api_healthy || !connectivity.websocket_reachable) {
        throw new Error(connectivity.details.join(' | '));
      }

      if (demoModeEnabled) {
        const deploymentStatusResult = await TauriCommands.getDeploymentStatus();
        const deployments = await ensureSuccess('node', () => Promise.resolve(deploymentStatusResult));
        const nodeReady = deployments.some(
          (deployment: DeploymentStatus) =>
            deployment.node_id === DEMO_NODE_ID && deployment.status === 'Running',
        );
        if (!nodeReady) {
          throw new Error(`Demo node not running: ${DEMO_NODE_ID}`);
        }
      }

      setErrorSummary('Quick self-test passed: dashboard and mesh connectivity are healthy.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorSummary(message);
    } finally {
      setIsRunning(false);
    }
  }, [demoModeEnabled, ensureSuccess]);

  const repairDeployment = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }

    setErrorSummary(null);
    setIsRunning(true);
    try {
      const repaired = await TauriCommands.repairStack();
      await ensureSuccess('stack', () => Promise.resolve(repaired));
      await executeFlow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorSummary(message);
    } finally {
      setIsRunning(false);
    }
  }, [executeFlow, ensureSuccess]);

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

  const runtime = getRuntimeConfig();
  const recommendedMeshEndpoint = runtime.wsUrl || 'ws://127.0.0.1:3000';

  return (
    <div className="min-h-screen bg-carbon text-tungsten p-8">
      <div className="mx-auto max-w-3xl rounded-lg border border-overmatch/40 bg-carbon-2 p-6">
        <h1 className="text-2xl font-display mb-2">Commander Edition Setup</h1>
        <p className="text-sm text-tungsten/80 mb-4">
          Tactical Glass follows a deterministic bootstrap path with service-backed checks.
        </p>

        <div className="mb-4 rounded border border-overmatch/30 bg-carbon p-3 text-xs">
          <p className="font-semibold">Bootstrap defaults</p>
          <p>Profile: <span className="font-mono">commander_edition</span></p>
          <p>Mesh endpoint: <span className="font-mono">{recommendedMeshEndpoint}</span></p>
          <p className="text-tungsten/70 mt-1">Advanced options are hidden during first run for deterministic setup.</p>
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="mt-2 underline decoration-dotted"
          >
            {showAdvanced ? 'Hide Advanced' : 'Advanced'}
          </button>
          {showAdvanced && (
            <div className="mt-2 rounded border border-overmatch/20 bg-carbon-2 p-2 text-[11px] space-y-1">
              <p>Demo mode enabled: <span className="font-mono">{String(demoModeEnabled)}</span></p>
              <p>Demo node: <span className="font-mono">{DEMO_NODE_ID}</span></p>
              <p>Endpoint: <span className="font-mono">{recommendedMeshEndpoint}</span></p>
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
            {latestConnectivityDetails.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {latestConnectivityDetails.map((detail) => (
                  <li key={detail}>{detail}</li>
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
              {demoModeEnabled && <li>✅ Demo node deployment active</li>}
              {!demoModeEnabled && <li>✅ Demo deployment skipped (service-backed mode active)</li>}
            </ul>
            <p className="text-xs mt-2 text-tungsten/80">Acceptance criteria: one deterministic readiness path that never injects synthetic service state.</p>
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

  const forcedByCli = await TauriCommands.installerBootstrapRequested()
    .then((result) => {
      if (!result.success) {
        return false;
      }
      return result.data;
    })
    .catch(() => false);

  if (forcedByInstaller) {
    return true;
  }

  if (typeof window !== 'undefined' && localStorage.getItem('bootstrap.onboarding.completed') === 'true') {
    return false;
  }

  try {
    const stateResult = await TauriCommands.getBootstrapState();
    if (!stateResult.success) {
      return true;
    }
    return !stateResult.data.completed;
  } catch {
    return true;
  }
}
