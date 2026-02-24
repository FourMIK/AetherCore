/**
 * PurgeAnimation
 * Verification failure purge animation
 */

import React, { useEffect, useState } from 'react';
import { XCircle } from 'lucide-react';

interface PurgeAnimationProps {
  nodeId: string;
  reason: string;
  onComplete?: () => void;
}

export const PurgeAnimation: React.FC<PurgeAnimationProps> = ({
  nodeId,
  reason,
  onComplete,
}) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const duration = 2000; // 2 seconds
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(newProgress);

      if (newProgress < 100) {
        requestAnimationFrame(animate);
      } else if (onComplete) {
        setTimeout(onComplete, 300);
      }
    };

    animate();
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-jamming/20 backdrop-blur-sm animate-fadeIn">
      <div className="text-center space-y-4">
        {/* Icon */}
        <div className="flex justify-center">
          <XCircle className="text-jamming animate-pulse" size={80} />
        </div>

        {/* Title */}
        <div className="space-y-1">
          <h3 className="font-display text-2xl font-bold text-jamming">
            NODE PURGED
          </h3>
          <p className="text-sm text-tungsten/70 font-mono">{nodeId}</p>
        </div>

        {/* Reason */}
        <div className="glass-panel-heavy px-6 py-3 max-w-md">
          <div className="text-xs text-tungsten/50 mb-1">Reason</div>
          <div className="text-sm text-tungsten">{reason}</div>
        </div>

        {/* Progress */}
        <div className="w-64 mx-auto">
          <div className="h-1 bg-carbon border border-jamming/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-jamming transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
