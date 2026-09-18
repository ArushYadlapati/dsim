/**
 * THE ONE-TIME TOKEN OFF THE URL THIS DOCUMENT OPENED ON, read at module load.
 *
 * ⚠️ IT HAS TO BE CAPTURED THIS EARLY. `App`'s mount effect canonicalizes the
 * address bar — `history.replaceState(null, '', pathFor(screen, …))` — and
 * `pathFor` builds a PATH with no query string on it. So by the time a screen
 * component first renders, `?token=…` is already gone from `window.location`,
 * and a reset or verify screen reading it there would find nothing on exactly the
 * load that matters. A module-level const is evaluated when App imports the
 * screen, which is before any effect runs.
 *
 * Both links are always a COLD LOAD (they are opened out of an email client), so
 * there is no in-app navigation that could need a second, fresher value.
 */
const search = typeof window === 'undefined' ? '' : window.location.search;

/** the `token` query parameter, or null. Trimmed, and an empty one reads as absent. */
export const ENTRY_TOKEN: string | null = (() => {
  try {
    const t = new URLSearchParams(search).get('token');
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null; // a malformed query string is an absent token, never a crash
  }
})();
