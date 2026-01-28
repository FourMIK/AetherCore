/**
 * RalphieNode Provisioning Component
 * 
 * Zero-Touch Enrollment workflow for Arduino Satellite devices.
 * Implements a seamless 3-step process:
 * 1. Select and flash firmware to device
 * 2. Listen for GENESIS message from device
 * 3. Generate and display enrollment QR code
 * 
 * Security: Implements Fail-Visible philosophy with BLAKE3 hash verification
 * and Ed25519 cryptographic identity establishment.
 */

import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { QRCodeSVG } from 'qrcode.react';
import { GlassPanel } from './hud/GlassPanel';
import { 
  Usb, 
  Upload, 
  Radio, 
  QrCode, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw,
  ChevronRight,
  Zap
} from 'lucide-react';

// ============================================================================
// Type Definitions
// ============================================================================

interface SerialDevice {
  port_name: string;
  port_type: string;
  manufacturer: string | null;
  product: string | null;
  serial_number: string | null;
}

interface FlashProgress {
  stage: string;
  message: string;
  progress: number;
}

interface GenesisMessage {
  type: string;
  root: string;
  pub_key: string;
}

interface GenesisBundle {
  user_identity: string;
  squad_id: string;
  public_key: string;
  signature: string;
  timestamp: number;
}

// ============================================================================
// Main Component
// ============================================================================

export const RalphieNodeProvisioning: React.FC = () => {
  // Refs for cleanup
  const stepTransitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Workflow state
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  
  // Step 1: Device Selection & Flashing
  const [devices, setDevices] = useState<SerialDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [firmwarePath, setFirmwarePath] = useState<string>('');
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashProgress, setFlashProgress] = useState<FlashProgress | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  
  // Step 2: Genesis Listening
  const [isListening, setIsListening] = useState(false);
  const [genesisMessage, setGenesisMessage] = useState<GenesisMessage | null>(null);
  const [genesisError, setGenesisError] = useState<string | null>(null);
  
  // Step 3: Enrollment
  const [userIdentity, setUserIdentity] = useState('');
  const [squadId, setSquadId] = useState('');
  const [qrData, setQrData] = useState<string | null>(null);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);

  // ============================================================================
  // Step 1: Device Discovery
  // ============================================================================

  const scanDevices = async () => {
    try {
      const result = await invoke<SerialDevice[]>('list_serial_ports');
      setDevices(result);
      if (result.length > 0 && !selectedDevice) {
        setSelectedDevice(result[0].port_name);
      }
    } catch (err) {
      console.error('Failed to scan devices:', err);
      setFlashError(`Failed to scan devices: ${err}`);
    }
  };

  useEffect(() => {
    let mounted = true;
    
    const scan = async () => {
      try {
        const result = await invoke<SerialDevice[]>('list_serial_ports');
        if (mounted) {
          setDevices(result);
          if (result.length > 0 && !selectedDevice) {
            setSelectedDevice(result[0].port_name);
          }
        }
      } catch (err) {
        console.error('Failed to scan devices:', err);
        if (mounted) {
          setFlashError(`Failed to scan devices: ${err}`);
        }
      }
    };
    
    scan();
    
    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup effect for timeouts
  useEffect(() => {
    return () => {
      if (stepTransitionTimeoutRef.current) {
        clearTimeout(stepTransitionTimeoutRef.current);
      }
    };
  }, []);

  const handleFlashFirmware = async () => {
    if (!selectedDevice || !firmwarePath) {
      setFlashError('Please select a device and firmware file');
      return;
    }

    setIsFlashing(true);
    setFlashError(null);
    setFlashProgress(null);

    // Listen for flash progress events
    const unlisten = await listen<FlashProgress>('flash_progress', (event) => {
      setFlashProgress(event.payload);
    });

    try {
      await invoke('flash_firmware', {
        port: selectedDevice,
        firmwarePath: firmwarePath,
      });

      // Flash successful, move to next step
      // Clear any existing timeout first
      if (stepTransitionTimeoutRef.current) {
        clearTimeout(stepTransitionTimeoutRef.current);
      }
      
      stepTransitionTimeoutRef.current = setTimeout(() => {
        setCurrentStep(2);
        // Automatically start listening for genesis
        handleListenForGenesis();
      }, 1000);
    } catch (err) {
      setFlashError(`Flash failed: ${err}`);
    } finally {
      setIsFlashing(false);
      unlisten();
    }
  };

  // ============================================================================
  // Step 2: Genesis Listening
  // ============================================================================

  const handleListenForGenesis = async () => {
    if (!selectedDevice) {
      setGenesisError('No device selected');
      return;
    }

    setIsListening(true);
    setGenesisError(null);

    try {
      const result = await invoke<GenesisMessage>('listen_for_genesis', {
        port: selectedDevice,
      });

      setGenesisMessage(result);
      setCurrentStep(3);
    } catch (err) {
      setGenesisError(`Failed to receive GENESIS: ${err}`);
    } finally {
      setIsListening(false);
    }
  };

  // ============================================================================
  // Step 3: Enrollment QR Generation
  // ============================================================================

  const handleGenerateEnrollment = async () => {
    if (!userIdentity || !squadId) {
      setEnrollmentError('User Identity and Squad ID are required');
      return;
    }

    if (!genesisMessage) {
      setEnrollmentError('No GENESIS message received from device');
      return;
    }

    try {
      const bundle: GenesisBundle = await invoke('generate_genesis_bundle', {
        userIdentity,
        squadId,
      });

      const qrString: string = await invoke('bundle_to_qr_data', { bundle });
      setQrData(qrString);
    } catch (err) {
      setEnrollmentError(`Failed to generate enrollment: ${err}`);
    }
  };

  const handleReset = () => {
    setCurrentStep(1);
    setSelectedDevice(null);
    setFirmwarePath('');
    setIsFlashing(false);
    setFlashProgress(null);
    setFlashError(null);
    setIsListening(false);
    setGenesisMessage(null);
    setGenesisError(null);
    setUserIdentity('');
    setSquadId('');
    setQrData(null);
    setEnrollmentError(null);
    scanDevices();
  };

  // ============================================================================
  // Render Helpers
  // ============================================================================

  const getStepStatus = (step: number): 'active' | 'complete' | 'pending' => {
    if (step < currentStep) return 'complete';
    if (step === currentStep) return 'active';
    return 'pending';
  };

  const StepIndicator: React.FC<{ step: number; title: string; icon: React.ReactNode }> = ({ 
    step, 
    title, 
    icon 
  }) => {
    const status = getStepStatus(step);
    
    return (
      <div className="flex items-center gap-3">
        <div
          className={`
            flex items-center justify-center w-12 h-12 rounded-full border-2 transition-all
            ${status === 'complete' ? 'bg-verified-green/20 border-verified-green text-verified-green' : ''}
            ${status === 'active' ? 'bg-overmatch/20 border-overmatch text-overmatch animate-pulse' : ''}
            ${status === 'pending' ? 'bg-tungsten/5 border-tungsten/30 text-tungsten/50' : ''}
          `}
        >
          {status === 'complete' ? <CheckCircle size={24} /> : icon}
        </div>
        <div>
          <div className="text-xs text-tungsten/50 uppercase tracking-wider">Step {step}</div>
          <div className={`font-display font-semibold ${status === 'pending' ? 'text-tungsten/50' : 'text-tungsten'}`}>
            {title}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-overmatch/20 rounded-lg">
            <Zap className="text-overmatch" size={32} />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold text-tungsten">
              RalphieNode Provisioning
            </h1>
            <p className="text-tungsten/70">
              Zero-Touch Enrollment for Arduino Satellite Devices
            </p>
          </div>
        </div>

        {/* Step Progress Bar */}
        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center justify-between">
            <StepIndicator step={1} title="Flash Firmware" icon={<Upload size={24} />} />
            <ChevronRight className="text-tungsten/30" size={24} />
            <StepIndicator step={2} title="Await Genesis" icon={<Radio size={24} />} />
            <ChevronRight className="text-tungsten/30" size={24} />
            <StepIndicator step={3} title="Enroll Device" icon={<QrCode size={24} />} />
          </div>
        </GlassPanel>

        {/* Step 1: Flash Firmware */}
        {currentStep === 1 && (
          <GlassPanel variant="heavy" className="p-6 space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-tungsten/10">
              <Upload className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Step 1: Flash Firmware to Device
              </h2>
            </div>

            {/* Device Selection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-tungsten/70 uppercase tracking-wider">
                  Select Device
                </label>
                <button
                  onClick={scanDevices}
                  className="btn-secondary flex items-center gap-2 text-xs"
                >
                  <RefreshCw size={14} />
                  Rescan
                </button>
              </div>
              
              {devices.length === 0 ? (
                <div className="p-8 text-center bg-tungsten/5 rounded-lg border border-tungsten/10">
                  <Usb className="mx-auto text-tungsten/30 mb-3" size={40} />
                  <p className="text-tungsten/70 mb-2">No devices detected</p>
                  <p className="text-sm text-tungsten/50">
                    Connect a RalphieNode device via USB and click Rescan
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {devices.map((device) => (
                    <label
                      key={device.port_name}
                      className={`
                        flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                        ${selectedDevice === device.port_name
                          ? 'bg-overmatch/10 border-overmatch'
                          : 'bg-tungsten/5 border-tungsten/10 hover:border-tungsten/30'
                        }
                      `}
                    >
                      <input
                        type="radio"
                        name="device"
                        value={device.port_name}
                        checked={selectedDevice === device.port_name}
                        onChange={() => setSelectedDevice(device.port_name)}
                        className="text-overmatch focus:ring-overmatch"
                      />
                      <Usb size={20} className="text-overmatch" />
                      <div className="flex-1">
                        <div className="font-mono text-sm text-tungsten font-semibold">
                          {device.port_name}
                        </div>
                        <div className="text-xs text-tungsten/50">
                          {device.manufacturer || 'Unknown'} • {device.product || device.port_type}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Firmware Path */}
            <div>
              <label className="block text-sm font-semibold text-tungsten/70 uppercase tracking-wider mb-3">
                Firmware Binary Path
              </label>
              <input
                type="text"
                value={firmwarePath}
                onChange={(e) => setFirmwarePath(e.target.value)}
                placeholder="/path/to/ralphienode-firmware.bin"
                className="w-full px-4 py-3 bg-tungsten/5 border border-tungsten/20 rounded-lg text-tungsten placeholder-tungsten/30 focus:outline-none focus:border-overmatch"
              />
              <p className="text-xs text-tungsten/50 mt-2">
                Path to the compiled firmware binary for your RalphieNode device
              </p>
            </div>

            {/* Flash Progress */}
            {flashProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-tungsten/70">{flashProgress.stage}</span>
                  <span className="font-mono text-overmatch">
                    {Math.round(flashProgress.progress * 100)}%
                  </span>
                </div>
                <div className="h-2 bg-tungsten/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-overmatch to-verified-green transition-all duration-300"
                    style={{ width: `${flashProgress.progress * 100}%` }}
                  />
                </div>
                <p className="text-xs text-tungsten/50 font-mono">
                  {flashProgress.message}
                </p>
              </div>
            )}

            {/* Error Display */}
            {flashError && (
              <div className="flex items-start gap-3 p-4 bg-jamming/10 border border-jamming/30 rounded-lg">
                <AlertCircle className="text-jamming flex-shrink-0" size={20} />
                <div className="flex-1">
                  <div className="font-semibold text-jamming mb-1">Flash Failed</div>
                  <div className="text-sm text-jamming/80">{flashError}</div>
                </div>
              </div>
            )}

            {/* Action Button */}
            <div className="flex items-center justify-between pt-4 border-t border-tungsten/10">
              <p className="text-sm text-tungsten/50">
                This will flash the firmware to your device using esptool
              </p>
              <button
                onClick={handleFlashFirmware}
                disabled={!selectedDevice || !firmwarePath || isFlashing}
                className="btn-primary flex items-center gap-2"
              >
                {isFlashing ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Flashing...
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    Flash Firmware
                  </>
                )}
              </button>
            </div>
          </GlassPanel>
        )}

        {/* Step 2: Listen for Genesis */}
        {currentStep === 2 && (
          <GlassPanel variant="heavy" className="p-6 space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-tungsten/10">
              <Radio className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Step 2: Awaiting GENESIS Message
              </h2>
            </div>

            <div className="text-center py-8">
              {isListening ? (
                <>
                  <div className="inline-block relative mb-6">
                    <Radio size={64} className="text-overmatch animate-pulse" />
                    <div className="absolute inset-0 animate-ping">
                      <Radio size={64} className="text-overmatch opacity-20" />
                    </div>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-tungsten mb-2">
                    Listening for device response...
                  </h3>
                  <p className="text-tungsten/70 mb-4">
                    Waiting for GENESIS message from RalphieNode on {selectedDevice}
                  </p>
                  <p className="text-sm text-tungsten/50 font-mono">
                    The device will broadcast its cryptographic identity within 30 seconds
                  </p>
                </>
              ) : genesisMessage ? (
                <>
                  <CheckCircle size={64} className="text-verified-green mx-auto mb-6" />
                  <h3 className="font-display text-xl font-semibold text-tungsten mb-2">
                    GENESIS Received!
                  </h3>
                  <div className="max-w-md mx-auto space-y-3 text-left">
                    <div className="p-3 bg-tungsten/5 rounded-lg border border-tungsten/10">
                      <div className="text-xs text-tungsten/50 uppercase tracking-wider mb-1">
                        Device Root Hash (BLAKE3)
                      </div>
                      <div className="font-mono text-xs text-verified-green break-all">
                        {genesisMessage.root}
                      </div>
                    </div>
                    <div className="p-3 bg-tungsten/5 rounded-lg border border-tungsten/10">
                      <div className="text-xs text-tungsten/50 uppercase tracking-wider mb-1">
                        Public Key (Ed25519)
                      </div>
                      <div className="font-mono text-xs text-tungsten/70 break-all">
                        {genesisMessage.pub_key.substring(0, 40)}...
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {genesisError && (
              <div className="flex items-start gap-3 p-4 bg-jamming/10 border border-jamming/30 rounded-lg">
                <AlertCircle className="text-jamming flex-shrink-0" size={20} />
                <div className="flex-1">
                  <div className="font-semibold text-jamming mb-1">GENESIS Failed</div>
                  <div className="text-sm text-jamming/80">{genesisError}</div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-tungsten/10">
              <button onClick={handleReset} className="btn-secondary">
                Start Over
              </button>
              {genesisMessage && (
                <button onClick={() => setCurrentStep(3)} className="btn-primary flex items-center gap-2">
                  Continue to Enrollment
                  <ChevronRight size={16} />
                </button>
              )}
              {genesisError && (
                <button onClick={handleListenForGenesis} className="btn-primary flex items-center gap-2">
                  <RefreshCw size={16} />
                  Retry
                </button>
              )}
            </div>
          </GlassPanel>
        )}

        {/* Step 3: Enrollment */}
        {currentStep === 3 && (
          <GlassPanel variant="heavy" className="p-6 space-y-6">
            <div className="flex items-center gap-3 pb-4 border-b border-tungsten/10">
              <QrCode className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Step 3: Complete Enrollment
              </h2>
            </div>

            {!qrData ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-tungsten/70 uppercase tracking-wider mb-3">
                      User Identity
                    </label>
                    <input
                      type="text"
                      value={userIdentity}
                      onChange={(e) => setUserIdentity(e.target.value)}
                      placeholder="operator-001"
                      className="w-full px-4 py-3 bg-tungsten/5 border border-tungsten/20 rounded-lg text-tungsten placeholder-tungsten/30 focus:outline-none focus:border-overmatch"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-tungsten/70 uppercase tracking-wider mb-3">
                      Squad ID
                    </label>
                    <input
                      type="text"
                      value={squadId}
                      onChange={(e) => setSquadId(e.target.value)}
                      placeholder="squad-alpha"
                      className="w-full px-4 py-3 bg-tungsten/5 border border-tungsten/20 rounded-lg text-tungsten placeholder-tungsten/30 focus:outline-none focus:border-overmatch"
                    />
                  </div>
                </div>

                {enrollmentError && (
                  <div className="flex items-start gap-3 p-4 bg-jamming/10 border border-jamming/30 rounded-lg">
                    <AlertCircle className="text-jamming flex-shrink-0" size={20} />
                    <div className="flex-1">
                      <div className="font-semibold text-jamming mb-1">Enrollment Failed</div>
                      <div className="text-sm text-jamming/80">{enrollmentError}</div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-tungsten/10">
                  <button onClick={handleReset} className="btn-secondary">
                    Start Over
                  </button>
                  <button
                    onClick={handleGenerateEnrollment}
                    disabled={!userIdentity || !squadId}
                    className="btn-primary flex items-center gap-2"
                  >
                    <QrCode size={16} />
                    Generate Enrollment QR
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center space-y-6">
                <CheckCircle size={64} className="text-verified-green mx-auto" />
                <h3 className="font-display text-2xl font-semibold text-tungsten">
                  Enrollment Complete!
                </h3>
                <p className="text-tungsten/70">
                  Device is ready for deployment. Use this QR code for final provisioning.
                </p>

                <div className="inline-block p-6 bg-white rounded-xl border-4 border-overmatch">
                  <QRCodeSVG value={qrData} size={256} level="H" />
                </div>

                <div className="max-w-md mx-auto space-y-2 text-sm">
                  <div className="flex justify-between items-center p-3 bg-tungsten/5 rounded-lg">
                    <span className="text-tungsten/70">User:</span>
                    <span className="font-mono text-tungsten">{userIdentity}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-tungsten/5 rounded-lg">
                    <span className="text-tungsten/70">Squad:</span>
                    <span className="font-mono text-tungsten">{squadId}</span>
                  </div>
                  {genesisMessage && (
                    <div className="flex justify-between items-center p-3 bg-tungsten/5 rounded-lg">
                      <span className="text-tungsten/70">Device Root:</span>
                      <span className="font-mono text-xs text-verified-green">
                        {genesisMessage.root.substring(0, 16)}...
                      </span>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-tungsten/10">
                  <button onClick={handleReset} className="btn-primary w-full flex items-center justify-center gap-2">
                    <Zap size={16} />
                    Provision Another Device
                  </button>
                </div>
              </div>
            )}
          </GlassPanel>
        )}
      </div>
    </div>
  );
};

export default RalphieNodeProvisioning;
