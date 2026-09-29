// The two calls to action. Gold is reserved for the primary one.
import { APP_STORE_URL, CHROME_WEB_STORE_URL } from '@/lib/links';

export function CtaButtons({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <a
        href={APP_STORE_URL}
        className="rounded-full bg-gold px-6 py-3 text-[15px] font-semibold tracking-[-0.01em] text-ink shadow-[0_0_40px_-8px_rgba(245,197,66,0.6)] transition-transform duration-300 ease-[var(--ease-lens)] hover:scale-[1.03]"
      >
        Get the app
      </a>
      <a
        href={CHROME_WEB_STORE_URL}
        className="rounded-full border border-white/15 px-6 py-3 text-[15px] font-medium tracking-[-0.01em] text-white transition-colors duration-300 hover:border-white/40"
      >
        Add to Chrome
      </a>
    </div>
  );
}
