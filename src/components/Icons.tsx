import React from 'react';
import { AbilityId } from '../types/game';

export const KharosTitleLockup: React.FC<{ accentColor?: string }> = ({ accentColor = '#eab308' }) => (
  <svg
    viewBox="0 0 360 124"
    className="w-[290px] max-w-[82%] h-auto drop-shadow-[0_6px_18px_rgba(0,0,0,0.75)]"
    role="img"
    aria-label="Kharos: The Hollow Run"
  >
    {/* Carved Winged Crest Emblem */}
    <g transform="translate(180, 26)">
      <path
        d="M-66,6 L-28,-8 L-14,0 L0,-16 L14,0 L28,-8 L66,6 L34,10 L14,5 L0,16 L-14,5 L-34,10 Z"
        fill="#151820"
        stroke={accentColor}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M0,-10 L7,2 L0,10 L-7,2 Z" fill={accentColor} />
    </g>
    {/* Carved Display Wordmark */}
    <text
      x="180"
      y="82"
      textAnchor="middle"
      fill="#faf5e8"
      stroke="#12141a"
      strokeWidth="6"
      paintOrder="stroke fill"
      style={{
        fontFamily: 'Cinzel, Georgia, serif',
        fontSize: '46px',
        fontWeight: 900,
        letterSpacing: '0.16em',
      }}
    >
      KHAROS
    </text>
    {/* Engraved Divider & Subtitle */}
    <line x1="68" y1="95" x2="112" y2="95" stroke={accentColor} strokeWidth="1.5" opacity="0.85" />
    <line x1="248" y1="95" x2="292" y2="95" stroke={accentColor} strokeWidth="1.5" opacity="0.85" />
    <text
      x="180"
      y="101"
      textAnchor="middle"
      fill={accentColor}
      stroke="#0d0f14"
      strokeWidth="3"
      paintOrder="stroke fill"
      style={{
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: '12px',
        fontWeight: 800,
        letterSpacing: '0.32em',
      }}
    >
      THE HOLLOW RUN
    </text>
  </svg>
);

export const CoinSvg: React.FC<{ className?: string; color?: string }> = ({
  className = 'w-5 h-5',
  color = '#f5c542',
}) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#17140d" stroke={color} strokeWidth="2.2" />
    <circle cx="12" cy="12" r="7" fill={color} opacity="0.92" />
    <polygon points="12,7 15.5,12 12,17 8.5,12" fill="#fff7d6" />
  </svg>
);

export const AbilitySvg: React.FC<{ abilityId: AbilityId; className?: string }> = ({
  abilityId,
  className = 'w-6 h-6',
}) => {
  switch (abilityId) {
    case 'magnet':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M6 4v8a6 6 0 0 0 12 0V4h-3.5v8a2.5 2.5 0 0 1-5 0V4H6z"
            fill="#facc15"
            stroke="#141414"
            strokeWidth="1.5"
          />
          <rect x="6" y="4" width="3.5" height="3" fill="#fffbeb" />
          <rect x="14.5" y="4" width="3.5" height="3" fill="#fffbeb" />
        </svg>
      );
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M12 2.5L4.5 5.8v5.5c0 4.9 3.2 9.1 7.5 10.4 4.3-1.3 7.5-5.5 7.5-10.4V5.8L12 2.5z"
            fill="#38bdf8"
            stroke="#0f172a"
            strokeWidth="1.6"
          />
          <path d="M12 5.2v13.2" stroke="#e0f2fe" strokeWidth="1.8" />
        </svg>
      );
    case 'double_jump':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path d="M5 13l7-6 7 6M5 19l7-6 7 6" fill="none" stroke="#a7f3d0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'rush':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            d="M13 2L4.5 13.5h6L9.5 22l9-12h-6L13 2z"
            fill="#fb923c"
            stroke="#1c120d"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
};

export const PauseSvg: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect x="6" y="4" width="4.5" height="16" rx="1.2" fill="currentColor" />
    <rect x="13.5" y="4" width="4.5" height="16" rx="1.2" fill="currentColor" />
  </svg>
);

export const SoundSvg: React.FC<{ muted: boolean; className?: string }> = ({
  muted,
  className = 'w-5 h-5',
}) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M4 9.5v5h4.2l5.3 4.5V5L8.2 9.5H4z" fill="currentColor" />
    {muted ? (
      <path d="M16.5 9l4 6m0-6l-4 6" stroke="#f87171" strokeWidth="2.2" strokeLinecap="round" />
    ) : (
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    )}
  </svg>
);
