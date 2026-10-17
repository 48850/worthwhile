// Invented vertical Shorts frames. Four loud ones that flick past, and one
// worth stopping for. SVG only.
import { useId } from 'react';

export type ShortVariant = 'wait' | 'pov' | 'prank' | 'day' | 'proof';

const shout = { fontFamily: 'var(--font-geist-sans), system-ui, sans-serif', fontWeight: 900, letterSpacing: '-0.03em', paintOrder: 'stroke' as const };

export function ShortThumb({ variant, className = '' }: { variant: ShortVariant; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 90 160" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {variant === 'wait' && (
        <>
          <rect width="90" height="160" fill="#ff006e" />
          <circle cx="45" cy="70" r="36" fill="#ffbe0b" />
          <text x="31" y="86" fontSize="44" fill="#fff" stroke="#111" strokeWidth="5" style={shout}>3</text>
          <text x="10" y="132" fontSize="13" fill="#fff" stroke="#111" strokeWidth="3.5" style={shout}>WAIT FOR IT</text>
        </>
      )}
      {variant === 'pov' && (
        <>
          <rect width="90" height="80" fill="#3a86ff" />
          <rect y="80" width="90" height="80" fill="#8338ec" />
          <circle cx="45" cy="80" r="14" fill="#fff" stroke="#111" strokeWidth="3" />
          <text x="35" y="86" fontSize="15" fill="#111" style={shout}>vs</text>
          <text x="10" y="36" fontSize="18" fill="#fff" stroke="#111" strokeWidth="4" style={shout}>POV:</text>
        </>
      )}
      {variant === 'prank' && (
        <>
          <rect width="90" height="160" fill="#06d6a0" />
          <path d="M8 120 C30 100 40 80 58 60" stroke="#ef233c" strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M50 56 L64 52 L60 66 Z" fill="#ef233c" />
          <circle cx="66" cy="44" r="12" fill="none" stroke="#ef233c" strokeWidth="3" />
          <text x="8" y="146" fontSize="14" fill="#fff" stroke="#111" strokeWidth="3.5" style={shout}>HE DIDN&apos;T</text>
        </>
      )}
      {variant === 'day' && (
        <>
          <defs>
            <linearGradient id={`${id}d`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#fb5607" />
              <stop offset="1" stopColor="#ffbe0b" />
            </linearGradient>
          </defs>
          <rect width="90" height="160" fill={`url(#${id}d)`} />
          <text x="10" y="70" fontSize="20" fill="#fff" stroke="#111" strokeWidth="4" style={shout}>DAY 47</text>
          <text x="10" y="92" fontSize="11" fill="#111" style={shout}>of doing this</text>
        </>
      )}
      {variant === 'proof' && (
        <>
          <rect width="90" height="160" fill="#101512" />
          <rect x="6" y="18" width="78" height="88" rx="2" fill="#18231d" stroke="#2c3b32" strokeWidth="0.8" />
          <g fontFamily="Georgia, serif" fontStyle="italic" fill="#e8efe9">
            <text x="14" y="40" fontSize="11">√2 = p / q ?</text>
            <text x="14" y="58" fontSize="9" opacity="0.85">2q² = p²</text>
            <text x="14" y="74" fontSize="9" opacity="0.85">p even, so q even</text>
            <text x="14" y="94" fontSize="9" opacity="0.85">contradiction ∎</text>
          </g>
          <line x1="14" y1="80" x2="70" y2="80" stroke="#e8efe9" strokeWidth="0.5" opacity="0.4" />
        </>
      )}
    </svg>
  );
}
