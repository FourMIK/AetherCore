/**
 * TrustScoreGauge
 * Visual trust score indicator with color coding
 */

import React from 'react';

interface TrustScoreGaugeProps {
  score: number; // 0-100
  label?: string;
  className?: string;
  showValue?: boolean;
}

export const TrustScoreGauge: React.FC<TrustScoreGaugeProps> = ({
  score,
  label = 'Trust Score',
  className = '',
  showValue = true,
}) => {
  const clampedScore = Math.max(0, Math.min(100, score));
  const level = clampedScore >= 80 ? 'high' : clampedScore >= 50 ? 'medium' : 'low';

  const levelColor = {
    high: 'text-verified-green',
    medium: 'text-ghost',
    low: 'text-jamming',
  }[level];

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-tungsten/70">{label}</span>
        {showValue && (
          <span className={`text-sm font-semibold ${levelColor}`}>
            {clampedScore.toFixed(0)}%
          </span>
        )}
      </div>
      <div className="trust-gauge">
        <div
          className={`trust-gauge-fill ${level}`}
          style={{ width: `${clampedScore}%` }}
        />
      </div>
    </div>
  );
};
