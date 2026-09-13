# BIOBUZZ manual-conformance audit — findings for review

## Preamble

This is a gap audit of the BIOBUZZ season implementation (`src/games/biobuzz/`, plus the shared surfaces it rides on) against the FTC BIOBUZZ Competition Manual V1 of 2026-09-12: Section 8 (GAME OVERVIEW), Section 9 (ARENA), Section 10 (GAME DETAILS), and the Section 11 G-rules that Section 10 points into. Verbatim manual text was the authority. `docs/biobuzz/manual-distilled.md` was used as a secondary reference and agreed with the verbatim text everywhere it was checked.

The implementation is already deep. Every point value in Table 10-2 is exact, every assessment instant in §10.5 A–G is modelled, five G-rules are enforced against their own text, and the smoke lane pins several of the manual's figures case by case. Roughly 150 manual facts were checked and confirmed correct; they are listed in the appendix so the coverage can be judged. What follows is the residue.

**Headline count: 0 critical, 2 major, 13 minor, 37 nit. 52 findings.**

**Every finding names the rule that governs it.** Sections 8, 9 and 10 carry no G-numbers of their own, so each finding is resolved to the rule it is actually about. Eleven are governed by a real game rule or robot rule and name it. The rest are governed by a numbered section, a table, or repo doctrine, and say so outright rather than borrowing a rule number that does not cover them. The rule is the second column of the summary, it is in brackets in every heading, and the by-rule index below the summary groups the findings under it.

Two pairs of raw findings described the same defect from the bug side and the test-coverage side. They are merged here into BB-01 and BB-02, each carrying both halves, because they would be one issue.

Thirty-one of the 52 are terminology, stale documentation, dead constants, or test gaps on behaviour that is already correct. Only BB-01, BB-02, BB-04 and BB-11 can change a number a player sees.

---

## Summary

| id | rule | title | severity | category |
|---|---|---|---|---|
| BB-01 | **§10.5 A** | A HIVE TIP still swinging at the buzzer scores nothing | major | missing-scoring |
| BB-02 | **G410** | G410 double-bills one illegal NECTAR across the AUTO→TELEOP boundary | major | penalty |
| BB-03 | **§9.8** | A held NECTAR collides as a POLLEN | minor | geometry |
| BB-04 | **Table 10-2** | GARDEN points accrue during AUTO | minor | missing-scoring |
| BB-05 | **G403** | A turret slews under power in `pre`, the transition and `post` | minor | penalty |
| BB-06 | **G427** | G427.C is not modelled: an entered NECTAR can land inside a ROBOT | minor | penalty |
| BB-07 | **G407** | G407 is given DECODE's G408.C LOADING ZONE carve-out | minor | penalty |
| BB-08 | **G417** | G417 is disabled outright, so the HIVE-protection rule bills nothing | minor | penalty |
| BB-09 | **§10.6.1** | No card path exists in BIOBUZZ | minor | missing-rule |
| BB-10 | **repo doctrine** | No fouls are assessed in Free Drive | minor | penalty |
| BB-11 | **Table 10-2** | WIN and TIE ranking points are never computed or printed | minor | missing-scoring |
| BB-12 | **§10.5.1** | Three owner rulings narrow manual-legal scoring paths | minor | missing-scoring |
| BB-13 | **repo convention** | The APPROX worklist grep misses nine constants | minor | other |
| BB-14 | **§9.6** | Four `BB_TIP_POLLEN` rows are single bench readings and carry no marker | minor | wrong-value |
| BB-15 | **internal** | A cluster of placeholder-era comments still declares BIOBUZZ unscored | minor | other |
| BB-16 | **§10.5.4** | LEAVE requires 1.25 in of wall clearance the rule does not ask for | nit | wrong-value |
| BB-17 | **§10.5.3** | `bbInGarden` adds a not-held condition §10.5.3 does not state | nit | missing-rule |
| BB-18 | **§9.6.1** | HIVE frame bars are 50.0 in outer-to-outer against a printed 49.46 | nit | geometry |
| BB-19 | **§9.7** | The lower FLOWER ring is a flat floor, not a seat | nit | geometry |
| BB-20 | **§10.6.1** | The RP block ignores `voided` | nit | missing-rule |
| BB-21 | **§10.4** | AUTO is driver-controlled | nit | missing-rule |
| BB-22 | **G418.A** | Nothing launched can enter a FLOWER | nit | missing-rule |
| BB-23 | **G408** | `bbIntakeAccepts` enforces G408 structurally | nit | penalty |
| BB-24 | **G419** | G419 and G420 are absent from the “deliberately not here” list | nit | penalty |
| BB-25 | **Table 9-1** | “END GAME” is burned into every exported BIOBUZZ replay video | nit | terminology |
| BB-26 | **Table 9-1** | The HUD clock shows the phase countdown, not the field timer | nit | ux-hud |
| BB-27 | **Table 10-4** | The sanction line says WARNING where the manual says VERBAL WARNING | nit | terminology |
| BB-28 | **§9.3** | The gallery label abbreviates LOADING ZONE to “LZ” | nit | terminology |
| BB-29 | **§9.8** | `bb.scored` and the config summary say POLLEN where they mean elements | nit | terminology |
| BB-30 | **§9.8** | `BiobuzzState.held`'s example invents a QUEEN | nit | terminology |
| BB-31 | **§10.4** | `bb.endgame` has no reader and an unreachable `'climbed'` member | nit | other |
| BB-32 | **§10.3.1** | `BB_POLLEN_SIM = 60` is a dead element count with a live marker | nit | staging |
| BB-33 | **R105.A** | `BB_TAPE_2` and `BB_EXPANSION` are dead constants | nit | other |
| BB-34 | **G421** | Stale comment claims G421's solid probe reads DECODE's field | nit | other |
| BB-35 | **§9.6.1** | Two stale doc claims inside live contracts | nit | other |
| BB-36 | **§10.5.2** | Stale hand-worked z values in the rules.ts FLOWER block | nit | other |
| BB-37 | **G403** | Test gap: the transition is never stepped with a live mechanism | nit | test-gap |
| BB-38 | **§10.4** | Test gap: the `ZERO_CMD` substitution is unpinned | nit | test-gap |
| BB-39 | **§10.1** | Test gap: BIOBUZZ's phase machine never asserts the durations | nit | test-gap |
| BB-40 | **§10.5 C** | Test gap: nothing pins an element landing during `post` | nit | test-gap |
| BB-41 | **§10.5.1** | Test gap: no opponent-coloured NECTAR is ever staged in a CELL | nit | test-gap |
| BB-42 | **§10.5 D** | Test gap: the FLOWER line is never scored at a non-post phase | nit | test-gap |
| BB-43 | **§10.5.3** | Test gap: no GARDEN check uses a NECTAR | nit | test-gap |
| BB-44 | **§9.3** | Test gap: BB_LZ and BB_GARDEN dimensions are never asserted | nit | test-gap |
| BB-45 | **§9.6** | Test gap: no HIVE dimension is pinned as a literal | nit | test-gap |
| BB-46 | **§9.9** | Test gap: the AprilTag id groups are unpinned | nit | test-gap |
| BB-47 | **§10.5.2** | Test gap: the FLOWER owner/bonus fan-out is never split across alliances | nit | test-gap |
| BB-48 | **G426** | Test gap: the G426.A entitlement is never exercised in AUTO | nit | test-gap |
| BB-49 | **§9.8** | Test gap: nothing pins the 40 / 8 / 8 element split | nit | test-gap |
| BB-50 | **Table 10-3** | Test gap: all four RP checks sit off the threshold boundary | nit | test-gap |
| BB-51 | **Table 10-2** | Test gap: `biobuzzResultsRows` is never invoked by any suite | nit | test-gap |
| BB-52 | **seam contract** | Test gap: two of the four game registrations are unpinned | nit | test-gap |

## By rule

What each rule number covers, so a question about one rule is answerable in one look. A finding
listed under a numbered section is one the manual governs without a G-rule.

**Game rules and robot rules**

- **G403** — BB-05, BB-37
- **G407** — BB-07
- **G408** — BB-23
- **G410** — BB-02
- **G417** — BB-08
- **G418.A** — BB-22
- **G419** — BB-24
- **G421** — BB-34
- **G426** — BB-48
- **G427** — BB-06
- **R105.A** — BB-33

**Governed by a numbered section, no G-rule exists**

- **§9.3** — BB-28, BB-44
- **§9.6** — BB-14, BB-45
- **§9.6.1** — BB-18, BB-35
- **§9.7** — BB-19
- **§9.8** — BB-03, BB-29, BB-30, BB-49
- **§9.9** — BB-46
- **§10.1** — BB-39
- **§10.3.1** — BB-32
- **§10.4** — BB-21, BB-31, BB-38
- **§10.5 A** — BB-01
- **§10.5 C** — BB-40
- **§10.5 D** — BB-42
- **§10.5.1** — BB-12, BB-41
- **§10.5.2** — BB-36, BB-47
- **§10.5.3** — BB-17, BB-43
- **§10.5.4** — BB-16
- **§10.6.1** — BB-09, BB-20
- **Table 9-1** — BB-25, BB-26
- **Table 10-2** — BB-04, BB-11, BB-51
- **Table 10-3** — BB-50
- **Table 10-4** — BB-27
- **internal** — BB-15
- **repo convention** — BB-13
- **repo doctrine** — BB-10
- **seam contract** — BB-52

---

## BB-01 — [§10.5 A] A HIVE TIP still swinging at the buzzer scores nothing

*Rule: §10.5 A. Severity: major. Category: missing-scoring.*

**The rule.** No G-rule governs this. §10.5 A is the governing text: “Assessment of HIVE TIPS occurs throughout the MATCH and continues until all SCORING ELEMENTS and ROBOTS have come to rest at the conclusion of the MATCH.”

**What the manual says**

> A. Assessment of HIVE TIPS occurs throughout the MATCH and continues until all SCORING ELEMENTS and ROBOTS have come to rest at the conclusion of the MATCH.

**What the sim does**

The mechanism is right and the capture is early. `hiveStep` (`src/games/biobuzz/hive.ts:211-252`) increments `hive.tips` only on the settle branch, and `bbScoreWorld` multiplies that counter (`score.ts:333`). The hive keeps swinging after the buzzer: `play.ts:551` calls `hiveStep` with no `enabled` guard and `step.ts:136` runs `updateBiobuzz` in every phase, so §10.5 A's “continues until all … have come to rest” is honoured by the simulation.

What truncates it is the finalize window. `BB_TIP_SWING_S` is 4.0 s (`hive.ts:54`) with the tray releasing at 2.0 s (`BB_TIP_RELEASE_S`, `hive.ts:65`), while both finalize sites use the shared `C.MATCH_SETTLE_S` of 2.8 s (`src/config.ts:30-35`; `server/room.ts:1607-1609`; `src/game.ts:539`). No BIOBUZZ-specific settle exists.

A swing beginning later than T−1.2 s therefore settles after the score is frozen. Worked from the constants: a swing started at T−0.5 s releases at T+1.5 s, inside the window, so `contents` empties and `cellCount` goes to 0; it settles at T+3.5 s, outside the window, so `tips` never increments.

**Test gap, same defect.** Nothing in the lane could see this. `scripts/smoke-biobuzz/rules.ts:254-294` drives `hiveStep` directly on a bare `HiveState`; `rules.ts:329` and `:387` set `w.match.phase = 'post'` by hand; `grep -rn MATCH_SETTLE scripts/smoke-biobuzz` returns nothing. No check starts a swing before the buzzer and steps a world across it.

**Why it matters**

An alliance that lands the tipping element in the last second or two of TELEOP loses 20 points for the TIP plus 2 per element in the tray, because the tray released inside the window and the cell emptied. A referee would stand and watch that swing complete. This is the most expensive single scoring instant in the game and it is both wrong at the margin and untested end to end.

**Suggested fix**

Give the module a way to state a settle requirement, so the room and the controller can ask “is anything still settling?” while `hives[a].tipping > 0`, or credit a swing that is in flight at the buzzer, since the TIP is determined the moment the bar leaves its stable state. A per-game settle floor of `BB_TIP_SWING_S` plus margin is the smaller change. Do not move `MATCH_SETTLE_S` itself: that would move DECODE and Chain Reaction. Add a check in `scripts/smoke-biobuzz/rules.ts` that starts a swing a fraction of a second before the buzzer, steps `biobuzzStep` for `MATCH_SETTLE_S`, and asserts the 20 has landed.

**Confidence: high.** Verifier confirmed the arithmetic and both source constants, and noted that `step.ts:62-65` states the intended contract out loud (“a TIP that completes on the buzzer tick still scores”), which is exactly the case the 2.8 s window truncates.

---

## BB-02 — [G410] G410 double-bills one illegal NECTAR across the AUTO→TELEOP boundary

*Rule: G410. Severity: major. Category: penalty.*  Also bears on: Table 10-4, Table 10-6.

**The rule.** “ROBOTS may not enter NECTAR into the FLOWER scoring volume until the last 60 seconds of the MATCH.” Penalty: MAJOR FOUL per NECTAR.

**What the manual says**

> ROBOTS may not enter NECTAR into the FLOWER scoring volume until the last 60 seconds of the MATCH.

Penalty: MAJOR FOUL per NECTAR. §10.6 adds:

> Unless otherwise noted, all penalties are assigned for each instance of a rule violation.

**What the sim does**

G410 is written as a per-tick state predicate over the flower stacks, not as an entry event. `updateBiobuzzPenalties` iterates `bb.flowers[].stack` while `bbNectarLocked(world)` and fires `g410-<element id>` through the rising-edge memory (`penalties.ts:288-304`). `fire` bills when the key is absent from last tick's set (`penalties.ts:271`) and `bb.foulEdge = seen` re-arms each tick (`penalties.ts:487`).

The phase guard wipes that memory wholesale on every tick of `transition`: `penalties.ts:248` is `bb.foulEdge = {};`, reached via `!isAuto && !isTeleop` at `:243`. Nothing removes the NECTAR in between: `flowerRetrieve` bails unless the bottom element is a POLLEN (`flower.ts:164-170`), and the transition mutates no flower (`step.ts:229-236`). On the first TELEOP tick `bbNectarLocked` is still true (`phaseTimeLeft` is 120, `BB_FLOWER_UNLOCK_S` is 60), the key is absent, and the same NECTAR bills a second MAJOR.

The path is reachable. A completed TIP earns a human-player NECTAR entry with no phase restriction beyond `enabled` (`play.ts:833`), so: TIP in AUTO, human enters a NECTAR, robot collects and places it, MAJOR, then a second MAJOR roughly eight seconds later for the same entry.

G402 and G417 both defend against exactly this with a per-MATCH latch on `bb.held[robot]` (`penalties.ts:426`, `:476`), which survives the wipe because `bb.held` is initialised once (`state.ts:330`) and reset nowhere. G410 has no such latch.

**Test gap, same defect.** The entire G410 block runs with `w.match.phase = 'teleop'` fixed (`rules.ts:553-606`). The only phase-boundary check in the file is G421's pin clock at `rules.ts:1403-1412`. `rules.ts:591-596` already asserts that a genuine re-entry fires again, which is why a wipe that is not a re-entry is indistinguishable from one.

**Why it matters**

An alliance that gets one NECTAR into a FLOWER during AUTO is charged 40 points to the opponent where the rule says MAJOR FOUL per NECTAR. The second charge lands on the first tick of TELEOP, after the driver has done nothing new, so it reads on the HUD as a phantom foul.

**Suggested fix**

Latch G410 the way G402 and G417 latch, so the award survives the `foulEdge` clear. A real re-entry (pop then push while still locked) must still re-fire, which `rules.ts:589-598` pins, so the latch has to key on (element id, entry instance) or be dropped when the id leaves the stack. Add two cases: a NECTAR staged into a flower during `auto` stepped through `transition` into `teleop` asserting exactly one MAJOR, and the mirror case of a NECTAR landing during `transition`.

**Confidence: high.** Verifier traced the whole chain line by line and independently established reachability through `play.ts:833`, which the original finding had not.

---

## BB-03 — [§9.8] A held NECTAR collides as a POLLEN

*Rule: §9.8. Severity: minor. Category: geometry.*

**The rule.** No G-rule governs this. §9.8 is the governing text: “POLLEN are approximately 2.8 in. … NECTAR are approximately 3.6 in.”

**What the manual says**

> POLLEN are approximately 2.8 in. (7.1 cm) … NECTAR are approximately 3.6 in. (9.1 cm) Gopher ResisDent polyethylene balls

**What the sim does**

`bbRobotSolids` (`src/games/biobuzz/robot.ts:197-201`) builds every held plug as `{ kind: 'circle', cx: b.state.lx, cy: b.state.ly, r: radius }`, where `radius` is the function parameter and the sole call site passes `BB_POLLEN_R` (`play.ts:650`). It never reads `b.r`.

Every sibling site does read it: `clampPollenToWalls` uses `bbElementRadius(bbKindOf(b))` (`play.ts:130`), `solveArtifacts` reads `b.r ?? radius`, and `draw.ts:59-63` uses `b.r ?? BB_POLLEN_R`. The NECTAR constant's own doc comment records the holdout (`config.ts:415-421`).

**Why it matters**

A robot carrying NECTAR presents a 2.8 in plug where the element is 3.6 in. A ground POLLEN can sit 0.4 in inside a carried NECTAR, and a full hopper of NECTAR does not block the mouth as much as it physically should, which matters most at the 1:00 dump when the whole NECTAR economy is in play.

**Suggested fix**

`held.push({ kind: 'circle', cx: b.state.lx, cy: b.state.ly, r: b.r ?? radius })`. One expression, matching every other radius reader in the game. Add a case beside the two ground-radius checks at `scripts/smoke-biobuzz/field.ts:957-1026` that drives a POLLEN into a robot holding a NECTAR and measures the rest separation against `BB_NECTAR_R + BB_POLLEN_R`.

**Confidence: high.** Verifier confirmed verbatim, including the code's own admission in the constant's doc comment.

---

## BB-04 — [Table 10-2] GARDEN points accrue during AUTO

*Rule: Table 10-2. Severity: minor. Category: missing-scoring.*  Also bears on: §10.5 E.

**The rule.** No G-rule governs this. Table 10-2 is the governing text: The GARDEN row reads AUTO “-”, TELEOP 1. §10.5 E: “Assessment of GARDEN scoring occurs at the end of TELEOP.”

**What the manual says**

> E. Assessment of GARDEN scoring occurs at the end of TELEOP after all ROBOTS and SCORING ELEMENTS come to rest.

Table 10-2's AUTO cell for the GARDEN row is blank. §10.5 D, by contrast, says FLOWER assessment occurs “throughout the MATCH”, so the GARDEN line is the only one whose live reading has no textual backing.

**What the sim does**

`bbScoreWorld` counts GARDEN elements in every phase (`score.ts:317-325`) and `s.gardenPts = s.gardenCount * BB_PTS.garden` is unguarded (`score.ts:336`). It sits directly beside `s.cellPts = matchOver ? … : 0` (`score.ts:335`), which IS gated on `phase === 'post'` with a long comment arguing the case (`score.ts:274-296`). Staging puts four POLLEN in each GARDEN at tick 0 (`spawn.ts:416-428`), so both alliances carry 4 GARDEN points from the first tick of AUTO. The smoke lane bakes it in at `field.ts:3575`.

**Why it matters**

The running score bar shows each alliance 4 points it has not earned, from the pre-match buzzer through the end of AUTO. The final total is correct, because the same elements are still there at the buzzer, so this is a live-display deviation and not a final-score one. If an AUTO subtotal is ever surfaced on the results screen or the burned-in overlay it will be wrong by the garden count.

**Suggested fix**

Gate `gardenPts` on the phase the way `cellPts` is gated, keeping `gardenCount` live as the driver's readout. If the owner prefers a live provisional reading as a product choice, record that ruling beside the CELL comment, because the two lines' different treatment currently reads as an oversight rather than a decision.

**Confidence: medium.** Verifier confirmed both sides, including that the sibling FLOWER lines being live is manual-supported by §10.5 D while the GARDEN line is not.

---

## BB-05 — [G403] A turret slews under power in `pre`, the transition and `post`

*Rule: G403. Severity: minor. Category: penalty.*  Also bears on: G404.

**The rule.** “Any powered movement of the ROBOT or any of its MECHANISMS” during the 8-second transition. G404 extends it past the end of TELEOP. Penalty: VERBAL WARNING; MAJOR FOUL and YELLOW CARD per MATCH, if STRATEGIC.

**What the manual says**

> G403: “Any powered movement of the ROBOT or any of its MECHANISMS” [during the 8-second transition]. “Movement due to inertia, gravity, or de-energizing of actuators, etc. is not considered powered movement.”
> G404: [powered movement] “after the end of TELEOP, until the Head REFEREE or designee signals retrieval.”
> G304.H: a ROBOT must be “fully motionless following completion of OpMode initialization”.

**What the sim does**

`biobuzzStep` calls `updateBiobuzz` in every phase (`step.ts:136`), and stage 5b runs `bbSlewTurret` for every non-passive robot with no `enabled` gate. The code states the choice: “A TURRET TRACKS WHETHER OR NOT THE ROBOTS ARE ENABLED. `robotsEnabled` gates DRIVER CONTROL … and a turret auto-tracking is none of those” (`play.ts:673-676`). `spawn.ts:240-246` aims a turret at field centre and `bbAimTarget` targets the nearer own CELL, so the turret is genuinely off-bearing at t=0 and genuinely slews during `pre`. `bbLaunch` is gated on `enabled`; the slew is not.

**Why it matters**

Three manual periods in which a BIOBUZZ robot is required to be inert have a powered mechanism moving in them. G304.H is a pre-match condition the start-legality gate cannot express, because the motion begins after the pose is judged. The stated cost of gating it, a swing off bearing on the first live tick, lands inside AUTO, where that swing is legal.

**Suggested fix**

Gate the stage-5b slew on `enabled` the way `bbLaunch` is, and have `spawn.ts` seed `turretHeading` and `turret2Heading` on `bbAimTarget`'s bearing from the start pose rather than on field centre, so the turret is already pointed when AUTO begins. Add a check that steps a turreted robot through `pre` → `transition` → `post` and asserts `turretHeading` never changes. See BB-37, which is the same hole from the test side.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-06 — [G427] G427.C is not modelled: an entered NECTAR can land inside a ROBOT

*Rule: G427. Severity: minor. Category: penalty.*  Also bears on: G204.

**The rule.** Constraints on where and how a SCORING ELEMENT is entered onto the FIELD. Penalty: MINOR FOUL per SCORING ELEMENT.

**What the manual says**

> G427: “NECTAR may not be introduced to the FIELD, except as follows: A. without the use of a tool, B. by a DRIVE TEAM member of the ALLIANCE of the corresponding color, and C. such that NECTAR contacts the TILE within the LOADING ZONE before contacting a ROBOT or a FIELD element.”
> G204's example: driving through the blue LOADING ZONE while a blue DRIVE TEAM member is introducing NECTAR, “deflecting the blue NECTAR before it contacts the TILE in the LOADING ZONE, in violation of G426.”

**What the sim does**

The human-player entry calls `land(next, spot.x + jx, spot.y + jy)` (`play.ts:848`) at a fixed point, `bbLoadingZoneSpot(a, BB_NECTAR_R)` (`config.ts:143-146`), jittered ±4 in. `land` (`play.ts:152-158`) routes the point through `clearOfStatics`, which by its own header pushes out of “every static it overlaps” using `biobuzzColliders`: the four walls, the FLOWER feet and the HIVE frame. Nothing tests for a ROBOT. `penalties.ts:59-60` lists G427 among the rules that are structural; the timing half is, and the tile-first half of clause C is not.

**Why it matters**

This is the common case, not the edge one. PARK rewards a robot for sitting in its own LOADING ZONE, and at 1:00 all five remaining NECTAR are entered there. A robot parked for the PARK points gets NECTAR materialised inside its footprint, which the shared solve then has to eject, and BIOBUZZ has no eviction pass of its own. A driver can also collect an entered NECTAR that never touched a tile, which is the exact sequence clause C forbids and G204 prices as a MAJOR against the interferer.

**Suggested fix**

Refuse the entry while a robot overlaps the entry footprint and say so through `nectarWhy`, which already has a refusal channel. Alternatively slide the spot along the zone to the nearest clear point before `land`. A check that parks a robot on `bbLoadingZoneSpot` and presses `bbNectar` pins whichever answer is chosen.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-07 — [G407] G407 is given DECODE's G408.C LOADING ZONE carve-out

*Rule: G407. Severity: minor. Category: penalty.*  Also bears on: G408.

**The rule.** “A ROBOT may not simultaneously CONTROL more than 4 SCORING ELEMENTS.” Penalty: VERBAL WARNING; MAJOR FOUL and YELLOW CARD per MATCH, if STRATEGIC.

**What the manual says**

> G407: “A ROBOT may not simultaneously CONTROL more than 4 SCORING ELEMENTS.”

The rule's only not-CONTROL notes are bulldozing (“inadvertent contact with a SCORING ELEMENT while in the path of the ROBOT moving about the FIELD”), deflecting (“being hit by a SCORING ELEMENT that bounces into or off a ROBOT”), and “SCORING ELEMENTS that have been LAUNCHED by a ROBOT that are no longer in contact with the ROBOT.” There is no LOADING ZONE clause anywhere in G407 in V1.

**What the sim does**

`BB_CONTROL_GEOMETRY.carveOut = (a) => BB_LZ[a]` (`penalties.ts:165-173`), handed to the shared `controlledArtifacts`. That function then does `if (home && robotInZone(r, home)) { for (const b of loose) if (inRect(b.pos, home)) { held.delete(b.id); excused.add(b.id); } }` (`src/sim/penalties.ts:830-843`): while the robot is in the rect, every loose element inside it is removed from the count and from the transitive chain. The shared field's own doc comment names it “carve-out C … the manual's ‘attempting to acquire a SCORING ELEMENT FROM THE LOADING ZONE’” (`src/sim/penalties.ts:562-569`), which is DECODE's G408.C.

**Why it matters**

BIOBUZZ's consequence is larger than DECODE's, because this game puts the whole NECTAR economy in that rectangle. G426.B releases all five remaining NECTAR into the LOADING ZONE at 1:00, so the one moment a robot is most likely to be over 4 CONTROL is the one moment the sim exempts it. Four checks in the RULES lane now assert the exemption, so the imported clause is locked in by tests as well as by code.

**Suggested fix**

Drop `carveOut` from `BB_CONTROL_GEOMETRY`, since the shared field is optional, and re-baseline the four checks at `rules.ts:913-1025` to assert the opposite. If leniency for restock collection is wanted, keep only the sim's own intake-mouth allowance, which is already documented as the sim's modelling of a multi-tick intake rather than as a manual clause.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-08 — [G417] G417 is disabled outright, so the HIVE-protection rule bills nothing

*Rule: G417. Severity: minor. Category: penalty.*  Also bears on: Table 10-4.

**The rule.** “ROBOTS may not manipulate the motion of the HIVE in any way other than by LAUNCHING SCORING ELEMENTS into an upward-facing CELL.” Penalty: VERBAL WARNING; MAJOR FOUL and YELLOW CARD per MATCH, if STRATEGIC.

**What the manual says**

> ROBOTS may not manipulate the motion of the HIVE in any way other than by LAUNCHING SCORING ELEMENTS into an upward-facing CELL. Violation: VERBAL WARNING. MAJOR FOUL and YELLOW CARD per MATCH, if STRATEGIC.

**What the sim does**

`BB_G417_ENABLED = false` (`penalties.ts:129`) and the enforcement loop opens with `if (!BB_G417_ENABLED) break;` (`penalties.ts:~360`), so no G417 award is ever made. The detector (`frameRam`, `barFaceNormal`, `BB_FRAME_RAM_SPEED`) is fully built and unreachable. The stated reason is an owner ruling of 2026-09-13: the HIVE is not a body a chassis can topple in this sim, so the rule could only be suffered, never earned. The smoke lane pins the disabled state.

**Why it matters**

A rule the manual prints has no expression at all. Defensible while the HIVE is immovable. It also corrects the record on BB-09: G417 bills neither half of its clause, because it does not run.

**Suggested fix**

No code change needed while the ruling stands. Keep `BB_G417_ENABLED` as the one-word switch it is documented to be, and record the ruling in the divergences block proposed in BB-12.

**Confidence: high.** This finding is itself a correction issued by the second-pass critic against the first pass.

---

## BB-09 — [§10.6.1] No card path exists in BIOBUZZ

*Rule: §10.6.1. Severity: minor. Category: missing-rule.*  Also bears on: §10.6.3, Table 10-4.

**The rule.** No G-rule governs this. §10.6.1 is the governing text: “YELLOW CARDS are additive, meaning that a second YELLOW CARD is automatically converted to a RED CARD.” A RED CARD results in MATCH DISQUALIFICATION.

**What the manual says**

> “YELLOW CARDS are additive, meaning that a second YELLOW CARD is automatically converted to a RED CARD.” “A RED CARD results in MATCH DISQUALIFICATION.”
> §10.6.3: “During Playoff MATCHES, YELLOW and RED CARDS are assigned to the violating team's entire ALLIANCE … If an ALLIANCE receives 2 YELLOW CARDS, the entire ALLIANCE is issued a RED CARD.”

**What the sim does**

`bbAwardFoul` (`penalties.ts:90-111`) has three severities, `minor`, `major` and `warning`, and issues no cards; its own comment at `penalties.ts:391-394` says so. The shared `awardCard` (`src/sim/scoring.ts:72-92`) already implements the full rule, including yellow-then-red escalation, the `world.match.cards` tally and `scores[alliance].voided = true`, and `bbApplyScore` already honours the result (`score.ts:391`). The only `awardCard` call site in the repo is DECODE's G408 (`src/sim/penalties.ts:424`).

Of the five rules BIOBUZZ implements, three carry a card clause and all three are conditional on STRATEGIC: G402, G407 and G417. G410 and G421 carry none, which the code states correctly. STRATEGIC is a Head Referee judgement and is properly out of scope for G402 (billed at its base MAJOR) and G407 (a WARNING by owner ruling, `penalties.ts:51-56`). G417 is the sharp case: `penalties.ts:380-400` makes the STRATEGIC determination itself via a closing-speed threshold and bills the “if STRATEGIC” MAJOR, then omits the card from the same clause. See BB-08: that whole branch is currently switched off, so nothing bills today either way.

**Why it matters**

No BIOBUZZ match can be disqualified, and §10.6.3's playoff behaviour is unrepresented. With exactly one cardable rule and that rule disabled, no score can currently differ, so this is plumbing rather than a live mis-score.

**Suggested fix**

Wire `awardCard` into `bbAwardFoul` behind a fourth severity or a separate `bbAwardCard`, so a rule can bill both together. `awardCard` is per robot and §10.6.3 is per alliance, so decide explicitly whether BIOBUZZ playoff rooms are in scope; if they are, that is a shared-core change. Landing the plumbing now is what lets the STRATEGIC branch of G402/G407/G417 be added later without a second sanction path. Note BB-20: the RP block must zero on `voided` before a card can ever be issued.

**Confidence: high.** Verifier confirmed the gap and narrowed it from “three rules cannot card” to “one rule makes the determination and drops the card”, then reduced the severity because the escalation is structurally unreachable today.

---

## BB-10 — [repo doctrine] No fouls are assessed in Free Drive

*Rule: repo doctrine. Severity: minor. Category: penalty.*  Also bears on: §10.6.

**The rule.** No G-rule governs this. repo doctrine is the governing text: No manual rule. CLAUDE.md states that DECODE assesses penalties in Free Drive, deliberately, because Free Drive is driver practice.

**What the manual says**

Nothing. The manual does not speak to a practice mode. This is raised because CLAUDE.md states the opposite rule for DECODE:

> `updatePenalties` runs for `auto`, `teleop` AND `freeplay` … Free Drive is DRIVER PRACTICE and practising without match fouls is the opposite of practice.

**What the sim does**

`updateBiobuzzPenalties` returns immediately for anything that is not `auto` or `teleop` (`penalties.ts:243-260`), so `freeplay` gets no G421 PINNING, no G407 CONTROL warning and no G410. The file's stated reason for the early return is edge-memory hygiene, not a phase-scope argument. CLAUDE.md's justification for Chain Reaction's identical gate is that G05/G06 are explicitly phase-scoped; BIOBUZZ's G421 and G407 are not, and DECODE's counterparts G422 and G408 are live in free drive. G402 self-gates on `isAuto` (`penalties.ts:444`) and G410 self-gates on `bbNectarLocked` (`penalties.ts:291`), so both would stay inert in freeplay on their own terms.

**Why it matters**

A driver practising BIOBUZZ in Free Drive is never told they are pinning or over-controlling, and Free Drive is the mode most practice happens in. No match result is affected.

**Suggested fix**

Extend the guard to `auto | teleop | freeplay`, which makes only G421 and G407 live, or write the deliberate divergence and its reason into the file header the way the other divergences there are written. Whichever is chosen, preserve the pin-clock clear: `penalties.ts:249-257` documents clearing `world.penalties.pins` as a deliberate divergence from DECODE, which otherwise bills a MAJOR on the first teleop tick for a hold that happened while robots were disabled.

**Confidence: medium.** Verifier confirmed the asymmetry and the self-gates, and noted the practical exposure is limited to a two-human free-drive session, since passive dummies are skipped and never attempt to move.

---

## BB-11 — [Table 10-2] WIN and TIE ranking points are never computed or printed

*Rule: Table 10-2. Severity: minor. Category: missing-scoring.*

**The rule.** No G-rule governs this. Table 10-2 is the governing text: “WIN — Completing a MATCH with more MATCH points than your opponent” 3 RP. “TIE … the same MATCH points” 1 RP.

**What the manual says**

> “WIN - Completing a MATCH with more MATCH points than your opponent” 3 RP
> “TIE - Completing a MATCH with the same MATCH points as your opponent” 1 RP

**What the sim does**

`BB_RP` (`src/games/biobuzz/config.ts:395-404`) declares `win: 3` and `tie: 1`. A repo-wide `grep -rn BB_RP` returns five lines: the declaration, two imports, three threshold reads at `score.ts:344-346`, and three label reads at `HudSlots.tsx:478-480`. Nothing reads `.win` or `.tie`. `BbRankPoints` (`score.ts:189-196`) is three booleans, `bbScoreWorld`'s RP block computes only those three (`score.ts:340-347`), and the RANKING POINTS section of `biobuzzResultsRows` prints exactly three rows (`HudSlots.tsx:475-482`). The `BB_RP` doc comment (`config.ts:392-394`) describes only the three thresholds and never mentions win/tie.

The WIN/TIE verdict itself does exist and is shown: `winner` at `GameView.tsx:1023-1024` and the `RED WINS` / `BLUE WINS` / `TIE` slam at `GameView.tsx:1154`. It is never converted into the manual's RP line.

**Why it matters**

The RANKING POINTS section a player reads is short by the largest line in the table, 3 of a possible 6, and that line is the only one every match produces. DSIM runs no qualification tournament, so nothing accumulates RP and no MATCH point is affected; this is Table 10-2 presentation completeness.

**Suggested fix**

Add `win` and `tie` to `BbRankPoints` (or one `winTie: 0|1|3`), set them in `bbScoreWorld`'s RP block, and add the rows to the RANKING POINTS section. Derive them from `world.match.scores[a].total`, not from `BbAllianceScore.total`: `score.ts:149-151` states that the latter deliberately excludes foul points, and `bbApplyScore` (`score.ts:391`) is what folds fouls in and zeroes a voided alliance, so using the wrong one reports the wrong winner in a foul-decided match. Award only at `phase === 'post'`: a live “WIN 3” that flips as the score crosses is not what “Completing a MATCH” means.

**Confidence: high.** Verifier confirmed every factual point and lowered the severity from major, on the grounds that the verdict is already shown and no RP total accumulates anywhere in DSIM.

---

## BB-12 — [§10.5.1] Three owner rulings narrow manual-legal scoring paths

*Rule: §10.5.1. Severity: minor. Category: missing-scoring.*  Also bears on: §10.5.2, G407.

**The rule.** No G-rule governs this. §10.5.1 is the governing text: The HIVE TIP and FLOWER scoring criteria, which these owner rulings narrow.

**What the manual says**

> A ROBOT may not CONTROL more than 4 SCORING ELEMENTS. Violation: VERBAL WARNING. MAJOR FOUL and YELLOW CARD, if STRATEGIC.

**What the sim does**

Three restrictions the sim enforces that the manual does not state, each documented at its enforcement site as an owner ruling:

1. A CELL refuses an element LAUNCHED by the other alliance. The comment is candid: “Nothing in the manual bans launching into the opponent's up-CELL, and the geometry does not stop you” (`play.ts:~500`). The shot silently falls to the tiles.
2. Nothing LAUNCHED ever enters a FLOWER (`play.ts:~455`). The only entry path is the Box Tube's proximity placement, so a build with no Box Tube can never score a FLOWER line, and `flowerAccepts` is a tested pure function with no production caller. This is BB-22 from the rule side.
3. `BB_STORAGE_MAX = 4` hard-caps every hopper (`config.ts:871`), which makes G407's “if STRATEGIC” branch unreachable through the hopper. Only the herded count can exceed 4 (`penalties.ts:~330`), and the sim models only the warning.

**Why it matters**

Three manual-legal actions are structurally impossible: de-scoring by tipping an opponent's HIVE, scoring a FLOWER by launch, and controlling a fifth element by hopper. A driver who reads the manual and tries any of them sees nothing happen and no explanation.

**Suggested fix**

Nothing to change if the rulings stand. Collect them, plus BB-08's G417 switch and BB-23's structural G408, into a single “documented divergences from V1” block in `docs/biobuzz-reference.md`, rather than only in the comment at each enforcement site, so a V2 re-read finds them all in one place.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-13 — [repo convention] The APPROX worklist grep misses nine constants

*Rule: repo convention. Severity: minor. Category: other.*

**The rule.** No G-rule governs this. repo convention is the governing text: No manual rule. config.ts states that every constant not printed in the manual carries an APPROX marker, and that the grep for it is the tape-measure work list.

**What the convention says**

> Every constant whose value is NOT printed in the V1 manual carries an `APPROX` comment naming what it was derived from. That is not decoration: someone greps `APPROX` in this file and that grep IS the work list for the next manual revision or field test.

**What the sim does**

`grep APPROX src/games/biobuzz/config.ts` is named as the worklist in two places (`config.ts:104`, `drawField.ts:49`), but nine APPROX constants live outside `config.ts` and are invisible to it: `BB_FLOWER_FLOOR_Z` 0.43, `BB_FLOWER_MID_Z` 3.98, `BB_FLOWER_VOL_Z`, `BB_FLOWER_ENTRY_MARGIN` 3.0 (`flower.ts:36,56,62,68`), `BB_HIVE_ACCEPT_MARGIN` 2.0, `BB_SPILL_SPEED`, `BB_SPILL_FAN` (`hive.ts:69,280,281`), `BB_FRAME_RAM_SPEED` 30 (`penalties.ts:790`) and `NECTAR_ENTRY_JITTER` 4.0 (`play.ts:323`).

Six of the nine decide scoring rather than feel. `BB_FLOWER_MID_Z` is the scoring volume's floor and therefore decides whether the bottom staged POLLEN counts and what a FLOWER's capacity is (`flower.ts:129-143` derives 8 and 5 from it); `BB_HIVE_ACCEPT_MARGIN` widens the CELL's accept window. `sim.ts:37` already names `BB_FRAME_RAM_SPEED` and `BB_FLOWER_MID_Z` as provisional inputs, which confirms they are known and off the stated list.

**Why it matters**

The 09-14 tape-measure list is incomplete by nine entries, and the omissions include the one number that decides whether a FLOWER element scores at all. Anyone who runs the documented grep will believe the flower column is measured.

**Suggested fix**

Move the nine into `config.ts` (`flower.ts`'s own header already says the move is “a one-line import change”), or change both stated worklist commands to `grep -rn APPROX src/games/biobuzz/`.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-14 — [§9.6] Four `BB_TIP_POLLEN` rows are single bench readings and carry no marker

*Rule: §9.6. Severity: minor. Category: wrong-value.*

**The rule.** No G-rule governs this. §9.6 is the governing text: “Each HIVE is bi-stable and will hold its position until enough POLLEN or NECTAR are LAUNCHED into the upwards-facing CELL.” V1 prints no threshold anywhere.

**What the source says**

> the field guide requires every HIVE to be CALIBRATED (with ballast washers) to tip at “[8] Pollen + [0] Nectar” and “[3] Pollen + [3] Nectar” (§12, V1.0 p26)

**What the sim does**

`BB_TIP_POLLEN = [8, 7, 6, 3, 1, 0]` (`config.ts:355`). Its own comment says rows 0 and 3 are the guide's exact thresholds and that “Rows 1, 2, 4 and 5 are NOT in the guide: MEASURED on a real HIVE (owner, 2026-09-12), ONCE”, then four paragraphs later says “no row is a guess any more”. Under the file's stated convention (“A number without the marker is a number the manual gave us”), four of the six rows should be marked and none is.

The same class covers every owner-CAD constant in the HIVE and FLOWER block: `BB_HIVE_CELL_DY` 13.37, `BB_HIVE_CELL_LEN` 10.43, `BB_HIVE_LEN` 37.16, `BB_FRAME_Y` 19.4, `BB_FLOWER_D` 2.54, `BB_FLOWER_FOOT`. All are “MEASURED (owner CAD)”, none is marked, none is printed in V1.

**Why it matters**

Four of the six tip thresholds, including 1 NECTAR + 7 POLLEN and 4 NECTAR + 1 POLLEN, both reachable in a normal match, read as manual-backed when they are one bench reading. If a row is wrong, every TIP in the game and both POLLINATOR RPs are wrong with it, and nothing flags it for re-measurement.

**Suggested fix**

Mark rows 1, 2, 4 and 5 in the constant's own taxonomy, with a third marker such as `CAD` if `APPROX` should stay reserved for figure reads, and delete the “no row is a guess any more” sentence, which contradicts the paragraph above it.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-15 — [internal] A cluster of placeholder-era comments still declares BIOBUZZ unscored

*Rule: internal. Severity: minor. Category: other.*

**The rule.** No G-rule governs this. internal is the governing text: No manual rule. These are placeholder-era comments left from before the manual landed.

**What the sim does**

Seven live files still describe the pre-kickoff shell:

- `step.ts:14` — “BIOBUZZ step — a playable, UNSCORED match”.
- `state.ts:222` on `points` — “SHELL: always 0 — `scored: false` on the sim module, so nothing writes here and no match of this game reaches a leaderboard”. `score.ts:387` writes it, `sim.ts:57` is `scored: true`, and matches persist.
- `state.ts:250` on `foulEdge` — “SHELL: always empty — `penalties.ts` has no rules, because Section 11 is a Kickoff placeholder”. `penalties.ts` is 925 lines enforcing G402, G407, G410 and G421.
- `state.ts:110-115` — “Nothing WRITES them yet: staging (`spawn.ts`) and the lifecycle land in a later pass”. `spawn.ts:587-596` stages all 56 elements.
- `state.ts:188` — “SHELL: only `'none'` is ever set” for `BbEndgame`. `bbApplyScore` sets `'parked'` at `score.ts:384`. See BB-31.
- `robot.ts:70` — “SCORING is still Lane A's and still ABSENT”.
- `index.ts:33` — “Section 9 (ARENA) is a Kickoff placeholder, so the field is four walls and a tile grid”. `colliders.ts` ships hives and flower feet; `drawField.ts` is 1088 lines.
- `index.ts:120` — “no score HUD (nothing is scored) and no start editor (no legality model)”, sitting immediately above a `startEditor: BiobuzzStartEditor` fill and `startLegality: true`.
- `config.ts:730-736` — “`coerceSpec` … has no BIOBUZZ arm yet (Lane B owns adding one)”. `src/sim/spawn.ts:485` is that arm.

**Why it matters**

Every one of these is load-bearing documentation in a repo whose convention is that the comment is the spec. A reader who trusts `state.ts` believes `points` is structurally zero and `foulEdge` structurally empty, which is exactly the reasoning that would justify dropping them from a snapshot or a replay.

**Suggested fix**

One pass deleting the SHELL and placeholder claims. `index.ts`'s `ui: { showScoreHud: false, startEditor: false }` should go with them: `GameUiSpec` has no reader so the values are inert, but they now state the opposite of the module beside them.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-16 — [§10.5.4] LEAVE requires 1.25 in of wall clearance the rule does not ask for

*Rule: §10.5.4. Severity: nit. Category: wrong-value.*

**The rule.** No G-rule governs this. §10.5.4 is the governing text: “To qualify for LEAVE points, a ROBOT must move so that it is no longer contacting the perimeter wall.”

**What the manual says**

> To qualify for LEAVE points, a ROBOT must move so that it is no longer contacting the perimeter wall.

**What the sim does**

`bbLeftNow` (`score.ts:96-103`) computes `const lim = BB_HALF_X - START_TOUCH_TOL` and requires every footprint corner strictly inside it. `START_TOUCH_TOL` is 1.25 (`src/config.ts:2781`), the shared start-touch tolerance. A robot resting on the wall has a corner at exactly `BB_HALF`, so it must back off a full 1.25 in before `bbLeftNow` is true. The same predicate is the latch (`step.ts:160`), so this tolerance is the only definition of LEAVE in the game. The code comment is honest that this is anti-flicker slack and that the constant is borrowed.

**Why it matters**

A robot that barely breaks contact by the AUTO buzzer loses 3 points a referee would award. Solver-jitter epsilon is thousandths of an inch; 1.25 in is two orders of magnitude larger and comes from a START rule about what counts as TOUCHING.

**Suggested fix**

Shrink the tolerance to something well under a referee's eye, such as the containment slop rather than the full start-touch tolerance, or keep it and mark it as a deliberate deviation beside the predicate.

**Confidence: medium.** Verifier confirmed the arithmetic and declined to refute it on epsilon grounds, while holding the severity at nit because it is a 3-point line that bites only a robot that crept off the wall.

---

## BB-17 — [§10.5.3] `bbInGarden` adds a not-held condition §10.5.3 does not state

*Rule: §10.5.3. Severity: nit. Category: missing-rule.*

**The rule.** No G-rule governs this. §10.5.3 is the governing text: “To qualify for GARDEN points, POLLEN or NECTAR must be at least partially in the GARDEN zone.”

**What the manual says**

> To qualify for GARDEN points, a POLLEN or NECTAR must be at least partially in the GARDEN zone.

§9.3 defines the GARDEN as “an approximately 23 in. by 2 in. wide and infinitely tall volume defined by the outside edge of blue or red tape”.

**What the sim does**

`bbInGarden` returns false for anything whose `state.kind !== 'ground'` (`score.ts:130`), the first line of the test, before any geometry runs. An element in a robot's hopper sitting over the tape at the buzzer scores nothing. The header argues the case: a carried element tracking its robot across a garden would otherwise score while carried. The smoke lane pins the exclusion (`rules.ts:197-198`).

**Why it matters**

“At least partially in” an infinitely tall volume does, read literally, admit an element held inside a robot straddling the tape. A robot parked on its own GARDEN holding elements at the buzzer is denied 1 per element. The condition is the sim's, not the manual's.

**Suggested fix**

If the GARDEN line moves to end-of-match assessment (BB-04), reconsider whether the ground-only filter is still needed. Either way, state the condition where a player can see it.

**Confidence: low.** Verifier confirmed the condition is added and not manual-grounded, and rated it nit on reachability: a robot would have to end the match parked on a 2 in corner strip while holding elements.

---

## BB-18 — [§9.6.1] HIVE frame bars are 50.0 in outer-to-outer against a printed 49.46

*Rule: §9.6.1. Severity: nit. Category: geometry.*

**The rule.** No G-rule governs this. §9.6.1 is the governing text: “The frame is 49.46 in. (125.65 cm) wide, and 38.95 in. (98.95 cm) deep at its base.”

**What the manual says**

> The frame is 49.46 in. (125.65 cm) wide, and 38.95 in. (98.95 cm) deep at its base, which is also its widest point.

**What the sim does**

`BB_FRAME_BAR_IN` 24 and `BB_FRAME_BAR_OUT` 25 (`config.ts:230-231`) put the two base bars at x ∈ [24,25] and [−25,−24], 50.0 in outer-to-outer, and `colliders.ts:55-58` builds the robot-blocking statics straight from them. The comment justifies the inner edge sitting on the ±24 tile seam as the measured CAD fact and never mentions the printed 49.46. A grep for `49.46|125.65` across all of `src/` and `docs/biobuzz/` returns exactly one hit, the quoted manual text at `manual-distilled.md:545`.

The adjacent depth constant documents exactly this class of divergence: `config.ts:233-235` reads “Fig 9-8 prints a 38.95-in frame depth and the CAD measures 38.80”. The width one does not.

**Why it matters**

The two bars a robot can hit sit 0.27 in further out on each side than the real frame. Negligible in play, but it is an undocumented drift from a printed number, and the 09-14 tape-measure list greps `config.ts` for exactly these.

**Suggested fix**

Add the same one-line note the depth carries, or move `BB_FRAME_BAR_OUT` to 24.73 so the outer span is the printed 49.46. Choosing owner CAD over a figure callout is defensible; not writing down that you did is the finding.

**Confidence: medium.** Verifier confirmed the constants, the collider derivation and the repo-wide absence of the printed figure.

---

## BB-19 — [§9.7] The lower FLOWER ring is a flat floor, not a seat

*Rule: §9.7. Severity: nit. Category: geometry.*

**The rule.** No G-rule governs this. §9.7 is the governing text: “There is a lower ring that sits on the TILE floor and is approximately 0.4 in. (1.0 cm) tall with an hole for POLLEN to sit in that is approximately 2.79 in. (7.1 cm) diameter.”

**What the manual says**

> There is a lower ring that sits on the TILE floor and is approximately 0.4 in. (1.0 cm) tall with an hole for POLLEN to sit in that is approximately 2.79 in. (7.1 cm) diameter.

Figure 9-12: “Thickness of Bottom Ring 0.43 in. (1.1 cm)”.

**What the sim does**

`BB_FLOWER_FLOOR_Z = 0.43` (`flower.ts:32-36`) is the ring's top face, so a bottom POLLEN's centre is 1.83 and the column builds from there (`flower.ts:86`). The manual's wording is that the pollen sits IN the hole, down into the ring, which would put its centre lower.

**Why it matters**

Nothing downstream moves. The bottom pollen's top is 3.23 as modelled and would be at most 2.80 if recessed, and both are below the 3.98 volume floor, so it is non-scoring either way. Capacity is 8 at both floors. This is a drawn-height detail only, worth up to 0.43 in in the section drawing.

**Suggested fix**

Leave it, or recess by `min(ringHeight, R − sqrt(R² − (2.79/2)²))` if the section drawing is ever compared against a photo.

**Confidence: high.** Verifier added a caveat worth carrying: `BB_POLLEN_R` is 1.4, so a 2.8 in POLLEN against a 2.79 in hole is a 0.01 in interference and the ball wedges on the rim rather than nesting. The true magnitude is undetermined between 0.43 and 1.28 depending on how the two “approximately” figures are read, and neither reading changes a score.

---

## BB-20 — [§10.6.1] The RP block ignores `voided`

*Rule: §10.6.1. Severity: nit. Category: missing-rule.*  Also bears on: Table 10-4.

**The rule.** No G-rule governs this. §10.6.1 is the governing text: DISQUALIFIED is “the state of a team in which they receive 0 MATCH points and 0 RANKING POINTS in a Qualification MATCH”.

**What the manual says**

> DISQUALIFIED: “the state of a team in which they receive 0 MATCH points and 0 RANKING POINTS in a Qualification MATCH or causes their ALLIANCE to receive 0 MATCH points in a Playoff MATCH.”
> RED CARD: “a penalty issued by Head REFEREE … results in team being DISQUALIFIED [for the] MATCH.”

**What the sim does**

`bbApplyScore` honours the void for MATCH points (`score.ts:391`, `br.total = br.voided ? 0 : line.total + br.foulPoints`) and the smoke lane pins it (`rules.ts:420-422`). The RP block in `bbScoreWorld` (`score.ts:340-347`) reads `s.leave + s.parkAuto + s.parkTele` and `s.tips` with no `voided` test, and `bbScoreWorld` never reads `world.match.scores[a].voided` at all.

This is latent, not live. The sole writer of `voided` in the repo is `awardCard` (`src/sim/scoring.ts:84`) and the sole `awardCard` call site is DECODE's G408 (`src/sim/penalties.ts:424`). No BIOBUZZ alliance can currently be voided, so the described contradiction cannot occur yet.

**Why it matters**

The day BB-09 lands, a red-carded alliance prints SWARM / POLLINATOR 1 / POLLINATOR 2 as earned directly under a 0 total and under the forfeit banner. Once BB-11 lands too, a forfeiting alliance could be shown a WIN RP.

**Suggested fix**

Zero the whole `rp[a]` record when `world.match.scores[a].voided`, in the same loop that already sets it (`score.ts:340`). Fix it with BB-09 rather than before it.

**Confidence: medium.** Verifier confirmed the code gap and established that the symptom is unreachable today, which is why the severity dropped.

---

## BB-21 — [§10.4] AUTO is driver-controlled

*Rule: §10.4. Severity: nit. Category: missing-rule.*  Also bears on: G305, G401.

**The rule.** No G-rule governs this. §10.4 is the governing text: “During AUTO, ROBOTS operate without any DRIVER control or input.”

**What the manual says**

> During the first 30 seconds of the MATCH, the ROBOTS operate autonomously. … During AUTO, ROBOTS operate without any DRIVER control or input.

**What the sim does**

`robotsEnabled` returns true for `'auto'` (`src/sim/match.ts:76-79`) and `biobuzzStep` applies `commands.get(r.id)` whenever `enabled` (`step.ts:90,102`), so a human stick drives the robot for the whole AUTO period. BIOBUZZ also declares `autoPaths: false` (`sim.ts:76`) and never calls `updatePathTraversal`, so there is no autonomous-routine path either. LEAVE, AUTO PARK and any AUTO TIP are all earned by hand-driving.

This is shared DSIM architecture rather than a BIOBUZZ defect. `src/sim/world.ts:134` shows DECODE takes the driver's command in AUTO too unless `r.autoPathActive`, and an auto path is an optional imported `.pp` file (`src/ui/MatchSetup.tsx:171-174`), so a DECODE player who has not imported one hand-drives their AUTO identically. Chain Reaction is the same. All three games' `autoPaths` values are deliberately pinned at `scripts/smoke.ts:16089-16091`, so `false` here is a recorded decision.

**Why it matters**

The AUTO period exists as a clock and an assessment instant but not as an autonomous period. The only BIOBUZZ-specific residue is that `autoPaths: false` means a BIOBUZZ player cannot even opt into what a DECODE player can.

**Suggested fix**

If this is to be closed, the seam exists: implement `updatePathTraversal` in `biobuzzStep` and flip `autoPaths: true`. If it stays, a one-line note in `step.ts`'s pipeline header saying AUTO is driver-driven on purpose stops the next auditor re-raising it.

**Confidence: medium.** Verifier confirmed the facts and re-scoped the finding from a BIOBUZZ manual gap to a shared-core roadmap item, since `robotsEnabled` is the single site deciding this for all three games.

---

## BB-22 — [G418.A] Nothing launched can enter a FLOWER

*Rule: G418.A. Severity: nit. Category: missing-rule.*  Also bears on: §10.5.2.

**The rule.** “ROBOTS may not enter SCORING ELEMENTS into … a FLOWER except: A. only enter POLLEN and NECTAR into the top of a FLOWER.” §10.5.2: “Placing SCORING ELEMENTS into the top of the FLOWER is the only allowable way to score.”

**What the manual says**

> G418: “ROBOTS may not enter SCORING ELEMENTS into or remove SCORING ELEMENTS from a FLOWER except: A. only enter POLLEN and NECTAR into the top of a FLOWER…”
> §10.5.2: “Placing SCORING ELEMENTS into the top of the FLOWER is the only allowable way to score.”
> §9.7: “There is a backstop on top of each FLOWER to help guide POLLEN and NECTAR into the FLOWER. This backstop is 1.25 in. (3.15 cm) tall.”

**What the sim does**

The flight-to-FLOWER branch was removed: “With the flower flight branch gone (nothing launched enters a FLOWER)” (`play.ts:165-166`) and “the [branch] that used to sit here is gone; `flowerAccepts` (`flower.ts`) stays as a pure function” (`play.ts:452`). `flowerAccepts` (`flower.ts:151-157`) has callers only in the smoke lane (`scripts/smoke-biobuzz/field.ts:3420-3424`). The only route in is `placeLatch` on `bbPlace`/`bbPlaceNectar`, which is 2D proximity of `bbPlacePointLocal` to a ring with, in the owner's words, “no raise and no height” (`play.ts:728-730`).

**Why it matters**

The manual constrains the direction an element enters a FLOWER, through the top, not the mechanism, and §9.7's backstop exists to guide arriving elements in. The sim converts that into a hardware requirement: a build without a Box Tube can never score a FLOWER at all, and a lob through the 4.0 in top opening is impossible for every archetype. This is an owner ruling rather than an oversight, logged because no domain owned “how an element gets into a FLOWER” and the ruling deletes a path the manual grants.

**Suggested fix**

No code change unless the owner reopens it. If reopened, `flowerAccepts` is already written and already asserted, so re-wiring it into stage 2's flight capture beside the HIVE branch is the whole job. Either way, record the ruling in the divergences block proposed in BB-12.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-23 — [G408] `bbIntakeAccepts` enforces G408 structurally

*Rule: G408. Severity: nit. Category: penalty.*

**The rule.** “A ROBOT may not CONTROL the opponent’s NECTAR.” Penalty: VERBAL WARNING; YELLOW CARD per MATCH, if STRATEGIC. No FOUL at any level.

**What the manual says**

The sim cites G408 for “a NECTAR belonging to the OTHER alliance”. The verbatim rule text was not available to this pass.

**What the sim does**

`bbIntakeAccepts` (`mechs.ts:158-163`) returns false for a NECTAR whose colour is not the robot's alliance, and `capturePollen` (`elements.ts:94-96`) refuses the capture outright, so a robot physically cannot pick up the opponent's NECTAR and G408 never fires as a foul.

G410 depends on this. Its comment reads “A nectar is only ever handled by its own alliance (G408 refuses the opponent's at the intake), so its colour names who put it there”, which is what lets G410 attribute an illegal FLOWER entry by element colour alone.

The same predicate also refuses a robot's own NECTAR when its launcher is a single turret, which is a hardware model with no rule behind it.

**Why it matters**

G408 is unbillable, and the G410 offender attribution silently depends on that. If the ruling is relaxed so a robot can touch the opponent's NECTAR, G410 will attribute the foul to the wrong alliance rather than failing loudly.

**Suggested fix**

Leave the structural refusal and note the dependency at the G410 site, so the two move together.

**Confidence: medium.** Second-pass critic finding; no independent verifier note.

---

## BB-24 — [G419] G419 and G420 are absent from the “deliberately not here” list

*Rule: G419. Severity: nit. Category: penalty.*  Also bears on: G420, G421.

**The rule.** “A ROBOT may not damage or functionally impair an opponent ROBOT.” G420 covers attaching, tipping over and entangling. The §11.4.5 preamble makes G419 and G420 mutually exclusive.

**What the manual says**

> “G419 and G420 are mutually exclusive. A single ROBOT to ROBOT interaction which violates more than 1 of these rules results in the most punitive penalty, and only the most punitive penalty, being assessed.”
> G419: “A ROBOT may not damage or functionally impair an opponent ROBOT.”
> G420: “A ROBOT may not attach to, tip over, or entangle an opponent ROBOT.”

**What the sim does**

`penalties.ts:41-60` enumerates what is enforced (G410, G402, G417-off, G421, G407) and then what is “NOT HERE, each for a stated reason rather than an oversight: G405 / G409 / G411 / G418 / G426 / G427”. G419 and G420 appear nowhere in the file, in `config.ts`, or in any smoke check, and they are the two rules immediately beside the one opponent-interaction rule that is modelled. A 2D sim with no damage model and no tipping cannot express either, so the absence is right. It is the record of the decision that is missing, and that list is the only place the repo says which Section 11 rules were considered.

**Why it matters**

No runtime effect. That comment is the audit trail: the next person reconciling Section 11 against the engine reads it as complete, and two rules from the same subsection as G421 are silently outside it, along with the preamble that says how a G419/G420/G421 collision is to be resolved.

**Suggested fix**

Add G419 and G420 to the NOT-HERE list with the real reason, no damage model and no tipping in 2D, and note that the §11.4.5 mutual-exclusivity preamble is therefore vacuous, so whoever later adds a tipping or impairment model knows G421 has to be de-duplicated against it.

**Confidence: medium.** Second-pass critic finding; no independent verifier note.

---

## BB-25 — [Table 9-1] “END GAME” is burned into every exported BIOBUZZ replay video

*Rule: Table 9-1. Severity: nit. Category: terminology.*  Also bears on: §10.4.

**The rule.** No G-rule governs this. Table 9-1 is the governing text: The audio cue table. “Final 20 seconds 0:20 Train Whistle” is the whole of what the manual attaches to that instant. BIOBUZZ defines no endgame period.

**What the manual says**

> MATCHES consist of pre-MATCH setup, a 30-second AUTO period, an 8-second transition period between AUTO and TELEOP, and a 2-minute TELEOP period, followed by the post-MATCH reset. … Final 20 seconds 0:20 “Train Whistle”

BIOBUZZ has no END GAME period. `docs/biobuzz/manual-distilled.md:86-87` puts it plainly: the 0:20 cue “is an audio cue and nothing else. No scoring line, RP, or rule keys on it”.

**What the sim does**

`hudLabels` in `src/ui/replayOverlay.ts:104-113` is game-agnostic and returns `'END GAME'` for `phase === 'teleop' && m.phaseTimeLeft <= ENDGAME_START`, where `ENDGAME_START` is DECODE's shared constant of 20. `drawReplayHud` (`replayOverlay.ts:259`) calls it unconditionally and is the capture's overlay, so the last 20 s of every exported BIOBUZZ clip carries the label.

The live HUD is correct. `PHASE_LABEL` (`HudSlots.tsx:318-323`) has no endgame member and `:389` prints it unchanged, and `GameView.tsx:619-621` short-circuits the shared bar whenever `GameScoreBar` exists.

**Why it matters**

A permanent artefact, the file people share and that outlives the sim version, carries a DECODE and Chain Reaction period name on a BIOBUZZ match.

**Suggested fix**

Gate the END GAME split on the game in `hudLabels`, or route it through a module slot so a season states its own late-match label. `scripts/smoke.ts:13266-13325` already pins `hudLabels` for DECODE; add a BIOBUZZ case there or in `scripts/smoke-biobuzz/`.

**Confidence: high.** Verifier confirmed every limb, including that `grep -rni endgame src/games/biobuzz/` returns only `BbEndgame`/`bb.endgame`, which is PARK status rather than a period.

---

## BB-26 — [Table 9-1] The HUD clock shows the phase countdown, not the field timer

*Rule: Table 9-1. Severity: nit. Category: ux-hud.*

**The rule.** No G-rule governs this. Table 9-1 is the governing text: The primary FIELD timer reads 2:30 at MATCH start and 2:00 when AUTO ends.

**What the manual says**

> MATCH start 2:30 … AUTO ends 2:00 … AUTO to TELEOP Transition 0:08 to 0:01 … TELEOP begins 2:00 … Final 20 seconds 0:20 … MATCH end 0:00

**What the sim does**

`HudSnapshot.timeLeft` is `world.match.phaseTimeLeft` (`src/game.ts:1296`) for every game, and the BIOBUZZ score bar prints it through `fmtTime` unchanged (`HudSlots.tsx:391`). `biobuzzStepMatch` seeds `phaseTimeLeft = C.AUTO_DURATION` (30) at the AUTO flip (`step.ts:206`), exactly as `src/sim/match.ts:9,23` does for DECODE, so the on-screen clock runs 0:30 → 0:00 during AUTO where the field timer reads 2:30 → 2:00. TRANSITION and TELEOP agree with Table 9-1 because their phase durations equal their field-timer values; AUTO is the one period where they differ.

**Why it matters**

At the AUTO buzzer a real field reads 2:00 and the sim reads 0:00. Anyone rehearsing an auto routine against event audio or video timestamps is a full 2:00 out. No rule, score or assessment reads this number, and time-left-in-period is arguably the more useful readout.

**Suggested fix**

BIOBUZZ owns its whole bottom bar, so the display half is local: in `BiobuzzScoreBar`, render `fmtTime(hud.phase === 'auto' ? hud.timeLeft + C.TELEOP_DURATION : hud.timeLeft)`. The transition keeps its own 0:08 countdown, which Table 9-1 also shows separately. A general fix needs a per-game HUD clock slot on `GameModule`.

**Confidence: high.** Verifier confirmed the divergence is real, identical in all three games, and cosmetic, which is why it is a nit.

---

## BB-27 — [Table 10-4] The sanction line says WARNING where the manual says VERBAL WARNING

*Rule: Table 10-4. Severity: nit. Category: terminology.*

**The rule.** No G-rule governs this. Table 10-4 is the governing text: “VERBAL WARNING — a warning issued by event staff or the Head REFEREE.”

**What the manual says**

> “VERBAL WARNING | a warning issued by event staff or the Head REFEREE”

**What the sim does**

`bbAwardFoul` pushes `WARNING - ${offender.toUpperCase()} (${rule})` (`penalties.ts:98-101`), and the RULES lane pins that exact rendered string (`scripts/smoke-biobuzz/rules.ts:548-550, 849-850`). MINOR FOUL and MAJOR FOUL are both spelled in full on the same channel three lines below.

**Why it matters**

`world.events` is one of the three surfaces the terminology ruling names, alongside the live HUD and the burned-in video overlay. The manual has exactly one penalty named VERBAL WARNING, and the abbreviation is the only sanction word on this channel that is not the manual's. A driver reading a replay log sees three penalty tiers, two named as the rulebook names them and one not.

**Suggested fix**

`VERBAL WARNING - RED (G407 …)`, and re-baseline the two pinned strings in `rules.ts`.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-28 — [§9.3] The gallery label abbreviates LOADING ZONE to “LZ”

*Rule: §9.3. Severity: nit. Category: terminology.*

**The rule.** No G-rule governs this. §9.3 is the governing text: “LOADING ZONE: an approximately 23 in. … by 11 in. … volume bounded by red or blue tape and the adjoining FIELD perimeters.”

**What the manual says**

> LOADING ZONE: an approximately 23 in. (58.40 cm) wide by 11 in. (27.95 cm) deep infinitely tall volume bounded by red or blue tape and the adjoining FIELD perimeters.

**What the sim does**

`drawField.ts:990` prints `${name} LZ`. The GARDEN label sixteen lines down (`drawField.ts:1006`) prints `${name} GARDEN` in full, in the same loop, and the comment above (`drawField.ts:978-979`) says the LOADING ZONE rect “is 11 × 24 and has the room”. The whole block returns early unless `world.biobuzz?.labels === true` (`drawField.ts:972`), and that flag is written in exactly two places, both gallery scene builders (`scenesField.ts:240, 290`).

**Why it matters**

A reviewer reading a gallery still sees an abbreviation the manual never uses. It renders in no match, no HUD and no results screen. It is not a cross-game leak: a grep of the whole directory confirms no DECODE “artifact” or Chain Reaction “particle” appears in any BIOBUZZ copy.

**Suggested fix**

`${name} LOADING ZONE` if it fits the 11 × 24 rect at `LABEL_SIZE`, otherwise stack it on two lines.

**Confidence: high.** Verifier confirmed the inconsistency is internal to one gallery-only block.

---

## BB-29 — [§9.8] `bb.scored` and the config summary say POLLEN where they mean elements

*Rule: §9.8. Severity: nit. Category: terminology.*

**The rule.** No G-rule governs this. §9.8 is the governing text: “SCORING ELEMENTS for BIOBUZZ are POLLEN and NECTAR.” They are two distinct kinds.

**What the manual says**

> POLLEN are yellow and NECTAR carries its alliance colour.

**What the sim does**

`BiobuzzState.scored` is declared as “POLLEN scored per alliance, as a COUNT” (`state.ts:215-218`), but `bbApplyScore` writes `line.cellCount + line.ownedCount + line.gardenCount` (`score.ts:388`), which is every element of both kinds in a CELL, an owned FLOWER or a GARDEN. `hud.ts:95` and the score-bar panel label it “elements”, which is correct; the state type is the one place that still says POLLEN.

The same slip is user-visible at `labels.ts:181-182`, where `bbConfigSummary` prints `${spec.ballStorage} pollen` for a hopper that legally holds NECTAR on a dumper or double turret.

**Why it matters**

`bbConfigSummary` reaches leaderboard rows and match-strategy cards. It tells a dumper driver their hopper holds “4 pollen” when it holds four of either element.

**Suggested fix**

Say “elements” in both places. The manual has no collective noun, but SCORING ELEMENT is its own term and “elements” is what the rest of this game's copy already uses.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-30 — [§9.8] `BiobuzzState.held`'s example invents a QUEEN

*Rule: §9.8. Severity: nit. Category: terminology.*

**The rule.** No G-rule governs this. §9.8 is the governing text: “SCORING ELEMENTS for BIOBUZZ are POLLEN and NECTAR.” There is no third kind.

**What the manual says**

> POLLEN … NECTAR … HIVE … CELL … FLOWER … GARDEN

**What the sim does**

`state.ts:232` documents the per-robot latch bag with `held[robotId]['queen'] = true`. There is no QUEEN in BIOBUZZ. The live keys are `placeP`, `placeN`, `nectarPress`, `g402billed` and `g417billed` (`play.ts:812-816`, `penalties.ts:426,476`).

**Why it matters**

Comment only, but it sits in the state type that defines this game's vocabulary for the next reader, and the file's own terminology block is strict about exactly this.

**Suggested fix**

Use one of the real keys as the example.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-31 — [§10.4] `bb.endgame` has no reader and an unreachable `'climbed'` member

*Rule: §10.4. Severity: nit. Category: other.*  Also bears on: §10.1.

**The rule.** No G-rule governs this. §10.4 is the governing text: The MATCH is AUTO, an 8-second transition and TELEOP. No endgame period is defined.

**What the manual says**

> MATCHES consist of pre-MATCH setup, a 30-second AUTO period, an 8-second transition period between AUTO and TELEOP, and a 2-minute TELEOP period, followed by the post-MATCH reset.

There is no endgame period. There IS an end-of-match robot state, PARK (§10.5.4, Table 10-2).

**What the sim does**

`state.ts:192` declares `type BbEndgame = 'none' | 'parked' | 'climbed'` with a stale comment reading “SHELL: only `'none'` is ever set. Section 10 defines what an endgame IS for this game”. It is written twice per tick (`play.ts:888` clears it, `score.ts:384` re-derives it as `bb.parkTele[r.id] ? 'parked' : 'none'`), and a whole-repo grep filtered of Chain Reaction returns no reader at all: no UI, no HUD slice (`hud.ts` never projects it), no results row (`HudSlots.tsx:449` reads `parkTeleCount`/`parkTele` off the score line). The only read anywhere is `scripts/smoke-biobuzz/rules.ts:1511`.

`'parked'` is manual-grounded, and `score.ts:379-383` says so. Only `'climbed'` is a pre-kickoff leftover, and the `state.ts:188` comment is now false.

**Why it matters**

A per-robot field on the wire 30 times a second that nothing consumes, carrying a value space from a game BIOBUZZ is not. The stale comment will mislead the next reader into believing an endgame is pending definition.

**Suggested fix**

Delete `endgame` from `BiobuzzState`, since PARK already lives in `parkAuto`/`parkTele` which the score and HUD actually read. At minimum drop `'climbed'` and rewrite the comment to say the manual defines no endgame. Deleting it removes a per-tick field from every snapshot; see CLAUDE.md's `costprobe` note.

**Confidence: high.** Verifier confirmed the write sites, the absence of readers, and corrected the framing: only `'climbed'` is invented, not `'parked'`.

---

## BB-32 — [§10.3.1] `BB_POLLEN_SIM = 60` is a dead element count with a live marker

*Rule: §10.3.1. Severity: nit. Category: staging.*  Also bears on: §9.8.

**The rule.** No G-rule governs this. §10.3.1 is the governing text: “40 POLLEN are staged on the FIELD as follows: 4 POLLEN in each of the 4 FLOWERS (16) … 4 POLLEN pre-loaded in each ROBOT (16).”

**What the manual says**

> There are 40 POLLEN, 8 red NECTAR, and 8 blue NECTAR total in a BIOBUZZ MATCH.

**What the sim does**

`BB_POLLEN_SIM = 60` (`config.ts:435`) is self-described as “a placeholder chosen to LOOK like a field worth driving on … not a manual count”. Nothing in `src/` reads it. A whole-repo grep finds two hits: the definition, and an unused import at `scripts/smoke-biobuzz/field.ts:22`. The real staging (`stageBiobuzz`, `spawn.ts:578-599`) uses `BB_POLLEN_COUNT` and `BB_NECTAR_COUNT`, and the §10.3.1 distribution is asserted at `field.ts:1497-1503`.

**Why it matters**

No runtime effect. It is a wrong element count sitting in the file that is meant to be the single source of BIOBUZZ constants, next to the right one, and the dead import makes it look live.

**Suggested fix**

Delete `BB_POLLEN_SIM` and the import at `scripts/smoke-biobuzz/field.ts:22`. Clear the stale `scatterPollen` reference in the comment at `scenesField.ts:421` while there.

**Confidence: high.** Verifier confirmed the greps and noted this is already logged: `docs/biobuzz/feedback/002-thresholds.md:271` is titled “`BB_POLLEN_SIM` is dead and still carries a live marker” and names the same unused import. Close it against that ticket rather than opening a second one.

---

## BB-33 — [R105.A] `BB_TAPE_2` and `BB_EXPANSION` are dead constants

*Rule: R105.A. Severity: nit. Category: other.*  Also bears on: §9.3.

**The rule.** In-MATCH expansion is limited to an 18 x 24 x 29 in sizing volume.

**What the manual says**

> a ~23 × 2 in strip in the alliance's own corner, “defined by the outside edge of tape”, two 1-in tapes

**What the sim does**

`BB_TAPE_2 = 2` (`config.ts:162`) has no reader anywhere in `src` or `scripts`. `drawField.ts:724` strokes the GARDEN at `BB_TAPE_1`, and the 2 in depth is already carried by `BB_GARDEN`'s rect (y0 −72, y1 −70). `BB_EXPANSION = BB_PRISM - ROBOT_MAX_SIZE` (`config.ts:682`) likewise has no reader: `bbEnvelope` works directly off `BB_PRISM`/`BB_PRISM_NARROW` (`config.ts:801-820`). Both are carried over from the Chain Reaction copy this file started as. `BB_POLLEN_SIM` is the third, covered in BB-32.

**Why it matters**

None at run time. They are noise in the one file whose stated purpose is that every constant in it is either manual-printed or marked APPROX.

**Suggested fix**

Delete both, or give `BB_TAPE_2` its reader: the GARDEN stroke currently draws the 2 in strip at 1 in width.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-34 — [G421] Stale comment claims G421's solid probe reads DECODE's field

*Rule: G421. Severity: nit. Category: other.*

**The rule.** “A ROBOT may not PIN an opponent’s ROBOT for more than 3 seconds.” Penalty: MAJOR FOUL per instance and an additional MAJOR FOUL for every 3 seconds in which the situation is not corrected.

**What the sim does**

`penalties.ts:553-563` states: “⚠️ `isPinning`'s INTERNAL SOLID PROBE IS DECODE'S FIELD … this only bites in the four corner regions DECODE puts a goal in: a victim held there reads as ‘cornered against a solid, therefore escaping rather than pinning’, and the pin goes UNBILLED … Until then a pin in a BIOBUZZ corner is free.”

The call thirty lines below passes `bbPinSolid` (`penalties.ts:594`). `isPinning` takes an optional `solid?: PinSolid` and `pinnedAgainstWall` short-circuits on it (`src/sim/penalties.ts:1031-1032`, `if (solid) return solid(p)` sits above the perimeter, goal-wedge and classifier branch), so the DECODE branch is unreachable. `bbPinSolid` walks this field's own statics: walls, frame bars and flower feet (`colliders.ts:102, 134-146`). The smoke lane actively witnesses the fix at `rules.ts:1180-1202`, asserting `bbPinSolid({x:62,y:62}) === false` as a negative control and then billing a pin at that pose.

**Why it matters**

A maintainer reading `penalties.ts` would conclude BIOBUZZ under-bills pins in the field corners and that a shared-core request is outstanding. Both are false, and the block reads as a live known-defect notice.

**Suggested fix**

Rewrite the block to record that the request landed and `bbPinSolid` is passed, keeping the explanation of why the game's own solid list is needed, which is the reason the smoke witness exists.

**Confidence: high.** Verifier confirmed every limb, including the short-circuit ordering in the shared function.

---

## BB-35 — [§9.6.1] Two stale doc claims inside live contracts

*Rule: §9.6.1. Severity: nit. Category: other.*  Also bears on: §10.5.1.

**The rule.** No G-rule governs this. §9.6.1 is the governing text: The frame dimensions, and the HIVE TIP criteria the other stale claim touches.

**What the sim does**

1. `BbCellHud.tipping` is documented as “seconds left in the swing, 0 when settled. The CELL accepts nothing while this is > 0” (`hud.ts:64`). `hiveTakingSide`/`hiveAccepts` deliberately keep taking elements through the whole swing, handing over from the emptying tray to the incoming one at the release (`hive.ts:107-158`). That is an owner-feedback change which the same file's header describes correctly two dozen lines above (`hud.ts:32-34`).
2. `colliders.ts:48` says the frame bar spans “(`BB_FRAME_Y` = ±19.5)” where the constant is 19.4 (`config.ts:235`).

**Why it matters**

The `tipping` field is the DOM-free HUD contract the authoritative server computes for its clients. A consumer that trusts its doc comment would grey out the CELL readout for four seconds in which shots are still scoring.

**Suggested fix**

Fix both comments. The `tipping` one matters: it is the seam's own type documentation.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-36 — [§10.5.2] Stale hand-worked z values in the rules.ts FLOWER block

*Rule: §10.5.2. Severity: nit. Category: other.*

**The rule.** No G-rule governs this. §10.5.2 is the governing text: “NECTAR and POLLEN score when they are at least partially within the FLOWER scoring volume: between the top ring and the middle ring.”

**What the sim does**

`scripts/smoke-biobuzz/rules.ts:208-216` resolves the stack `['yellow','red','yellow','yellow']` by hand as “n2 centre 5.03 / p3 8.23 / p4 11.03”. With the ring-seat rule at `flower.ts:91` the real values are n2 = max(3.23, 3.98) + 1.8 = 5.78, p3 = 8.98, p4 = 11.78. The assertion itself only reads `fs.inVolume === 3`, which is unchanged, so the check still passes and passes for the right reason: only p1's 3.23 top falls below the 3.98 volume floor under either arithmetic. `scripts/smoke-biobuzz/field.ts:3264-3283` states the same geometry with the corrected numbers.

**Why it matters**

The independent hand-derivation is the check's whole value, and it no longer describes the code. Two smoke files now state different geometry for the same function, and a reader reconciling them will trust the wrong one.

**Suggested fix**

Update the four z values in the `rules.ts` comment to 1.83 / 5.78 / 8.98 / 11.78 and note that the nectar is ring-seated.

**Confidence: high.** Verifier re-derived the numbers independently and corrected the finding's category: no coverage is affected, so this is a stale comment and not a test gap.

---

## BB-37 — [G403] Test gap: the transition is never stepped with a live mechanism

*Rule: G403. Severity: nit. Category: test-gap.*

**The rule.** “Any powered movement of the ROBOT or any of its MECHANISMS” during the 8-second transition.

**What the manual says**

> “Any powered movement of the ROBOT or any of its MECHANISMS” [is a violation during the 8-second transition].

**What the sim does**

No check steps a world across the transition and asserts that mechanism state is frozen: not `turretHeading`, not `hopper`, not `flowers[i].stack`, not `nectarStock`. The nearest checks are `field.ts:2424-2440` (the human player's button is refused while `enabled` is false) and the G410 phase-boundary checks, and both are about gameplay verbs rather than mechanism state.

**Why it matters**

The whole class of “a mechanism kept running while the field was frozen” is untested, so any future mechanism added to stage 5b or 5c inherits the same hole silently. It is what let BB-05 sit unnoticed.

**Suggested fix**

One check: build a world, snapshot every mechanism field for both robots, step 8 s of `transition` with a fully-deflected command map, and assert the snapshot is byte-identical. It fails today on `turretHeading`, which is the point.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-38 — [§10.4] Test gap: the `ZERO_CMD` substitution is unpinned

*Rule: §10.4. Severity: nit. Category: test-gap.*  Also bears on: G403.

**The rule.** No G-rule governs this. §10.4 is the governing text: “There is an 8-second transition period between AUTO and TELEOP for scoring purposes.”

**What the manual says**

> There is an 8-second transition period between AUTO and TELEOP for scoring purposes as described in Section 10.5 Scoring.

**What the sim does**

The behaviour is correct: `step.ts:102` is `let cmd = enabled ? (commands.get(r.id) ?? ZERO_CMD) : ZERO_CMD` and `robotsEnabled` (`src/sim/match.ts:73-76`) excludes `transition`, so every robot gets `ZERO_CMD` and the aim hook is suppressed (`step.ts:90,114`).

Every `biobuzzStep(` call site in the lane was enumerated (`core.ts:597,671`; `field.ts:810,922,1179,1755,1833,1980,1981`; `harness.ts:76`; `robot.ts:209`; `rules.ts:1467,1469,1472,1492,1493,1504,1505`). Each steps in teleop or freeplay, or in transition with an empty command map (`core.ts:671`), so none would fail if the ternary were deleted. The two candidate rebuttals both miss: `field.ts:2422-2447` drives `updateBiobuzz` directly with `enabled: false`, which is the human-player button path, and `rules.ts:1412`'s transition check calls `bill()`, which loops `updateBiobuzzPenalties` directly and never touches `biobuzzStep`.

**Why it matters**

The transition is a scoring window in which nobody may drive. An unpinned freeze is exactly what a later refactor of the aim hook or the command resolve breaks silently.

**Suggested fix**

In the existing `core.ts` transition block, place a robot, hold full throttle through the 8 s of transition via `biobuzzStep`, and assert its pose is unchanged, and that the same command moves it on the first TELEOP tick.

**Confidence: high.** Verifier enumerated all seventeen call sites independently.

---

## BB-39 — [§10.1] Test gap: BIOBUZZ's phase machine never asserts the durations

*Rule: §10.1. Severity: nit. Category: test-gap.*  Also bears on: §10.4.

**The rule.** No G-rule governs this. §10.1 is the governing text: “a 30-second AUTO period, an 8-second transition period between AUTO and TELEOP, and a 2-minute TELEOP period”.

**What the manual says**

> a 30-second AUTO period, an 8-second transition period between AUTO and TELEOP, and a 2-minute TELEOP period

**What the sim does**

`biobuzzStepMatch` reads `C.AUTO_DURATION` / `C.TRANSITION_DURATION` / `C.TELEOP_DURATION` (`step.ts:206,228,233`), which are 30 / 8 / 120 in `src/config.ts:19-21`. Nothing in `scripts/smoke-biobuzz/` asserts those lengths: every phase test hand-writes `m.match.phase` and `phaseTimeLeft` (`rules.ts:1480-1502`, `core.ts:668-669`, `field.ts:1818,2090,2295`), and the one end-to-end run derives its stop tick from the same constants (`field.ts:2521`).

**Why it matters**

Narrower than it looks. The values themselves are pinned by `scripts/smoke.ts:5315-5318`, which runs DECODE's clock against the same three constants by wall clock, and `npm test` chains both suites, so a value change goes red. What is genuinely uncovered is a BIOBUZZ-specific mis-wiring, `step.ts` reading the wrong constant for the wrong phase with the values unchanged, and a future need for per-game durations.

**Suggested fix**

Three lines in `scripts/smoke-biobuzz/rules.ts`: step a fresh `createBiobuzzWorld('match', …)` from `pre` with `preCountdown` set, and assert `phaseTimeLeft === 30` on the first AUTO tick, `=== 8` on the first transition tick and `=== 120` on the first TELEOP tick, plus the phase order.

**Confidence: high.** Verifier confirmed the absence of any assertion in the lane and corrected the impact: the finding's claim that the suite “would still pass if the durations changed” is true only of `npm run test:bb` in isolation.

---

## BB-40 — [§10.5 C] Test gap: nothing pins an element landing during `post`

*Rule: §10.5 C. Severity: nit. Category: test-gap.*  Also bears on: §10.5 D, §10.5 E.

**The rule.** No G-rule governs this. §10.5 C is the governing text: Assessment “will occur after all SCORING ELEMENTS and ROBOTS have come to rest at the conclusion of the MATCH”.

**What the manual says**

> C. Assessment of POLLEN and NECTAR remaining in the CELL will occur after all SCORING ELEMENTS and ROBOTS have come to rest at the conclusion of the MATCH. … E. Assessment of GARDEN scoring occurs at the end of TELEOP when all ROBOTS and SCORING ELEMENTS have come to rest.

**What the sim does**

All three “at rest” lines are exercised only on hand-built static fields (`rules.ts:296-435`, which fills cells, flowers and gardens by helper and then reads `bbScoreWorld` once at `phase = 'post'`). The one full-clock check (`field.ts:3466-3580`) runs four idle robots and asserts the staged layout's score. Nothing asserts that a shot in the air at 0:00 which lands in a CELL, FLOWER or GARDEN during the `post` ticks is counted, which is the behaviour the sim relies on: gameplay stage 8 keeps running in `post` (`step.ts:133-143`, no phase gate).

**Why it matters**

The “at rest” requirement is the reason `post` keeps stepping at all. A future change that froze gameplay in `post` would pass the whole suite while silently dropping every late-landing element.

**Suggested fix**

One check: put a ball in `{kind:'flight'}` aimed at a cell, set phase `post`, step 60 ticks, assert `cellPts` moved. Pair it with the BB-01 check.

**Confidence: high.** Verifier confirmed by reading both the static checks and the one full-clock check.

---

## BB-41 — [§10.5.1] Test gap: no opponent-coloured NECTAR is ever staged in a CELL

*Rule: §10.5.1. Severity: nit. Category: test-gap.*

**The rule.** No G-rule governs this. §10.5.1 is the governing text: “At the end of the MATCH, any POLLEN and/or NECTAR left in an upward-facing CELL will earn points for that ALLIANCE.”

**What the manual says**

> At the end of the MATCH, any POLLEN and/or NECTAR left in an upward-facing CELL will earn points for that ALLIANCE.

**What the sim does**

`score.ts:297-301` credits `hive.contents.length` to the HIVE's alliance with no colour filter, which is the correct reading. All three `intoCell` call sites are in `rules.ts` and all are RED: `:248` `['red','red','red','yellow','yellow']`, `:257` six of the same, `:320` `['yellow','yellow','red','red']`. No check stages a blue NECTAR in red's cell.

The case is reachable: `field.ts:2630-2670` pins that a shot BY the opponent into a hive is refused (`hiveAccepts` gates on the shooter), but nothing stops a blue robot collecting a red nectar off the tiles and launching it into blue's own cell.

**Why it matters**

The rule reads “any POLLEN and/or NECTAR”. A regression that filtered the count by colour would pass today.

**Suggested fix**

Add a blue NECTAR to the staged red cell in the existing table check and extend the arithmetic by 2.

**Confidence: medium.** Verifier confirmed all three call sites and established reachability.

---

## BB-42 — [§10.5 D] Test gap: the FLOWER line is never scored at a non-post phase

*Rule: §10.5 D. Severity: nit. Category: test-gap.*  Also bears on: §10.5.2.

**The rule.** No G-rule governs this. §10.5 D is the governing text: “Assessment of SCORING ELEMENTS scored in a FLOWER will occur throughout the MATCH with final assessment taking place at the end of TELEOP.”

**What the manual says**

> D. Assessment of SCORING ELEMENTS scored in a FLOWER will occur throughout the MATCH … E. Assessment of GARDEN scoring occurs at the end of TELEOP.

**What the sim does**

The phase sweep at `rules.ts:382-400` re-scores the same field at `auto`, `teleop` and `post`, and asserts only the CELL line's behaviour. Its other assertion is `x.s.red.total === others(x.s.red)`, where `others()` (`rules.ts:392`) itself sums `ownedPts + bottomPts + gardenPts`, an identity that holds vacuously if those terms are all zero, so it cannot catch a phase gate accidentally added to the flower line. Every other flower-scoring check calls `flowerScore` directly, bypassing the phase entirely (`rules.ts:207,229`; `field.ts:3289,3374,3405`).

The GARDEN half is covered: `rules.ts:329` sets `post` and `:353` asserts `gardenPts === 3` there, which is exactly §10.5 E's instant.

**Why it matters**

Rule D says flower scoring is assessed throughout the MATCH, and a phase gate added to that line would ship unnoticed.

**Suggested fix**

Extend the same sweep with a per-line assertion that the FLOWER lines are live in every phase.

**Confidence: medium.** Verifier refuted the GARDEN half of the original finding and confirmed the FLOWER half.

---

## BB-43 — [§10.5.3] Test gap: no GARDEN check uses a NECTAR

*Rule: §10.5.3. Severity: nit. Category: test-gap.*

**The rule.** No G-rule governs this. §10.5.3 is the governing text: “NECTAR belonging to either ALLIANCE and POLLEN scores in the GARDEN for the ALLIANCE that corresponds with the color of the GARDEN.”

**What the manual says**

> GARDENS are ALLIANCE SPECIFIC and earn points for the ALLIANCE of corresponding color regardless of which ALLIANCE placed the POLLEN or NECTAR in the GARDEN. … NECTAR belonging to either ALLIANCE and POLLEN scores in the GARDEN for the ALLIANCE that corresponds with the color of the GARDEN.

**What the sim does**

The implementation is right: the garden loop iterates alliances and credits `out[a]`, never reading `ball.color` (`score.ts:317-325`), and `bbInGarden` takes an alliance argument (`score.ts:130-137`). But every element in every GARDEN check in the lane is `el('yellow', …)`, a POLLEN: `rules.ts:190-198` builds four yellow probes, `rules.ts:324-327` stages three yellow in red's strip and one in blue's, `field.ts:1553-1585` and `:3575` stage POLLEN only. Nothing asserts that a blue NECTAR sitting in red's GARDEN scores 1 for red, which the manual spells out twice.

**Why it matters**

A refactor that made garden credit follow the element's alliance, which is the intuitive-but-wrong reading and the reading FLOWER ownership genuinely uses, would pass the whole suite. Nothing currently distinguishes the two rules.

**Suggested fix**

Two checks beside the existing GARDEN block: a blue NECTAR on red's strip gives `gardenCount` 1 to red and 0 to blue, and a red NECTAR on blue's strip scores for blue. One line each, same `el()` helper.

**Confidence: high.** Verifier confirmed the coverage gap and noted the code structurally cannot get colour wrong, since colour is never read.

---

## BB-44 — [§9.3] Test gap: BB_LZ and BB_GARDEN dimensions are never asserted

*Rule: §9.3. Severity: nit. Category: test-gap.*

**The rule.** No G-rule governs this. §9.3 is the governing text: The LOADING ZONE is “23 in. … by 11 in.” and includes its tape; the GARDEN is “23 in. … by 2 in.” measured to the tape’s outside edge.

**What the manual says**

> LOADING ZONE: an approximately 23 in. … by 11 in. (27.95 cm) deep … GARDEN: an approximately 23 in. (58.40 cm) by 2 in. (5.10 cm) wide and infinitely tall volume …

**What the sim does**

`field.ts:1231-1270` pins the point-mirror relationship between red's and blue's rects, with an explicit x-mirror negative control, which is good. `field.ts:1559-1590`'s only dimensional read is `rect.x1 - rect.x0 >= rect.y1 - rect.y0`, which is an axis test rather than a length. `rules.ts:183` checks which wall and half red's LOADING ZONE is on, and `rules.ts:199` which corner red's garden is in. No depth or width literal is asserted anywhere.

**Why it matters**

A V2 revision or a typo that moved a zone bound would change PARK reachability, G304.E legal frontage and G407's control carve-out, and fail nothing.

**Suggested fix**

Four lines in `field.ts` beside the symmetry block. Note the correct expectations before writing them: `BB_LZ.red` is y ∈ [24,48], 24 in along the wall rather than the manual's “approximately 23”, deliberately, because `config.ts:120-129` sets the width from the TILE seams at rows 4 and 5. `BB_GARDEN` is 23 × 2 and matches directly. A naive 23 in assertion on the LOADING ZONE would be the wrong check.

**Confidence: high.** Verifier read both cited blocks and supplied the `BB_LZ` correction.

---

## BB-45 — [§9.6] Test gap: no HIVE dimension is pinned as a literal

*Rule: §9.6. Severity: nit. Category: test-gap.*  Also bears on: §9.6.1, §9.6.2.

**The rule.** No G-rule governs this. §9.6 is the governing text: The HIVE, frame and CELL dimensions printed in §9.6 and Figures 9-8 to 9-11.

**What the manual says**

> The opening of the CELL is approximately 20 in. (50.8 cm) wide by 14 in (35.6 cm) tall and 12 in. (30.5 cm) deep. … Top of HIVE Opening above TILES 65.6 in.; Bottom of HIVE Opening above TILES 53.5 in.; Bottom of HIVE above TILES 25.5 in.; HIVE Center to Center 25.5 in.; 30 degrees

**What the sim does**

Every HIVE constant is correct today (see the appendix), but every use in the lane is relational. `field.ts:3097-3101` builds its bounds out of `BB_CELL_OPEN.w`, `BB_HIVE_CELL_DY + BB_CELL_OPEN.d` and `BB_HIVE_BOTTOM_Z`; `field.ts:3166-3179` builds every `hiveAccepts` case out of `BB_HIVE_OPEN_Z[0]`/`[1]`; `robot.ts:732,759` take the midpoint of `BB_HIVE_OPEN_Z`. A grep for the literals returns two prose mentions and one unrelated robot position, never an assertion. Editing any of those constants to a wrong number breaks nothing in the lane.

**Why it matters**

A mistyped HIVE constant moves the cell centre, the aim solution, the capture band and the drawing together, so the whole suite still passes and the field is silently the wrong size. That is precisely the failure mode `BB_TIP_POLLEN`'s literal check was written to catch: `field.ts:2765-2775` pins it as a literal with the comment “⚠️ THE LITERAL IS DELIBERATE AND IT IS THE POINT”, and `rules.ts:505` does the same for `BB_PTS`.

**Suggested fix**

One block in `scripts/smoke-biobuzz/field.ts` asserting the manual literals: `2*BB_HIVE_X === 25.5`, `BB_HIVE_TILT_DEG === 30`, `BB_CELL_OPEN.w === 20`, `BB_HIVE_OPEN_Z` = [53.5, 65.6], `BB_HIVE_BOTTOM_Z === 25.5`, plus the four cos-30 derivations.

**Confidence: high.** Verifier confirmed both the correctness of the constants and the absence of any literal assertion.

---

## BB-46 — [§9.9] Test gap: the AprilTag id groups are unpinned

*Rule: §9.9. Severity: nit. Category: test-gap.*  Also bears on: §9.6.

**The rule.** No G-rule governs this. §9.9 is the governing text: “AprilTag ID’s 30, 31, 32, 33 on the red CELL on the side of the FIELD opposite of the audience”, and the three further groups through 45.

**What the manual says**

> On the bottom face of each CELL is a unique AprilTag Cluster containing 4 distinct AprilTags.

**What the sim does**

`BB_HIVE_TAGS` (`config.ts:246-249`) carries red north 30-33, red south 34-37, blue south 38-41, blue north 42-45, and `drawField.ts:1023-1053` prints them as a range over each cell behind the gallery-labels flag. `grep -rni "apriltag|BB_HIVE_TAGS|36h11" scripts/` returns nothing. Its own doc comment says the ids exist so a still can be checked against the manual without opening it.

**Why it matters**

A renumbering or a red/blue swap ships silently, and the drawn field then contradicts the published manual. The ceiling is honest: the table has no behaviour attached, nothing reads it but a label, so a test could only pin a transcription against itself. The real verification is the visual mirror test in `docs/biobuzz-reference.md` §9.

**Suggested fix**

One check: each group has length 4 and four consecutive ids, the four groups are disjoint and cover 30..45, and the audience-side and rear-side assignment per alliance matches Figure 9-17.

**Confidence: high.** Verifier confirmed the grep and flagged this as the lowest-value item in the set.

---

## BB-47 — [§10.5.2] Test gap: the FLOWER owner/bonus fan-out is never split across alliances

*Rule: §10.5.2. Severity: nit. Category: test-gap.*

**The rule.** No G-rule governs this. §10.5.2 is the governing text: The Bottom NECTAR Bonus and FLOWER Owner lines, which can belong to different ALLIANCES in one FLOWER.

**What the manual says**

> …owns that FLOWER and will earn points for every POLLEN and NECTAR that meet the scoring criteria for that FLOWER, regardless of which ALLIANCE placed the POLLEN and/or NECTAR in the FLOWER.

**What the sim does**

The rule itself is pinned on the pure function: `field.ts:3272` row D (`[R,P,P,B]` → owner blue, ownerPts 4 × 2, bonus red) is exactly the split case, derived by hand from the rule. What is untested is the fan-out at `score.ts:303-314`, where one `flowerScore` writes `out[fs.owner].ownedPts` and `out[fs.bonusAlliance].bottomPts` to potentially different alliances. The Table 10-2 longhand at `rules.ts:320-321` uses F1 red-owner/red-bottom and F2 blue-owner/blue-bottom, so a bug that wrote the bonus to `fs.owner` would pass every existing check. The end-to-end placement path is likewise single-alliance (`robot.ts:1203`, one nectar, asserts its own alliance owns).

**Why it matters**

The fan-out is exactly the shape a refactor collapses silently.

**Suggested fix**

Cheapest version: change one word in the existing Table check so F2's bottom element is the opposite colour to its top nectar. The expensive version, a two-robot end-to-end scene through `placeInFlower` (`play.ts:941-969`), proves the same thing.

**Confidence: high.** Verifier confirmed the gap and narrowed it from major to nit, since the manual rule itself is already tested on the pure function.

---

## BB-48 — [G426] Test gap: the G426.A entitlement is never exercised in AUTO

*Rule: G426. Severity: nit. Category: test-gap.*  Also bears on: §10.1.

**The rule.** Entering NECTAR: one per HIVE TIP, or all remaining at 60 seconds or less, whichever comes first. Penalty: MINOR FOUL per NECTAR.

**What the manual says**

> DRIVE TEAM members may not enter NECTAR onto the FIELD except: A. each time the HIVE of their corresponding ALLIANCE color is TIPPED, one NECTAR may be entered for that ALLIANCE, or B. when 60 seconds or less remain in the MATCH, all remaining NECTAR can be entered

**What the sim does**

Exception A carries no phase clause and the sim implements it that way: `play.ts:820-823` gates entry on `enabled`, stock and `nectarDue > 0`, where only `dumping` is teleop-scoped (`play.ts:804`), and `play.ts:567-575` does `bb.nectarDue[a] += 1` on `res.tipped` with no phase test. So a TIP in AUTO banks an entry that a press in AUTO can spend.

Every human-player check in the suite sets `phase = 'teleop'` first (`field.ts:2294, 2314-2315, 2349-2350, 2391-2392, 2410-2411, 2430-2431`). The staged CELL holds 3 NECTAR and `BB_TIP_POLLEN[3] = 3` (`config.ts:345-355`), so the first TIP costs three POLLEN and is explicitly reachable in AUTO.

**Why it matters**

The auto-phase half of the entitlement is unpinned. Adding a teleop guard to the per-TIP branch, which looks plausible beside the teleop-only `dumping` test one line away, would break a legal entry with the suite green.

**Suggested fix**

One case: spawn a match, set `phase = 'auto'` with a full `phaseTimeLeft`, set `nectarDue.red = 1`, press once, and assert one NECTAR reaches the red LOADING ZONE and `nectarWhy.red` goes to `'none-owed'`.

**Confidence: high.** Verifier confirmed both halves, including that `rules.ts`'s only nectar coverage is the G410 FLOWER lock, a different rule.

---

## BB-49 — [§9.8] Test gap: nothing pins the 40 / 8 / 8 element split

*Rule: §9.8. Severity: nit. Category: test-gap.*  Also bears on: §10.3.1.

**The rule.** No G-rule governs this. §9.8 is the governing text: “There are 40 POLLEN, 8 red NECTAR, and 8 blue NECTAR total in a BIOBUZZ MATCH.”

**What the manual says**

> “There are 40 POLLEN, 8 red NECTAR, and 8 blue NECTAR total in a BIOBUZZ MATCH.”
> “A. 40 POLLEN are staged on the FIELD as follows: i. 4 POLLEN in each of the 4 FLOWERS (16) ii. 4 POLLEN in the red GARDEN (4) iii. 4 POLLEN in the blue GARDEN (4) iv. 4 POLLEN pre-loaded in each ROBOT (16). B. 8 red and 8 blue NECTAR … i. 3 NECTAR in each upward-facing CELL of corresponding color (6) ii. 5 NECTAR are in each ALLIANCE AREA of corresponding color (10).”

**What the sim does**

The suite pins the aggregate, “CONSERVATION: 56 ELEMENTS, EVERY TICK, WITH TWO ROBOTS DRIVING” (`field.ts:1785-1791`), and pins `nectarStock` against the count of stock balls (`field.ts:1744-1750`). It does not pin the manual's decomposition: that `world.balls` holds exactly 40 POLLEN, exactly 8 red NECTAR and exactly 8 blue NECTAR, split 16/4/4/16 and 6/10 at tick 0. The staging code is correct (`spawn.ts:308, 335-342, 588-593`), so this is coverage rather than behaviour.

**Why it matters**

56 is the sum of two numbers that can trade against each other. A staging edit that moved one POLLEN from a GARDEN into a FLOWER, or turned a red NECTAR blue, keeps the total at 56 and passes. The colour split is load-bearing for the FLOWER owner and Bottom NECTAR Bonus lines and for G426's per-alliance stock.

**Suggested fix**

One check at tick 0 counting by `bbKindOf` and by `state.kind`, asserting 40/8/8 and the 16/4/4/16 plus 6/10 placement, against named constants rather than bare digits.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## BB-50 — [Table 10-3] Test gap: all four RP checks sit off the threshold boundary

*Rule: Table 10-3. Severity: nit. Category: test-gap.*  Also bears on: Table 10-2.

**The rule.** No G-rule governs this. Table 10-3 is the governing text: SWARM RP 16 Points, POLLINATOR 1 RP 4 TIPS, POLLINATOR 2 RP 7 TIPS, each “at or above threshold”.

**What the manual says**

> “SWARM RP - Combined LEAVE + PARK points earned at or above threshold”; “POLLINATOR 1 RP - The number of TIPS at or above threshold”; thresholds 16 Points / 4 TIPS / 7 TIPS

**What the sim does**

`score.ts:344-346` uses `>=` for all three, correctly. The only four assertions are `rules.ts:404-407`: red SWARM 26 vs 16, blue SWARM 0 vs 16, blue POLLINATOR 1 with 5 tips vs 4, red with 2 vs 4, blue POLLINATOR 2 with 5 vs 7. Every one still passes if `>=` is replaced by `>`. A grep for `swarm|pollinator` across the lane returns those four lines and nothing else.

**Why it matters**

An off-by-one in the comparison would silently deny SWARM to the exact alliance profile the threshold was written for. `config.ts:393-394` and `score.ts:341-343` both note that 16 is chosen because it is exactly 3+3+5+5, both robots LEAVEing and both PARKing in AUTO, which is the single most likely real-match SWARM total.

**Suggested fix**

Three checks at the boundary: exactly 16 earns SWARM and 15 does not, exactly 4 TIPS earns POLLINATOR 1 and 3 does not, exactly 7 earns POLLINATOR 2 and 6 does not. Six assertions on hand-built states, same shape as `rules.ts:404`.

**Confidence: high.** Verifier evaluated each existing assertion against a hypothetical `>` and confirmed all four survive it.

---

## BB-51 — [Table 10-2] Test gap: `biobuzzResultsRows` is never invoked by any suite

*Rule: Table 10-2. Severity: nit. Category: test-gap.*

**The rule.** No G-rule governs this. Table 10-2 is the governing text: The point-value table the results screen prints.

**What the manual says**

The five RANKING POINTS rows of Table 10-2: SWARM, POLLINATOR 1, POLLINATOR 2, WIN, TIE.

**What the sim does**

`grep -rn "resultsRows" scripts/` returns nothing. `core.ts` pins that BIOBUZZ fills the `statTiles` slot (`core.ts:304`) and the `labels.configSummary` slot (`core.ts:357`) but never `resultsRows`, and no lane invokes `biobuzzResultsRows` (`HudSlots.tsx:429`, registered at `index.ts:49`, consumed at `GameView.tsx:1095,1398`). Separately, the HUD-slice block at `rules.ts:421-429` asserts `hud.cells`, `hud.flowerOwners`, `hud.flowerDepth` and `hud.score.red.total`, but never `hud.rp`, so the `out.rp[a] = s.rp[a]` hop at `hud.ts:278` is unpinned.

The RP rules themselves are pinned at `rules.ts:404-407`. What is untested is the two presentation hops between that computation and the screen.

**Why it matters**

A dropped RANKING POINTS section, a renamed `BbRankPoints` key, a threshold label that stops reading `BB_RP`, or a lost `rp` hop all ship green. A check asserting the section has five rows also fails today, which is BB-11.

**Suggested fix**

One check in `core.ts` that `biobuzzModule.resultsRows` is a function, matching the `statTiles`/`configSummary` pattern, and one in `rules.ts` that calls `biobuzzResultsRows` on the already-built 88 vs 110 world and asserts the RANKING POINTS section's values against `s.rp`. Add `hud.rp.red.swarm` to the existing HUD-slice block while there.

**Confidence: high.** Verifier confirmed both halves and corrected the severity down, since the RP thresholds are covered.

---

## BB-52 — [seam contract] Test gap: two of the four game registrations are unpinned

*Rule: seam contract. Severity: nit. Category: test-gap.*

**The rule.** No G-rule governs this. seam contract is the governing text: No manual rule. CLAUDE.md requires four registrations per game and states that all four fail silently when missed.

**What the contract says**

> FOUR registrations, and all four are silent when missed

**What the sim does**

`scripts/smoke-biobuzz/core.ts:69-97` loops `GAME_IDS` and asserts `SIM_GAMES` membership, `startPoseCount` and `initialAct` for every id, and `field.ts:232,240` pins BIOBUZZ's `scored` and `startLegality`. Nothing pins the client registry (`src/games/index.ts` `GAMES`) or the `src/seasons.ts` entry, which are registrations 1 and 3. A BIOBUZZ entry dropped from either would leave the server-safe suite fully green, because the DECODE fallback in `moduleFor`/`gameOf` absorbs it, while the home picker loses the season and the client renders a BIOBUZZ world through DECODE's renderers.

**Why it matters**

Two of the four silent-failure registrations the seam contract names are untested for this game, and both are client-side, where the failure is a wrong-looking screen rather than a crash.

**Suggested fix**

Two checks in `core.ts`: `moduleFor('biobuzz').id === 'biobuzz'`, not the DECODE fallback, and `SEASONS.some(s => s.key === 'biobuzz')`. The first needs the client registry, so it may belong in a DOM-tolerant lane.

**Confidence: high.** Second-pass critic finding; no independent verifier note.

---

## Appendix A — confirmed correct

Manual facts checked and found correctly implemented. Grouped by domain, deduplicated.

**Match structure and timing**

- All three periods exist with the manual's durations: AUTO 30 s, transition 8 s, TELEOP 120 s (`step.ts:206,228,233` over `src/config.ts:19-21`), documented against §10.1/§10.4 at `config.ts:459-461`.
- Phase order `pre → auto → transition → teleop → post`, sim-driven off `preCountdown` with no controller involvement (`step.ts:198-248`), so a replay reproduces the whole clock.
- The 8-second transition is a real phase in which robots are frozen: `robotsEnabled` excludes it, so every robot gets `ZERO_CMD` and the aim override is suppressed.
- It is also a transition “for scoring purposes”: flight integration, HIVE tipping and the shared artifact solve all keep running through it, and only capture, launch and the human-player entry are gated on `enabled`.
- The transition runs its own 0:08 → 0:01 countdown without consuming the main clock, matching Table 9-1. TELEOP reads 2:00 → 0:00.
- The 1:00 FLOWER-ownership instant exists as a constant (`BB_FLOWER_UNLOCK_S` 60), a phase event on exactly the crossing tick, a HUD countdown, a `FLOWERS OPEN` chip, and the rule itself reading the clock rather than a stored flag. The cue fires once and never repeats, pinned with a half-tick-offset fixture.
- Table 9-1's audio cues all land at the right instants: match-start lead-in, AUTO-end buzzer, the transition's “Drivers, pick up your controllers” then 3-2-1, TELEOP resume, the final-20-seconds warning, and the match-end buzzer.
- No BIOBUZZ rule or scoring line keys on an endgame window, and the live BIOBUZZ score bar correctly does not print “END GAME”.
- The phase event vocabulary is DRIVER-CONTROLLED rather than TELEOP, on every surface, with the negative half pinned.

**Scoring values and assessment instants**

- Every point value in Table 10-2 is exact in `BB_PTS`: LEAVE 3, PARK 5 + 5, HIVE TIP 20, CELL 2, Bottom NECTAR Bonus 5, owned FLOWER 2, GARDEN 1. Every scoring site reads the member rather than a literal.
- LEAVE pays in AUTO only and exactly once; PARK is the only achievement paying in both periods, as two independent latches worth 5 each.
- §10.5 F: LEAVE and AUTO PARK latch at the end of AUTO, with `bbAssess` running before the phase flips so the predicates read the field as it was at the buzzer.
- §10.5 G: TELEOP PARK latches at the end of the MATCH on where the robot actually ended, leaving the AUTO latch untouched.
- A robot that returns to the wall after AUTO keeps its LEAVE; the latch, not the live pose, is read once the instant has passed.
- §10.5 C: the CELL line pays 0 for the whole match and lands once at `post`, while the count stays live as the driver's readout.
- The CELL line credits the HIVE's own alliance whoever scored the element, and covers the up cell only.
- The TIP is awarded at the end of the swing per §10.5.1 A+B, not when the swing starts and not when the contents spill.
- §10.5.2: FLOWER ownership is the alliance of the top-most scoring NECTAR, paying 2 per element partially in the scoring volume regardless of who placed it, with a 5-point Bottom NECTAR Bonus to the alliance of the bottom-most scoring NECTAR. No NECTAR means no owner and no bonus. Both rules are single-winner, matching Figure 10-5's single TOP and BOTTOM arrows. One NECTAR can be both.
- §10.5.3 and Figure 10-6: a GARDEN element counts on partial overlap, as a circle-versus-rect distance test rather than centre-in-rect, credited to the GARDEN's colour whoever placed it and whatever the element's colour.
- §10.5.4 and Figure 10-7: PARK is “at least partially in”, computed as an OBB-versus-rect SAT intersection, so one corner over the tape parks. Both LEAVE and PARK are measured on the footprint including the sweeper.
- LEAVE genuinely requires movement: G304.C forces every legal start pose to touch the perimeter wall, so a robot that never moves cannot satisfy `bbLeftNow`.
- The score is recomputed from the world every tick rather than accumulated, so a re-simulated or reconciled tick cannot double-bank a line, and a de-scored flower gives the points back.
- Gameplay keeps running in `post`, so elements still in the air or rolling at 0:00 continue to resolve, which is the mechanism §10.5's “come to rest” language requires.
- Achievements cannot be manufactured during the transition or after 0:00: every launch, place and intake path is gated on `enabled`.
- A RED CARD voids the alliance total while the breakdown still shows everything earned.
- `bb.points`, `bb.scored` and the shared `ScoreBreakdown.total` are all written from the same computed line, and only `leave` is mapped onto DECODE's breakdown shape.

**Ranking points**

- Thresholds match Table 10-3's “all other events” column: SWARM 16, POLLINATOR 1 at 4 TIPS, POLLINATOR 2 at 7 TIPS, correctly identified in-code as that set with regionals and Championship noted as TBA.
- SWARM counts LEAVE + PARK points rather than robot counts, and includes the TELEOP PARK line, which “Combined LEAVE + PARK points” requires and which the 3+3+5+5 arithmetic does not by itself force.
- “At or above threshold” is `>=` for all three.
- POLLINATOR 1 and 2 read the same `tips` counter and differ only by threshold, matching the two rows' identical glossary text.
- No LOSS RP row is invented anywhere.
- The three implemented RP lines are surfaced in a RANKING POINTS section of the results breakdown, printed by both versus results and `RecordResults`. Each label carries its own threshold read from `BB_RP` rather than a literal.
- The WIN/TIE verdict is correctly determined and reported off `ScoreBreakdown.total`, which includes foul points and reads 0 for a voided alliance, so foul-decided and red-carded matches both resolve correctly. The same verdict is burned into exported replay video.
- RP is recomputed from the world every tick rather than latched, and its inputs are already frozen by `post`.
- DSIM's Glicko-2 ranking and per-game leaderboards do not read RP, which is correct: RP is an event-ranking concept and folding it into Glicko-2 would be the invention.

**HIVE and CELL**

- Two CELLS per HIVE, one per end, bi-stable with exactly one facing up, with no angle field because `tipping` covers the swing.
- A frame holding one red and one blue HIVE, pivots 25.5 in centre to centre, matching Figure 9-10.
- The 30° tilt between the stable states, baked into every plan length as a cos 30° and re-derived for the drawn swing by `tipProjection`, pinned at rest, level and settle.
- Figure 9-9's three callouts are reconciled self-consistently: 18.84 is the clear gap between the cells, giving 15.44 pivot-to-cell-centre, 13.37 / 10.43 / 37.16 as the cos-30 plan lengths, and §9.6.2's “CELLS approximately 18.8 in. apart” is the same gap. Note the audit brief glosses 18.84 as pivot-to-cell, which would put the cells 37.68 apart and contradict §9.6.2; the sim's reading is the consistent one.
- CELL opening 20 in wide by 14 in tall by 12 in deep, with the 20 in width perpendicular to the tilt axis and therefore unforeshortened, and 65.6 − 53.5 = 12.1 = 14·cos30 exactly.
- Bottom of HIVE 25.5 in above the TILES, with no dynamic collider for the cells, which is what makes G409's “robots drive under the HIVE” assumption true.
- Four distinct AprilTags on the bottom face of every CELL, with the audience-versus-rear assignment per alliance matching Figure 9-17.
- Tipping swaps which CELL is up, and the elements in the tipping CELL are released and go somewhere: they re-enter the world as ground elements carrying an outboard velocity at `BB_HIVE_BOTTOM_Z`, so nothing is destroyed and G409 has a referent.
- Only the upward-facing CELL accepts and is scored: `hiveAccepts` requires a descending element travelling inboard over the open outer lip, inside the opening footprint and within its z band. Every reject case is pinned, including a shot from the closed back.
- §10.5 A: a TIP that completes after the buzzer still counts, mechanically.
- §10.1: each TIP earns one NECTAR entry out of five staged in the ALLIANCE AREA.
- §10.3.1: each HIVE is staged with the CELL that points at a FLOWER down, built into `emptyBiobuzzState` so an unstaged hive is not a representable state.
- The manual states no tip threshold, and the sim's model is documented as its own, with its provenance and a pointer to the re-measure ticket.

**FLOWER**

- Four FLOWERS, one per wall, each ring centre 2.54 in off its wall face on the ±24 tile seam, point-symmetric about the origin. The set of four is asserted closed under the point mirror, which is the check that catches an x-mirror.
- Top ring opening 4.0 in diameter; top ring height 21.5 in above the TILES, and it is the upper bound of the scoring volume.
- The scoring volume is a band from the middle ring to the top ring, exactly as §10.5.2 words it. An element resting on the lower ring is outside it, and the staged bottom POLLEN scores nothing.
- The middle-ring height is a sound derivation, not a guess: 3.55 in Retrieval Opening plus the 0.43 in bottom-ring thickness, both printed in Figure 9-12, and honestly flagged APPROX because V1 prints no ring thickness.
- “At least partially within” is implemented as a partial-overlap test, strict at both ends, not a centre test. Both planes are exercised with an element on each side and one straddling each.
- Owned value is 2 per element and the Bottom NECTAR Bonus is 5 per flower, both read from `BB_PTS`, ceiling 4 × 5 = 20.
- POLLEN alone score nothing, and the bonus requires the NECTAR to be scoring.
- Retrieval is POLLEN-only and from the bottom per G418.B, justified by the manual's own numbers (a 3.6 in NECTAR against a 3.55 in Retrieval Opening), wired to a real intake requiring a mouth on the foot's field-side face. Retrieving a POLLEN from under a ring-seated NECTAR does not lower the NECTAR.
- The 1:00 G410 unlock is enforced as “still scores but fouls”, not “does not score”, matching §10.5.2 exactly, and G410 does not touch the stack.
- G410 binds NECTAR only, which is right; §10.5.2's unqualified note still holds emergently, because no flower point can exist without a NECTAR to own the flower.
- Placement into the top is the only way to score, and the flowers are neutral: proximity, not ownership, with ownership run-time per §10.5.2.
- The four flower feet are real colliders flush to their walls.
- The section drawing calls the scorer's own functions, so the picture cannot disagree with the points.
- Figure 9-12's lower-ring thickness and the text's “approximately 0.4 in” are consistent, and the 2.79 in hole passes neither element.
- G418's unmodelled clauses are structurally impossible rather than omitted: the stack is an id list, so nothing can fall out or be forced back through the middle ring.
- The backstop's one scoring consequence is modelled, drawn and tested: an element held proud of the top ring still breaks the plane and counts (`flowerFits`, `field.ts:3277-3278` case G).

**Field, zones and staging**

- 144 × 144 in field, origin centre, ±72 half-extents, with the perimeter as a hard containment invariant.
- 36 interlocking 24 in TILES, with the grid derived from `C.TILE` rather than typed, and the Figure 9-5 coordinate convention (columns A-F left to right along the audience wall, rows 1-6 with row 1 nearest the audience). G402's A-C / D-F split reads as x < 0 red, x > 0 blue, matching it.
- The layout is point-symmetric, not mirrored: red LOADING ZONE on the left wall at y ∈ [24,48] and red GARDEN in the audience-left corner, with `bbMirror` a true 180° rotation including heading, and the symmetry asserted with an explicit x-mirror negative control.
- Red is on the left from the audience view, and the shared `viewAngleOf` puts the drivers on the correct walls.
- GARDEN is 23 × 2 in flush in the corner, drawn as two 1 in tapes by stroking rather than filling. LOADING ZONE depth is 11 in against the side wall, tape-bounded on the three open sides.
- GARDENS are not protected zones: `penalties.ts` contains no GARDEN reference at all.
- Only ground elements score a GARDEN (see BB-17 for the manual question this raises).
- The LOADING ZONE is alliance-specific and belongs to the alliance whose ALLIANCE AREA adjoins it, which is what settles the own-zone reading of PARK (§9.3, quoted in the distillation, and Figure 10-7).
- The field elements are one HIVE structure and four FLOWERS, and those plus the four perimeter walls are the only colliders. Tape is tape: no zone has a collider.
- G304.E is enforced on the footprint AABB against the robot's own zone, and the C-and-E interaction is handled by sampling the three legal walls minus the zone and the flower feet. Testing only the own zone is sufficient, because the opponent's LOADING ZONE is on the far side of x=0, which G304.A already excludes.
- §9.8 element sizes (POLLEN 2.8 in, NECTAR 3.6 in), counts (40 / 8 / 8) and colours are all correct and asserted end to end, and rendered at their own sizes.
- §10.3.1 staging is correct in every clause: 4 POLLEN in each of the four FLOWERS seated through the same `flowerStackZ` the scorer reads; 4 per GARDEN in a line starting in the corner closest to the ALLIANCE AREA, contacting both walls, asserted at the correct pitch rather than merely inside the strip; 4 pre-loaded per ROBOT as a constant of the field rather than of the lineup; 3 NECTAR in each upward-facing CELL read from state rather than from the staged constant; 5 NECTAR per alliance as real `stock` balls so conservation is a count over one array.
- §10.3.4: an absent robot's four preloads go to approximately the centre of its own LOADING ZONE against the perimeter wall, and overflow past the hopper cap is parked on the tiles contacting the robot rather than deleted.
- A present robot really does hold its four preloads (`robot.ts:384,389`), through the real staging path.
- Conservation: `world.balls.length` is 56 from staging to the buzzer with nothing changing kind.
- Two-radius ground physics: a resting NECTAR sits 1.8 in off the wall and a NECTAR resting on a POLLEN sits at the sum of the radii, bracketed against both wrong answers.
- Element ids are unique and `nextBallId` is seeded past the highest staged id.
- Staging is deterministic: every position is a figure or a constant, ids are handed out in fixed order, and the only RNG draws are the two per actual NECTAR entry, taken only when an entry happens so a refused press cannot desync.

**Penalties**

- MAJOR FOUL is 20 points, not DECODE's 15, and MINOR is 5. No shared-`awardFoul` leak exists: every award goes through `bbAwardFoul`.
- Foul points are credited to the opponent while the offender's own tally bumps for the HUD, pinned for G410, G402 and G421.
- The per-3-seconds tariff bills 1 on entry plus 1 per 3 s, so 15 s in violation is exactly 6 MAJOR, with a `while` rather than an `if` so a coarse `dt` crossing two thresholds bills both.
- VERBAL WARNING is a third severity distinct from a FOUL, moving no points.
- G407's number is 4 and the violation opens at 5, per-instance under §10.6, counting real CONTROL rather than just the hopper via BIOBUZZ's own `ControlGeometry`. The per-(robot, element) clocks are swept, so a recycled id cannot arrive pre-latched.
- G410's 60 s cue is locked in pre-match, AUTO and the transition by default, announced once on the exact crossing tick. It is per NECTAR rather than per flower or per tick, does not un-score the element, and names NECTAR only.
- G410's offender attribution by element colour is sound because a robot cannot carry the opponent's NECTAR, and every NECTAR in a stack is genuinely in the scoring volume, so “in the stack” is equivalent to the manual's “into the FLOWER scoring volume”.
- G418 is structurally enforced in both clauses, with top-only entry and bottom-only POLLEN-only removal both asserted.
- G304 start legality is enforced for BIOBUZZ rather than waved through, so the server and `startSelectionLegal` judge a BIOBUZZ pose against this field's own rule.
- G421 has no “attempting to move” clause and the sim honours that: an idle victim held against the frame bills.
- G421 criteria A and B pause the count rather than resetting it and only end the pin after `PIN_END_S`; criterion A is measured as the gap between footprints rather than centre to centre; criterion C is computed over the full ordered-pair verdict map before any award; G421 carries no card escalation; and its pin clocks are cleared outside the played periods so a hold live at the AUTO buzzer does not bill on the first TELEOP tick.
- §10.6's “a single action may violate multiple rules”: edge keys name the rule and the instance, so one action can fire several rules independently and two simultaneous violations of one rule are two keys.
- Foul strings are typographically correct and name the act rather than the rule label, with the smoke lane reading the engine's source for the exact bytes rather than comparing the engine's output to itself.
- Sanctions are surfaced to the driver: G407 warnings as a per-alliance count, and a live G421 pin as `nextIn` and `billed` in units of `BB_PTS.foulMajor`.
- Penalties run at stage 7, after the Rapier solve and before the score pass, so a foul awarded this tick folds into the total and the pin clock reads the post-solve pose.

**Terminology**

- No DECODE “artifact” or Chain Reaction “particle” leak exists in any BIOBUZZ user-visible string. A regex over quoted literals in `src/games/biobuzz/` returns one hit, a code comment about the shared solver's 5 in artifact. The only `Artifact`/`ArtifactColor` tokens are shared TypeScript type names.
- The manual's words are used throughout: POLLEN, NECTAR, HIVE, CELL, FLOWER, GARDEN, LOADING ZONE, TIP, LEAVE, PARK. `coerce.ts:160-162` strips Chain Reaction's catalyst fields off a BIOBUZZ spec, and `bbStatTiles` exists precisely because the shared builder hero once advertised a CATALYST.
- `docs/biobuzz/manual-distilled.md` agrees with the verbatim text on every point checked across all domains: point values, the blank LEAVE TELEOP cell, the A–G assessment rules, the RP thresholds, the element counts and the staging distribution.

---

## Appendix B — coverage and limits

**Not determinable from the material available.**

- **Table 10-4 rows for G402 and G421.** The verbatim brief did not include them. The sim bills G402 as MAJOR per MATCH behind a `bb.held[robot].g402billed` latch, and §10.6's default is “each instance”, so a per-MATCH cap is a 20-point-per-repeat deviation resting entirely on `manual-distilled.md:319,327` being right. Same for G421's own row, where only Table 10-6's arithmetic was supplied. Both warrant one direct re-read of the real Table 10-4. No finding was raised either way.
- **§10.6.1's own body** on whether a RED CARD zeroes RANKING POINTS, as opposed to the Section 16 glossary. BB-20 leans on the glossary text quoted in the distillation, which is why its confidence is medium.
- **Which wall each GARDEN strip runs along.** The verbatim says only “in opposite corners of the FIELD”, and Figure 9-2's bottom-left corner is satisfied by a strip along the audience wall or along the left wall. The sim picks the audience wall for red, consistent with the distillation, and no smoke check settles it. If Figure 9-2 shows the strip running up the side wall, the garden rect, its four staged POLLEN and `gardenLine`'s step direction are all 90° off and nothing would catch it. Worth a figure re-read.
- **GARDEN strip depth relative to the tape.** §9.3 defines the volume by the tape's outside edge, the one zone where which side you measure from changes the answer. The sim assumes the strip is flush against the wall, consistent with Figure 10-6 marking a corner-tucked ball YES, but a gap or offset between the two tapes and the wall would move the 2 in band. Marked APPROX in the source.
- **CAD Reference 10-4**, the authority for the scoring volume's actual floor. `BB_FLOWER_MID_Z` = 3.98 is derived from two Figure 9-12 callouts, and it is the number BB-13's severity and several FLOWER outcomes turn on.
- **Whether §10.1's 60 s cue and G410's 60 s FLOWER unlock are the same threshold.** The sim folds them into one constant. Both quoted texts say 60 seconds, so one constant is defensible; if a later revision moves one, this is the line that has to split.
- **G408's verbatim text.** BB-23 cites the rule as the sim cites it. The rule text itself was not available to this pass.
- **Which sound asset backs each Table 9-1 cue.** `handlePhaseAudio` maps the AUTO buzzer and the match-end buzzer to the same `audio.play('end')`, where the manual distinguishes “Buzzer x 3” from a “3-second Buzzer”. `public/sounds` was not inspected. Table 9-1 also lists the 1:00 cue as [TBD], so the sim's event-only treatment is not obviously wrong.
- **Visual verification.** `npm run test:bb` was not run and no screenshots were taken; this was a strictly read-only audit. All rendering and test-coverage claims come from reading the code and the assertions, not from observing them.

**Out of scope.**

- Sections 11 and 12 were not audited exhaustively. Only the G-rules Section 10 points into were examined: G304, G402, G403, G404, G407, G408, G410, G417, G418, G419, G420, G421, G426 and G427.
- Drive-team conduct rules were treated as structurally unrepresentable in a sim with no modelled humans, and no finding was raised for them. That covers G422 (leaving the ALLIANCE AREA), G424 (DRIVE COACH contacting elements), G428 (removing elements from the FIELD), and G301 (DRIVE TEAM delay). It is also why no BIOBUZZ rule can currently issue a MINOR FOUL: every MINOR-bearing rule in V1 is drive-team conduct.
- §10.8.2's element-return paths were treated as field-staff logistics with no robot rule attached, and the sim has no out-of-field region to return anything from, since the wall clamp is applied to both flight and ground elements.
- Code style, comment density, refactoring, performance, and anything the manual does not speak to were excluded by the audit's own terms. The stale-comment findings (BB-15, BB-34, BB-35, BB-36) are included only because each one asserts something about manual conformance that is no longer true.

**Refuted and deliberately excluded.** Twenty-three candidate findings were checked and dropped, either because the manual does not require what they claimed, because the behaviour was already implemented under a name the first pass did not guess, or because the divergence was a dated owner ruling on a point the manual leaves open. The ones a reader is most likely to re-raise: GARDEN being scored live (the buzzer value is the assessed value, and the CELL gate exists for a double-counting reason, not a timing one); PARK being scoped to the own LOADING ZONE (§9.3 makes the zone alliance-specific); HIVE TIPS not being split AUTO versus TELEOP (both columns pay 20 and no period subtotal exists anywhere); a CELL refusing the opponent's launched element (an open question in the manual, settled by dated ruling); the FLOWER backstop being unmodelled (its one scoring consequence is modelled and tested as case G); and the LOADING ZONE's 24 in along-wall span against a printed ~23 (the two zones have different boundary conventions in §9.3, and both constants are correct under their own).