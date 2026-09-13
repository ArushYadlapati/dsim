/**
 * WHERE A TAB-HOSTED ROOM LIVES WHILE ITS HOST IS PLAYING IN IT.
 *
 * The LAN screen starts the room, and then the host leaves that screen to go and play — which
 * unmounts the component that owns the `LanHost`. React's answer to "this component is gone"
 * is to run the cleanup, and the cleanup stopped hosting: the host clicked GO TO THE ROOM, the
 * Worker was terminated on the way, every guest's connection was closed behind them, and the
 * host arrived at a lobby waiting on a room that no longer existed.
 *
 * So the host is PARKED here on the way out, exactly as `src/ui/queueKeeper.ts` parks a live
 * ranked queue for the same reason: module state outlives a tree, and the room has to outlive
 * the screen that made it. Coming back to the LAN screen ADOPTS it again, so the host still has
 * a Stop hosting button and still sees the code they read out.
 *
 * ⚠️ **THE ROOM STILL HAS TO END SOMEWHERE.** Parked, it has no UI attached at all, so the two
 * things that stop it are the host stopping it from the LAN screen and the tab closing, which
 * takes the Worker with it. An EMPTY room does not end it: the room idles (its loop runs only
 * during a match), the host can step back in, and a guest can still join by the same code.
 */
import type { LanHost } from './hostRuntime';

let held: LanHost | null = null;

/** hand the room over on the way to the room screen */
export function keepHostedRoom(host: LanHost): void {
  if (held && held !== host) held.stop();
  held = host;
}

/**
 * Adopt it back (the LAN screen mounting again). Clears as it returns.
 *
 * ⚠️ **A ROOM THAT ENDED WHILE PARKED IS NOT HANDED BACK.** Nothing here hears the room end —
 * the `LanHost` tells the events it was built with, which belong to a screen that has
 * unmounted — so a host who went to the lobby alone and pressed Back (the room empties and
 * stops itself) came back to a LAN screen showing the dead room's code, a Stop button that
 * did nothing and a GO TO THE ROOM that threw. Asking the host whether it is still live at
 * the moment of adoption is the one place that knows; a dead one is dropped and the screen
 * starts clean.
 */
export function takeHostedRoom(): LanHost | null {
  const h = held;
  held = null;
  return h?.live ? h : null;
}

/** is a LIVE room parked here? — for a caller that must not consume it */
export function hostedRoomParked(): boolean {
  return held?.live === true;
}

/** end a parked room and forget it */
export function stopHostedRoom(reason?: string): void {
  held?.stop(reason);
  held = null;
}
