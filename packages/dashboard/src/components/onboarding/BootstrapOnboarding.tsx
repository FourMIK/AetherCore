import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getRuntimeConfig } from '../../config/runtime';

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
}

interface ConnectivityCheck {
  api_healthy: boolean;
  websocket_reachable: boolean;
  details: string[];
}

const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 1000;
const TIMEOUT_BUDGET_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const BootstrapOnboarding: React.FC<{ onReady: () => void }> = ({ onReady }) => {
  const [steps, setSteps] = useState<BootstrapStep[]>([
    { id: 'dirs', label: 'Initialize local data/config directories', state: 'pending', attempts: 0 },
    { id: 'services', label: 'Start and validate managed local services', state: 'pending', attempts: 0 },
    { id: 'connectivity', label: 'Verify dashboard API and WebSocket connectivity', state: 'pending', attempts: 0 },
  ]);
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

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
    setErrorSummary(null);

    try {
      const dirs = await runWithRetry('dirs', async () => invoke<string[]>('initialize_local_data_dirs'));
      updateStep('dirs', { state: 'success', detail: `Ready (${dirs.length} directories)` });

      const serviceStatuses = await runWithRetry('services', async () => {
        await invoke<ServiceStatus[]>('start_managed_services');
        return invoke<ServiceStatus[]>('check_local_service_status');
      });

      const unhealthyRequired = serviceStatuses.filter((svc) => svc.required && !svc.healthy);
      if (unhealthyRequired.length > 0) {
        throw new Error(`Required services unhealthy: ${unhealthyRequired.map((svc) => svc.name).join(', ')}`);
      }
      updateStep('services', {
        state: 'success',
        detail: `${serviceStatuses.filter((svc) => svc.healthy).length}/${serviceStatuses.length} healthy`,
      });

      const runtime = getRuntimeConfig();
      const apiHealth = `${runtime.apiUrl || 'http://127.0.0.1:3000'}/health`;
      const wsEndpoint = runtime.wsUrl || 'ws://127.0.0.1:8080';
      const connectivity = await runWithRetry('connectivity', () =>
        invoke<ConnectivityCheck>('verify_dashboard_connectivity', {
          apiHealthEndpoint: apiHealth,
          websocketEndpoint: wsEndpoint,
        })
      );

      if (!connectivity.api_healthy || !connectivity.websocket_reachable) {
        throw new Error(connectivity.details.join(' | '));
      }

      updateStep('connectivity', { state: 'success', detail: 'All connectivity checks passed' });
      await invoke<string>('set_bootstrap_state', { completed: true });
      onReady();
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

  useEffect(() => {
    void executeFlow();
  }, [executeFlow]);

  const progress = useMemo(() => {
    const complete = steps.filter((step) => step.state === 'success').length;
    return Math.round((complete / steps.length) * 100);
  }, [steps]);

  return (
    <div className="min-h-screen bg-carbon text-tungsten p-8">
      <div className="mx-auto max-w-3xl rounded-lg border border-overmatch/40 bg-carbon-2 p-6">
        <h1 className="text-2xl font-display mb-2">First-Run Bootstrap</h1>
        <p className="text-sm text-tungsten/80 mb-4">
          Deterministic readiness contract: {TIMEOUT_BUDGET_MS / 1000}s timeout budget, {RETRY_LIMIT} retries, {RETRY_DELAY_MS}ms backoff.
        </p>
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

        {errorSummary && (
          <div className="mt-4 rounded border border-jamming/60 bg-jamming/10 p-4">
            <p className="font-semibold">Guided remediation</p>
            <ul className="list-disc pl-5 text-sm mt-2 space-y-1">
              <li>Verify local services can bind to ports 3000 and 8080.</li>
              <li>Run `pnpm --dir services/gateway dev` and `pnpm --dir services/collaboration dev` manually.</li>
              <li>Confirm API `/health` and WebSocket endpoints are reachable from this host.</li>
            </ul>
            <p className="mt-2 text-xs">Last error: {errorSummary}</p>
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
            onClick={() => {
              void invoke<string>('set_bootstrap_state', { completed: false });
            }}
            className="rounded border border-overmatch/40 px-4 py-2"
          >
            Reset first-run state
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

  try {
    const state = await invoke<{ completed: boolean }>('get_bootstrap_state');
    return !state.completed;
  } catch {
    return true;
  }
}
