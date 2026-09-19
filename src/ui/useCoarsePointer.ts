import { useSyncExternalStore } from 'react';

/**
 * Is this a TOUCH surface — the one question that decides whether the on-screen driving
 * controls exist, and which of the two button rows the game screen renders.
 *
 * It replaces five bare `window.matchMedia('(pointer: coarse)').matches` calls made DURING
 * `GameView`'s render, which was wrong twice over. The HUD polls at 10 Hz, so those five
 * constructed a `MediaQueryList` fifty times a second to answer a question that changes
 * approximately never — and, more to the point, reading a media query during render is not
 * SUBSCRIBING to it. The value was frozen until some unrelated state happened to re-render,
 * so a tablet that gained a mouse, or a 2-in-1 folded into laptop mode, kept whichever set of
 * controls it booted with.
 *
 * `useSyncExternalStore` fixes both: one listener, and React re-renders when the answer
 * actually changes.
 */
const QUERY = '(pointer: coarse)';

const mql = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;

const subscribe = (onChange: () => void): (() => void) => {
  const m = mql();
  if (!m) return () => {};
  // `addEventListener` on a MediaQueryList is the modern spelling; Safari before 14 only had
  // `addListener`. Feature-detect rather than assume — this runs in the Electron shell too.
  if (typeof m.addEventListener === 'function') {
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }
  m.addListener(onChange);
  return () => m.removeListener(onChange);
};

const getSnapshot = (): boolean => mql()?.matches ?? false;

/** SSR/prerender has no pointer to ask about; the desktop layout is the safe default because
 *  it is the one that renders no touch-only chrome. */
const getServerSnapshot = (): boolean => false;

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
