/**
 * CHAIN REACTION's own touch buttons. The shared pad (`src/ui/mobileActions.ts`) contributes
 * SHOOT, INTAKE, FLIP, WHEELS and PARK; these two are what the season adds, and they are here
 * rather than in the shared table for the reason CLAUDE.md gives: an action that names a game
 * element belongs to the game.
 *
 * Both keep the `mobileLayout` keys they shipped with, so a player who dragged either one
 * still finds it where they left it.
 */
import type { GameTouch, TouchButton } from '../../ui/mobileActions';
import { CHAIN_DEFAULT_SCORE_MODE, chainCatalystGeom } from './config';

const CHAIN_TOUCH_BUTTONS: readonly TouchButton[] = [
  {
    action: 'catalyst',
    hold: 'catalyst',
    label: 'CATALYST',
    aria: 'Catalyst pick up or place',
    glyph: '⬡',
    cls: 'catalyst',
    side: 'right',
    slot: 'catalyst',
    // carrying, a press always acts: it seats the ring on a hook in reach or drops it at the
    // mouth (`catalystAction`). Empty-handed it only acts with a ring in reach — the prompt's
    // `pickup`. So `ringAction` alone is NOT the answer: it is null while carrying with no hook.
    ready: (l) => !l.chain || l.chain.carrying || l.chain.ringAction === 'pickup',
  },
  {
    // the CATAPULT throw. Its own button for the same reason it has its own keybind — a throw
    // is not the claw's grab/place, and a driver must never have to guess which one a press
    // means. A claw-only build has nothing to throw, so it gets no button.
    action: 'fling',
    hold: 'fling',
    label: 'THROW',
    aria: 'Catapult throw',
    glyph: '⤴',
    cls: 'fling',
    side: 'right',
    slot: 'fling',
    present: (c) => chainCatalystGeom(c.spec).fling,
    ready: (l) => !l.chain || l.chain.carrying,
  },
];

export const CHAIN_TOUCH: GameTouch = {
  buttons: CHAIN_TOUCH_BUTTONS,
  // the drum and the dumper have no turret: a HELD shoot button turns the chassis onto the goal
  // (`chainAimAssist` — "only the manual button steers"), which auto fire never does. With aim
  // assist OFF it steers nothing, and the press is as dead as a turret's.
  manualFireCounts: (c) => {
    const mode = c.spec.scoreMode ?? CHAIN_DEFAULT_SCORE_MODE;
    return c.aimAssist && (mode === 'drum' || mode === 'dumper');
  },
};
