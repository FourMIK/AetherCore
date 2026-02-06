/**
 * Settings Panel Component
 * 
 * Manages application configuration per Fail-Visible security doctrine.
 * All configuration is stored server-side and validated against security policy.
 * 
 * SECURITY:
 * - Frontend NEVER performs direct file I/O
 * - All config operations go through Tauri commands
 * - Invalid configurations are rejected with clear error messages
 */

import React, { useState, useEffect } from 'react';
import { Settings, Save, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { TauriCommands, type AppConfig } from '../api/tauri-commands';

export function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('');

  // Load configuration on mount
  useEffect(() => {
    loadConfig();
    loadConfigPath();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await TauriCommands.getConfig();
      if (result.success) {
        setConfig(result.data);
      } else {
        setError(`Failed to load configuration: ${result.error}`);
      }
    } catch (err) {
      setError(`Failed to load configuration: ${err}`);
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadConfigPath = async () => {
    try {
      const result = await TauriCommands.getConfigPath();
      if (result.success) {
        setConfigPath(result.data);
      }
    } catch (err) {
      console.error('Failed to get config path:', err);
    }
  };

  const saveConfig = async () => {
    if (!config) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const result = await TauriCommands.updateConfig(config);
      if (result.success) {
        setSuccess('Configuration saved successfully');
        
        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(`Failed to save configuration: ${result.error}`);
      }
    } catch (err) {
      setError(`Failed to save configuration: ${err}`);
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof AppConfig>(
    field: K,
    value: AppConfig[K]
  ) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  };

  const updateRetryConfig = <K extends keyof AppConfig['connection_retry']>(
    field: K,
    value: AppConfig['connection_retry'][K]
  ) => {
    if (!config) return;
    setConfig({
      ...config,
      connection_retry: {
        ...config.connection_retry,
        [field]: value,
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-cyan-400">Loading configuration...</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-400">Failed to load configuration</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-black/80 text-cyan-400 p-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-cyan-900/30">
        <Settings className="w-6 h-6" />
        <h2 className="text-2xl font-bold text-cyan-300">System Configuration</h2>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-500/50 rounded flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-red-300">{error}</div>
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-900/30 border border-green-500/50 rounded flex items-start gap-2">
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          <div className="text-green-300">{success}</div>
        </div>
      )}

      {/* Configuration Form */}
      <div className="space-y-6">
        {/* Connection Settings */}
        <section>
          <h3 className="text-xl font-semibold mb-4 text-cyan-200">
            Connection Settings
          </h3>

          {/* Production Mesh Endpoint */}
          <div className="mb-4">
            <label className="block mb-2 text-sm font-medium">
              Production C2 Mesh Endpoint
            </label>
            <div className="flex items-start gap-2 mb-1">
              <Info className="w-4 h-4 text-cyan-600 flex-shrink-0 mt-1" />
              <p className="text-xs text-cyan-600">
                SECURITY: Must use wss:// (secure WebSocket) protocol
              </p>
            </div>
            <input
              type="text"
              value={config.mesh_endpoint || ''}
              onChange={(e) => updateField('mesh_endpoint', e.target.value || null)}
              placeholder="wss://mesh.example.com/c2"
              className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded text-cyan-300 placeholder-cyan-700 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Testnet Endpoint (Deprecated) */}
          <div className="mb-4">
            <label className="block mb-2 text-sm font-medium">
              Testnet Endpoint <span className="text-yellow-500">(DEPRECATED)</span>
            </label>
            <div className="flex items-start gap-2 mb-1">
              <Info className="w-4 h-4 text-cyan-600 flex-shrink-0 mt-1" />
              <p className="text-xs text-cyan-600">
                For backward compatibility only. Use Production Mesh for new deployments.
              </p>
            </div>
            <input
              type="text"
              value={config.testnet_endpoint || ''}
              onChange={(e) => updateField('testnet_endpoint', e.target.value || null)}
              placeholder="ws://testnet.example.com"
              className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded text-cyan-300 placeholder-cyan-700 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </section>

        {/* Security Settings */}
        <section>
          <h3 className="text-xl font-semibold mb-4 text-cyan-200">
            Security Settings
          </h3>

          {/* TPM Enforcement */}
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enforce_tpm}
                onChange={(e) => updateField('enforce_tpm', e.target.checked)}
                className="w-4 h-4 text-cyan-500 bg-black/50 border-cyan-900/50 rounded focus:ring-cyan-500"
              />
              <span className="text-sm font-medium">Enforce TPM Hardware Authentication</span>
            </label>
            <div className="flex items-start gap-2 mt-1 ml-6">
              <Info className="w-4 h-4 text-cyan-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-cyan-600">
                When enabled, application will not start without valid TPM 2.0 attestation.
                Per Fail-Visible doctrine, this should remain enabled for production deployments.
              </p>
            </div>
          </div>
        </section>

        {/* Connection Retry Settings */}
        <section>
          <h3 className="text-xl font-semibold mb-4 text-cyan-200">
            Connection Retry Configuration
          </h3>

          {/* Max Retries */}
          <div className="mb-4">
            <label className="block mb-2 text-sm font-medium">
              Maximum Retry Attempts
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={config.connection_retry.max_retries}
              onChange={(e) =>
                updateRetryConfig('max_retries', parseInt(e.target.value) || 10)
              }
              className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Initial Delay */}
          <div className="mb-4">
            <label className="block mb-2 text-sm font-medium">
              Initial Retry Delay (milliseconds)
            </label>
            <input
              type="number"
              min="100"
              max="60000"
              value={config.connection_retry.initial_delay_ms}
              onChange={(e) =>
                updateRetryConfig('initial_delay_ms', parseInt(e.target.value) || 1000)
              }
              className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Max Delay */}
          <div className="mb-4">
            <label className="block mb-2 text-sm font-medium">
              Maximum Retry Delay (milliseconds)
            </label>
            <input
              type="number"
              min="1000"
              max="300000"
              value={config.connection_retry.max_delay_ms}
              onChange={(e) =>
                updateRetryConfig('max_delay_ms', parseInt(e.target.value) || 30000)
              }
              className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
            />
            <div className="flex items-start gap-2 mt-1">
              <Info className="w-4 h-4 text-cyan-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-cyan-600">
                Uses exponential backoff between initial_delay_ms and max_delay_ms
              </p>
            </div>
          </div>
        </section>

        {/* Debug Info */}
        <section className="pt-4 border-t border-cyan-900/30">
          <h3 className="text-sm font-semibold mb-2 text-cyan-600">
            Configuration File Location
          </h3>
          <code className="block p-3 bg-black/50 border border-cyan-900/50 rounded text-xs text-cyan-500 break-all">
            {configPath || 'Loading...'}
          </code>
        </section>
      </div>

      {/* Action Buttons */}
      <div className="mt-8 pt-6 border-t border-cyan-900/30 flex gap-4">
        <button
          onClick={saveConfig}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-cyan-700 hover:bg-cyan-600 disabled:bg-cyan-900 disabled:cursor-not-allowed text-white font-semibold rounded transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>

        <button
          onClick={loadConfig}
          disabled={loading || saving}
          className="px-6 py-3 bg-black/50 hover:bg-black/70 disabled:bg-black/30 disabled:cursor-not-allowed border border-cyan-900/50 text-cyan-400 font-semibold rounded transition-colors"
        >
          Reset to Saved
        </button>
      </div>
    </div>
  );
}
