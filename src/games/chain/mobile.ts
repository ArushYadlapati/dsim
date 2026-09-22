/**
 * CHAIN REACTION's own touch buttons. The shared pad (`src/ui/mobileActions.ts`) contributes
 * SHOOT, INTAKE, FLIP, WHEELS and PARK; these two are what the season adds, and they are here
 * rather than in the shared table for the reason CLAUDE.md gives: an action that names a game
 * element belongs to the game.
 *
 * Both keep the `mobileLayout` keys they shipped with, so a player who dragged either one
 * still finds it where they left it.
 */
import type { TouchButton } from '../../ui/mobileActions';
import { chainCatalystGeom } from './config';

export const CHAIN_TOUCH_BUTTONS: readonly TouchButton[] = [
  {
    action: 'catalyst',
    hold: 'catalyst',
    label: 'CATALYST',
    aria: 'Catalyst pick up or place',
    glyph: '⬡',
    cls: 'catalyst',
    side: 'right',
    slot: 'catalyst',
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
  },
];
