// A phone, drawn in CSS: a thin dark bezel, a soft edge highlight, and a
// screen that is a size container, so everything inside is sized in cqw
// (a percentage of the screen's width) and scales with the phone.
import type { CSSProperties, ReactNode } from 'react';

export function Phone({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`relative aspect-[390/844] rounded-[15%/7%] bg-[#101012] p-[2.4%] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.07),inset_0_0_0_1px_rgba(255,255,255,0.04)] ${className}`}
      style={style}
    >
      <div className="@container relative h-full w-full overflow-hidden rounded-[12.5%/5.8%] bg-ink">
        {children}
        {/* The camera cut-out. */}
        <div className="pointer-events-none absolute left-1/2 top-[1.6cqw] z-30 h-[7.5cqw] w-[27cqw] -translate-x-1/2 rounded-full bg-black" />
      </div>
    </div>
  );
}
