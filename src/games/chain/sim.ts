import type { GameSimModule } from '../types';
import { CHAIN_HALF_Y, CHAIN_START_POSES, CHAIN_VIEW_HALF_X, CHAIN_VIEW_MARGIN } from './config';
import { chainColliders } from './colliders';
import { chainStartLegal } from './state';
import { createChainWorld } from './spawn';
import { chainStep } from './step';

/**
 * Chain Reaction SIMULATION module (DOM-free) — fully playable + SCORED. `scored: true`
 * puts its matches on the ranked/record boards, which are keyed PER GAME (its own Act →
 * Season periods, separate from DECODE). CR start poses are legal by construction (Lab-Area
 * anchors), so `startLegality:false` keeps the server's DECODE-only G304 gate off.
 */
export const CHAIN_SIM: GameSimModule = {
  id: 'chain',
  scored: true,
  startLegality: false,
  initialAct: 1, // CR's periods start at Act 1 · Season 1 (DECODE keeps act 0)
  startPoseCount: CHAIN_START_POSES.length,
  // G04. The FLAG above stays false and this is filled anyway — they are different questions:
  // the flag is whether the SERVER refuses a ready-up, and this is whether the EDITOR paints
  // the ring red. CR has always answered the second and never wanted the first.
  // ALLIANCE IS IGNORED, exactly as the caller that used to branch on the game id did:
  // `chainStartLegal` asks about the Lab Areas as a pair, so a canonical pose is assessed in
  // the frame it is stored in. Changing that is a CR rules question, not a seam change.
  startLegal: (spec, _a, pose) =>
    !pose || chainStartLegal(spec, { x: pose.x, y: pose.y }, pose.headingDeg),
  // camera bounds include the protruding goals (walls/colliders stay at ±72)
  bounds: { halfX: CHAIN_VIEW_HALF_X, halfY: CHAIN_HALF_Y, viewMargin: CHAIN_VIEW_MARGIN },
  colliders: chainColliders,
  createWorld: createChainWorld,
  step: chainStep,
};
