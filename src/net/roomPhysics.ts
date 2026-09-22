/**
 * THE CLIENT HALF OF THE 3D READINESS HANDSHAKE (`READY3D_CAP`, owner request 2026-09-22).
 *
 * "Only start any server-required game once 3D physics loads." The server's half is
 * `Room.seatWaiting3d`; this is the two lines every screen that can lead into a server room
 * owes it — START THE LOAD EARLY, SAY WHEN IT LANDS.
 *
 * ⚠️ **THE PRELOAD IS THE HALF THAT MAKES THE WAIT INVISIBLE.** Holding the match start is
 * only tolerable if it is normally zero, and it is zero exactly when the chunks were fetched
 * while the player was doing something else — reading the queue screen, typing a room code,
 * opening the record page. Without it every one of those screens would hand the room a client
 * that has not started downloading 1.1 MB yet.
 *
 * ⚠️ **IT IS A LEAF, and it must stay one.** It reaches the game through `simModuleFor` (the
 * SERVER-SAFE registry) rather than `moduleFor`, for the reason `src/lan/hostWorker.ts` does:
 * the client registry drags in canvas renderers, and the only thing asked here is whether this
 * game's server rooms run `'3d'`. `initPhysics3d` is the LIGHT SEAM (`sim3d/engine.ts`), so
 * importing it costs nothing until it is called — that is the whole point of that file.
 */
import { initPhysics3d, physics3dReady } from '../games/biobuzz/sim3d/engine';
import { simModuleFor } from '../games/sim';
import { serverPhysics } from '../games/types';
import type { GameId } from '../types';

/** does a server room of `game` run the 3D solve? (`Room.physics`, the 2026-09-18 ruling) */
export function roomNeeds3d(game: GameId): boolean {
  return serverPhysics(simModuleFor(game)) === '3d';
}

/** is this client able to step a server room of `game` RIGHT NOW — chunks and all? */
export function roomPhysicsReady(game: GameId): boolean {
  return !roomNeeds3d(game) || physics3dReady();
}

/**
 * START FETCHING what a server room of `game` will need, as early as the intent is known.
 *
 * Idempotent (`initPhysics3d` resolves the same in-flight promise), a no-op for a game with
 * no 3D solve, and deliberately UNAWAITED at most call sites: nothing on screen depends on
 * it, and a failure here is not a failure of the screen that asked — the room's own gate and
 * `RecordRun`'s preflight are where a load that never lands is answered.
 */
export function preloadRoomPhysics(game: GameId): Promise<void> {
  return roomNeeds3d(game) ? initPhysics3d() : Promise.resolve();
}

/**
 * SAY WHEN IT LANDS. Call once per room socket, right after the join.
 *
 * The lobby client latches the announcement and re-sends it behind every reconnect's join
 * frame, so this is a one-shot at the call site — see `LobbyClient.physicsReady`.
 *
 * A failed load announces nothing, which is correct: the seat is genuinely not ready, and the
 * server waits it out to `READY3D_DEADLINE_MS` and starts without it rather than hanging.
 */
export function announcePhysicsReady(lobby: { physicsReady(): void }, game: GameId): void {
  if (!roomNeeds3d(game)) return;
  void initPhysics3d().then(
    () => lobby.physicsReady(),
    (err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('BIOBUZZ 3D physics failed to load; this seat will not report ready.', err);
    },
  );
}
