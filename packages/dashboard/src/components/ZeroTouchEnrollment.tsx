import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import QRCode from 'qrcode.react';

/**
 * Genesis Bundle structure for Zero-Touch Enrollment
 */
interface GenesisBundle {
  user_identity: string;
  squad_id: string;
  public_key: string;
  signature: string;
  timestamp: number;
}

/**
 * Zero-Touch Enrollment Component
 * 
 * Implements the CodeRalphie Linker flow:
 * 1. Generate GenesisBundle with user identity and squad ID
 * 2. Sign it with Ed25519 (TPM-backed in production)
 * 3. Render as QR code for IoT device scanning
 */
export const ZeroTouchEnrollment: React.FC = () => {
  const [userIdentity, setUserIdentity] = useState('');
  const [squadId, setSquadId] = useState('');
  const [qrData, setQrData] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Generate Genesis Bundle and QR Code
   */
  const handleGenerateBundle = async () => {
    if (!userIdentity || !squadId) {
      setError('Both User Identity and Squad ID are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Generate Genesis Bundle via Tauri command
      const bundle: GenesisBundle = await invoke('generate_genesis_bundle', {
        userIdentity,
        squadId,
      });

      // Convert bundle to QR-encodable string
      const qrString: string = await invoke('bundle_to_qr_data', { bundle });

      setQrData(qrString);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Zero-Touch Enrollment</h2>
      <p>Generate a Genesis Bundle for provisioning IoT devices</p>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>
          User Identity:
          <input
            type="text"
            value={userIdentity}
            onChange={(e) => setUserIdentity(e.target.value)}
            placeholder="operator-001"
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
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>
          Squad ID:
          <input
            type="text"
            value={squadId}
            onChange={(e) => setSquadId(e.target.value)}
            placeholder="squad-alpha"
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
      </div>

      <button
        onClick={handleGenerateBundle}
        disabled={loading}
        style={{
          padding: '10px 20px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? 'Generating...' : 'Generate QR Code'}
      </button>

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
          Error: {error}
        </div>
      )}

      {qrData && (
        <div style={{ marginTop: '30px', textAlign: 'center' }}>
          <h3>Genesis Bundle QR Code</h3>
          <p>Scan this with your IoT device to provision it</p>
          <div
            style={{
              display: 'inline-block',
              padding: '20px',
              backgroundColor: 'white',
              border: '2px solid #007bff',
              borderRadius: '8px',
            }}
          >
            <QRCode value={qrData} size={256} level="H" />
          </div>
          <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
            User: {userIdentity} | Squad: {squadId}
          </p>
        </div>
      )}
    </div>
  );
};

export default ZeroTouchEnrollment;
