import { useEffect, useState } from 'react';
import { fetchLinks, startLink, unlinkProvider, type LinkProvider } from '../net/api';

const LABEL: Record<LinkProvider, string> = { github: 'GitHub', discord: 'Discord' };
const WHY: Record<LinkProvider, string> = {
  github: 'Star the repo and you keep a title for it.',
  discord: 'Boost the Discord server and you get supporter perks while the boost is up.',
};

/**
 * LINKED ACCOUNTS — connect GitHub or Discord, or disconnect one.
 *
 * ⚠️ THE BUTTON DOES NOT LINK ANYTHING. It asks the server for an authorize URL and sends
 * the browser there; the server does the code exchange and learns the account id FROM THE
 * PROVIDER (`server/oauthLink.ts`). A client that could name its own GitHub id could claim
 * a star somebody else gave, which is the same impersonation primitive the staff role is
 * server-authored to avoid.
 *
 * A provider the server has no credentials for is not rendered at all, rather than shown
 * disabled: until the owner creates the OAuth app there is nothing a person could do with
 * the row, and a permanently greyed control reads as a bug in the page.
 */
export function LinkedAccounts() {
  const [state, setState] = useState<{ linked: LinkProvider[]; available: LinkProvider[] } | null>(null);
  const [busy, setBusy] = useState<LinkProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    fetchLinks()
      .then(setState)
      .catch(() => setState({ linked: [], available: [] }));
  };
  useEffect(load, []);

  // the callback bounces back to /account?link=ok|taken|error — say what happened, once.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('link');
    if (!p) return;
    if (p === 'taken') setError('That account is already linked to another DSIM profile.');
    else if (p === 'error') setError('Couldn’t finish linking. Try again.');
    // strip it so a reload does not repeat the message
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (!state || state.available.length === 0) return null;

  const connect = (p: LinkProvider): void => {
    setBusy(p);
    setError(null);
    startLink(p)
      .then((r) => {
        window.location.href = r.url;
      })
      .catch(() => {
        setBusy(null);
        setError('Couldn’t start linking. Check your connection and try again.');
      });
  };

  const disconnect = (p: LinkProvider): void => {
    setBusy(p);
    setError(null);
    unlinkProvider(p)
      .then(() => {
        setBusy(null);
        load();
      })
      .catch(() => {
        setBusy(null);
        setError('Couldn’t disconnect that account.');
      });
  };

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Linked accounts</span>
      </div>
      <div className="ds-panel-body stack start">
        <p className="ds-hint">
          Linking stores the account’s id and nothing else — no email, no password, and no
          access token. You can disconnect at any time.
        </p>
        {state.available.map((p) => {
          const on = state.linked.includes(p);
          return (
            <div className="ds-field" key={p}>
              <span className="cap">{LABEL[p]}</span>
              <span className="ds-hint">{WHY[p]}</span>
              <button
                className={`ds-btn ${on ? 'ghost' : ''} small`}
                disabled={busy === p}
                onClick={() => (on ? disconnect(p) : connect(p))}
              >
                {on ? 'Disconnect' : `Connect ${LABEL[p]}`}
              </button>
            </div>
          );
        })}
        {/* ⚠️ Disconnecting GitHub takes the star title with it — otherwise the decal
            outlives the proof, and unlink-keep-relink is a farm. Said here because it is a
            consequence of a button, not a setting somebody would go looking for. */}
        {state.linked.includes('github') && (
          <p className="ds-hint">Disconnecting GitHub also removes the title you earned for starring.</p>
        )}
        {error && <p className="ds-hint warn">{error}</p>}
      </div>
    </div>
  );
}
