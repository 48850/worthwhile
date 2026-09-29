// The signature scroll sequence, as points on scroll progress (0 = the
// sequence's top at the top of the screen, 1 = its end). One place to
// retune the pacing.

export const T: Record<string, number[]> = {
  tags: [0.1, 0.18], // slate tags land on the loud items, one by one
  pull: [0.2, 0.27, 0.34], // the whole phone blurs (focus pull) and the frame refocuses
  slopBlur: [0.23, 0.3], // the loud feed goes soft and stays soft
  goodIn: [0.25, 0.33], // the worthwhile items appear, still soft
  slopOut: [0.35, 0.47], // the soft loud feed collapses away
  sharpen: [0.35, 0.49], // worthwhile items sharpen one by one, each gaining a gold ring
  feedOut: [0.5, 0.53],
  shortsIn: [0.5, 0.53],
  flick: [0.53, 0.61], // blurred Shorts flick past
  settle: [0.61, 0.645], // ...and it settles on a sharp one
  shortsOut: [0.66, 0.69],
  chatIn: [0.66, 0.69],
  bubbles: [0.69, 0.78],
  receipt: [0.8, 0.86], // the receipt rises
  count: [0.82, 0.88], // its numbers count up
  cta: [0.9, 0.93],
};

/** Headline windows: fade in over [a, b], hold, fade out over [c, d]. */
export const HEADLINE_WINDOWS: [number, number, number, number][] = [
  [-1, 0, 0.085, 0.1],
  [0.1, 0.12, 0.19, 0.21],
  [0.21, 0.24, 0.31, 0.33],
  [0.33, 0.355, 0.475, 0.495],
  [0.5, 0.52, 0.635, 0.655],
  [0.66, 0.68, 0.775, 0.795],
  [0.8, 0.82, 0.88, 0.9],
  [0.9, 0.925, 2, 2],
];

/** The labels on the lens scale beside the phone (large screens). */
export const RAIL = ['Your feed', 'Tagged', 'Focus pull', 'In focus', 'Shorts', 'Taste', 'Receipt', 'Yours'];
