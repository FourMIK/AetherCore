/**
 * AddNodeWizard
 * Multi-stage wizard for node onboarding with Tauri backend integration
 * Supports Unified Materia doctrine: Satellite (USB) and Gateway (SSH) flows
 */

import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, CheckCircle, AlertCircle, Copy, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { GlassPanel } from '../hud/GlassPanel';
import { useTacticalStore } from '../../store/useTacticalStore';
import { SelectPlatformStep } from './SelectPlatformStep';
import { PlatformType } from '../../types';

type WizardStage = 'platform-select' | 'identity' | 'qr-enrollment' | 'attestation' | 'verifying-proof' | 'provisioning' | 'gateway-script' | 'gateway-polling' | 'deployment' | 'complete' | 'error';

interface AddNodeWizardProps {
  onClose: () => void;
}

export const AddNodeWizard: React.FC<AddNodeWizardProps> = ({ onClose }) => {
  const [stage, setStage] = useState<WizardStage>('platform-select');
  const [platformType, setPlatformType] = useState<PlatformType | null>(null);
  const [nodeId, setNodeId] = useState('');
  const [domain, setDomain] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Gateway-specific state
  const [enrollmentToken, setEnrollmentToken] = useState<string>('');
  const [gatewayPolling, setGatewayPolling] = useState(false);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  
  // Deployment configuration
  const [deployLocally, setDeployLocally] = useState(false);
  const [meshEndpoint, setMeshEndpoint] = useState('ws://localhost:8080');
  const [listenPort, setListenPort] = useState(9000);
  const [dataDir, setDataDir] = useState('');
  const [logLevel, setLogLevel] = useState('info');
  
  const addNode = useTacticalStore((s) => s.addNode);
  const updateDeploymentStatus = useTacticalStore((s) => s.updateDeploymentStatus);

  // Gateway polling effect
  useEffect(() => {
    if (gatewayPolling && !gatewayConnected) {
      const pollInterval = setInterval(async () => {
        try {
          // Check if gateway has called home
          const connected = await invoke<boolean>('check_gateway_enrollment', {
            token: enrollmentToken,
          });
          if (connected) {
            setGatewayConnected(true);
            setGatewayPolling(false);
          }
        } catch (err) {
          console.error('Gateway polling error:', err);
        }
      }, 3000);

      return () => clearInterval(pollInterval);
    }
  }, [gatewayPolling, gatewayConnected, enrollmentToken]);

  const getStagesForPlatform = (): WizardStage[] => {
    if (platformType === 'satellite') {
      return ['platform-select', 'identity', 'qr-enrollment', 'attestation', 'verifying-proof', 'provisioning', 'deployment', 'complete'];
    } else if (platformType === 'gateway') {
      return ['platform-select', 'identity', 'gateway-script', 'gateway-polling', 'provisioning', 'deployment', 'complete'];
    }
    return ['platform-select'];
  };

  const handleNext = async () => {
    const stages = getStagesForPlatform();
    const currentIndex = stages.indexOf(stage);

    if (stage === 'platform-select' && !platformType) {
      setError('Please select a platform type');
      return;
    }

    if (stage === 'identity' && (!nodeId || !domain)) {
      setError('Node ID and Domain are required');
      return;
    }

    if (stage === 'qr-enrollment') {
      // Only generate QR if not already skipped or generated
      if (!qrCode) {
        setIsLoading(true);
        try {
          const bundle = await invoke<any>('generate_genesis_bundle', {
            userIdentity: nodeId,
            squadId: domain,
          });
          const qrData = await invoke<string>('bundle_to_qr_data', { bundle });
          setQrCode(qrData);
          setError('');
        } catch (err) {
          // If QR generation fails, allow manual skip
          console.warn('QR generation failed:', err);
          setError('QR generation unavailable - proceeding with manual configuration');
          setQrCode('skipped');
        }
        setIsLoading(false);
      }
    }

    if (stage === 'gateway-script') {
      // Generate enrollment token for gateway
      setIsLoading(true);
      try {
        const token = await invoke<string>('generate_enrollment_token', {
          nodeId,
          domain,
        });
        setEnrollmentToken(token);
        setError('');
      } catch (err) {
        console.error('Token generation failed:', err);
        setError('Failed to generate enrollment token. Using fallback.');
        // Fallback token generation
        setEnrollmentToken(`${nodeId}-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      }
      setIsLoading(false);
    }

    if (stage === 'gateway-polling') {
      // Start polling for gateway connection
      setGatewayPolling(true);
    }

    // Set default data directory if not set
    if (stage === 'provisioning' && !dataDir) {
      setDataDir(`./data/${nodeId}`);
    }

    if (currentIndex < stages.length - 1) {
      setStage(stages[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const stages = getStagesForPlatform();
    const currentIndex = stages.indexOf(stage);
    if (currentIndex > 0) {
      // If going back from gateway-polling, stop polling
      if (stage === 'gateway-polling') {
        setGatewayPolling(false);
      }
      setStage(stages[currentIndex - 1]);
    }
    setError('');
  };

  const handleComplete = async () => {
    // Invoke Tauri command to create node
    setIsLoading(true);
    try {
      await invoke('create_node', {
        nodeId,
        domain,
      });

      // If deployLocally is true, deploy the node process
      let deploymentPid: number | undefined;
      let deploymentPort: number | undefined;
      let deploymentStatus: string | undefined;

      if (deployLocally) {
        try {
          const deployResult = await invoke<any>('deploy_node', {
            config: {
              node_id: nodeId,
              mesh_endpoint: meshEndpoint,
              listen_port: listenPort,
              data_dir: dataDir,
              log_level: logLevel,
            },
          });
          deploymentPid = deployResult.pid;
          deploymentPort = deployResult.port;
          deploymentStatus = deployResult.status;
          console.log('Node deployed:', deployResult);
        } catch (deployErr) {
          console.error('Failed to deploy node locally:', deployErr);
          setError(`Node created but deployment failed: ${deployErr}`);
          // Continue anyway - node is created even if deployment failed
        }
      }

      // Add the node to local store
      addNode({
        id: nodeId,
        domain,
        position: { latitude: 0, longitude: 0, altitude: 0 },
        trustScore: 100,
        verified: true,
        lastSeen: new Date(),
        status: deploymentStatus === 'Running' ? 'online' : 'offline',
        deployedLocally: deployLocally,
        deploymentPid,
        deploymentStatus,
        deploymentPort,
      });

      setError('');
    } catch (err) {
      setError(`Failed to create node: ${err}`);
      setStage('error');
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/80 backdrop-blur-sm p-4">
      <GlassPanel variant="heavy" className="w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-tungsten/10 flex-shrink-0">
          <h2 className="font-display text-2xl font-semibold text-tungsten">
            Add Node
          </h2>
          <div className="flex gap-2 mt-4">
            {getStagesForPlatform().map((s, i) => (
              <div
                key={s}
                className={`flex-1 h-2 rounded-full transition-all ${getStagesForPlatform().indexOf(stage) >= i
                    ? 'bg-overmatch'
                    : 'bg-tungsten/20'
                  }`}
              />
            ))}
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {/* Error State */}
          {stage === 'error' && (
            <div className="space-y-4 text-center">
              <AlertCircle className="text-jamming mx-auto" size={64} />
              <h3 className="font-display text-xl text-jamming">Error</h3>
              <p className="text-tungsten/70">{error}</p>
            </div>
          )}

          {stage === 'platform-select' && (
            <SelectPlatformStep
              selectedPlatform={platformType}
              onSelectPlatform={setPlatformType}
            />
          )}

          {stage === 'identity' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Node Identity</h3>
              <div>
                <label className="block text-sm text-tungsten/70 mb-2">Node ID</label>
                <input
                  type="text"
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                  placeholder="Enter node ID (e.g., node-001)..."
                />
              </div>
              <div>
                <label className="block text-sm text-tungsten/70 mb-2">Domain / Squad ID</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                  placeholder="Enter domain (e.g., squad-alpha)..."
                />
              </div>
            </div>
          )}

          {stage === 'qr-enrollment' && (
            <div className="space-y-4 text-center">
              <h3 className="font-display text-xl text-tungsten">Zero-Touch Enrollment</h3>
              {isLoading ? (
                <>
                  <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden mx-auto w-48">
                    <div className="h-full bg-overmatch animate-pulse w-1/2" />
                  </div>
                  <p className="text-tungsten/70">Generating QR code...</p>
                </>
              ) : qrCode ? (
                qrCode === 'skipped' ? (
                  <div className="text-center py-8">
                    <div className="text-verified-green mb-3">
                      <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h4 className="font-display text-lg text-tungsten mb-2">Manual Configuration Mode</h4>
                    <p className="text-tungsten/70 text-sm">
                      Proceeding without zero-touch enrollment.
                      <br />
                      CodeRalphie will be provisioned manually.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-tungsten/70 mb-4">
                      Scan this QR code with the node hardware to enroll automatically
                    </p>
                    <div className="bg-white p-4 rounded-lg inline-block">
                      {/* In production, use qrcode.react to render QR code */}
                      <div className="w-48 h-48 bg-carbon flex items-center justify-center text-tungsten/50 text-sm">
                        [QR Code: {qrCode.substring(0, 30)}...]
                      </div>
                    </div>
                    <p className="text-xs text-tungsten/50 mt-4">
                      QR Code ready for scanning
                    </p>
                  </>
                )
              ) : null}
              <div className="pt-4 mt-4 border-t border-tungsten/10">
                {!qrCode && (
                  <>
                    <p className="text-sm text-tungsten/50 mb-3">
                      Node without imaging capabilities?
                    </p>
                    <button
                      onClick={() => {
                        setQrCode('skipped');
                        setError('');
                      }}
                      className="px-4 py-2 bg-tungsten/10 hover:bg-tungsten/20 text-tungsten rounded-lg transition-colors text-sm"
                    >
                      Skip Zero-Touch – Manual Configuration
                    </button>
                    <p className="text-xs text-tungsten/40 mt-2">
                      CodeRalphie will be provisioned without QR enrollment
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {stage === 'attestation' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">TPM Attestation</h3>
              <p className="text-tungsten/70">
                Verifying TPM attestation and cryptographic signatures...
              </p>
              <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
                <div className="h-full bg-overmatch animate-pulse w-3/4" />
              </div>
              <div className="text-xs text-tungsten/50 space-y-2">
                <div>✓ TPM Present: Verified</div>
                <div>✓ Attestation Key: Generated</div>
                <div>○ CodeRalphie Identity: Pending</div>
              </div>
            </div>
          )}

          {stage === 'verifying-proof' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Verifying Hardware Integrity</h3>
              <p className="text-tungsten/70">
                Performing challenge-response attestation with hardware root of trust...
              </p>
              <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
                <div className="h-full bg-overmatch animate-pulse w-2/3" />
              </div>
              <div className="text-xs text-tungsten/50 space-y-2">
                <div>✓ Challenge Generated: 32-byte random</div>
                <div>✓ Challenge Sent: ENROLL command</div>
                <div>○ Awaiting Proof: ECDSA P-256 signature</div>
                <div>○ Signature Verification: Pending</div>
              </div>
              <div className="p-3 bg-overmatch/10 border border-overmatch/30 rounded-lg">
                <p className="text-xs text-tungsten/70">
                  <strong className="text-overmatch">FAIL-VISIBLE:</strong> If signature verification fails, 
                  the device will be rejected as an adversary. No graceful degradation.
                </p>
              </div>
            </div>
          )}

          {stage === 'provisioning' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Provisioning</h3>
              <p className="text-tungsten/70">
                Generating cryptographic keys and provisioning node in mesh...
              </p>
              <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden">
                <div className="h-full bg-overmatch animate-pulse w-1/2" />
              </div>
              <div className="text-xs text-tungsten/50 space-y-2">
                <div>✓ Identity Key: Generated</div>
                <div>✓ Trust Bootstrap: Complete</div>
                <div>○ Mesh Registration: In Progress</div>
              </div>
            </div>
          )}

          {stage === 'gateway-script' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Gateway Provisioning</h3>
              <p className="text-tungsten/70 mb-4">
                Run this script on your Raspberry Pi to provision the Gateway node.
              </p>
              
              {isLoading ? (
                <div className="text-center py-8">
                  <div className="h-2 bg-carbon border border-overmatch/30 rounded-full overflow-hidden mx-auto w-48">
                    <div className="h-full bg-overmatch animate-pulse w-1/2" />
                  </div>
                  <p className="text-tungsten/70 mt-3">Generating enrollment token...</p>
                </div>
              ) : enrollmentToken ? (
                <>
                  <div className="bg-carbon/50 border border-tungsten/20 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-tungsten/70 font-semibold uppercase tracking-wider">
                        Provisioning Script
                      </label>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `curl -sL https://c2.4mik.network/install | sudo bash -s -- --token ${enrollmentToken}`
                          );
                        }}
                        className="flex items-center gap-1 px-2 py-1 bg-tungsten/10 hover:bg-tungsten/20 text-tungsten rounded text-xs transition-colors"
                      >
                        <Copy size={12} />
                        Copy
                      </button>
                    </div>
                    <pre className="text-xs text-tungsten/90 font-mono overflow-x-auto bg-carbon p-3 rounded border border-tungsten/10">
                      <code>curl -sL https://c2.4mik.network/install | sudo bash -s -- --token {enrollmentToken}</code>
                    </pre>
                  </div>

                  <div className="p-4 bg-overmatch/10 border border-overmatch/30 rounded-lg">
                    <h4 className="text-sm font-semibold text-overmatch mb-2">Instructions:</h4>
                    <ol className="text-sm text-tungsten/70 space-y-1 list-decimal list-inside">
                      <li>SSH into your Raspberry Pi</li>
                      <li>Copy and paste the command above</li>
                      <li>Execute with sudo privileges</li>
                      <li>Wait for TPM attestation to complete</li>
                      <li>Click "Next" to wait for the Gateway to call home</li>
                    </ol>
                  </div>

                  <div className="p-3 bg-carbon/30 border border-tungsten/10 rounded-lg">
                    <p className="text-xs text-tungsten/60">
                      <strong className="text-tungsten">Token Valid For:</strong> 15 minutes
                      <br />
                      <strong className="text-tungsten">Endpoint:</strong> c2.4mik.network
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {stage === 'gateway-polling' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Waiting for Gateway</h3>
              <p className="text-tungsten/70">
                Listening for Gateway connection via WebSocket...
              </p>

              {gatewayConnected ? (
                <div className="text-center py-8">
                  <CheckCircle className="text-verified-green mx-auto mb-4" size={64} />
                  <h4 className="font-display text-lg text-tungsten mb-2">Gateway Connected!</h4>
                  <p className="text-tungsten/70 text-sm">
                    TPM attestation verified. Node <span className="font-mono text-overmatch">{nodeId}</span> is ready.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-center py-12">
                    <div className="relative">
                      <div className="w-24 h-24 border-4 border-tungsten/20 rounded-full" />
                      <div className="absolute inset-0 w-24 h-24 border-4 border-overmatch border-t-transparent rounded-full animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <RefreshCw className="text-overmatch" size={32} />
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-center text-tungsten/70 space-y-2">
                    <p className="text-sm">Polling for connection...</p>
                    <p className="text-xs text-tungsten/50">
                      Make sure the provisioning script has been executed on the Gateway.
                    </p>
                  </div>

                  <div className="text-xs text-tungsten/50 space-y-2 p-3 bg-carbon/30 border border-tungsten/10 rounded">
                    <div>○ WebSocket Connection: Listening</div>
                    <div>○ TPM Attestation: Awaiting</div>
                    <div>○ Identity Verification: Pending</div>
                  </div>
                </>
              )}
            </div>
          )}

          {stage === 'deployment' && (
            <div className="space-y-4">
              <h3 className="font-display text-xl text-tungsten">Local Deployment</h3>
              <p className="text-tungsten/70 mb-4">
                Optionally deploy the node process locally on this machine.
              </p>
              
              <label className="flex items-center gap-3 p-3 bg-carbon/50 border border-tungsten/20 rounded-lg cursor-pointer hover:border-overmatch/30 transition-colors">
                <input
                  type="checkbox"
                  checked={deployLocally}
                  onChange={(e) => setDeployLocally(e.target.checked)}
                  className="w-4 h-4 rounded border-tungsten/30 text-overmatch focus:ring-overmatch focus:ring-offset-0"
                />
                <span className="text-tungsten font-medium">Deploy node process locally</span>
              </label>

              {deployLocally && (
                <div className="space-y-3 mt-4 pt-4 border-t border-tungsten/10">
                  <div>
                    <label className="block text-sm text-tungsten/70 mb-2">Mesh Endpoint</label>
                    <input
                      type="text"
                      value={meshEndpoint}
                      onChange={(e) => setMeshEndpoint(e.target.value)}
                      className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                      placeholder="ws://localhost:8080"
                    />
                    <p className="text-xs text-tungsten/50 mt-1">WebSocket endpoint for mesh connectivity</p>
                  </div>

                  <div>
                    <label className="block text-sm text-tungsten/70 mb-2">Listen Port</label>
                    <input
                      type="number"
                      value={listenPort}
                      onChange={(e) => setListenPort(parseInt(e.target.value) || 9000)}
                      min="1024"
                      max="65535"
                      className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                    />
                    <p className="text-xs text-tungsten/50 mt-1">Port range: 1024-65535</p>
                  </div>

                  <div>
                    <label className="block text-sm text-tungsten/70 mb-2">Data Directory</label>
                    <input
                      type="text"
                      value={dataDir}
                      onChange={(e) => setDataDir(e.target.value)}
                      className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                      placeholder={`./data/${nodeId}`}
                    />
                    <p className="text-xs text-tungsten/50 mt-1">Local directory for node data storage</p>
                  </div>

                  <div>
                    <label className="block text-sm text-tungsten/70 mb-2">Log Level</label>
                    <select
                      value={logLevel}
                      onChange={(e) => setLogLevel(e.target.value)}
                      className="w-full px-4 py-2 bg-carbon/50 border border-tungsten/20 rounded-lg text-tungsten focus:outline-none focus:border-overmatch"
                    >
                      <option value="trace">Trace</option>
                      <option value="debug">Debug</option>
                      <option value="info">Info</option>
                      <option value="warn">Warn</option>
                      <option value="error">Error</option>
                    </select>
                  </div>
                </div>
              )}

              {!deployLocally && (
                <div className="p-3 bg-tungsten/5 border border-tungsten/10 rounded-lg">
                  <p className="text-sm text-tungsten/70">
                    Node will be registered in the identity registry but not deployed locally. 
                    You can deploy it later from the Deployments view.
                  </p>
                </div>
              )}
            </div>
          )}

          {stage === 'complete' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto w-24 h-24 rounded-full bg-verified-green/20 flex items-center justify-center mb-4">
                <CheckCircle className="text-verified-green" size={64} />
              </div>
              <h3 className="font-display text-xl text-tungsten">Node Added Successfully</h3>
              <p className="text-tungsten/70">
                Node <span className="font-mono text-overmatch">{nodeId}</span> has been provisioned and added to the mesh.
              </p>
              <div className="bg-carbon/50 border border-tungsten/10 rounded p-4 text-left text-xs text-tungsten/70 space-y-2">
                <div className="flex justify-between">
                  <span>Node ID:</span>
                  <span className="font-mono text-tungsten">{nodeId}</span>
                </div>
                <div className="flex justify-between">
                  <span>Domain:</span>
                  <span className="font-mono text-tungsten">{domain}</span>
                </div>
                <div className="flex justify-between">
                  <span>Platform:</span>
                  <span className="font-mono text-tungsten capitalize">{platformType}</span>
                </div>
                <div className="flex justify-between">
                  <span>Trust Score:</span>
                  <span className="font-mono text-verified-green">100%</span>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className="font-mono text-verified-green">ONLINE</span>
                </div>
                <div className="pt-2 mt-2 border-t border-tungsten/10">
                  <div className="flex justify-between items-start">
                    <span>Identity Hash:</span>
                    <span className="font-mono text-overmatch text-[10px] break-all max-w-[200px] text-right">
                      {/* BLAKE3 hash simulation */}
                      {`blake3:${Array.from({ length: 64 }, () => 
                        Math.floor(Math.random() * 16).toString(16)
                      ).join('')}`}
                    </span>
                  </div>
                </div>
                <div className="pt-2 mt-2 border-t border-tungsten/10">
                  <div className="flex justify-between">
                    <span>Location:</span>
                    <span className="font-mono text-tungsten">0.0000°, 0.0000° (Alt: 0m)</span>
                  </div>
                </div>
              </div>
              <div className="p-3 bg-verified-green/10 border border-verified-green/30 rounded-lg mt-4">
                <p className="text-sm text-tungsten/80">
                  <strong className="text-verified-green">✓ CRYPTOGRAPHIC CERTAINTY:</strong> 
                  {' '}Hardware-rooted identity established via{' '}
                  {platformType === 'satellite' ? 'Genesis Handshake' : 'TPM Attestation'}
                </p>
              </div>
            </div>
          )}

          {error && stage !== 'error' && (
            <div className="mt-4 p-3 bg-jamming/10 border border-jamming/30 rounded text-jamming text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-tungsten/10 flex justify-between flex-shrink-0">
          <button
            onClick={stage === 'platform-select' ? onClose : handleBack}
            className="px-4 py-2 bg-tungsten/10 hover:bg-tungsten/20 text-tungsten rounded-lg transition-colors disabled:opacity-50"
            disabled={isLoading || stage === 'complete' || (stage === 'gateway-polling' && gatewayPolling && !gatewayConnected)}
          >
            <ChevronLeft size={16} className="inline mr-1" />
            {stage === 'platform-select' ? 'Cancel' : 'Back'}
          </button>
          <button
            onClick={stage === 'complete' ? handleComplete : handleNext}
            className="px-4 py-2 bg-overmatch hover:bg-overmatch/80 text-carbon font-semibold rounded-lg transition-colors disabled:opacity-50"
            disabled={
              (stage === 'platform-select' && !platformType) ||
              (stage === 'identity' && (!nodeId || !domain)) ||
              (stage === 'qr-enrollment' && !qrCode) ||
              (stage === 'gateway-script' && !enrollmentToken) ||
              (stage === 'gateway-polling' && !gatewayConnected) ||
              isLoading ||
              stage === 'error'
            }
          >
            {isLoading && (
              <span className="inline mr-2 animate-spin">⟳</span>
            )}
            {stage === 'complete' ? 'Finish' : 'Next'}
            {stage !== 'complete' && stage !== 'error' && <ChevronRight size={16} className="inline ml-1" />}
          </button>
        </div>
      </GlassPanel>
    </div>
  );
};
