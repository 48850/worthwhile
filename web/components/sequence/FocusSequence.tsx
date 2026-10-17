'use client';

// The signature scroll sequence. A phone stays pinned in the middle of the
// screen while scroll progress drives what's inside it and the headline
// beside it:
//   1. "This is your feed."      a loud, cluttered feed
//   2. tags land on the loud items: ragebait, reaction, recycled, drama
//   3. "Now, with worthwhile."   the whole phone blurs: the camera pulls focus
//   4. slop stays soft and collapses away; chess, maths, science, theatre
//      and literature sharpen one by one, each gaining a thin gold ring
//   5. "Shorts included."        blurred Shorts flick past, it settles on a sharp one
//   6. the taste interview, three bubbles
//   7. a receipt rises: In focus: 14 · Out of focus: 218
//   8. the calls to action
//
// Performance: everything animates transform and opacity, except blur,
// which is animated on a few large layers only (the phone during the focus
// pull, the loud feed, the Shorts reel) and on each in-focus item while it
// sharpens. Pacing lives in timeline.ts.

import { useRef, type ReactNode } from 'react';
import { domAnimation, LazyMotion, m, useMotionTemplate, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { Phone } from '@/components/phone/Phone';
import {
  Bubble,
  FeedHeader,
  FocusBrackets,
  FocusHeader,
  FocusRing,
  GoodRow,
  InterviewHeader,
  OutOfFocusTag,
  ReceiptCard,
  ShortFrame,
  SlopCard,
  StatusBar,
  TAG_POSITION,
} from '@/components/phone/screens';
import { CtaButtons } from '@/components/site/CtaButtons';
import { GOOD, INTERVIEW, RECEIPT, SHORTS, SLOP } from '@/lib/content';
import { HEADLINE_WINDOWS, RAIL, T } from './timeline';

type P = MotionValue<number>;

const HEADLINES: { title: ReactNode; sub?: string; cta?: boolean }[] = [
  { title: 'This is your feed.', sub: 'Loud thumbnails, louder titles, and somewhere underneath, the few videos you actually came for.' },
  { title: 'Some of it was made to be clicked, not watched.', sub: 'Ragebait. Reactions. Recycled clips. Drama. You know it on sight.' },
  { title: <>Now, with <span className="text-white">worthwhile</span>.</>, sub: 'Your taste, applied to every feed.' },
  { title: <>What’s worth it comes into <span className="text-gold">focus</span>.</>, sub: 'Chess, maths, science, theatre, literature: whatever you care about stays sharp. The rest softens and falls away.' },
  { title: 'Shorts included.', sub: 'The endless swipe, filtered before it reaches you.' },
  { title: 'It starts with a conversation about your taste.', sub: 'A few good questions. It pushes back, gently, when your answers don’t add up.' },
  { title: 'Every session ends with a receipt.', sub: 'What made the cut, and what didn’t. A clear picture, nothing more.' },
  { title: 'Scroll like it’s worth it.', cta: true },
];

export function FocusSequence() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  return (
    <LazyMotion features={domAnimation} strict>
      <section ref={ref} aria-label="How worthwhile works" className="relative h-[700svh] motion-reduce:hidden lg:h-[1000vh]">
        <div className="sticky top-0 h-svh overflow-hidden">
          {/* A faint pool of light behind the phone. */}
          <div className="pointer-events-none absolute left-1/2 top-[62%] h-[90svh] w-[90svh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.055),transparent)] lg:top-1/2" />
          <Headlines p={p} />
          <PhoneStage p={p} />
          <Rail p={p} />
          <ScrollCue p={p} />
        </div>
      </section>
    </LazyMotion>
  );
}

// ---------------------------------------------------------------------------
// Headlines: stacked, one in focus at a time (a small focus pull between them)
// ---------------------------------------------------------------------------

function Headlines({ p }: { p: P }) {
  return (
    <div className="absolute inset-x-5 top-[calc(4.25rem+2svh)] h-[25svh] text-center lg:inset-x-auto lg:left-[6vw] lg:top-1/2 lg:h-auto lg:w-[min(34vw,520px)] lg:-translate-y-1/2 lg:text-left">
      {HEADLINES.map((h, i) => (
        <Headline key={i} p={p} window={HEADLINE_WINDOWS[i]} first={i === 0} {...h} />
      ))}
    </div>
  );
}

function Headline({ p, window: [a, b, c, d], title, sub, cta, first }: { p: P; window: [number, number, number, number]; title: ReactNode; sub?: string; cta?: boolean; first?: boolean }) {
  const opacity = useTransform(p, [a, b, c, d], [0, 1, 1, 0]);
  const y = useTransform(p, [a, b, c, d], [14, 0, 0, -14]);
  const blurPx = useTransform(p, [a, b, c, d], [6, 0, 0, 6]);
  const filter = useMotionTemplate`blur(${blurPx}px)`;
  const pointerEvents = useTransform(opacity, (o) => (o > 0.6 ? 'auto' : 'none'));
  const Tag = first ? 'h1' : 'h2';
  return (
    <m.div style={{ opacity, y, filter, pointerEvents }} className="absolute inset-x-0 top-0 lg:top-1/2 lg:-translate-y-1/2">
      <Tag className="display text-balance text-[clamp(1.9rem,7.6vw,3.1rem)] text-white lg:text-[clamp(2.6rem,4.4vw,4.9rem)]">
        {title}
      </Tag>
      {sub && <p className="mx-auto mt-3 max-w-[34ch] text-pretty text-[15px] leading-relaxed text-slate lg:mx-0 lg:mt-6 lg:text-[17px]">{sub}</p>}
      {cta && <CtaButtons className="mt-5 justify-center lg:mt-8 lg:justify-start" />}
    </m.div>
  );
}

// ---------------------------------------------------------------------------
// The phone and its layers
// ---------------------------------------------------------------------------

function PhoneStage({ p }: { p: P }) {
  // The focus pull: the whole phone blurs, then the frame refocuses.
  const pullPx = useTransform(p, [T.pull[0], T.pull[1], T.pull[2]], [0, 7, 0]);
  const filter = useMotionTemplate`blur(${pullPx}px)`;
  // Lens breathing during the pull, and a step back for the calls to action.
  const scale = useTransform(p, [T.pull[0], T.pull[1], T.pull[2], T.cta[0], T.cta[1]], [1, 1.025, 1, 1, 0.92]);
  const y = useTransform(p, [T.cta[0], T.cta[1]], ['0%', '5%']);

  return (
    <div className="absolute inset-x-0 bottom-[3svh] top-[calc(4.25rem+29svh)] flex items-center justify-center lg:inset-y-0">
      <m.div style={{ filter, scale, y, willChange: 'transform, filter' }} className="h-full lg:h-[min(84svh,780px)]">
        <Phone className="h-full">
          <SlopLayer p={p} />
          <GoodLayer p={p} />
          <ShortsLayer p={p} />
          <InterviewLayer p={p} />
          <ReceiptLayer p={p} />
        </Phone>
      </m.div>
    </div>
  );
}

/** 1-4: the loud feed. It scrolls a little, gets tagged, goes soft, and collapses away. */
function SlopLayer({ p }: { p: P }) {
  const blurPx = useTransform(p, T.slopBlur, [0, 12]);
  const filter = useMotionTemplate`blur(${blurPx}px)`;
  const opacity = useTransform(p, [T.goodIn[0], T.goodIn[1], T.slopOut[1] - 0.04], [1, 0.6, 0]);
  const listY = useTransform(p, [0.02, 0.19], ['0%', '-23%']);
  // "Collapses away": the soft feed folds up towards the top.
  const listScaleY = useTransform(p, T.slopOut, [1, 0.25]);
  return (
    <m.div style={{ filter, opacity, willChange: 'filter, opacity' }} className="absolute inset-0 bg-ink">
      <StatusBar />
      <FeedHeader />
      <m.div style={{ y: listY, scaleY: listScaleY, transformOrigin: 'top' }}>
        {SLOP.map((item, i) => (
          <SlopCard key={item.title} item={item} tagSlot={<SlopTag p={p} i={i}>{item.tag}</SlopTag>} />
        ))}
      </m.div>
    </m.div>
  );
}

function SlopTag({ p, i, children }: { p: P; i: number; children: ReactNode }) {
  const step = (T.tags[1] - T.tags[0]) / 4;
  const start = T.tags[0] + Math.min(i, 3) * step;
  const opacity = useTransform(p, [start, start + step * 0.8], [0, 1]);
  const x = useTransform(p, [start, start + step * 0.8], [-6, 0]);
  return (
    <m.span style={{ opacity, x }} className={TAG_POSITION}>
      <OutOfFocusTag>{children}</OutOfFocusTag>
    </m.span>
  );
}

/** 3-4: what's worth it, soft at first, then sharpening one by one. */
function GoodLayer({ p }: { p: P }) {
  const opacity = useTransform(p, [T.goodIn[0], T.goodIn[1], T.feedOut[0], T.feedOut[1]], [0, 1, 1, 0]);
  const headerOpacity = useTransform(p, [T.sharpen[0], T.sharpen[0] + 0.03], [0, 1]);
  return (
    <m.div style={{ opacity }} className="absolute inset-0">
      <StatusBar />
      <m.div style={{ opacity: headerOpacity }}>
        <FocusHeader />
      </m.div>
      <div className="mt-[3cqw]">
        {GOOD.map((item, i) => (
          <GoodItem key={item.title} p={p} i={i} item={item} />
        ))}
      </div>
    </m.div>
  );
}

function GoodItem({ p, i, item }: { p: P; i: number; item: (typeof GOOD)[number] }) {
  const step = (T.sharpen[1] - T.sharpen[0]) / GOOD.length;
  const start = T.sharpen[0] + i * step;
  const end = start + step * 0.9;
  const blurPx = useTransform(p, [start, end], [10, 0]);
  const filter = useMotionTemplate`blur(${blurPx}px)`;
  const opacity = useTransform(p, [start, end], [0.45, 1]);
  const ringOpacity = useTransform(p, [end - step * 0.25, end + step * 0.1], [0, 1]);
  const ringScale = useTransform(p, [end - step * 0.25, end + step * 0.1], [1.06, 1]);
  return (
    <m.div style={{ filter, opacity, willChange: 'filter, opacity' }}>
      <GoodRow
        item={item}
        ringSlot={
          <m.span style={{ opacity: ringOpacity, scale: ringScale }} className="pointer-events-none absolute inset-0">
            <FocusRing />
          </m.span>
        }
      />
    </m.div>
  );
}

/** 5: Shorts. Soft ones flick past, then it settles on a sharp one. */
function ShortsLayer({ p }: { p: P }) {
  const opacity = useTransform(p, [T.shortsIn[0], T.shortsIn[1], T.shortsOut[0], T.shortsOut[1]], [0, 1, 1, 0]);
  const scale = useTransform(p, [T.shortsIn[0], T.shortsIn[1]], [1.04, 1]);
  // Flicks: hold, then a quick swipe to the next, four times.
  const [f0, f1] = T.flick;
  const step = (f1 - f0) / 4;
  const stops: number[] = [f0];
  const ys: string[] = ['0%'];
  for (let k = 1; k <= 4; k++) {
    stops.push(f0 + step * k - step * 0.45, f0 + step * k);
    ys.push(`${-(k - 1) * 20}%`, `${-k * 20}%`);
  }
  const reelY = useTransform(p, stops, ys);
  const reelBlurPx = useTransform(p, [T.shortsIn[1], T.flick[0] + 0.005, T.settle[0], T.settle[1]], [0, 7, 7, 0]);
  const reelFilter = useMotionTemplate`blur(${reelBlurPx}px)`;
  const focusOpacity = useTransform(p, [T.settle[0] + 0.015, T.settle[1]], [0, 1]);
  const focusScale = useTransform(p, [T.settle[0] + 0.015, T.settle[1]], [1.08, 1]);

  return (
    <m.div style={{ opacity, scale }} className="absolute inset-0 bg-black">
      <m.div style={{ y: reelY, filter: reelFilter, willChange: 'transform, filter' }} className="absolute inset-x-0 top-0 h-[500%]">
        {SHORTS.map((s) => (
          <div key={s.caption} className="h-[20%]">
            <ShortFrame {...s} />
          </div>
        ))}
      </m.div>
      <div className="absolute inset-x-0 top-0 z-10">
        <StatusBar />
      </div>
      <m.div style={{ opacity: focusOpacity, scale: focusScale }} className="absolute inset-0 z-10">
        <FocusBrackets />
        <span className="absolute left-1/2 top-[14cqw] -translate-x-1/2 rounded-full border border-gold/60 bg-black/60 px-[3cqw] py-[1cqw] text-[3cqw] font-medium text-gold">
          in focus
        </span>
      </m.div>
    </m.div>
  );
}

/** 6: the taste interview. */
function InterviewLayer({ p }: { p: P }) {
  const opacity = useTransform(p, [T.chatIn[0], T.chatIn[1], T.receipt[0], T.receipt[1]], [0, 1, 1, 0.35]);
  return (
    <m.div style={{ opacity }} className="absolute inset-0 bg-ink">
      <StatusBar />
      <InterviewHeader />
      <div className="flex flex-col gap-[3cqw] px-[4cqw] pt-[6cqw]">
        {INTERVIEW.map((line, i) => (
          <InterviewBubble key={i} p={p} i={i} from={line.from}>
            {line.text}
          </InterviewBubble>
        ))}
      </div>
    </m.div>
  );
}

function InterviewBubble({ p, i, from, children }: { p: P; i: number; from: 'worthwhile' | 'you'; children: ReactNode }) {
  const step = (T.bubbles[1] - T.bubbles[0]) / INTERVIEW.length;
  const start = T.bubbles[0] + i * step;
  const opacity = useTransform(p, [start, start + step * 0.7], [0, 1]);
  const y = useTransform(p, [start, start + step * 0.7], [12, 0]);
  return (
    <m.div style={{ opacity, y }}>
      <Bubble from={from}>{children}</Bubble>
    </m.div>
  );
}

/** 7: the receipt rises, and its numbers count up. */
function ReceiptLayer({ p }: { p: P }) {
  const y = useTransform(p, T.receipt, ['115%', '0%']);
  const opacity = useTransform(p, [T.receipt[0], T.receipt[0] + 0.02], [0, 1]);
  const inFocus = useTransform(p, T.count, [0, RECEIPT.inFocus], { clamp: true });
  const outOfFocus = useTransform(p, T.count, [0, RECEIPT.outOfFocus], { clamp: true });
  const shorts = useTransform(p, T.count, [0, RECEIPT.shorts], { clamp: true });
  const round = (v: MotionValue<number>) => <Count value={v} />;
  return (
    <m.div style={{ y, opacity }} className="absolute inset-x-[4cqw] bottom-[6cqw]">
      <ReceiptCard inFocus={round(inFocus)} outOfFocus={round(outOfFocus)} shorts={round(shorts)} when={RECEIPT.when} />
    </m.div>
  );
}

function Count({ value }: { value: MotionValue<number> }) {
  const rounded = useTransform(value, (v) => Math.round(v));
  return <m.span>{rounded}</m.span>;
}

// ---------------------------------------------------------------------------
// Beside the phone: a lens focus scale (large screens) and a scroll cue
// ---------------------------------------------------------------------------

function Rail({ p }: { p: P }) {
  const markerY = useTransform(p, [0, 1], ['0%', '100%']);
  return (
    <div className="pointer-events-none absolute right-[5vw] top-1/2 hidden h-[44svh] -translate-y-1/2 lg:block" aria-hidden="true">
      <div className="relative h-full w-px bg-line">
        {RAIL.map((label, i) => (
          <RailTick key={label} p={p} i={i} label={label} />
        ))}
        <m.div style={{ top: markerY }} className="absolute -left-[5px] h-px w-[11px] -translate-y-1/2 bg-gold shadow-[0_0_10px_rgba(245,197,66,0.8)]" />
      </div>
    </div>
  );
}

function RailTick({ p, i, label }: { p: P; i: number; label: string }) {
  const at = i / (RAIL.length - 1);
  const [a, b, c, d] = HEADLINE_WINDOWS[i];
  const active = useTransform(p, [a, b, c, d], [0, 1, 1, 0]);
  const color = useTransform(active, [0, 1], ['#7c818b', '#ffffff']);
  const opacity = useTransform(active, [0, 1], [0.55, 1]);
  return (
    <div className="absolute right-0 flex -translate-y-1/2 items-center gap-3" style={{ top: `${at * 100}%` }}>
      <m.span style={{ color, opacity }} className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em]">
        {label}
      </m.span>
      <span className="h-px w-2 bg-slate/60" />
    </div>
  );
}

function ScrollCue({ p }: { p: P }) {
  const opacity = useTransform(p, [0, 0.03], [1, 0]);
  return (
    <m.div style={{ opacity }} className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-3 text-[12px] uppercase tracking-[0.18em] text-slate lg:flex">
      <span className="relative h-7 w-4 rounded-full border border-slate/60">
        <span className="absolute left-1/2 top-1.5 h-1.5 w-px -translate-x-1/2 animate-pulse bg-white" />
      </span>
      Scroll to pull focus
    </m.div>
  );
}
