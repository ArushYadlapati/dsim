/**
 * "Accounts are off in this build" — the panel every account-shaped screen shows
 * when `VITE_NEON_AUTH_URL` is unset.
 *
 * One component rather than one per screen: the Profile page, the password-reset
 * screen and the verify screen all reach it, and three copies of a sentence
 * naming an environment variable is three chances for one of them to name the
 * wrong one after a rename. The variable is named in the dev console only: it is a
 * developer's next step, never a player's (design review 07-04 / 19-03).
 */
export function AuthDisabled() {
  if (import.meta.env.DEV) console.warn('[auth] VITE_NEON_AUTH_URL is not set');
  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Account</span>
      </div>
      <div className="ds-empty">
        <div className="big">Accounts are off in this build</div>
        This build has no sign-in, so records and ranked rating aren’t saved. Solo practice and free drive still work.
      </div>
    </div>
  );
}
