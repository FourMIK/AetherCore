/**
 * ParticipantGrid - Mission Guardian Participant Display
 * 
 * Displays video/audio participants in a grid layout
 * Shows NodeID and TrustMesh-resolved display names
 * TacticalGlass design system styling
 */

import { ParticipantInfo, NodeID } from '@aethercore/shared';

/**
 * ParticipantGrid Props
 */
export interface ParticipantGridProps {
  participants: ParticipantInfo[];
  onParticipantClick?: (nodeId: NodeID) => void;
}

/**
 * ParticipantGrid Component
 * 
 * Displays participants in a responsive grid
 */
export class ParticipantGrid {
  /**
   * Render participant grid HTML
   */
  static render(props: ParticipantGridProps): string {
    const gridClass = this.getGridClass(props.participants.length);

    return `
      <div class="participant-grid ${gridClass}">
        ${props.participants.map((p) => this.renderParticipant(p, props.onParticipantClick)).join('')}
      </div>
    `;
  }

  /**
   * Render individual participant
   */
  private static renderParticipant(
    participant: ParticipantInfo,
    onClick?: (nodeId: NodeID) => void,
  ): string {
    const displayName = participant.displayName || this.formatNodeId(participant.nodeId);
    const qualityColor = this.getQualityColor(participant.connectionQuality);
    const qualityLabel = participant.connectionQuality || 'unknown';

    return `
      <div 
        class="participant ${participant.isLocal ? 'participant--local' : ''}"
        onclick="${onClick ? `this.handleParticipantClick('${participant.nodeId}')` : ''}"
      >
        <div class="participant__video">
          ${!participant.hasVideo ? this.renderNoVideoPlaceholder() : ''}
          <video 
            class="participant__video-element" 
            autoplay 
            ${participant.isLocal ? 'muted' : ''}
          ></video>
        </div>

        <div class="participant__info">
          <div class="participant__header">
            <div class="participant__name">
              ${displayName}
              ${participant.isLocal ? '<span class="badge badge--local">YOU</span>' : ''}
            </div>
            <div class="participant__node-id">${this.formatNodeId(participant.nodeId)}</div>
          </div>

          <div class="participant__status">
            <div class="media-indicators">
              ${participant.hasAudio 
                ? '<div class="indicator indicator--audio"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1.1 0 2 .9 2 2v7c0 1.1-.9 2-2 2s-2-.9-2-2V4c0-1.1.9-2 2-2z"/></svg></div>'
                : '<div class="indicator indicator--muted"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V4c0-1.66-1.34-3-3-3S9 2.34 9 4v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg></div>'
              }
              ${participant.hasVideo
                ? '<div class="indicator indicator--video"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg></div>'
                : '<div class="indicator indicator--no-video"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/></svg></div>'
              }
            </div>

            ${participant.connectionQuality 
              ? `<div class="quality-indicator" style="color: ${qualityColor};">
                   <div class="quality-dot" style="background-color: ${qualityColor};"></div>
                   ${qualityLabel}
                 </div>`
              : ''
            }
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render no video placeholder
   */
  private static renderNoVideoPlaceholder(): string {
    return `
      <div class="no-video-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
        </svg>
      </div>
    `;
  }

  /**
   * Get grid class based on participant count
   */
  private static getGridClass(count: number): string {
    if (count === 1) return 'participant-grid--single';
    if (count === 2) return 'participant-grid--dual';
    if (count <= 4) return 'participant-grid--quad';
    return 'participant-grid--many';
  }

  /**
   * Format NodeID for display
   */
  private static formatNodeId(nodeId: NodeID): string {
    if (nodeId.length <= 16) return nodeId;
    return `${nodeId.substring(0, 8)}...${nodeId.substring(nodeId.length - 8)}`;
  }

  /**
   * Get quality color
   */
  private static getQualityColor(quality?: string): string {
    const colors: Record<string, string> = {
      excellent: '#10b981',
      good: '#3b82f6',
      fair: '#f59e0b',
      poor: '#ef4444',
    };
    return colors[quality || ''] || '#6b7280';
  }

  /**
   * Get TacticalGlass CSS styles
   */
  static getStyles(): string {
    return `
      .participant-grid {
        display: grid;
        gap: 1rem;
        padding: 1rem;
        height: 100%;
        background: #0a0a0a;
      }

      .participant-grid--single {
        grid-template-columns: 1fr;
      }

      .participant-grid--dual {
        grid-template-columns: repeat(2, 1fr);
      }

      .participant-grid--quad {
        grid-template-columns: repeat(2, 1fr);
        grid-template-rows: repeat(2, 1fr);
      }

      .participant-grid--many {
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      }

      .participant {
        position: relative;
        background: rgba(0, 0, 0, 0.5);
        border: 2px solid rgba(59, 130, 246, 0.3);
        border-radius: 0.75rem;
        overflow: hidden;
        transition: all 0.2s ease;
        cursor: pointer;
      }

      .participant:hover {
        border-color: rgba(59, 130, 246, 0.6);
        transform: translateY(-2px);
        box-shadow: 0 10px 30px rgba(59, 130, 246, 0.2);
      }

      .participant--local {
        border-color: rgba(16, 185, 129, 0.5);
      }

      .participant--local:hover {
        border-color: rgba(16, 185, 129, 0.8);
        box-shadow: 0 10px 30px rgba(16, 185, 129, 0.2);
      }

      .participant__video {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        background: #000;
        overflow: hidden;
      }

      .participant__video-element {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .no-video-placeholder {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        color: #475569;
      }

      .no-video-placeholder svg {
        width: 80px;
        height: 80px;
        opacity: 0.5;
      }

      .participant__info {
        padding: 1rem;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(10px);
        font-family: 'Rajdhani', 'Courier New', monospace;
      }

      .participant__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }

      .participant__name {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 1rem;
        font-weight: 700;
        color: white;
        letter-spacing: 0.05em;
      }

      .badge {
        padding: 0.125rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.625rem;
        font-weight: 900;
        letter-spacing: 0.1em;
      }

      .badge--local {
        background: rgba(16, 185, 129, 0.2);
        color: #10b981;
      }

      .participant__node-id {
        font-size: 0.75rem;
        color: #3b82f6;
        font-family: 'Courier New', monospace;
        font-weight: 600;
      }

      .participant__status {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .media-indicators {
        display: flex;
        gap: 0.5rem;
      }

      .indicator {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
      }

      .indicator svg {
        width: 14px;
        height: 14px;
      }

      .indicator--audio {
        color: #10b981;
        background: rgba(16, 185, 129, 0.2);
      }

      .indicator--muted {
        color: #ef4444;
        background: rgba(239, 68, 68, 0.2);
      }

      .indicator--video {
        color: #3b82f6;
        background: rgba(59, 130, 246, 0.2);
      }

      .indicator--no-video {
        color: #6b7280;
        background: rgba(107, 114, 128, 0.2);
      }

      .quality-indicator {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .quality-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        animation: pulse-dot 2s ease-in-out infinite;
      }

      @keyframes pulse-dot {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
    `;
  }
}
