# BIOBUZZ launch announcements (DRAFT, not published)

Two entries, published together from the admin console (or `POST /api/admin/announcement`)
AFTER the production deploy is verified. Nothing on the server publishes these by itself:
BIOBUZZ's first season row is seeded by `ensureSeason` with `initialAct: 1` on its first
result, and that path never creates an announcement.

⚠️ **Do not use the admin "start new act/season" action for this.** That action is per game
and rolls the chosen game's boards; BIOBUZZ needs no roll (its Act 1 · Season 1 exists as soon
as it is played), and DECODE and Chain Reaction must NOT advance. Publish the two entries
below as plain announcements.

---

## Entry 1 — cinematic reveal

- **kind:** `season`
- **title:** `BIOBUZZ · Act 1 · Season 1`
- **tagline:** `A NEW SEASON BEGINS`
- **body:**

```
BIOBUZZ presented by RTX is here. Fresh boards and ranked ratings start today.
```

---

## Entry 2 — patch notes

- **kind:** `patch`
- **title:** `BIOBUZZ · Act 1`
- **tagline:** *(empty)*
- **body:**

```markdown
# Welcome to BIOBUZZ · Act 1 · Season 1

- **BIOBUZZ presented by RTX is playable**, the FTC 2026–27 season. Pick it on the home screen.
- **Its own boards and ranked ratings**, starting at Act 1 · Season 1.
- **Build a robot around a launcher**: single turret, double turret or dumper.
- **Tip the HIVE, fill the FLOWERS, and park.**

## Before you play

- **BIOBUZZ opens at Act 1 · Season 1.** Record boards start empty and every ranked rating starts fresh.
- **DECODE and Chain Reaction do not change.** Both stay on Act 2 · Season 1, with their boards, ratings and replays exactly as they were.

## The game

- **POLLEN and NECTAR** are the two elements. NECTAR carries your alliance colour.
- **Tip your HIVE** by loading its up-facing cell: 8 POLLEN, or 3 POLLEN with 3 NECTAR. Every tip is 20 points.
- **Elements left in an up-facing cell** score 2 each when the match ends.
- **FLOWERS**: 2 per element in a FLOWER you own, and 5 for the bottom NECTAR of your colour.
- **GARDENS** score 1 per element for their colour.
- **Leave** in AUTO for 3, and **park** in your LOADING ZONE for 5 at the end of AUTO and again at the end of the match.
- **Human player NECTAR** comes in on a button (N): one NECTAR into your own LOADING ZONE when one is owed, or in the last minute.

## Building

- **A launcher is required.** A single turret shoots POLLEN only. A double turret has a POLLEN turret and a NECTAR turret. A dumper carries both and lobs its load into the HIVE from close in.
- **Mount each mechanism where you want it**, and the mount sets your footprint and which edge faces the goal.
- **The hopper holds four elements**, POLLEN and NECTAR together.
- **The OFFSET™ Box Tube places on a FLOWER.** Drive its marker onto a FLOWER and press Z for POLLEN or X for NECTAR. Only a robot with one can score a FLOWER.
- **Your intake can pull the bottom POLLEN out of a FLOWER.** A NECTAR at the bottom locks it.
- **No intake takes the other alliance’s NECTAR.**

## Shooting

- **Aim Assist aims at your nearer HIVE cell** and only lets a shot go when it would land in that cell.
- **Hold fire on a dumper** and the chassis turns onto the cell, then dumps.
- **There is no auto fire in BIOBUZZ.**
- Launchers never aim at a FLOWER; FLOWERS are scored by placing.

## Starting positions

- **Drag your robot into place** on the BIOBUZZ field with G304 legality checked live and snapping on by default.
- **TOP and BOTTOM roles**, like Chain Reaction, with four legal default positions against the walls.

## Fouls

- **A MAJOR foul is worth 20 points** to the other alliance.
- **G402**: crossing into the opponent’s half in AUTO.
- **G410**: NECTAR placed in a FLOWER before the 1:00 cue, per NECTAR.
- **G417**: strategic ramming of the HIVE frame.
- **G421**: pinning an opponent for more than 3 seconds, and again every 3 seconds it goes on.
- **Controlling more than four elements** (G407) shows a warning and costs no points.
```

---

## Before publishing — verify on the production build

- [ ] BIOBUZZ is visible on the stable site (`src/seasons.ts` no longer restricts it to `alpha`).
- [ ] Each rule id above is actually billed by `src/games/biobuzz/penalties.ts` on the deployed build (trim the list if not).
- [ ] The Box Tube reads “OFFSET™ Box Tube” (sponsor term active). If `VITE_SPONSOR=0` is set, change the line to “Box tube”.
- [ ] Z / X / N are still the default bindings (`src/input/bindings.ts`).
- [ ] `GET /api/seasons?game=biobuzz` on production reads Act 1 · Season 1, and `?game=decode` / `?game=chain` still read Act 2 · Season 1.
