import { useEffect, useState, type ReactNode } from 'react';
import { LEGAL_UPDATED, LEGAL_VERSION, termsGateBlocks, termsGateState } from '../legalText';
import { authClient } from '../lib/authClient';
import { appUrl } from '../lib/authFlows';
import { acceptTerms, fetchEntitlements } from '../net/api';
import { gameServerConfigured } from '../net/env';

/** the agreement sentence, with both documents linked. Shared with the sign-up
 *  checkbox so the two places that ask cannot end up asking different things.
 *
 *  ABSOLUTE URLS OPENED IN A NEW TAB, not in-app navigation: the gate is blocking,
 *  so routing the page underneath it would leave somebody staring at the terms they
 *  cannot reach past the dialog. `appUrl` keeps it origin-relative on the web (so a
 *  Vercel preview links to itself) and points at the live site under Electron, where
 *  a `file://` path is not a link. */
export function TermsAgreement() {
  return (
    <>
      I agree to the{' '}
      <a className="md-link" href={appUrl('/terms')} target="_blank" rel="noopener noreferrer">
        Terms of Use
      </a>{' '}
      and{' '}
      <a className="md-link" href={appUrl('/privacy')} target="_blank" rel="noopener noreferrer">
        Privacy Policy
      </a>
      .
    </>
  );
}

/**
 * BLOCKING TERMS ACCEPTANCE.
 *
 * ⚠️ IT WRAPS ITS CHILDREN INSTEAD OF SITTING BESIDE THEM, and that is not a style
 * choice. `UsernameGate` is the other blocking dialog in this app and a brand-new
 * account trips BOTH — a Google sign-up has neither a username nor an acceptance —
 * so two `.ds-modal-backdrop`s would stack, double-darken the page, and show one
 * modal dimmed behind the other. Rendering the rest of the gates as CHILDREN makes
 * the ordering explicit and structural: terms first, because agreeing to the service
 * comes before picking a name inside it.
 *
 * ⚠️ IT DOES NOT LIVE IN `AccountSync`. That component seeds the account's settings
 * exactly once per session, and hanging a gate off the same effect would make one
 * fetch's failure a reason not to load somebody's key bindings. Separate component,
 * separate fetch; `AccountSync` is untouched.
 *
 * FAIL OPEN. The recorded version rides along with the entitlements read, which never
 * throws and answers nothing at all against a server that predates the route (one Fly
 * app serves every client version). `termsGateState` calls that `'unknown'` and this
 * renders straight through — an un-dismissable dialog in front of every player
 * because one route hiccuped is a worse failure than a late acceptance.
 *
 * SIGN OUT IS THE OTHER BUTTON, because a required agreement with one option is not
 * an agreement. Declining means not having an account here, which the terms already
 * say, and there is nothing else to decline into.
 *
 * ⚠️ `suspended` IS NOT A DISMISS — IT IS THE LEGAL PAGES THEMSELVES. The gate is a
 * full-viewport `.ds-modal-backdrop` rendered as a SIBLING of the routed screen, so on
 * `/terms` and `/privacy` it covered the very documents it is asking about: the two
 * links in the sentence below open a new tab, and the same modal was waiting there.
 * Nobody could read what they were agreeing to. Those pages are public by design
 * (App.tsx says so at the render site — AdSense review fetches `/privacy` directly),
 * so the gate stands down on them and re-blocks everywhere else. The acceptance fetch
 * still runs: suspending the DIALOG must not suspend knowing the answer, or a route
 * back from `/terms` would start from "unknown" again.
 */
export function TermsGate({
  children,
  suspended = false,
}: {
  children?: ReactNode;
  suspended?: boolean;
}) {
  const configured = gameServerConfigured();
  const session = authClient!.useSession();
  const user = session.data?.user ?? null;

  /** the version the SERVER has on file. `undefined` means "not told yet". */
  const [recorded, setRecorded] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (!user || !configured) {
      setRecorded(undefined); // nothing to gate on ⇒ back to "unknown", i.e. open
      return;
    }
    let alive = true;
    void fetchEntitlements().then((e) => {
      if (alive) setRecorded(e.termsVersion);
    });
    return () => {
      alive = false;
    };
  }, [user, configured]);

  const state = termsGateState(user && configured ? recorded : undefined, LEGAL_VERSION);
  if (suspended || !termsGateBlocks(state)) return <>{children}</>;

  const accept = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await acceptTerms();
      setRecorded(r.termsVersion);
    } catch (e) {
      // The route can be MISSING rather than broken — the same one-app-many-client-
      // versions case `DeleteAccount` handles — and that needs its own sentence,
      // because "try again" is wrong advice for a server that has not shipped yet.
      setError(
        e instanceof Error && /404|not found/i.test(e.message)
          ? 'This server doesn’t record acceptances yet. It will work after the next update.'
          : 'Couldn’t record that. Check your connection and try again.',
      );
      setBusy(false);
    }
  };

  const updated = state === 'stale';

  return (
    <div className="ds-modal-backdrop">
      <div className="ds-modal">
        <div className="ds-modal-h">
          <span className="ds-panel-title">
            {updated ? 'Our terms have changed' : 'Terms of Use'}
          </span>
        </div>
        <p className="ds-hint">
          {updated
            ? `The Terms of Use and Privacy Policy were updated on ${LEGAL_UPDATED}. Accept the new version to carry on using your account.`
            : 'Accepting these is part of having an account. They are short, and they say what is collected and what is not.'}
        </p>
        <p className="ds-hint">
          <TermsAgreement />
        </p>
        <div className={`ds-form-hint${error ? ' err' : ''}`}>{error}</div>
        {/* PRIMARY IS RIGHTMOST (ui-standard §6). Sign out is the way out rather than a
            destructive action on anything, so it is `ghost`, not `danger`. */}
        <div className="ds-actions">
          <button className="ds-btn ghost" onClick={() => void authClient!.signOut()}>
            Sign out
          </button>
          <button className="ds-btn primary" onClick={accept} disabled={busy}>
            {busy ? 'Saving…' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
