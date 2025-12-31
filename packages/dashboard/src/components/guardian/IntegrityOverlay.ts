/**
 * IntegrityOverlay - Fail-Visible Security Alert
 * 
 * Displays "INTEGRITY COMPROMISED" blackout screen when stream integrity fails
 * TacticalGlass design system styling
 */

import { IntegrityStatus } from '@aethercore/shared';

/**
 * IntegrityOverlay Props
 */
export interface IntegrityOverlayProps {
  status: IntegrityStatus;
  onDismiss?: () => void;
}

/**
 * IntegrityOverlay Component
 * 
 * This would be implemented as a React component in a real application.
 * Here we provide the structure and styling logic.
 */
export class IntegrityOverlay {
  /**
   * Render the overlay HTML
   */
  static render(props: IntegrityOverlayProps): string {
    if (!props.status.showAlert) {
      return '';
    }

    const severity = props.status.invalidFrames > 10 ? 'critical' : 'warning';
    const stats = `${props.status.invalidFrames}/${props.status.totalFrames} frames compromised`;

    return `
      <div class="integrity-overlay integrity-overlay--${severity}">
        <div class="integrity-overlay__content">
          <div class="integrity-overlay__icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          </div>
          
          <h1 class="integrity-overlay__title">INTEGRITY COMPROMISED</h1>
          
          <p class="integrity-overlay__message">
            Video stream integrity verification failed.
            The incoming video may have been tampered with.
          </p>
          
          <div class="integrity-overlay__stats">
            <div class="stat">
              <span class="stat__label">Invalid Frames:</span>
              <span class="stat__value">${props.status.invalidFrames}</span>
            </div>
            <div class="stat">
              <span class="stat__label">Valid Frames:</span>
              <span class="stat__value">${props.status.validFrames}</span>
            </div>
            <div class="stat">
              <span class="stat__label">Total Frames:</span>
              <span class="stat__value">${props.status.totalFrames}</span>
            </div>
          </div>
          
          <div class="integrity-overlay__actions">
            <button 
              class="btn btn--danger" 
              onclick="${props.onDismiss ? 'this.handleDismiss()' : ''}"
            >
              Terminate Connection
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get TacticalGlass CSS styles
   */
  static getStyles(): string {
    return `
      .integrity-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(20px);
        animation: overlay-fade-in 0.3s ease-out;
      }

      .integrity-overlay--warning {
        background: rgba(234, 179, 8, 0.95);
      }

      .integrity-overlay--critical {
        background: rgba(239, 68, 68, 0.95);
      }

      @keyframes overlay-fade-in {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .integrity-overlay__content {
        max-width: 600px;
        padding: 3rem;
        text-align: center;
        color: white;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
      }

      .integrity-overlay__icon {
        width: 120px;
        height: 120px;
        margin: 0 auto 2rem;
        animation: pulse 2s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.7;
          transform: scale(1.1);
        }
      }

      .integrity-overlay__icon svg {
        width: 100%;
        height: 100%;
      }

      .integrity-overlay__title {
        font-size: 3rem;
        font-weight: 900;
        letter-spacing: 0.05em;
        margin: 0 0 1.5rem;
        font-family: 'Rajdhani', 'Courier New', monospace;
        text-transform: uppercase;
      }

      .integrity-overlay__message {
        font-size: 1.25rem;
        line-height: 1.6;
        margin: 0 0 2rem;
        font-weight: 500;
      }

      .integrity-overlay__stats {
        display: flex;
        gap: 2rem;
        justify-content: center;
        margin: 2rem 0;
        padding: 1.5rem;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 0.5rem;
        backdrop-filter: blur(10px);
      }

      .stat {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .stat__label {
        font-size: 0.875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.9;
      }

      .stat__value {
        font-size: 2rem;
        font-weight: 900;
        font-family: 'Rajdhani', monospace;
      }

      .integrity-overlay__actions {
        margin-top: 2rem;
      }

      .btn {
        padding: 1rem 2rem;
        font-size: 1rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        border: none;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: 'Rajdhani', sans-serif;
      }

      .btn--danger {
        background: rgba(0, 0, 0, 0.5);
        color: white;
        border: 2px solid white;
      }

      .btn--danger:hover {
        background: white;
        color: #dc2626;
        transform: translateY(-2px);
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
      }
    `;
  }
}

/**
 * React Component Version (for reference)
 * 
 * This shows how it would be implemented in React:
 * 
 * ```tsx
 * import React from 'react';
 * 
 * export const IntegrityOverlay: React.FC<IntegrityOverlayProps> = ({ status, onDismiss }) => {
 *   if (!status.showAlert) return null;
 * 
 *   return (
 *     <div className={`integrity-overlay integrity-overlay--${severity}`}>
 *       ...
 *     </div>
 *   );
 * };
 * ```
 */
