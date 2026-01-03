/**
 * LedgerSlot
 * Merkle Vine blockchain ledger display
 * Immutable audit trail with BLAKE3 hash chain verification
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Link2 } from 'lucide-react';
import { MateriaSlot, MateriaSlotConfig } from './MateriaSlot';

export interface MerkleVineLinkData {
  /** Previous hash in the chain (32 bytes, hex encoded) */
  previousHash: string;
  /** Current hash of this data point (32 bytes, hex encoded) */
  currentHash: string;
  /** Sequence number in the chain */
  sequence: number;
  /** Timestamp in nanoseconds since epoch */
  timestampNs: number;
  /** Optional data payload description */
  dataDescription?: string;
  /** Verification status */
  verified: boolean;
}

export interface LedgerSlotConfig extends MateriaSlotConfig {
  type: 'ledger';
  /** Node ID owning this ledger */
  nodeId: string;
  /** Merkle Vine chain entries (newest first) */
  entries: MerkleVineLinkData[];
  /** Total chain length */
  totalLength: number;
}

export interface LedgerSlotProps {
  config: LedgerSlotConfig;
  onClose?: () => void;
  onMinimize?: () => void;
  onEntryClick?: (entry: MerkleVineLinkData) => void;
}

/**
 * LedgerSlot Component
 * Displays immutable audit trail with Merkle chain visualization
 */
export const LedgerSlot: React.FC<LedgerSlotProps> = ({
  config,
  onClose,
  onMinimize,
  onEntryClick,
}) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const formatTimestamp = (nsTimestamp: number): string => {
    const msTimestamp = Math.floor(nsTimestamp / 1_000_000);
    return new Date(msTimestamp).toLocaleString();
  };

  const formatHash = (hash: string): string => `${hash.substring(0, 8)}...${hash.slice(-4)}`;

  return (
    <MateriaSlot
      config={{
        ...config,
        type: 'ledger',
        description: `Merkle Ledger • ${config.totalLength} entries`,
      }}
      onClose={onClose}
      onMinimize={onMinimize}
    >
      <div className="flex flex-col gap-4 h-full">
        {/* Chain Statistics */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-carbon/50 border border-tungsten/10 rounded p-2">
            <div className="text-tungsten/70">Total Entries</div>
            <div className="text-lg font-mono text-overmatch font-bold">
              {config.totalLength}
            </div>
          </div>
          <div className="bg-carbon/50 border border-tungsten/10 rounded p-2">
            <div className="text-tungsten/70">Verified</div>
            <div className="text-lg font-mono text-verified-green font-bold">
              {config.entries.filter((e) => e.verified).length}
            </div>
          </div>
          <div className="bg-carbon/50 border border-tungsten/10 rounded p-2">
            <div className="text-tungsten/70">Chain Integrity</div>
            <div className="text-lg font-mono text-tungsten font-bold">
              {config.entries.every((e) => e.verified) ? '100%' : 'WARN'}
            </div>
          </div>
        </div>

        {/* Merkle Chain Display */}
        <div className="flex-1 overflow-auto space-y-2">
          {config.entries.length === 0 ? (
            <div className="text-center text-tungsten/50 py-8">
              No ledger entries
            </div>
          ) : (
            config.entries.map((entry, index) => (
              <div
                key={entry.sequence}
                className="border border-tungsten/10 rounded-lg overflow-hidden hover:border-tungsten/30 transition-colors cursor-pointer"
                onClick={() => {
                  toggleExpand(index);
                  onEntryClick?.(entry);
                }}
              >
                {/* Entry Header */}
                <div className="p-3 bg-carbon/30 flex items-center justify-between">
                  <div className="flex-1 flex items-center gap-3">
                    {/* Verification Badge */}
                    <div
                      className={`w-3 h-3 rounded-full flex-shrink-0 ${
                        entry.verified
                          ? 'bg-verified-green'
                          : 'bg-jamming animate-pulse'
                      }`}
                    />

                    {/* Sequence and Hash */}
                    <div>
                      <div className="text-sm font-mono text-tungsten font-bold">
                        #{entry.sequence}
                      </div>
                      <div className="text-xs text-tungsten/50">
                        {formatHash(entry.currentHash)}
                      </div>
                    </div>
                  </div>

                  {/* Timestamp */}
                  <div className="text-xs text-tungsten/50 mr-3">
                    {formatTimestamp(entry.timestampNs)}
                  </div>

                  {/* Expand Toggle */}
                  <div className="text-tungsten/70">
                    {expandedIndex === index ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </div>
                </div>

                {/* Entry Details (Expanded) */}
                {expandedIndex === index && (
                  <div className="p-3 border-t border-tungsten/10 space-y-2 bg-carbon/50 text-xs">
                    {/* Chain Link Visualization */}
                    <div className="flex items-center gap-2 font-mono text-tungsten/70">
                      <Link2 size={14} />
                      <span>Previous</span>
                    </div>
                    <div className="bg-carbon/30 p-2 rounded border border-tungsten/5 font-mono text-tungsten/60 break-all text-xs">
                      {entry.previousHash}
                    </div>

                    <div className="flex items-center gap-2 font-mono text-tungsten/70 mt-3">
                      <Link2 size={14} />
                      <span>Current</span>
                    </div>
                    <div className="bg-carbon/30 p-2 rounded border border-tungsten/5 font-mono text-overmatch break-all text-xs">
                      {entry.currentHash}
                    </div>

                    {/* Data Description */}
                    {entry.dataDescription && (
                      <>
                        <div className="text-tungsten/70 mt-3">Payload</div>
                        <div className="bg-carbon/30 p-2 rounded border border-tungsten/5 text-tungsten/80">
                          {entry.dataDescription}
                        </div>
                      </>
                    )}

                    {/* Verification Details */}
                    <div className="mt-3 pt-3 border-t border-tungsten/10 flex justify-between">
                      <span className="text-tungsten/70">Status</span>
                      <span
                        className={
                          entry.verified
                            ? 'text-verified-green font-semibold'
                            : 'text-jamming font-semibold'
                        }
                      >
                        {entry.verified ? 'VERIFIED' : 'UNVERIFIED'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="text-xs text-tungsten/50 border-t border-tungsten/10 pt-3">
          Node: {config.nodeId}
        </div>
      </div>
    </MateriaSlot>
  );
};

export default LedgerSlot;
