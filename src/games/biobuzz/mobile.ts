/**
 * BIOBUZZ's own touch buttons.
 *
 * Four of the five were unreachable on a phone until this file existed — `bbPlace`,
 * `bbPlaceNectar`, `bbRamp` and `bbPass` all shipped with a keybind and a pad button and no
 * touch control, which three separate BIOBUZZ handoffs recorded as debt. The shared pad now
 * DERIVES its set from `ACTION_GAMES`, so the omission is a test failure rather than a note
 * (`touchCoverageGaps`, `src/ui/mobileActions.ts`).
 *
 * ⚠️ EVERY `present` HERE ASKS THE SPEC, NOT THE TICK. "Does this build have the mechanism" is
 * a property of the robot the player assembled; whether a press would do anything RIGHT NOW
 * (something of that kind in the hopper, a FLOWER in reach, an entitlement owed) changes
 * several times a match and is answered in the HUD, never by a button appearing and vanishing
 * under a driver's thumb.
 */
import type { TouchButton } from '../../ui/mobileActions';
import { BB_HOOD_DEFAULT_DEG } from './config';
import { bbCarriesNectar, bbIntakeKindOf, bbIsTurreted, bbLauncherOf, bbLiftOf } from './mechs';

export const BB_TOUCH_BUTTONS: readonly TouchButton[] = [
  {
    // place a held POLLEN into the FLOWER in reach. No Box Tube, no placement
    // (`placeInFlower` returns false on the first line), so no button.
    action: 'bbPlace',
    hold: 'bbPlace',
    label: 'POLLEN',
    aria: 'Place POLLEN',
    glyph: '◇',
    cls: 'bbplace',
    side: 'right',
    present: (c) => bbLiftOf(c.spec) !== null,
  },
  {
    // place a held NECTAR. Needs the tube AND a launcher that can carry NECTAR at all — a
    // single turret feeds POLLEN only, so that build can never have one to place.
    action: 'bbPlaceNectar',
    hold: 'bbPlaceNectar',
    label: 'NECTAR',
    aria: 'Place NECTAR',
    glyph: '◆',
    cls: 'bbplacenectar',
    side: 'right',
    present: (c) => bbLiftOf(c.spec) !== null && bbCarriesNectar(bbLauncherOf(c.spec, BB_HOOD_DEFAULT_DEG)),
  },
  {
    // PASS to your partner: the same solver aimed at a field point rather than at the hive.
    // A turretless launcher fires along a fixed line and cannot aim at one.
    action: 'bbPass',
    hold: 'bbPass',
    label: 'PASS',
    aria: 'Pass to partner',
    glyph: '▶',
    cls: 'bbpass',
    side: 'right',
    present: (c) => bbIsTurreted(bbLauncherOf(c.spec, BB_HOOD_DEFAULT_DEG)),
  },
  {
    // the deployable ramp — the `ramp` intake archetype only; every other build's sim ignores
    // the bit outright (`bbRampStep` returns before touching the robot).
    action: 'bbRamp',
    hold: 'bbRamp',
    label: 'RAMP',
    aria: 'Deploy ramp',
    glyph: '◣',
    cls: 'bbramp',
    side: 'left',
    present: (c) => bbIntakeKindOf(c.spec) === 'ramp',
  },
  {
    // THE HUMAN PLAYER (G426): enter one NECTAR into the alliance's own LOADING ZONE. No
    // `present`, and that is a statement — the human player is not hardware, so there is no
    // build that should be missing the button. It keeps its own `mobileLayout` slot and sits
    // on the LEFT: it acts on the ALLIANCE rather than on the robot, and it is pressed at a
    // cue rather than in the drive rhythm, so it stays out of the scoring thumb's sweep.
    // Labelled HUMAN, not NECTAR, because the two FLOWER buttons above are also nectar and
    // pollen — three buttons agreeing on a noun name nothing.
    action: 'bbNectar',
    hold: 'bbNectar',
    label: 'HUMAN',
    aria: 'Human player: enter NECTAR',
    glyph: '⬗',
    cls: 'bbnectar',
    side: 'left',
    slot: 'bbNectar',
  },
];
