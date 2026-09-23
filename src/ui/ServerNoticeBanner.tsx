import { useEffect, useState } from 'react';
import { useServerNotice, setServerNotice } from '../net/notice';

/** fixed top banner for admin server notices (scheduled restart countdown / info).
 * Mounted once at the app root so it shows over every screen. */
export function ServerNoticeBanner() {
  const notice = useServerNotice();
  const [, force] = useState(0);

  // tick once a second while a countdown is live
  useEffect(() => {
    if (!notice?.until) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [notice?.until]);

  if (!notice) return null;

  // The LIVE part is the stable sentence only. The m:ss countdown changes every second, and
  // inside a live region it re-announced the whole banner every second; it is aria-hidden,
  // and a screen reader gets the wall-clock time it counts down to instead.
  let at: string | null = null;
  let clock: string | null = null;
  let restarting = false;
  if (notice.until) {
    const leftMs = notice.until - Date.now();
    if (leftMs <= -20000) {
      // the restart landed a while ago and we're still on the old socket — drop it
      setServerNotice(null);
      return null;
    }
    if (leftMs <= 0) {
      restarting = true;
    } else {
      const left = Math.round(leftMs / 1000);
      const m = Math.floor(left / 60);
      const s = left % 60;
      clock = `${m}:${String(s).padStart(2, '0')}`;
      at = new Date(notice.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  return (
    <div className={`server-notice ${restarting ? 'urgent' : ''}`}>
      <span className="server-notice-icon" aria-hidden>
        ⚠
      </span>
      {/* one flex item, so the countdown sits in the sentence and not a gap away from it */}
      <span>
        <span role="status">
          {notice.message}
          {restarting && ' · restarting now…'}
          {at && <span className="ds-sr"> at {at}</span>}
        </span>
        {clock && <span aria-hidden> in {clock}</span>}
      </span>
    </div>
  );
}
