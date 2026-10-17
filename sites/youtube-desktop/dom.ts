// sites/youtube-desktop/dom.ts
//
// Element builder. Always textContent, never innerHTML: titles come from
// YouTube, and YouTube's page blocks innerHTML anyway (Trusted Types).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  { id, className, text }: { id?: string; className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
