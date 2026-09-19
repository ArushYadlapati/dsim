/**
 * COPY TO THE CLIPBOARD, INCLUDING ON THE PAGES WHERE THERE IS NO CLIPBOARD API.
 *
 * ⚠️ `navigator.clipboard` is gated on a SECURE CONTEXT. A LAN guest is served from
 * `http://192.168.x.x:8787`, which is plain http and not `localhost`, so it is not secure and
 * `navigator.clipboard` is `undefined` there — measured, not assumed. An optional chain alone
 * (`void navigator.clipboard?.writeText(x)`) means the whole call evaporates and the button is
 * one that does nothing, silently, with no error to notice.
 *
 * So there is a fallback, and it is the old `execCommand('copy')` one. It is deprecated and it
 * is also the only thing that works without a secure context, which is the situation. The
 * textarea is off-screen rather than `display:none` because a hidden element cannot be
 * selected, and `readOnly` keeps a mobile keyboard from opening over the page.
 *
 * A rejection from the modern path is usually "the document is not focused" rather than "not
 * allowed", and the fallback copes with both — so it is tried before giving up.
 *
 * `onDone` is called with whether the text actually landed. Callers use it to flash "Copied",
 * which is the other half of the bug: a button that reports success it never had teaches
 * people to paste something that is not there.
 */
export function copyText(text: string, onDone?: (ok: boolean) => void): void {
  const done = (ok: boolean): void => onDone?.(ok);
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(
      () => done(true),
      () => done(copyFallback(text)),
    );
    return;
  }
  done(copyFallback(text));
}

function copyFallback(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
