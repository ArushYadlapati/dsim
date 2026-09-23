import type { ReactNode } from 'react';
import type { RobotSpec } from '../types';
import type { GameId } from '../games/types';
import { buildWords } from './robotLabels';

/**
 * ONE ROBOT CARD — a saved robot and a preset in the builder's `Start from`, and a saved robot in
 * the "Your robot" swap row of the custom-room lobby and the ranked strategy window.
 *
 * ── WHY ONE COMPONENT ─────────────────────────────────────────────────────────────────────
 * Owner, 2026-09-22: "Saved robot display. Robot preview card. All these descriptions add no
 * value. It is visual clutter." There were four spellings of a robot in a tile. A preset card
 * carried a tagline, a spec line AND a loadout chip — three readings of one robot, each repeating
 * the others (`Tank · 18 lb · 286 rpm · FRONT sweeper · 4 pollen` under `Kit robot · 6WD tank`
 * over `DUMPER · FRONT`). A saved card carried a different spec line, and on BIOBUZZ's 3D view no
 * line at all, only a picture — so a thumbnail that did not render left a tall empty block with a
 * name in its corner. The swap rows said a name and a drivetrain.
 *
 * So a card is: the NAME, the TEAM when there is one, and ONE line — `buildWords`, the drivetrain
 * and the mechanisms. The numbers are the hero's; the tagline was flavour. A thumbnail, when the
 * game draws one (`GameModule.savedThumb`), sits beside the name and never replaces the line.
 *
 * It is a `.ds-opt`, so selection, hover, press, focus and the `.real` mark are the option card's
 * and cannot drift from every other pick in the app.
 */
export function RobotCard({
  spec,
  game,
  on,
  team,
  real = false,
  thumb,
  onPick,
  onDelete,
}: {
  spec: RobotSpec;
  game: GameId;
  /** this card's build is the one being driven */
  on: boolean;
  /** the identity line, or nothing. The CALLER decides: a preset prints a team only when it is a
   * real one, because a demo's `teamName` is a tagline. */
  team?: string;
  /** a documented real-world robot rather than an archetype demo (`.ds-opt.real`) */
  real?: boolean;
  /** the game's thumbnail, if it draws one; it may render nothing */
  thumb?: ReactNode;
  onPick(): void;
  /** present ⇒ the card carries a delete ✕ and is a `div role=button`, since a button may not
   * hold a button */
  onDelete?: () => void;
}) {
  const cls = `ds-opt ds-robot-card${on ? ' on' : ''}${real ? ' real' : ''}${onDelete ? ' del' : ''}`;
  const body = (
    <>
      {thumb}
      <span className="ot">{spec.name || 'Unnamed'}</span>
      {team ? <span className="od">{team}</span> : null}
      <span className="om">{buildWords(spec, game).join(' · ')}</span>
    </>
  );
  if (!onDelete) {
    return (
      <button type="button" className={cls} aria-pressed={on} onClick={onPick}>
        {body}
      </button>
    );
  }
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      onClick={onPick}
      onKeyDown={(e) => {
        // only the card's own keys: Enter on the ✕ inside it is the ✕'s
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
    >
      <button
        type="button"
        className="ds-opt-del"
        title="Delete this robot"
        aria-label={`Delete ${spec.name || 'this robot'}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        ✕
      </button>
      {body}
    </div>
  );
}
