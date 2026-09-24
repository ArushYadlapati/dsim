import { useEffect, useRef, useState } from 'react';

/**
 * A line of text that does not fit its box SCROLLS instead of wrapping — the results roster's
 * driver names, and the name and team on a robot card.
 *
 * The roster row is one line on a broadcast board, and a wrapped name used to push the team
 * number onto a second line — which, on a versus board, desynced the two halves' rows. The
 * overflow has to be MEASURED: the box is a percentage of the viewport, so whether a given
 * string fits is a question about the window, not about the string. `over` is read off the
 * first copy against the clip, never off the clip's own `scrollWidth`, so it still answers
 * correctly once the second copy exists and the marquee can switch back off when the window
 * grows.
 *
 * Anything that belongs BESIDE the text (a badge, a YOU chip) is a sibling of this, never a
 * child: the clip is what gets measured, and a chip inside it would scroll text that fits.
 */
export function Marquee({ text }: { text: string }) {
  const clip = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const c = clip.current;
    const t = copy.current;
    if (!c || !t) return;
    // ⚠️ `getBoundingClientRect`, NOT `scrollWidth`. `.ds-marquee-text` is an INLINE element
    // (it has to stay inline for the `text-overflow: ellipsis` fallback to apply to it), and
    // `scrollWidth` on a non-replaced inline box is 0 — so the comparison was false for every
    // name, however long, and the marquee never once fired. The rect is the text's real
    // layout width; the parent's `overflow: hidden` clips at PAINT and does not shrink it.
    // 1px of slack: sub-pixel metrics otherwise scroll a name that visually fits.
    const measure = () => setOver(t.getBoundingClientRect().width > c.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    // ⚠️ AND AGAIN ONCE THE WEBFONT LANDS. Both families are variable cuts loaded by
    // `@fontsource`, so the first measurement is taken in the fallback face — which is
    // narrower here, so a name that overflows Plus Jakarta measured as fitting and never
    // scrolled. The observer cannot catch it: the CLIP's box does not change, only the
    // text's. `fonts` is absent in no browser this app runs in, but it is optional chaining
    // because the harness renders under jsdom-less test conditions too.
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [text]);
  return (
    <span ref={clip} className={`ds-marquee${over ? ' scroll' : ''}`}>
      <span ref={copy} className="ds-marquee-text">
        {text}
      </span>
      {/* the second copy is what makes the loop seamless rather than a snap back to the
          start. It is decorative: a screen reader must not read the text twice. */}
      {over && (
        <span className="ds-marquee-text" aria-hidden="true">
          {text}
        </span>
      )}
    </span>
  );
}
