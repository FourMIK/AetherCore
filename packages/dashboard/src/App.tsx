/**
 * App.tsx
 * Main application entry point for AetherCore Tactical Glass
 */

import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TauriCommands, SentinelTrustStatus } from './api/tauri-commands';
import { MapProvider } from './map-engine/MapContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { useTacticalStore } from './store/useTacticalStore';
import { useCommStore } from './store/useCommStore';
import { initializeComms } from './store/initComms';
import { getRuntimeConfig, loadUnifiedRuntimeConfig, setRuntimeConfig } from './config/runtime';
import {
  BootstrapOnboarding,
  shouldRunBootstrapOnboarding,
} from './components/onboarding/BootstrapOnboarding';
import './index.css';

interface StackStatus {
  ready: boolean;
  required_services: number;
  healthy_required_services: number;
  services: Array<{ name: string; required: boolean; healthy: boolean; remediation_hint: string }>;
}

const BOOTSTRAP_CHECK_TIMEOUT_MS = 10000;
const STACK_STATUS_TIMEOUT_MS = 10000;

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    operation,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const App: React.FC = () => {
  const theme = useTacticalStore((s) => s.theme);
  const [bootstrapReady, setBootstrapReady] = React.useState(false);
  const [bootstrapCheckComplete, setBootstrapCheckComplete] = React.useState(false);
  const [stackReady, setStackReady] = React.useState(false);
  const [stackCheckComplete, setStackCheckComplete] = React.useState(false);
  const [stackError, setStackError] = React.useState<string | null>(null);
  const [sentinelTrustStatus, setSentinelTrustStatus] = React.useState<SentinelTrustStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    withTimeout(shouldRunBootstrapOnboarding(), BOOTSTRAP_CHECK_TIMEOUT_MS, 'bootstrap check')
      .then((shouldRun) => {
        if (!mounted) {
          return;
        }
        setBootstrapReady(!shouldRun);
        setBootstrapCheckComplete(true);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        // Fail visible: if bootstrap probe hangs/fails, show onboarding rather than blank screen.
        setBootstrapReady(false);
        setBootstrapCheckComplete(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!bootstrapCheckComplete || !bootstrapReady) {
      return;
    }

    if (!isTauriRuntime()) {
      setStackReady(true);
      setStackCheckComplete(true);
      return;
    }

    let mounted = true;
    withTimeout(invoke<StackStatus>('stack_status'), STACK_STATUS_TIMEOUT_MS, 'stack status')
      .then((status) => {
        if (!mounted) {
          return;
        }
        setStackReady(status.ready);
        setStackCheckComplete(true);
        if (!status.ready) {
          const guidance = status.services
            .filter((service) => service.required && !service.healthy)
            .map((service) => `${service.name}: ${service.remediation_hint}`)
            .join(' | ');
          setStackError(
            guidance ||
              `Required services healthy: ${status.healthy_required_services}/${status.required_services}`,
          );
        } else {
          setStackError(null);
        }
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }
        setStackReady(false);
        setStackCheckComplete(true);
        setStackError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      mounted = false;
    };
  }, [bootstrapCheckComplete, bootstrapReady]);


  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let mounted = true;
    TauriCommands.getSentinelTrustStatus().then((result) => {
      if (!mounted || !result.success) {
        return;
      }
      setSentinelTrustStatus(result.data);
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (!bootstrapCheckComplete || !bootstrapReady || !stackCheckComplete || !stackReady) {
      return;
    }

    setTimeout(async () => {
      await loadUnifiedRuntimeConfig().then(setRuntimeConfig).catch(() => undefined);
      initializeComms();

      const { wsUrl } = getRuntimeConfig();
      const gatewayUrl = wsUrl;
      try {
        const commStore = useCommStore.getState();
        const clientId = commStore.currentOperator?.id || 'operator-local';
        commStore.initC2Client(gatewayUrl, clientId);
        commStore.connectC2().catch((err) => {
          console.error('[AETHERIC LINK] C2 connection failed:', err);
        });
        console.log('[AETHERIC LINK] C2 client initialized');
      } catch (err) {
        console.error('[AETHERIC LINK] Failed to initialize C2 client:', err);
      }
    }, 100);

    return () => {
      try {
        useCommStore.getState().disconnectC2();
      } catch {
        // Ignore errors during cleanup
      }
    };
  }, [bootstrapCheckComplete, bootstrapReady, stackCheckComplete, stackReady]);

  if (!bootstrapCheckComplete) {
    return (
      <div className="min-h-screen bg-carbon text-tungsten flex items-center justify-center">
        <p className="text-sm tracking-wide">Initializing Commander startup checks...</p>
      </div>
    );
  }

  if (!bootstrapReady) {
    return <BootstrapOnboarding onReady={() => setBootstrapReady(true)} />;
  }

  if (!stackCheckComplete) {
    return (
      <div className="min-h-screen bg-carbon text-tungsten flex items-center justify-center">
        <p className="text-sm tracking-wide">Verifying local stack health...</p>
      </div>
    );
  }

  if (!stackReady) {
    return <BootstrapOnboarding onReady={() => setStackReady(true)} externalError={stackError} />;
  }

  return (
    <MapProvider>
      <DashboardLayout sentinelTrustStatus={sentinelTrustStatus} />
    </MapProvider>
  );
};

export default App;
