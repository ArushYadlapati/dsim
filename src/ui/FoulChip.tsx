import type { HudSnapshot } from '../game';

/**
 * THE RUNNING FOUL TALLY — the fouls THIS alliance has committed, as one chip in each game's
 * `.breakdown-row` (design review C39: 05-11, 22-02, 17-10).
 *
 * ONE SLOT, EVERY GAME. It used to be an `eventlog-pinned` line gated on DECODE, which put it
 * behind the "In-match messages" toggle and gave Chain Reaction (whose G05/G06 engine bills
 * through the same `awardFoul`, so `hud.fouls` is already filled) no tally at all. The
 * breakdown row is the one read-out every game mounts on every pointer, and it is a RESERVED
 * slot (`.breakdown-row`'s min extent), so a chip appearing in it never re-frames the 3D field.
 * BIOBUZZ fills its own row through `scoreBar` and renders this same component there.
 *
 * Absent at zero, like the old line: a standing "FOULS 0" is a chip of noise on a phone. Only
 * the non-zero parts are printed, so the common case ("FOULS 2 MAJ", all of Chain's) stays
 * inside the landscape gutter column's 124px `min-width`.
 *
 * SPOKEN IN WORDS, not colour: "MIN"/"MAJ" is the visible shorthand (and a screen reader says
 * "min" as minutes), so the visible text is `aria-hidden` and `.ds-sr` says it in full. Not a
 * live region of its own — every foul is already announced as it happens by the event log's
 * polite region, which stays mounted whatever the toggle says; a second one would say it twice.
 */
export function FoulChip({ hud }: { hud: Pick<HudSnapshot, 'fouls' | 'alliance'> }) {
  const f = hud.fouls[hud.alliance];
  if (f.minor + f.major === 0) return null;
  const parts = [f.minor > 0 ? `${f.minor} MIN` : '', f.major > 0 ? `${f.major} MAJ` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="warn">
      <span aria-hidden="true">FOULS {parts}</span>
      <span className="ds-sr">
        Fouls committed: {f.minor} minor, {f.major} major.
      </span>
    </span>
  );
}
