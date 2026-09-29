// The worthwhile mark: a lowercase "w" inside a thin camera focus ring.
// The ring carries a focus scale: fine ticks, with longer ones at the
// quarters, like the distance marks on a lens barrel.

type MarkProps = {
  size?: number;
  /** Colour of the ring and ticks. */
  ring?: string;
  /** Colour of the "w". */
  glyph?: string;
  className?: string;
  title?: string;
};

const TICKS = Array.from({ length: 36 }, (_, i) => i * 10);

export function Mark({ size = 28, ring = 'currentColor', glyph = 'currentColor', className, title = 'worthwhile' }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label={title} className={className}>
      <circle cx="24" cy="24" r="21.5" stroke={ring} strokeWidth="1" />
      {TICKS.map((deg) => {
        const long = deg % 90 === 0;
        const r1 = 21.5;
        const r2 = long ? 18.6 : 19.9;
        const a = ((deg - 90) * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={24 + r1 * Math.cos(a)}
            y1={24 + r1 * Math.sin(a)}
            x2={24 + r2 * Math.cos(a)}
            y2={24 + r2 * Math.sin(a)}
            stroke={ring}
            strokeWidth={long ? 1 : 0.6}
            strokeOpacity={long ? 1 : 0.55}
          />
        );
      })}
      {/* The "w": four strokes, geometric, round joins. */}
      <path d="M14.5 19.5 L19.2 30 L24 21.6 L28.8 30 L33.5 19.5" stroke={glyph} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The mark and the name, always lowercase. */
export function Wordmark({ className = '', size = 26 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">worthwhile</span>
    </span>
  );
}
