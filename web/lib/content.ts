// Everything shown inside the phone. All invented: titles, channels,
// numbers. No real creators, no real channels.
import type { GoodVariant } from '@/components/thumbs/GoodThumb';
import type { ShortVariant } from '@/components/thumbs/ShortThumb';
import type { SlopVariant } from '@/components/thumbs/SlopThumb';

export type SlopItem = { variant: SlopVariant; title: string; channel: string; meta: string; tag: string; avatar: string };
export type GoodItem = { variant: GoodVariant; title: string; channel: string; meta: string; topic: string; avatar: string };

// The feed as it arrives: loud, and mostly not for you.
export const SLOP: SlopItem[] = [
  { variant: 'furious', title: 'Why Everyone Is FURIOUS About This', channel: 'SpillHQ', meta: '4.1M views · 3 hours ago', tag: 'ragebait', avatar: '#e10613' },
  { variant: 'reaction', title: 'Reacting To The WORST Takes Of The Year', channel: 'ReactReel', meta: '2.8M views · 1 day ago', tag: 'reaction', avatar: '#ff2bd6' },
  { variant: 'recycled', title: 'Best Moments Compilation pt. 47', channel: 'ClipCrate', meta: '906K views · 6 hours ago', tag: 'recycled', avatar: '#ff7b00' },
  { variant: 'drama', title: 'She Finally EXPOSED Everything (full story)', channel: 'TeaRoom Live', meta: '3.3M views · 11 hours ago', tag: 'drama', avatar: '#8a1cff' },
  { variant: 'box', title: 'I Lived In A Box For 7 Days (GONE WRONG)', channel: 'OMGzone', meta: '12M views · 2 days ago', tag: 'ragebait', avatar: '#ffb800' },
  { variant: 'top10', title: 'TOP 10 Moments That BROKE The Internet', channel: 'TenTopTen', meta: '7.7M views · 4 days ago', tag: 'recycled', avatar: '#12ff6a' },
];

// What comes into focus.
export const GOOD: GoodItem[] = [
  { variant: 'chess', title: 'The endgame that took ninety years to solve', channel: 'Endgame Room', meta: '41 min · 3 weeks ago', topic: 'chess', avatar: '#cbbd9c' },
  { variant: 'maths', title: 'Why the harmonic series never stops growing', channel: 'Quiet Proofs', meta: '18 min · 1 month ago', topic: 'maths', avatar: '#9fb3bb' },
  { variant: 'science', title: 'What a single photon actually does', channel: 'Night Physics', meta: '26 min · 2 weeks ago', topic: 'science', avatar: '#8ea6ff' },
  { variant: 'theatre', title: 'Staging a whole play in one room', channel: 'Second Row', meta: '33 min · 5 days ago', topic: 'theatre', avatar: '#b86a5a' },
  { variant: 'literature', title: 'Reading a long novel slowly, on purpose', channel: 'Marginalia', meta: '22 min · 1 week ago', topic: 'literature', avatar: '#d8c9a8' },
];

// Shorts: four flick past, one is worth stopping for.
export const SHORTS: { variant: ShortVariant; caption: string; channel: string }[] = [
  { variant: 'wait', caption: 'wait for it…', channel: 'loopz' },
  { variant: 'pov', caption: 'POV: you opened the app again', channel: 'scrollcore' },
  { variant: 'prank', caption: 'he did NOT expect that', channel: 'prankd' },
  { variant: 'day', caption: 'day 47 of doing this until it goes viral', channel: 'dailyday' },
  { variant: 'proof', caption: 'Why √2 can’t be a fraction, in 40 seconds', channel: 'Quiet Proofs' },
];

// The taste interview, three lines of it.
export const INTERVIEW: { from: 'worthwhile' | 'you'; text: string }[] = [
  { from: 'worthwhile', text: 'What’s a video you were glad you watched?' },
  { from: 'you', text: 'A two-hour lecture on the history of zero. I didn’t notice the time go.' },
  { from: 'worthwhile', text: 'You said you want depth. Where do the ones that are just fun fit?' },
];

export const RECEIPT = { inFocus: 14, outOfFocus: 218, shorts: 3, when: 'Tue · 9:40 pm' };
