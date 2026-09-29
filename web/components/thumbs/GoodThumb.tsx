// Invented thumbnails for what's worth it: quiet, designed, one idea each.
// Geometric SVG only.
import { useId } from 'react';

export type GoodVariant = 'chess' | 'maths' | 'science' | 'theatre' | 'literature';

export function GoodThumb({ variant, className = '' }: { variant: GoodVariant; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 160 90" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {variant === 'chess' && (
        <>
          <rect width="160" height="90" fill="#16140f" />
          {Array.from({ length: 6 * 4 }, (_, i) => {
            const c = i % 6;
            const r = Math.floor(i / 6);
            return <rect key={i} x={52 + c * 18} y={18 + r * 18} width="18" height="18" fill={(c + r) % 2 ? '#3a3325' : '#cbbd9c'} opacity={0.9 - r * 0.12} />;
          })}
          {/* A knight, drawn as a silhouette. */}
          <path d="M92 70 H112 V66 H108 C108 58 112 54 110 46 C108 40 102 36 95 37 L92 34 L90 38 C86 40 84 44 85 48 L90 50 C92 49 94 49 95 51 C92 55 90 60 92 66 H92 Z" fill="#f4f1ea" stroke="#16140f" strokeWidth="1" />
          <rect x="12" y="18" width="30" height="2" fill="#cbbd9c" opacity="0.5" />
          <rect x="12" y="24" width="22" height="2" fill="#cbbd9c" opacity="0.3" />
        </>
      )}
      {variant === 'maths' && (
        <>
          <rect width="160" height="90" fill="#0e1417" />
          {Array.from({ length: 9 }, (_, i) => (
            <line key={`v${i}`} x1={i * 20} y1="0" x2={i * 20} y2="90" stroke="#1e2a30" strokeWidth="0.6" />
          ))}
          {Array.from({ length: 5 }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={i * 20 + 5} x2="160" y2={i * 20 + 5} stroke="#1e2a30" strokeWidth="0.6" />
          ))}
          <path d={Array.from({ length: 61 }, (_, i) => `${i ? 'L' : 'M'}${10 + i * 2.35} ${72 - Math.log(1 + i * 0.9) * 13}`).join(' ')} stroke="#e8eef0" strokeWidth="1.6" fill="none" />
          {[4, 12, 24, 40, 58].map((i) => (
            <circle key={i} cx={10 + i * 2.35} cy={72 - Math.log(1 + i * 0.9) * 13} r="1.8" fill="#e8eef0" />
          ))}
          <text x="116" y="30" fontSize="16" fill="#9fb3bb" fontFamily="Georgia, serif" fontStyle="italic">Σ 1/n</text>
        </>
      )}
      {variant === 'science' && (
        <>
          <defs>
            <radialGradient id={`${id}s`} cx="50%" cy="50%" r="60%">
              <stop offset="0" stopColor="#132046" />
              <stop offset="1" stopColor="#070a15" />
            </radialGradient>
          </defs>
          <rect width="160" height="90" fill={`url(#${id}s)`} />
          {[
            [18, 14], [140, 20], [30, 74], [124, 78], [70, 10], [150, 60], [8, 48],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="0.8" fill="#c9d6ff" opacity="0.7" />
          ))}
          <ellipse cx="80" cy="45" rx="46" ry="16" fill="none" stroke="#8ea6ff" strokeWidth="0.9" opacity="0.8" />
          <ellipse cx="80" cy="45" rx="46" ry="16" fill="none" stroke="#8ea6ff" strokeWidth="0.9" opacity="0.8" transform="rotate(60 80 45)" />
          <ellipse cx="80" cy="45" rx="46" ry="16" fill="none" stroke="#8ea6ff" strokeWidth="0.9" opacity="0.8" transform="rotate(-60 80 45)" />
          <circle cx="80" cy="45" r="5" fill="#e6ecff" />
          <circle cx="124" cy="41" r="2" fill="#e6ecff" />
        </>
      )}
      {variant === 'theatre' && (
        <>
          <defs>
            <linearGradient id={`${id}t`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#fff4d6" stopOpacity="0.55" />
              <stop offset="1" stopColor="#fff4d6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width="160" height="90" fill="#0b0909" />
          <path d="M80 0 L56 78 H104 Z" fill={`url(#${id}t)`} />
          <ellipse cx="80" cy="79" rx="26" ry="4" fill="#fff4d6" opacity="0.35" />
          <path d="M0 0 H44 C40 30 46 60 36 90 H0 Z" fill="#4a1414" />
          <path d="M160 0 H116 C120 30 114 60 124 90 H160 Z" fill="#4a1414" />
          <path d="M0 0 H160 V10 C120 16 40 16 0 10 Z" fill="#5c1a1a" />
          <rect x="76" y="58" width="8" height="20" rx="3" fill="#e9dcc0" />
          <circle cx="80" cy="54" r="4" fill="#e9dcc0" />
        </>
      )}
      {variant === 'literature' && (
        <>
          <rect width="160" height="90" fill="#1a150f" />
          <path d="M80 18 C62 12 40 12 24 18 V78 C40 72 62 72 80 78 Z" fill="#e9dfcb" />
          <path d="M80 18 C98 12 120 12 136 18 V78 C120 72 98 72 80 78 Z" fill="#f2eadb" />
          {Array.from({ length: 8 }, (_, i) => (
            <line key={`l${i}`} x1="32" y1={26 + i * 6} x2={i === 7 ? 58 : 72} y2={25 + i * 6} stroke="#8b7a5c" strokeWidth="0.9" opacity="0.8" />
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <line key={`r${i}`} x1="88" y1={25 + i * 6} x2={i === 3 ? 110 : 128} y2={26 + i * 6} stroke="#8b7a5c" strokeWidth="0.9" opacity="0.8" />
          ))}
          <line x1="80" y1="18" x2="80" y2="78" stroke="#b9a988" strokeWidth="0.8" />
        </>
      )}
    </svg>
  );
}
