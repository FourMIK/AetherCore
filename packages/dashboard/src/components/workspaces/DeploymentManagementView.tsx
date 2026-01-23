/**
 * DeploymentManagementView
 * Manage locally deployed node processes
 */

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GlassPanel } from '../hud/GlassPanel';
import { Server, StopCircle, RefreshCw, FileText, PlayCircle, X } from 'lucide-react';

interface DeploymentStatus {
  node_id: string;
  pid: number;
  port: number;
  started_at: number;
  status: string;
}

export const DeploymentManagementView: React.FC = () => {
  const [deployments, setDeployments] = useState<DeploymentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogModal, setShowLogModal] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchDeployments = React.useCallback(async () => {
    try {
      const result = await invoke<DeploymentStatus[]>('get_deployment_status');
      setDeployments(result);
      setError(null);
    } catch (err) {
      setError(`Failed to fetch deployments: ${err}`);
      console.error('Error fetching deployments:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const stopNode = async (nodeId: string) => {
    try {
      await invoke('stop_node', { nodeId });
      await fetchDeployments();
    } catch (err) {
      setError(`Failed to stop node: ${err}`);
      console.error('Error stopping node:', err);
    }
  };

  const viewLogs = async (nodeId: string) => {
    try {
      const result = await invoke<string[]>('get_node_logs', { nodeId, tail: 500 });
      setLogs(result);
      setSelectedNodeId(nodeId);
      setShowLogModal(true);
    } catch (err) {
      setError(`Failed to fetch logs: ${err}`);
      console.error('Error fetching logs:', err);
    }
  };

  useEffect(() => {
    fetchDeployments();
  }, []);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      fetchDeployments();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh, fetchDeployments]);

  // Live tail logs if modal is open
  useEffect(() => {
    if (!showLogModal || !selectedNodeId) return;

    const interval = setInterval(async () => {
      try {
        const result = await invoke<string[]>('get_node_logs', { 
          nodeId: selectedNodeId, 
          tail: 500 
        });
        setLogs(result);
      } catch (err) {
        console.error('Error refreshing logs:', err);
        // If error fetching logs, stop the interval
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [showLogModal, selectedNodeId]);

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatUptime = (startedAt: number) => {
    const now = Math.floor(Date.now() / 1000);
    const uptime = now - startedAt;
    
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return 'text-verified-green';
      case 'stopped':
        return 'text-tungsten/50';
      case 'failed':
        return 'text-jamming';
      default:
        return 'text-tungsten';
    }
  };

  return (
    <div className="h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="text-overmatch" size={28} />
          <div>
            <h2 className="font-display text-2xl font-semibold text-tungsten">
              Deployment Management
            </h2>
            <p className="text-sm text-tungsten/70">
              Manage locally deployed node processes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-tungsten/70">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-tungsten/30 text-overmatch focus:ring-overmatch focus:ring-offset-0"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchDeployments}
            disabled={loading}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-jamming/10 border border-jamming/30 rounded-lg text-jamming">
          {error}
        </div>
      )}

      {/* Deployments Table */}
      <GlassPanel variant="heavy" className="overflow-hidden">
        {loading && deployments.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin text-overmatch mb-3">
              <RefreshCw size={32} />
            </div>
            <p className="text-tungsten/70">Loading deployments...</p>
          </div>
        ) : deployments.length === 0 ? (
          <div className="p-12 text-center">
            <Server className="mx-auto text-tungsten/30 mb-3" size={48} />
            <p className="text-tungsten/70 mb-2">No local deployments</p>
            <p className="text-sm text-tungsten/50">
              Deploy nodes from the Add Node wizard or Tactical Map view
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-tungsten/10">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-tungsten/70 uppercase tracking-wider">
                    Node ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-tungsten/70 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-tungsten/70 uppercase tracking-wider">
                    PID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-tungsten/70 uppercase tracking-wider">
                    Port
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-tungsten/70 uppercase tracking-wider">
                    Started
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-tungsten/70 uppercase tracking-wider">
                    Uptime
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-tungsten/70 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tungsten/10">
                {deployments.map((deployment) => (
                  <tr
                    key={deployment.node_id}
                    className="hover:bg-tungsten/5 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm text-tungsten">
                        {deployment.node_id}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${getStatusColor(deployment.status)}`}>
                        {deployment.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm text-tungsten/70">
                        {deployment.pid}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm text-tungsten/70">
                        {deployment.port}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-tungsten/70">
                        {formatTimestamp(deployment.started_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-tungsten/70">
                        {formatUptime(deployment.started_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => viewLogs(deployment.node_id)}
                          className="p-1.5 hover:bg-tungsten/10 rounded text-tungsten/70 hover:text-tungsten transition-colors"
                          title="View Logs"
                        >
                          <FileText size={16} />
                        </button>
                        <button
                          onClick={() => stopNode(deployment.node_id)}
                          className="p-1.5 hover:bg-jamming/10 rounded text-tungsten/70 hover:text-jamming transition-colors"
                          title="Stop Node"
                        >
                          <StopCircle size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      {/* Stats Summary */}
      {deployments.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <GlassPanel variant="light" className="p-4">
            <div className="text-xs text-tungsten/70 uppercase tracking-wider mb-1">
              Total Deployments
            </div>
            <div className="text-2xl font-display font-bold text-tungsten">
              {deployments.length}
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="text-xs text-tungsten/70 uppercase tracking-wider mb-1">
              Running
            </div>
            <div className="text-2xl font-display font-bold text-verified-green">
              {deployments.filter(d => d.status.toLowerCase() === 'running').length}
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-4">
            <div className="text-xs text-tungsten/70 uppercase tracking-wider mb-1">
              Stopped/Failed
            </div>
            <div className="text-2xl font-display font-bold text-tungsten/50">
              {deployments.filter(d => d.status.toLowerCase() !== 'running').length}
            </div>
          </GlassPanel>
        </div>
      )}

      {/* Log Viewer Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/80 backdrop-blur-sm p-4">
          <GlassPanel variant="heavy" className="w-full max-w-4xl max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-tungsten/10 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <FileText className="text-overmatch" size={20} />
                <div>
                  <h3 className="font-display text-lg font-semibold text-tungsten">
                    Node Logs
                  </h3>
                  <p className="text-xs text-tungsten/70">
                    {selectedNodeId} (live tail - last 500 lines)
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowLogModal(false);
                  setSelectedNodeId(null);
                  setLogs([]);
                }}
                className="p-2 hover:bg-tungsten/10 rounded text-tungsten/70 hover:text-tungsten transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Log Content */}
            <div className="flex-1 min-h-0 p-4 overflow-auto">
              <div className="bg-carbon/50 rounded border border-tungsten/10 p-4 font-mono text-xs">
                {logs.length === 0 ? (
                  <div className="text-tungsten/50 text-center py-8">
                    No logs available
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {logs.map((line, i) => (
                      <div
                        key={i}
                        className={`${
                          line.includes('[ERR]')
                            ? 'text-jamming'
                            : line.includes('[OUT]')
                            ? 'text-tungsten/80'
                            : 'text-tungsten/70'
                        }`}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-tungsten/10 flex justify-end flex-shrink-0">
              <button
                onClick={() => {
                  setShowLogModal(false);
                  setSelectedNodeId(null);
                  setLogs([]);
                }}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  );
};
