// Invented, deliberately garish thumbnails for the "before" feed: loud
// colour, bursts, arrows and shouting type. All drawn in SVG; no photos,
// no faces, nothing from any real channel.
import { useId } from 'react';

export type SlopVariant = 'box' | 'furious' | 'reaction' | 'top10' | 'drama' | 'recycled';

const shout = {
  fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
  fontWeight: 900,
  letterSpacing: '-0.03em',
  paintOrder: 'stroke' as const,
};

export function SlopThumb({ variant, className = '' }: { variant: SlopVariant; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 160 90" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {variant === 'box' && (
        <>
          <defs>
            <radialGradient id={`${id}b`} cx="70%" cy="45%" r="75%">
              <stop offset="0" stopColor="#fff36b" />
              <stop offset="0.55" stopColor="#ffb800" />
              <stop offset="1" stopColor="#ff5a00" />
            </radialGradient>
          </defs>
          <rect width="160" height="90" fill={`url(#${id}b)`} />
          {Array.from({ length: 14 }, (_, i) => (
            <path key={i} d={`M112 40 L${112 + 120 * Math.cos((i / 14) * 6.283)} ${40 + 120 * Math.sin((i / 14) * 6.283)} L${112 + 120 * Math.cos(((i + 0.45) / 14) * 6.283)} ${40 + 120 * Math.sin(((i + 0.45) / 14) * 6.283)} Z`} fill="#fff" opacity="0.28" />
          ))}
          <rect x="92" y="30" width="40" height="34" rx="2" fill="#a0612b" stroke="#3b1f06" strokeWidth="2.5" />
          <path d="M92 38 H132 M112 30 V64" stroke="#3b1f06" strokeWidth="1.6" />
          <text x="8" y="44" fontSize="30" fill="#fff" stroke="#111" strokeWidth="5" style={shout}>7 DAYS</text>
          <text x="9" y="70" fontSize="15" fill="#ff1f1f" stroke="#fff" strokeWidth="3.5" style={shout}>GONE WRONG</text>
          <path d="M70 76 C80 66 84 58 88 50" stroke="#ff1f1f" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M80 48 L90 47 L88 57 Z" fill="#ff1f1f" />
        </>
      )}
      {variant === 'furious' && (
        <>
          <rect width="160" height="90" fill="#0d0d0d" />
          <path d="M0 0 H104 L66 90 H0 Z" fill="#e10613" />
          <path d="M112 8 L96 44 H110 L94 84 L132 36 H116 L128 8 Z" fill="#ffe600" stroke="#111" strokeWidth="2" />
          <text x="8" y="52" fontSize="36" fill="#fff" stroke="#111" strokeWidth="5" style={shout}>WHY?!</text>
          <rect x="8" y="62" width="62" height="14" fill="#111" />
          <text x="12" y="73" fontSize="10" fill="#ffe600" style={shout}>EVERYONE IS MAD</text>
        </>
      )}
      {variant === 'reaction' && (
        <>
          <defs>
            <linearGradient id={`${id}r`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#ff2bd6" />
              <stop offset="1" stopColor="#1ee3ff" />
            </linearGradient>
          </defs>
          <rect width="160" height="90" fill={`url(#${id}r)`} />
          <rect x="72" y="10" width="80" height="46" rx="3" fill="#1a1a1a" stroke="#fff" strokeWidth="2.5" />
          <path d="M104 24 L118 33 L104 42 Z" fill="#fff" />
          <circle cx="36" cy="46" r="26" fill="#ffe14d" stroke="#111" strokeWidth="3" />
          <circle cx="28" cy="40" r="4.5" fill="#111" />
          <circle cx="44" cy="40" r="4.5" fill="#111" />
          <ellipse cx="36" cy="56" rx="7" ry="9" fill="#111" />
          <text x="76" y="80" fontSize="17" fill="#fff" stroke="#111" strokeWidth="4" style={shout}>I CAN&apos;T</text>
        </>
      )}
      {variant === 'top10' && (
        <>
          <rect width="160" height="90" fill="#12ff6a" />
          <path d="M0 90 L160 38 V90 Z" fill="#00c24a" />
          <circle cx="126" cy="44" r="26" fill="#111" />
          <text x="112" y="54" fontSize="26" fill="#12ff6a" style={shout}>#1</text>
          <text x="8" y="40" fontSize="30" fill="#fff" stroke="#111" strokeWidth="5" style={shout}>TOP 10</text>
          <text x="9" y="66" fontSize="13" fill="#111" style={shout}>BROKE THE</text>
          <text x="9" y="81" fontSize="13" fill="#111" style={shout}>INTERNET</text>
        </>
      )}
      {variant === 'drama' && (
        <>
          <rect width="160" height="90" fill="#3a0a5c" />
          <path d="M0 58 L22 50 L40 60 L63 48 L84 58 L104 46 L126 57 L160 44 V90 H0 Z" fill="#f1e6ff" />
          <circle cx="130" cy="22" r="28" fill="#8a1cff" opacity="0.55" />
          <g transform="rotate(-12 60 40)">
            <rect x="12" y="20" width="96" height="30" rx="3" fill="none" stroke="#ff2a2a" strokeWidth="3" />
            <text x="18" y="44" fontSize="22" fill="#ff2a2a" style={shout}>EXPOSED</text>
          </g>
          <text x="10" y="80" fontSize="11" fill="#3a0a5c" style={shout}>THE FULL STORY (PART 3)</text>
        </>
      )}
      {variant === 'recycled' && (
        <>
          <rect width="160" height="90" fill="#ff7b00" />
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x={6 + (i % 4) * 38} y={6 + Math.floor(i / 4) * 20} width="34" height="16" rx="1.5" fill={['#ff2e63', '#08d9d6', '#ffe600', '#7d2cff'][i % 4]} stroke="#111" strokeWidth="1.2" />
          ))}
          <rect x="0" y="66" width="160" height="24" fill="#111" />
          <text x="8" y="84" fontSize="15" fill="#fff" style={shout}>BEST MOMENTS pt.47</text>
        </>
      )}
    </svg>
  );
}
