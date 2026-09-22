import { useEffect, useRef, useState } from 'react';
import { authClient, authEnabled, clearAuthToken } from '../lib/authClient';
import {
  completeEmailVerification,
  requestEmailVerification,
  type AuthFlowResult,
} from '../lib/authFlows';
import { AuthDisabled } from './AuthDisabled';
import { ENTRY_TOKEN } from './entryToken';

/**
 * `/account/verify` — where the verification email's link lands.
 *
 * It verifies on MOUNT rather than behind a button: the person already clicked
 * something, and a screen that asks them to click a second time to do the thing
 * the first click was for is a worse version of the same page.
 *
 * ⚠️ IT RUNS EXACTLY ONCE. The token is spent by the first call, so React 18's
 * StrictMode double-invoked effect would fire a second one against a token that no
 * longer exists and paint the success screen red. A ref, not a state flag — state
 * is reset with the remount, a ref is not.
 *
 * On success the cached JWT is dropped: it was minted before the address was
 * verified and still says so, and it is the token the ranked gate reads. Without
 * this, somebody who verified mid-session would keep being refused for up to an
 * hour by a claim that had already stopped being true.
 */
export function AccountVerify({ onAccount }: { onAccount: () => void }) {
  return (
    <>
      <h1 className="ds-h1">Verify your email</h1>
      {!authEnabled ? <AuthDisabled /> : <Verify onAccount={onAccount} />}
    </>
  );
}

function Verify({ onAccount }: { onAccount: () => void }) {
  const session = authClient!.useSession();
  const email = session.data?.user?.email ?? '';
  const [result, setResult] = useState<AuthFlowResult | null>(null);
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !ENTRY_TOKEN) return;
    started.current = true;
    void completeEmailVerification(ENTRY_TOKEN).then((r) => {
      if (r.ok) clearAuthToken(); // the cached JWT predates the verified flag
      setResult(r);
    });
  }, []);

  const sendAgain = async (): Promise<void> => {
    if (resend === 'sending' || !email) return;
    setResend('sending');
    setResendError('');
    const r = await requestEmailVerification(email);
    if (r.ok) setResend('sent');
    else {
      setResendError(r.message);
      setResend('error');
    }
  };

  // no token at all: someone typed the URL, or a mail client ate the query string
  if (!ENTRY_TOKEN) {
    return (
      <div className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Nothing to verify</span>
        </div>
        <div className="ds-panel-body stack start">
          <p className="ds-hint">
            This page needs the link from the verification email. Open the newest one and follow
            it from there.
          </p>
          {email && resend !== 'sent' && (
            <button className="ds-btn" onClick={sendAgain} disabled={resend === 'sending'}>
              {resend === 'sending' ? 'Sending…' : 'Send a new link'}
            </button>
          )}
          {resend === 'sent' && <p className="ds-hint ok">A new link is on its way to {email}.</p>}
          {resend === 'error' && <p className="ds-hint err">{resendError}</p>}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Verifying</span>
        </div>
        <div className="ds-loading">Checking your link…</div>
      </div>
    );
  }

  if (result.ok) {
    return (
      <div className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Email verified</span>
        </div>
        <div className="ds-panel-body stack start">
          <p className="ds-hint">
            {email ? `${email} is verified.` : 'Your address is verified.'} Ranked and record runs
            are open.
          </p>
          <button className="ds-btn primary" onClick={onAccount}>
            Go to Profile
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Couldn’t verify that link</span>
      </div>
      <div className="ds-panel-body stack start">
        <p className="ds-hint err">{result.message}</p>
        {result.reason === 'invalid-token' && (
          <p className="ds-hint">
            Verification links work once. If you have already followed this one, your address is
            verified.
          </p>
        )}
        {email && resend !== 'sent' && (
          <button className="ds-btn" onClick={sendAgain} disabled={resend === 'sending'}>
            {resend === 'sending' ? 'Sending…' : 'Send a new link'}
          </button>
        )}
        {resend === 'sent' && <p className="ds-hint ok">A new link is on its way to {email}.</p>}
        {resend === 'error' && <p className="ds-hint err">{resendError}</p>}
        <button className="ds-btn ghost" onClick={onAccount}>
          Go to Profile
        </button>
      </div>
    </div>
  );
}
