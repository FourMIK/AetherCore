/**
 * Settings Panel Component
 */

import React, { useState, useEffect } from 'react';
import { Settings, Save, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { TauriCommands, type AppConfig } from '../api/tauri-commands';
import { setRuntimeConfig } from '../config/runtime';

export function SettingsPanel() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('');

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
        setRuntimeConfig(result.data);
      } else {
        setError(`Failed to load configuration: ${result.error}`);
      }
    } catch (err) {
      setError(`Failed to load configuration: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const loadConfigPath = async () => {
    const result = await TauriCommands.getConfigPath();
    if (result.success) {
      setConfigPath(result.data);
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
        setRuntimeConfig(config);
        setSuccess('Configuration saved successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(`Failed to save configuration: ${result.error}`);
      }
    } catch (err) {
      setError(`Failed to save configuration: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (updater: (config: AppConfig) => AppConfig) => {
    if (!config) return;
    setConfig(updater(config));
  };

  if (loading || !config) {
    return <div className="flex items-center justify-center h-full text-cyan-400">Loading configuration...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-black/80 text-cyan-400 p-6 overflow-auto">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-cyan-900/30">
        <Settings className="w-6 h-6" />
        <h2 className="text-2xl font-bold text-cyan-300">System Configuration</h2>
      </div>

      {error && <div className="mb-4 p-4 bg-red-900/30 border border-red-500/50 rounded flex items-start gap-2"><AlertCircle className="w-5 h-5 text-red-400" /><div className="text-red-300">{error}</div></div>}
      {success && <div className="mb-4 p-4 bg-green-900/30 border border-green-500/50 rounded flex items-start gap-2"><CheckCircle className="w-5 h-5 text-green-400" /><div className="text-green-300">{success}</div></div>}

      <div className="space-y-6">
        <section>
          <h3 className="text-xl font-semibold mb-4 text-cyan-200">Deployment Profile</h3>
          <p className="text-xs text-cyan-600 mb-3">Commander Mode is the only default profile for first launch and standard desktop operations.</p>
          <select
            value={config.profile}
            onChange={(e) => updateConfig((c) => ({ ...c, profile: e.target.value as AppConfig['profile'] }))}
            className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded"
          >
            <optgroup label="Default">
              <option value="commander-local">Commander Mode (commander-local)</option>
            </optgroup>
            <optgroup label="Advanced (non-default)">
              <option value="training-testnet">Cloud/Internal (testnet profile)</option>
              <option value="enterprise-remote">Production Mesh (cloud profile)</option>
            </optgroup>
          </select>
        </section>

        <section>
          <h3 className="text-xl font-semibold mb-4 text-cyan-200">Connection Settings</h3>
          <label className="block mb-2 text-sm font-medium">API URL</label>
          <input
            type="text"
            value={config.connection.api_endpoint}
            onChange={(e) => updateConfig((c) => ({ ...c, connection: { ...c.connection, api_endpoint: e.target.value } }))}
            className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded mb-4"
          />

          <label className="block mb-2 text-sm font-medium">Mesh Endpoint</label>
          <div className="flex items-start gap-2 mb-1"><Info className="w-4 h-4 text-cyan-600" /><p className="text-xs text-cyan-600">Use wss:// for production profile.</p></div>
          <input
            type="text"
            value={config.connection.mesh_endpoint}
            onChange={(e) => updateConfig((c) => ({ ...c, connection: { ...c.connection, mesh_endpoint: e.target.value } }))}
            className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded"
          />
        </section>

        <section>
          <h3 className="text-xl font-semibold mb-4 text-cyan-200">Advanced Runtime Controls (non-default)</h3>
          <label className="block mb-2 text-sm font-medium">TPM Mode</label>
          <select
            value={config.tpm_policy.mode}
            onChange={(e) => updateConfig((c) => ({ ...c, tpm_policy: { ...c.tpm_policy, mode: e.target.value as AppConfig['tpm_policy']['mode'] } }))}
            className="w-full px-3 py-2 bg-black/50 border border-cyan-900/50 rounded mb-4"
          >
            <option value="required">required</option>
            <option value="optional">optional</option>
            <option value="disabled">disabled</option>
          </select>

          <label className="flex items-center gap-2 mb-2">
            <input type="checkbox" checked={config.tpm_policy.enforce_hardware} onChange={(e) => updateConfig((c) => ({ ...c, tpm_policy: { ...c.tpm_policy, enforce_hardware: e.target.checked } }))} />
            Enforce Hardware TPM
          </label>
          <label className="flex items-center gap-2 mb-2">
            <input type="checkbox" checked={config.features.allow_insecure_localhost} onChange={(e) => updateConfig((c) => ({ ...c, features: { ...c.features, allow_insecure_localhost: e.target.checked } }))} />
            Allow insecure localhost ws://
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.features.bootstrap_on_startup} onChange={(e) => updateConfig((c) => ({ ...c, features: { ...c.features, bootstrap_on_startup: e.target.checked } }))} />
            Run bootstrap checks on startup
          </label>
        </section>

        <section className="pt-4 border-t border-cyan-900/30">
          <h3 className="text-sm font-semibold mb-2 text-cyan-600">Configuration File Location</h3>
          <code className="block p-3 bg-black/50 border border-cyan-900/50 rounded text-xs text-cyan-500 break-all">{configPath || 'Loading...'}</code>
        </section>
      </div>

      <div className="mt-8 pt-6 border-t border-cyan-900/30 flex gap-4">
        <button onClick={saveConfig} disabled={saving} className="flex items-center gap-2 px-6 py-3 bg-cyan-700 hover:bg-cyan-600 disabled:bg-cyan-900 text-white font-semibold rounded"><Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save Configuration'}</button>
        <button onClick={loadConfig} disabled={loading || saving} className="px-6 py-3 bg-black/50 hover:bg-black/70 border border-cyan-900/50 text-cyan-400 font-semibold rounded">Reset to Saved</button>
      </div>
    </div>
  );
}
