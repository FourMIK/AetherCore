import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Mesh Connection Component (Production Mode)
 * 
 * Allows operators to connect the Tactical Glass desktop app
 * to the production C2 mesh with hardware-rooted authentication.
 * 
 * Security: All connections use TLS 1.3 / WSS with mutual TPM attestation.
 * The "Fail-Visible" doctrine requires that connection failures are prominently
 * displayed and unverified endpoints are rejected.
 */
export const MeshConnection: React.FC = () => {
  const [endpoint, setEndpoint] = useState('wss://c2.aethercore.local:8443');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [attestationStatus, setAttestationStatus] = useState<'pending' | 'verified' | 'failed'>('pending');

  /**
   * Connect to Production C2 Mesh
   * Establishes hardware-authenticated connection to command & control router
   */
  const handleConnect = async () => {
    if (!endpoint) {
      setError('Endpoint is required');
      return;
    }

    // Production mode: Reject non-WSS endpoints (fail-visible)
    if (!endpoint.startsWith('wss://')) {
      setError('SECURITY VIOLATION: Production mode requires WSS (secure WebSocket). Non-encrypted endpoints are rejected.');
      return;
    }

    setStatus('connecting');
    setError(null);
    setMessage('');
    setAttestationStatus('pending');

    try {
      // Invoke Tauri command to connect to production mesh
      // This will perform TPM attestation before allowing data transfer
      const result: string = await invoke('connect_to_mesh', { endpoint });
      
      setStatus('connected');
      setMessage(result);
      setAttestationStatus('verified');
    } catch (err) {
      setStatus('disconnected');
      setAttestationStatus('failed');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Disconnect from C2 Mesh
   */
  const handleDisconnect = () => {
    // TODO: Implement disconnect command
    setStatus('disconnected');
    setMessage('');
    setAttestationStatus('pending');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Production C2 Mesh Connection</h2>
      <p>
        Connect to the AetherCore Command & Control mesh with hardware-rooted authentication.
        All connections use TLS 1.3 and require valid TPM attestation.
      </p>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>
          C2 Endpoint (WSS only):
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="wss://c2.aethercore.local:8443"
            disabled={status === 'connected' || status === 'connecting'}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px',
              marginTop: '4px',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
        </label>
        <p style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
          Must start with wss:// (secure WebSocket). Non-encrypted connections are rejected.
        </p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        {status === 'disconnected' && (
          <button
            onClick={handleConnect}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Connect to C2 Mesh
          </button>
        )}

        {status === 'connecting' && (
          <button
            disabled
            style={{
              padding: '10px 20px',
              backgroundColor: '#ffc107',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'not-allowed',
              opacity: 0.6,
            }}
          >
            Connecting & Attesting...
          </button>
        )}

        {status === 'connected' && (
          <button
            onClick={handleDisconnect}
            style={{
              padding: '10px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Status Indicator */}
      <div
        style={{
          padding: '10px',
          borderRadius: '4px',
          backgroundColor:
            status === 'connected'
              ? '#d4edda'
              : status === 'connecting'
              ? '#fff3cd'
              : '#f8d7da',
          color:
            status === 'connected'
              ? '#155724'
              : status === 'connecting'
              ? '#856404'
              : '#721c24',
        }}
      >
        <strong>Status:</strong>{' '}
        {status === 'connected'
          ? '🟢 Connected & Verified'
          : status === 'connecting'
          ? '🟡 Connecting...'
          : '🔴 Disconnected'}
      </div>

      {/* Attestation Status (Fail-Visible Design) */}
      {status === 'connected' && (
        <div
          style={{
            marginTop: '10px',
            padding: '10px',
            borderRadius: '4px',
            backgroundColor:
              attestationStatus === 'verified' ? '#d1ecf1' : '#f8d7da',
            color: attestationStatus === 'verified' ? '#0c5460' : '#721c24',
          }}
        >
          <strong>TPM Attestation:</strong>{' '}
          {attestationStatus === 'verified'
            ? '✅ Hardware Root of Trust Verified'
            : attestationStatus === 'failed'
            ? '❌ ATTESTATION FAILED - BYZANTINE NODE'
            : '⏳ Pending...'}
        </div>
      )}

      {message && (
        <div
          style={{
            marginTop: '20px',
            padding: '10px',
            backgroundColor: '#d1ecf1',
            color: '#0c5460',
            borderRadius: '4px',
          }}
        >
          {message}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: '20px',
            padding: '10px',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            borderRadius: '4px',
            border: '2px solid #721c24',
          }}
        >
          <strong>⚠️ SECURITY ALERT:</strong> {error}
        </div>
      )}

      {/* Connection Info */}
      {status === 'connected' && (
        <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
          <h3>Connection Details</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <li>
              <strong>Endpoint:</strong> {endpoint}
            </li>
            <li>
              <strong>Protocol:</strong> WebSocket Secure (WSS) / TLS 1.3
            </li>
            <li>
              <strong>Authentication:</strong> Mutual TPM Attestation
            </li>
            <li>
              <strong>Mesh Type:</strong> Production C2 Router
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};

// Maintain backward compatibility alias
export const TestnetConnection = MeshConnection;

export default MeshConnection;
