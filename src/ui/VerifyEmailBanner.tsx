import { useState } from 'react';
import { authClient } from '../lib/authClient';
import { requestEmailVerification } from '../lib/authFlows';
import { CloseGlyph } from './FriendsPanel';

/**
 * PER-SESSION dismissal, in `sessionStorage` rather than `localStorage`.
 *
 * An unverified email is a state the account is supposed to LEAVE, so a dismissal
 * that outlived the tab would quietly retire the only prompt there is — and the
 * next thing that tells them is a ranked queue refusing to open. One tab, one
 * dismissal: it comes back tomorrow, and it stops nagging for the ten minutes
 * somebody is trying to do something else.
 *
 * Its own key, like `theme.ts` and `chainDisclaimer.ts`, and deliberately NOT in
 * `GameSettings` — that blob syncs to Postgres per account, and "I closed a banner"
 * is not account state.
 */
import { VERIFY_BANNER_KEY as KEY } from '../storageKeys';

function dismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false; // storage off ⇒ treat as not dismissed, i.e. show it
  }
}

function dismiss(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* non-fatal — it just reappears on the next render of this screen */
  }
}

/**
 * "Verify your email" — the one prompt that exists before the server starts
 * refusing ranked.
 *
 * ⚠️ `emailVerified === undefined` READS AS VERIFIED, not as unverified. The field
 * is optional on our hand-typed session user because the beta SDK is what decides
 * whether it is there at all; an adapter that stops sending it would otherwise
 * badge every account in the app as unverified overnight. The gate that actually
 * costs somebody something is the server's, off the JWT, and it fails the same
 * way for the same reason (server/auth.ts).
 *
 * Renders nothing when signed out, when the address is verified, or once
 * dismissed for this tab. Only mounted where auth is enabled, so `authClient` is
 * non-null.
 */
export function VerifyEmailBanner() {
  const session = authClient!.useSession();
  const user = session.data?.user;
  const [hidden, setHidden] = useState(dismissed);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  if (!user || user.emailVerified !== false || hidden) return null;
  const email = user.email ?? '';

  const resend = async (): Promise<void> => {
    if (state === 'sending' || !email) return;
    setState('sending');
    setError('');
    const r = await requestEmailVerification(email);
    if (r.ok) setState('sent');
    else {
      setError(r.message);
      setState('error');
    }
  };

  return (
    <div className="ds-verifybar" role="status">
      <div className="ds-verifybar-text">
        {state === 'sent' ? (
          <>A new link is on its way to {email}. Open it to finish verifying.</>
        ) : (
          <>
            <strong>Verify your email.</strong> We sent a link to {email}. Ranked and record runs
            need a verified address; practice and casual matches do not.
          </>
        )}
        {state === 'error' && <span className="err"> {error}</span>}
      </div>
      {state !== 'sent' && (
        <button className="ds-btn small" onClick={resend} disabled={state === 'sending' || !email}>
          {state === 'sending' ? 'Sending…' : 'Resend'}
        </button>
      )}
      <button
        className="ds-btn ghost small"
        onClick={() => {
          dismiss();
          setHidden(true);
        }}
        aria-label="Hide until next visit"
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
