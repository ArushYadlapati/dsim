import { useState } from 'react';
import { APP_NAME } from '../seasons';

/**
 * Share a player's PUBLIC profile link (`/profile/<username>`). Uses the native
 * share sheet where available (mobile / some desktops), else copies the URL to the
 * clipboard with transient "Link copied" feedback. Renders nothing without a username
 * (a legacy account that hasn't picked one has no public URL to share).
 *
 * BOTH LABELS ARE ALWAYS RENDERED, stacked in one grid cell (`.ds-share`), and the idle one is
 * hidden: the button is as wide as the longer of the two, so the panel header it sits in does
 * not reflow for 1.8 s. The confirmation is announced through a polite live region that
 * exists before it is filled (design review 09-25).
 */
export function ShareButton({
  username,
  label = 'Share',
}: {
  username: string | null | undefined;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!username) return null;

  const url =
    (typeof window !== 'undefined' ? window.location.origin : '') +
    `/profile/${encodeURIComponent(username)}`;

  const onClick = async (): Promise<void> => {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    // Prefer the native share sheet; fall back to clipboard. A user-cancelled
    // share (AbortError) is a no-op, not an error.
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title: `@${username} · ${APP_NAME}`, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // fall through to clipboard
      }
    }
    try {
      await nav?.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // last-ditch: select nothing, just surface the URL
      window.prompt('Copy this profile link:', url);
    }
  };

  return (
    <button className="ds-btn ghost ds-share" onClick={onClick}>
      <span className={copied ? 'off' : undefined} aria-hidden={copied}>
        {label} <span aria-hidden="true">↗</span>
      </span>
      <span className={copied ? undefined : 'off'} aria-hidden="true">
        Link copied ✓
      </span>
      <span className="ds-sr" aria-live="polite">
        {copied ? 'Link copied' : ''}
      </span>
    </button>
  );
}
