import * as C from '../../config';
import { activeStartLegal } from '../../sim/field';
import { createWorld } from '../../sim/spawn';
import { step } from '../../sim/world';
import type { GameSimModule } from '../types';
import { decodeColliders } from './colliders';

/**
 * DECODE's SIMULATION module (DOM-free) — a thin wrapper over the existing
 * `src/sim/*`. Server + headless import this; the client's `DECODE_MODULE`
 * (./index.ts) extends it with the canvas renderers. Behavior is byte-identical to
 * the pre-seam code (see `colliders.ts` determinism note).
 */
export const DECODE_SIM: GameSimModule = {
  id: 'decode',
  scored: true,
  startLegality: true, // G304 start-pose legality applies
  initialAct: 0, // DECODE's boards opened in the beta/pre-season act
  startPoseCount: C.START_POSES.length,
  // G304 itself. `activeStartLegal` already mirrors the canonical pose onto the alliance and
  // waves an absent one through, which is exactly this slot's contract — so it IS the slot.
  startLegal: activeStartLegal,
  autoPaths: true, // `src/sim/world.ts` — the only step that drives path traversal
  bounds: { halfX: C.FIELD_HALF, halfY: C.FIELD_HALF, viewMargin: C.VIEW_MARGIN },
  colliders: decodeColliders,
  createWorld,
  step,
};
