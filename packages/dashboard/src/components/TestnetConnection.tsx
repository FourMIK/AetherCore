import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Testnet Connection Component
 * 
 * Allows operators to connect the Tactical Glass desktop app
 * to a testnet P2P endpoint for mesh networking.
 */
export const TestnetConnection: React.FC = () => {
  const [endpoint, setEndpoint] = useState('wss://testnet.aethercore.local:8443');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  /**
   * Connect to Testnet
   */
  const handleConnect = async () => {
    if (!endpoint) {
      setError('Endpoint is required');
      return;
    }

    setStatus('connecting');
    setError(null);
    setMessage('');

    try {
      // Invoke Tauri command to connect to testnet
      const result: string = await invoke('connect_to_testnet', { endpoint });
      
      setStatus('connected');
      setMessage(result);
    } catch (err) {
      setStatus('disconnected');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Disconnect from Testnet
   */
  const handleDisconnect = () => {
    // TODO: Implement disconnect command
    setStatus('disconnected');
    setMessage('');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Testnet Connection</h2>
      <p>Connect to the AetherCore P2P testnet for development and testing</p>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>
          Testnet Endpoint:
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="wss://testnet.example.com:8443"
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
          Must start with ws:// or wss://
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
            Connect to Testnet
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
            Connecting...
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
          ? '🟢 Connected'
          : status === 'connecting'
          ? '🟡 Connecting...'
          : '🔴 Disconnected'}
      </div>

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
          }}
        >
          <strong>Error:</strong> {error}
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
              <strong>Protocol:</strong> WebSocket (WSS)
            </li>
            <li>
              <strong>Mesh Type:</strong> P2P Testnet
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default TestnetConnection;
