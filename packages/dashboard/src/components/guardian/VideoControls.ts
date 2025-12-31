/**
 * VideoControls - Mission Guardian Video Controls
 * 
 * TacticalGlass design system for video call controls
 * Shows NodeID, network health, contested mode status
 */

import { CallState, NetworkHealth, NodeID } from '@aethercore/shared';

/**
 * VideoControls Props
 */
export interface VideoControlsProps {
  localNodeId: NodeID;
  callState: CallState;
  networkHealth: NetworkHealth | null;
  isContested: boolean;
  isMuted: boolean;
  isVideoEnabled: boolean;
  onToggleMute?: () => void;
  onToggleVideo?: () => void;
  onHangup?: () => void;
}

/**
 * VideoControls Component
 * 
 * Displays call controls with TacticalGlass styling
 */
export class VideoControls {
  /**
   * Render controls HTML
   */
  static render(props: VideoControlsProps): string {
    const displayNodeId = this.formatNodeId(props.localNodeId);
    const healthColor = this.getHealthColor(props.networkHealth?.healthPercent || 0);
    const stateLabel = this.getStateLabel(props.callState);

    return `
      <div class="video-controls">
        <div class="video-controls__header">
          <div class="node-id">
            <span class="node-id__label">NODE</span>
            <span class="node-id__value">${displayNodeId}</span>
          </div>
          
          <div class="call-state call-state--${props.callState}">
            ${stateLabel}
          </div>
        </div>

        ${props.networkHealth ? this.renderNetworkHealth(props.networkHealth, healthColor) : ''}
        
        ${props.isContested ? this.renderContestedBanner() : ''}

        <div class="video-controls__actions">
          <button 
            class="control-btn ${props.isMuted ? 'control-btn--active' : ''}"
            onclick="${props.onToggleMute ? 'this.handleToggleMute()' : ''}"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${props.isMuted 
                ? '<path d="M17.5 15c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C21.38 18.03 22 16.56 22 15c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l6.01 6.01V15c0 1.66 1.34 3 3 3 .35 0 .69-.07 1-.2l1.2 1.2c-.63.3-1.32.5-2.03.5-2.76 0-5-2.24-5-5v-1H5v1c0 3.53 2.61 6.43 6 6.92V22h2v-2.08c.91-.13 1.77-.45 2.54-.9L19.73 24 21 22.73 4.27 3z"/>'
                : '<path d="M12 2c1.1 0 2 .9 2 2v7c0 1.1-.9 2-2 2s-2-.9-2-2V4c0-1.1.9-2 2-2zm5.3 5.3l-1.4 1.4C16.6 9.5 17 10.7 17 12c0 1.3-.4 2.5-1.1 3.5l1.4 1.4C18.2 15.5 19 13.8 19 12c0-1.8-.8-3.5-1.7-4.7zM5 10v4c0 3.5 2.6 6.4 6 6.9V23h2v-2.1c3.4-.5 6-3.4 6-6.9v-4h-2v4c0 2.8-2.2 5-5 5s-5-2.2-5-5v-4H5z"/>'
              }
            </svg>
            <span>${props.isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          <button 
            class="control-btn ${!props.isVideoEnabled ? 'control-btn--active' : ''}"
            onclick="${props.onToggleVideo ? 'this.handleToggleVideo()' : ''}"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${!props.isVideoEnabled
                ? '<path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>'
                : '<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>'
              }
            </svg>
            <span>${!props.isVideoEnabled ? 'Enable Video' : 'Disable Video'}</span>
          </button>

          <button 
            class="control-btn control-btn--danger"
            onclick="${props.onHangup ? 'this.handleHangup()' : ''}"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
            <span>Hang Up</span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render network health indicator
   */
  private static renderNetworkHealth(health: NetworkHealth, color: string): string {
    return `
      <div class="network-health">
        <div class="network-health__bar">
          <div class="network-health__fill" style="width: ${health.healthPercent}%; background-color: ${color};"></div>
        </div>
        <div class="network-health__stats">
          <div class="stat">
            <span class="stat__label">Health</span>
            <span class="stat__value" style="color: ${color};">${health.healthPercent}%</span>
          </div>
          <div class="stat">
            <span class="stat__label">Latency</span>
            <span class="stat__value">${health.latencyMs}ms</span>
          </div>
          <div class="stat">
            <span class="stat__label">Loss</span>
            <span class="stat__value">${health.packetLossPercent.toFixed(1)}%</span>
          </div>
          <div class="stat">
            <span class="stat__label">Bandwidth</span>
            <span class="stat__value">${Math.round(health.bandwidthKbps)}kbps</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render contested mode banner
   */
  private static renderContestedBanner(): string {
    return `
      <div class="contested-banner">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        <span>CONTESTED MODE - AUDIO ONLY</span>
      </div>
    `;
  }

  /**
   * Format NodeID for display (show first 8 and last 8 chars)
   */
  private static formatNodeId(nodeId: NodeID): string {
    if (nodeId.length <= 16) return nodeId;
    return `${nodeId.substring(0, 8)}...${nodeId.substring(nodeId.length - 8)}`;
  }

  /**
   * Get health color based on percentage
   */
  private static getHealthColor(percent: number): string {
    if (percent >= 80) return '#10b981'; // green
    if (percent >= 60) return '#3b82f6'; // blue
    if (percent >= 40) return '#f59e0b'; // orange
    return '#ef4444'; // red
  }

  /**
   * Get state label
   */
  private static getStateLabel(state: CallState): string {
    const labels: Record<CallState, string> = {
      idle: 'Ready',
      initiating: 'Initiating...',
      handshaking: 'Hardware Handshake...',
      connecting: 'Connecting...',
      connected: 'Connected',
      contested: 'Contested',
      disconnecting: 'Disconnecting...',
      disconnected: 'Disconnected',
      failed: 'Failed',
    };
    return labels[state];
  }

  /**
   * Get TacticalGlass CSS styles
   */
  static getStyles(): string {
    return `
      .video-controls {
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(10px);
        border-top: 2px solid rgba(59, 130, 246, 0.5);
        padding: 1.5rem;
        font-family: 'Rajdhani', 'Courier New', monospace;
      }

      .video-controls__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .node-id {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
      }

      .node-id__label {
        color: #9ca3af;
        font-weight: 600;
        letter-spacing: 0.1em;
      }

      .node-id__value {
        color: #3b82f6;
        font-family: 'Courier New', monospace;
        font-weight: 700;
      }

      .call-state {
        padding: 0.25rem 0.75rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .call-state--idle,
      .call-state--disconnected {
        background: rgba(107, 114, 128, 0.2);
        color: #9ca3af;
      }

      .call-state--initiating,
      .call-state--handshaking,
      .call-state--connecting {
        background: rgba(59, 130, 246, 0.2);
        color: #3b82f6;
      }

      .call-state--connected {
        background: rgba(16, 185, 129, 0.2);
        color: #10b981;
      }

      .call-state--contested {
        background: rgba(245, 158, 11, 0.2);
        color: #f59e0b;
      }

      .call-state--failed {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
      }

      .network-health {
        margin: 1rem 0;
        padding: 1rem;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 0.5rem;
      }

      .network-health__bar {
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        margin-bottom: 0.75rem;
        overflow: hidden;
      }

      .network-health__fill {
        height: 100%;
        transition: width 0.3s ease, background-color 0.3s ease;
      }

      .network-health__stats {
        display: flex;
        gap: 1.5rem;
        justify-content: space-between;
      }

      .stat {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .stat__label {
        font-size: 0.75rem;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .stat__value {
        font-size: 1.125rem;
        font-weight: 700;
        color: white;
      }

      .contested-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background: rgba(245, 158, 11, 0.2);
        border: 2px solid #f59e0b;
        border-radius: 0.375rem;
        color: #f59e0b;
        font-weight: 700;
        font-size: 0.875rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: 1rem;
        animation: pulse-warning 2s ease-in-out infinite;
      }

      @keyframes pulse-warning {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }

      .contested-banner svg {
        width: 24px;
        height: 24px;
      }

      .video-controls__actions {
        display: flex;
        gap: 1rem;
        justify-content: center;
      }

      .control-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.05);
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.5rem;
        color: white;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 100px;
      }

      .control-btn svg {
        width: 24px;
        height: 24px;
      }

      .control-btn span {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .control-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.3);
        transform: translateY(-2px);
      }

      .control-btn--active {
        background: rgba(239, 68, 68, 0.2);
        border-color: #ef4444;
        color: #ef4444;
      }

      .control-btn--danger {
        background: rgba(239, 68, 68, 0.2);
        border-color: #ef4444;
        color: #ef4444;
      }

      .control-btn--danger:hover {
        background: #ef4444;
        color: white;
      }
    `;
  }
}
