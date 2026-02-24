/**
 * SelectPlatformStep
 * Visual selection screen for choosing between Satellite and Gateway hardware
 * Part of the Unified Materia doctrine
 */

import React from 'react';
import { Radio, Server } from 'lucide-react';
import { PlatformType } from '../../types';

interface SelectPlatformStepProps {
  selectedPlatform: PlatformType | null;
  onSelectPlatform: (platform: PlatformType) => void;
}

export const SelectPlatformStep: React.FC<SelectPlatformStepProps> = ({
  selectedPlatform,
  onSelectPlatform,
}) => {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h3 className="font-display text-2xl text-tungsten mb-2">Select Chassis</h3>
        <p className="text-tungsten/70">
          Choose the hardware platform for your new node
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Satellite Option */}
        <button
          onClick={() => onSelectPlatform('satellite')}
          className={`
            relative p-6 rounded-lg border-2 transition-all
            flex flex-col items-center text-center gap-4
            ${
              selectedPlatform === 'satellite'
                ? 'border-overmatch bg-overmatch/10'
                : 'border-tungsten/20 bg-carbon/30 hover:border-tungsten/40 hover:bg-carbon/50'
            }
          `}
        >
          {/* Selection Indicator */}
          {selectedPlatform === 'satellite' && (
            <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-overmatch flex items-center justify-center">
              <svg className="w-4 h-4 text-carbon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}

          {/* Icon */}
          <div className={`
            p-4 rounded-full transition-colors
            ${selectedPlatform === 'satellite' ? 'bg-overmatch/20' : 'bg-tungsten/10'}
          `}>
            <Radio 
              size={48} 
              className={selectedPlatform === 'satellite' ? 'text-overmatch' : 'text-tungsten/70'}
            />
          </div>

          {/* Title */}
          <div>
            <h4 className="font-display text-xl text-tungsten font-semibold mb-2">
              Ralphie Satellite
            </h4>
            <p className="text-sm text-tungsten/70 leading-relaxed">
              Long-range LoRa relay and sensor node. Requires USB connection for provisioning.
            </p>
          </div>

          {/* Technical Specs */}
          <div className="mt-2 pt-4 border-t border-tungsten/10 w-full text-left">
            <div className="space-y-2 text-xs text-tungsten/60">
              <div className="flex justify-between">
                <span>Platform:</span>
                <span className="font-mono text-tungsten/80">ESP32/LoRa</span>
              </div>
              <div className="flex justify-between">
                <span>Interface:</span>
                <span className="font-mono text-tungsten/80">USB Serial</span>
              </div>
              <div className="flex justify-between">
                <span>Auth:</span>
                <span className="font-mono text-tungsten/80">Genesis Handshake</span>
              </div>
            </div>
          </div>
        </button>

        {/* Gateway Option */}
        <button
          onClick={() => onSelectPlatform('gateway')}
          className={`
            relative p-6 rounded-lg border-2 transition-all
            flex flex-col items-center text-center gap-4
            ${
              selectedPlatform === 'gateway'
                ? 'border-overmatch bg-overmatch/10'
                : 'border-tungsten/20 bg-carbon/30 hover:border-tungsten/40 hover:bg-carbon/50'
            }
          `}
        >
          {/* Selection Indicator */}
          {selectedPlatform === 'gateway' && (
            <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-overmatch flex items-center justify-center">
              <svg className="w-4 h-4 text-carbon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}

          {/* Icon */}
          <div className={`
            p-4 rounded-full transition-colors
            ${selectedPlatform === 'gateway' ? 'bg-overmatch/20' : 'bg-tungsten/10'}
          `}>
            <Server 
              size={48} 
              className={selectedPlatform === 'gateway' ? 'text-overmatch' : 'text-tungsten/70'}
            />
          </div>

          {/* Title */}
          <div>
            <h4 className="font-display text-xl text-tungsten font-semibold mb-2">
              Ralphie Gateway
            </h4>
            <p className="text-sm text-tungsten/70 leading-relaxed">
              High-compute edge processor. Requires Network/SSH access for provisioning.
            </p>
          </div>

          {/* Technical Specs */}
          <div className="mt-2 pt-4 border-t border-tungsten/10 w-full text-left">
            <div className="space-y-2 text-xs text-tungsten/60">
              <div className="flex justify-between">
                <span>Platform:</span>
                <span className="font-mono text-tungsten/80">Raspberry Pi</span>
              </div>
              <div className="flex justify-between">
                <span>Interface:</span>
                <span className="font-mono text-tungsten/80">SSH/Network</span>
              </div>
              <div className="flex justify-between">
                <span>Auth:</span>
                <span className="font-mono text-tungsten/80">TPM Attestation</span>
              </div>
            </div>
          </div>
        </button>
      </div>

      {selectedPlatform && (
        <div className="mt-6 p-4 bg-overmatch/10 border border-overmatch/30 rounded-lg">
          <p className="text-sm text-tungsten/80">
            <strong className="text-overmatch">Selected:</strong>{' '}
            {selectedPlatform === 'satellite' ? 'Ralphie Satellite' : 'Ralphie Gateway'}
          </p>
        </div>
      )}
    </div>
  );
};
