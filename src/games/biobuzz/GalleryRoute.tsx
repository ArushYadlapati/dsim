import { Suspense, lazy } from 'react';

/**
 * THE SCENE GALLERY'S ROUTE ENTRY — a lazy wrapper, so the gallery itself is not in the stable
 * bundle.
 *
 * ⚠️ **A GATED ROUTE IS NOT AN ABSENT MODULE.** `devRouteFor` (`src/ui/App.tsx`) refuses to
 * match `/gallery/*` unless `devRoutesEnabled()`, so a stable build never RENDERS the gallery —
 * but `index.ts` imported it statically for the route table, and a static import is a bundling
 * fact, not a runtime one. Seven hundred lines of gallery, the seventy-scene registry and
 * everything they reach shipped to every player of every game, to be gated at the door. The
 * gate is about the URL; this is about the download, and neither substitutes for the other.
 *
 * The `<Suspense>` boundary lives HERE rather than at the render site, because `App.tsx`
 * renders a dev route as a bare `<Dev />` with no boundary around it and `React.lazy` throws
 * without one. Owning the boundary is what lets this be a drop-in `ComponentType` —
 * `GameDevRoute.Component`'s whole contract — and keeps the route table's shape the same for
 * every game.
 */
const BiobuzzGalleryLazy = lazy(() => import('./Gallery').then((m) => ({ default: m.BiobuzzGallery })));

export function BiobuzzGalleryRoute(): JSX.Element {
  return (
    <Suspense fallback={<div className="ds-loading">Loading the scene gallery…</div>}>
      <BiobuzzGalleryLazy />
    </Suspense>
  );
}
