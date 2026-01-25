/**
 * ISRConsoleView
 * Intelligence, Surveillance, Reconnaissance workspace
 */

import React from 'react';
import { GlassPanel } from '../hud/GlassPanel';
import { Eye, Camera, Satellite, AlertTriangle } from 'lucide-react';

export const ISRConsoleView: React.FC = () => {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div className="max-w-7xl mx-auto p-4 space-y-4 pb-8">
        <h1 className="font-display text-3xl font-bold text-tungsten mb-2">
          ISR Console
        </h1>

        <div className="grid grid-cols-2 gap-4">
          <GlassPanel variant="light" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Camera className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Visual Intelligence
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Active Feeds</span>
                <span className="font-mono text-tungsten font-semibold">0</span>
              </div>
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Recording</span>
                <span className="font-mono text-tungsten/50">Inactive</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-tungsten/70">Storage Used</span>
                <span className="font-mono text-tungsten font-semibold">0 GB</span>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel variant="light" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Satellite className="text-overmatch" size={24} />
              <h2 className="font-display text-xl font-semibold text-tungsten">
                Signal Intelligence
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">RF Channels</span>
                <span className="font-mono text-tungsten font-semibold">0</span>
              </div>
              <div className="flex justify-between py-2 border-b border-tungsten/10">
                <span className="text-tungsten/70">Intercepts</span>
                <span className="font-mono text-tungsten/50">None</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-tungsten/70">Classification</span>
                <span className="font-mono text-tungsten font-semibold">N/A</span>
              </div>
            </div>
          </GlassPanel>
        </div>

        <GlassPanel variant="light" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Eye className="text-overmatch" size={24} />
            <h2 className="font-display text-xl font-semibold text-tungsten">
              Reconnaissance Feed
            </h2>
          </div>
          <div className="bg-carbon/50 border border-tungsten/10 rounded-lg h-64 flex items-center justify-center">
            <div className="text-center text-tungsten/50">
              <AlertTriangle className="mx-auto mb-2" size={48} />
              <div>No ISR Materia Slots Configured</div>
              <div className="text-sm mt-1">Deploy ISR-capable units to enable reconnaissance</div>
            </div>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
};
