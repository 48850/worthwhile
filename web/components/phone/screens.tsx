// The screens inside the phone, as plain components. The scroll sequence
// wraps them in motion; the reduced-motion before/after uses them as they
// are. Sizes are in cqw (the phone's screen width), so they scale with it.
import type { ReactNode } from 'react';
import { Mark } from '@/components/brand/Mark';
import { GoodThumb } from '@/components/thumbs/GoodThumb';
import { ShortThumb } from '@/components/thumbs/ShortThumb';
import { SlopThumb } from '@/components/thumbs/SlopThumb';
import type { GoodItem, SlopItem } from '@/lib/content';
import type { ShortVariant } from '@/components/thumbs/ShortThumb';

export function StatusBar({ dim = false }: { dim?: boolean }) {
  return (
    <div className={`flex h-[12cqw] items-end justify-between px-[7cqw] pb-[1.5cqw] text-[3.6cqw] font-semibold ${dim ? 'text-white/70' : 'text-white'}`}>
      <span className="tabular-nums">9:41</span>
      <span className="flex items-center gap-[1.4cqw]">
        <span className="flex items-end gap-[0.5cqw]">
          {[1.4, 2, 2.6, 3.2].map((h) => (
            <span key={h} className="w-[0.8cqw] rounded-[0.2cqw] bg-current" style={{ height: `${h}cqw` }} />
          ))}
        </span>
        <span className="relative h-[3.2cqw] w-[6.4cqw] rounded-[1cqw] border border-current p-[0.4cqw] opacity-90">
          <span className="block h-full w-[70%] rounded-[0.5cqw] bg-current" />
        </span>
      </span>
    </div>
  );
}

/** The generic video app header and category chips of the "before" feed. No real app's logo or layout. */
export function FeedHeader() {
  return (
    <div className="px-[4cqw]">
      <div className="flex h-[11cqw] items-center justify-between">
        <span className="text-[5.6cqw] font-bold tracking-[-0.04em]">Home</span>
        <span className="flex items-center gap-[3cqw]">
          <span className="relative h-[4.6cqw] w-[4.6cqw] rounded-full border-[0.6cqw] border-white/90">
            <span className="absolute -bottom-[1.4cqw] -right-[1.4cqw] h-[0.6cqw] w-[2.2cqw] rotate-45 rounded bg-white/90" />
          </span>
          <span className="relative h-[5cqw] w-[4.6cqw] rounded-t-full border-[0.6cqw] border-white/90">
            <span className="absolute -right-[1.6cqw] -top-[1.4cqw] flex h-[3.4cqw] w-[3.4cqw] items-center justify-center rounded-full bg-[#ff2a2a] text-[2.2cqw] font-bold">9+</span>
          </span>
        </span>
      </div>
      <div className="flex gap-[2cqw] overflow-hidden pb-[3cqw]">
        {['All', 'Trending', 'Drama', 'Reacts', 'Gaming', 'Live'].map((chip, i) => (
          <span
            key={chip}
            className={`shrink-0 rounded-[2cqw] px-[3cqw] py-[1.4cqw] text-[3.2cqw] font-semibold ${i === 0 ? 'bg-white text-black' : 'bg-white/12 text-white'}`}
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One loud card. tagSlot: the "out of focus" tag the sequence brings in. */
export function SlopCard({ item, tagSlot }: { item: SlopItem; tagSlot?: ReactNode }) {
  return (
    <div className="pb-[4cqw]">
      <div className="relative mx-[3cqw] overflow-hidden rounded-[3cqw]">
        <SlopThumb variant={item.variant} className="block aspect-video w-full" />
        <span className="absolute bottom-[1.6cqw] right-[1.6cqw] rounded-[1cqw] bg-black/85 px-[1.4cqw] py-[0.4cqw] text-[2.6cqw] font-semibold tabular-nums">
          {['12:04', '23:51', '1:02:17', '18:40', '31:09', '14:22'][item.title.length % 6]}
        </span>
        {tagSlot}
      </div>
      <div className="mt-[2.4cqw] flex gap-[2.6cqw] px-[4cqw]">
        <span className="mt-[0.4cqw] h-[7.4cqw] w-[7.4cqw] shrink-0 rounded-full" style={{ background: item.avatar }} />
        <span className="min-w-0">
          <span className="line-clamp-2 text-[3.8cqw] font-bold leading-[1.22] tracking-[-0.01em]">{item.title}</span>
          <span className="mt-[0.6cqw] block truncate text-[3cqw] text-white/55">
            {item.channel} · {item.meta}
          </span>
        </span>
      </div>
    </div>
  );
}

/** The slate tag on a card: what kind of out of focus it is. */
export function OutOfFocusTag({ children }: { children: ReactNode }) {
  return (
    <span className="block rounded-full border border-slate/60 bg-ink/80 px-[2.4cqw] py-[0.7cqw] text-[2.7cqw] font-medium tracking-[0.02em] text-slate">
      {children}
    </span>
  );
}

/** Where a tag sits on a card's thumbnail. */
export const TAG_POSITION = 'absolute left-[2cqw] top-[2cqw]';

/** The calm, in-focus feed's header. */
export function FocusHeader() {
  return (
    <div className="flex h-[11cqw] items-center justify-between px-[5cqw]">
      <span className="flex items-center gap-[2cqw]">
        <Mark size={24} className="h-[6.4cqw] w-[6.4cqw] text-gold" />
        <span className="text-[4.4cqw] font-semibold tracking-[-0.03em]">In focus</span>
      </span>
      <span className="text-[3cqw] text-slate">for you</span>
    </div>
  );
}

/** One in-focus video, compact. ringSlot: the gold focus ring the sequence draws. */
export function GoodRow({ item, ringSlot }: { item: GoodItem; ringSlot?: ReactNode }) {
  return (
    <div className="flex gap-[3.4cqw] px-[4cqw] py-[2.4cqw]">
      <div className="relative w-[40cqw] shrink-0">
        <div className="overflow-hidden rounded-[2.4cqw]">
          <GoodThumb variant={item.variant} className="block aspect-video w-full" />
        </div>
        {ringSlot}
      </div>
      <div className="min-w-0 pt-[0.4cqw]">
        <div className="text-[2.6cqw] font-medium uppercase tracking-[0.12em] text-slate">{item.topic}</div>
        <div className="mt-[0.8cqw] line-clamp-2 text-[3.6cqw] font-semibold leading-[1.22] tracking-[-0.01em]">{item.title}</div>
        <div className="mt-[0.8cqw] truncate text-[2.8cqw] text-white/50">
          {item.channel} · {item.meta}
        </div>
      </div>
    </div>
  );
}

/** The thin gold ring an item gains when it comes into focus. */
export function FocusRing() {
  return <span className="pointer-events-none absolute -inset-[0.9cqw] rounded-[3.2cqw] border border-gold shadow-[0_0_4cqw_-1cqw_rgba(245,197,66,0.55)]" />;
}

/** A vertical Short, full screen. */
export function ShortFrame({ variant, caption, channel }: { variant: ShortVariant; caption: string; channel: string }) {
  return (
    <div className="relative h-full w-full">
      <ShortThumb variant={variant} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-x-0 bottom-0 h-[70cqw] bg-gradient-to-t from-black/80 to-transparent" />
      <div className="absolute bottom-[10cqw] left-[5cqw] right-[18cqw]">
        <div className="flex items-center gap-[2cqw] text-[3.4cqw] font-semibold">
          <span className="h-[6cqw] w-[6cqw] rounded-full bg-white/25" />@{channel.toLowerCase().replace(/\s+/g, '')}
        </div>
        <div className="mt-[2cqw] text-[3.8cqw] font-medium leading-[1.25]">{caption}</div>
      </div>
      <div className="absolute bottom-[12cqw] right-[4cqw] flex flex-col items-center gap-[5cqw]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-[8.5cqw] w-[8.5cqw] rounded-full bg-white/20" />
        ))}
      </div>
    </div>
  );
}

/** Camera focus brackets: four gold corners. */
export function FocusBrackets() {
  const corner = 'absolute h-[9cqw] w-[9cqw] border-gold';
  return (
    <span className="pointer-events-none absolute inset-[7cqw]">
      <span className={`${corner} left-0 top-0 border-l border-t`} />
      <span className={`${corner} right-0 top-0 border-r border-t`} />
      <span className={`${corner} bottom-0 left-0 border-b border-l`} />
      <span className={`${corner} bottom-0 right-0 border-b border-r`} />
    </span>
  );
}

export function InterviewHeader() {
  return (
    <div className="flex h-[12cqw] items-center gap-[2.4cqw] border-b border-line px-[5cqw]">
      <Mark size={24} className="h-[7cqw] w-[7cqw] text-white" />
      <div>
        <div className="text-[3.8cqw] font-semibold tracking-[-0.02em]">Taste interview</div>
        <div className="text-[2.8cqw] text-slate">Question 3 of 7</div>
      </div>
    </div>
  );
}

export function Bubble({ from, children }: { from: 'worthwhile' | 'you'; children: ReactNode }) {
  const mine = from === 'you';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78cqw] rounded-[4.4cqw] px-[4cqw] py-[3cqw] text-[3.7cqw] leading-[1.35] ${
          mine ? 'rounded-br-[1.2cqw] bg-white text-ink' : 'rounded-bl-[1.2cqw] border border-line bg-ink-raised text-white'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** The session receipt. The numbers can be passed in as live nodes (they count up in the sequence). */
export function ReceiptCard({ inFocus, outOfFocus, shorts, when }: { inFocus: ReactNode; outOfFocus: ReactNode; shorts: ReactNode; when: string }) {
  return (
    <div className="rounded-[5cqw] border border-line bg-[#0e0e10] p-[5cqw] shadow-[0_-10cqw_20cqw_-6cqw_rgba(0,0,0,0.9)]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-[2cqw]">
          <Mark size={20} className="h-[6cqw] w-[6cqw]" />
          <span className="text-[3.6cqw] font-semibold tracking-[-0.02em]">Session receipt</span>
        </span>
        <span className="font-mono text-[2.8cqw] text-slate">{when}</span>
      </div>
      <div className="mt-[5cqw] grid grid-cols-2 gap-[3cqw]">
        <div>
          <div className="font-mono text-[12cqw] font-medium leading-none tracking-[-0.04em] text-gold tabular-nums">{inFocus}</div>
          <div className="mt-[1.4cqw] text-[3cqw] text-white/80">in focus</div>
        </div>
        <div>
          <div className="font-mono text-[12cqw] font-medium leading-none tracking-[-0.04em] text-slate tabular-nums">{outOfFocus}</div>
          <div className="mt-[1.4cqw] text-[3cqw] text-slate">out of focus</div>
        </div>
      </div>
      <div className="my-[4cqw] border-t border-dashed border-line" />
      <div className="flex justify-between text-[3cqw]">
        <span className="text-white/70">Shorts that made the cut</span>
        <span className="font-mono tabular-nums">{shorts}</span>
      </div>
      <div className="mt-[4cqw] font-mono text-[2.6cqw] tracking-[0.02em] text-slate">
        In focus: 14 · Out of focus: 218
      </div>
    </div>
  );
}
