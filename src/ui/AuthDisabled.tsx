/**
 * "Accounts are off in this build" — the panel every account-shaped screen shows
 * when `VITE_NEON_AUTH_URL` is unset.
 *
 * One component rather than one per screen: the Profile page, the password-reset
 * screen and the verify screen all reach it, and three copies of a sentence
 * naming an environment variable is three chances for one of them to name the
 * wrong one after a rename.
 */
export function AuthDisabled() {
  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Account</span>
      </div>
      <div className="ds-empty">
        <div className="big">Accounts are off in this build</div>
        Set <code>VITE_NEON_AUTH_URL</code> to enable sign-in, saved records, and ranked ELO.
      </div>
    </div>
  );
}
