import { useEffect, useRef } from 'react';
import { FOCUSABLE } from './PadNavLayer';

/**
 * The ONE dialog behaviour (design review C07): attach the returned ref to the element that
 * carries `role="dialog" aria-modal="true" aria-labelledby=…` and the hook
 *
 * - moves focus into it on open (the first control, or the dialog itself — give it
 *   `tabIndex={-1}` so that fallback works),
 * - keeps Tab / Shift+Tab inside it,
 * - calls `onClose` on Escape (omit it for a dialog that must be answered, e.g. TermsGate),
 * - hands focus back to whatever had it when the dialog closes.
 *
 * The key listener is on `document` but only acts while focus is inside the dialog or has
 * fallen to <body> (a disabled-while-busy button drops it there); stacked dialogs cannot both
 * act because the first to handle a key preventDefaults it. The role/aria attributes stay in
 * the JSX, where a reader of the markup can see them.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose?: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    const items = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    // a child that already focused itself on mount (autoFocus, an equip button) keeps it
    if (!el.contains(document.activeElement)) (items()[0] ?? el).focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const at = document.activeElement;
      if (at !== document.body && !el.contains(at)) return;
      if (e.key === 'Escape' && closeRef.current) {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const list = items();
        if (list.length === 0) return e.preventDefault();
        const first = list[0];
        const last = list[list.length - 1];
        if (at === document.body) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && (at === first || at === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return ref;
}
