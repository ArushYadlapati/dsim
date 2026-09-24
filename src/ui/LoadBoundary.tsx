import { Component, Suspense, type ReactNode } from 'react';

/**
 * A LAZY PAGE THAT FAILS TO LOAD SAYS SO, INSTEAD OF BLANKING THE APP.
 *
 * `React.lazy` rejects when its chunk cannot be fetched: offline, a flaky network, or a stale
 * hashed filename after a deploy (the page still asks for the old `GraphicsSection-<hash>.js`,
 * which is gone). With no error boundary anywhere, that rejection unmounted the whole root and
 * the player saw an empty dark page on clicking Configure › Graphics. This catches it at the
 * lazy page, keeps the rest of the app, and offers the reload that fixes the stale case.
 * `main.tsx` also reloads once on Vite's `vite:preloadError`, which covers most stale deploys
 * before this ever shows.
 */
class Boundary extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(err: unknown): void {
    // eslint-disable-next-line no-console
    console.warn(`Couldn’t load ${this.props.what}.`, err);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ds-loading" role="alert">
        <p>Couldn’t load {this.props.what}. Check your connection, then reload the page.</p>
        <button type="button" className="ds-btn small" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

/** `Suspense` plus the boundary above, for every `lazy()` page. `what` finishes "Couldn’t load …". */
export function LoadBoundary({ what, fallback, children }: { what: string; fallback: ReactNode; children: ReactNode }) {
  return (
    <Boundary what={what}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </Boundary>
  );
}
