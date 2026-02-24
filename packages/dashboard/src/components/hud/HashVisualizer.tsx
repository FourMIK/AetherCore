/**
 * HashVisualizer
 * Truncated crypto hash display with click-to-copy
 * CRITICAL: Copies FULL hash, not truncated version
 */

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface HashVisualizerProps {
  hash: string;
  length?: number;
  className?: string;
  showIcon?: boolean;
}

export const HashVisualizer: React.FC<HashVisualizerProps> = ({
  hash,
  length = 16,
  className = '',
  showIcon = true,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // CRITICAL: Copy FULL hash, not truncated
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy hash:', err);
    }
  };

  const truncated = hash.length > length ? `${hash.slice(0, length)}...` : hash;

  return (
    <div
      className={`inline-flex items-center gap-2 font-mono text-sm cursor-pointer hover:text-overmatch transition-colors ${className}`}
      onClick={handleCopy}
      title={`Click to copy full hash: ${hash}`}
    >
      <span>{truncated}</span>
      {showIcon && (
        <span className="text-overmatch">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </span>
      )}
    </div>
  );
};
