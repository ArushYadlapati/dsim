# BIOBUZZ field CAD audit — 2026-09-18

Every number here is MEASURED off the pinned STEP (v26-27.2, sha256 `5e768b73…fe00`, cached at
`%LOCALAPPDATA%/dsim/field-cad/`), not read off a figure and not inferred from a part name.
Method: a fresh XCAF walk (993 leaf part instances, 104 distinct part definitions), colours from
the STEP's own `STYLED_ITEM → PRESENTATION_STYLE_ASSIGNMENT → COLOUR_RGB` chain, geometry from
OCC tessellation at 0.25–1.5 mm linear deflection, transformed by the pipeline's fitted axis map
(`sim_x = +cad_x`, `sim_y = −cad_z`, `sim_z = cad_y`, mm→in, origin at the tile top surface —
re-confirmed, residual unchanged).

It exists because two earlier rounds shipped fixes that were guesses, and the owner's re-test
listed five things still wrong. Each of the five is traced to a root cause below, with the
measurement that proves it.

---

## 0. The five reports, mapped

| owner's words | root cause | section |
|---|---|---|
| "balls are on a different plane than the actual bottom of the hive" | the tray collider is built from an AXIS-ALIGNED BOX of each part taken in the WORLD frame at the tray's own 30° tilt, then treated as if those numbers were tray-LOCAL. The up-cell floor collider ends up **3.26 in above** the real floor. | §4 |
| "parts of the hive (like the back) seem to be gone" | the ACM logo panel, the A-frame top bar (crossbar), the top corners, the feet, the axle holders and the four AprilTag plates all classify as `other` in `convert.py`, and `other` is **never passed to `add_visual`** — so 25 part instances are in no GLB node and no collider. | §2 |
| "some support structures are completely missing" | same defect, plus 40 more parts (the 24 perimeter rails and 16 corner hinges) swallowed by the FASTENER regex because it matches the bare word `rivet` in "FTC Rail with **Rivet** Holes". | §2 |
| "flowers are still the wrong color" | the STEP carries a real colour per part and the pipeline never read it. The flower is amber/green/purple in CAD; it was rendered three greys. | §3 |
| "tape marks on the ground are also incorrect … zones bounded with the wall don't have tape on the wall … documented widths" | the GLB's `tape` node (16 real CAD tape parts) is **hidden at runtime** and replaced by a procedural `strokeRect` of the `BB_LZ`/`BB_GARDEN` rectangles — which paints all four edges of each rectangle, including the wall edge, at whatever width the caller passes. | §5 |

---

## 1. Inventory — 104 part definitions, 993 leaf instances

Counts are leaf occurrences. "kept" = reaches a GLB node and/or a collider in the CURRENT
pipeline.

| current class | n | kept | parts |
|---|---|---|---|
| `tile` | 36 | yes | `am-2499-Center` ×16, `am-2499-Side` ×16, `am-2499-Corner` ×4 (`FIRST Tech Challenge Field Soft Tiles`) |
| `tape` | 16 | GLB only (hidden) | `Gaffer Tape, {Red,Blue}, 1in Wide, {11,20.69,22.69,54,94.82}in Long` |
| `wall` | 28 | yes | `FTC Field Side Glass 11in` ×12, `am-2580a: … Panel Link` ×16 |
| `hive` | 48 | yes | `am-5876: A-Frame Leg` ×4, `am-5873: Goal Pivot Bracket` ×4, `am-5864: Pivot Damper Holder` ×4, `am-5865: Blumotion 970A Damper` ×4, `am-5867: 10.5in Churro Lite` ×8, `am-5868: Basket Base Tube` ×4, `am-5866-red/-blue: Goal Rib` ×4+×4, `am-5869: Hive Goal Top Skin` ×4, `am-5871: Hive Goal Back Skin` ×4, `am-5888: Hive Goal Bottom Skin` ×4 |
| `flower` | 40 | yes | `am-5857/58/59: Flower Layer C/B/X` ×4 each, `am-5860: Flower Field Bracket` ×4, `am-5861: Flower Under Field Bracket` ×4, `am-5862: Flower HIPS Pipe` ×16, `am-5884: Flower Backstop` ×4, `am-5892: Flower Peanut Support` ×8 |
| `element` | 56 | excluded (correct) | `am-5851: Pollen` ×40, `am-5852: Red/Blue Nectar` ×8+×8 |
| `other` | 25 | **NO — dropped entirely** | see §2.1 |
| `hardware` | 744 | excluded | fasteners — **but 40 of them are structure**, see §2.2 |

### Structural bboxes (sim frame, inches — `x0 y0 z0 → x1 y1 z1`, first instance)

```
am-5876: A-Frame Leg          12.257   0.000   0.218 → 24.296  19.067  41.399   (diagonal strut)
am-5867: 10.5in Churro Lite   22.231 -21.150  38.799 → 22.601 -11.843  44.419   (diagonal brace)
am-5873: Goal Pivot Bracket   13.258  -4.947  38.373 → 13.333   7.159  45.696
am-5864: Pivot Damper Holder  12.168   2.631  43.385 → 13.349   4.515  45.521
am-5865: Blumotion 970A       12.522  -3.143  40.314 → 12.995  -0.709  41.658
am-5868: Basket Base Tube     12.258 -17.726  30.873 → 13.258  -2.720  40.114
am-5866-blue: Blue Goal Rib    2.145 -15.524  35.671 → 23.372  -6.691  50.679
am-5869: Hive Goal Top Skin    2.841 -24.878  38.823 → 22.674 -11.568  50.126
am-5871: Hive Goal Back Skin   2.290 -14.714  37.622 → 23.227  -7.228  50.567
am-5888: Hive Goal Bottom Skin 2.618 -21.692  31.964 → 22.898  -7.608  44.608
FTC Field Side Glass 11in     70.674 -23.335   0.090 → 70.792  23.335  10.965
am-2556a: FTC Rail w/ Rivet   70.585 -23.335  10.474 → 71.650  23.335  11.644  (top rail)
am-2556a: FTC Rail w/ Rivet   70.585 -23.335  -0.589 → 71.650  23.335   0.581  (bottom rail)
am-2580a: Panel Link          70.900  18.397  11.054 → 71.650  28.398  11.554
Corner Hinge Rivet Field     -71.471  70.181  -0.182 → -67.162 71.648   0.096
am-5857: Flower Layer C       20.372 -70.504  20.253 → 26.413 -65.579  21.405
am-5862: Flower HIPS Pipe     21.143 -66.842   4.254 → 22.193 -65.792  21.254
am-5884: Flower Backstop      20.649 -70.451  22.404 → 26.136 -68.397  22.654
am-5892: Flower Peanut Support (see flower group, §3)
```

## 2. What is ABSENT from the current GLB, and why

### 2.1 Class `other` is built but never emitted

`convert.py` fills `groups["other"]` and then calls `add_visual` for `walls`, `tiles`, `tape`,
`stations`, the hive buckets and the flowers — **never for `other`**. `hull_bucket_static` is
likewise never called for it. So these 25 instances exist in the inventory JSON and nowhere
else:

| part | n | sim bbox (first) | what it is |
|---|---|---|---|
| `am-5877: ACM Panel` | 2 | −15.072, 1.549, 34.072 → 15.087, 4.283, 40.020 | **the big BIOBUZZ logo panel spanning the whole hive structure** — this is "the back of the hive" |
| `am-5883: Panel Sticker` | 2 | −15.072, 1.657, 34.121 → 15.087, 4.292, 40.024 | the printed sticker on that panel |
| `am-5875: A-Frame Top Bar` | 1 | −11.993, −0.500, 40.950 → 12.007, 0.500, 41.950 | **the crossbar joining the two A-frames at the apex** (manual §9.6.1) |
| `am-5874: A-Frame Top Corner` | 2 | 10.507, −1.527, 39.485 → 13.804, 1.527, 44.220 | the apex casting each frame's legs meet at |
| `am-5863: Axle Holder` | 2 | 10.480, −0.658, 41.761 → 12.125, 0.658, 44.315 | the pivot-shaft holder |
| `am-5878: Sheet Metal Foot Bar` | 2 | 22.750, −19.472, 0.000 → 24.735, 19.472, 2.148 | the ground bar each frame stands on |
| `am-5879-A/B: Frame Foot A/B` | 4 | 22.783, ±17.195, 0.015 → 24.652, ±19.477, 2.128 | the feet |
| `am-5880: 47.5in CC Under Tile Bar` | 2 | −24.500, 15.781, −0.743 → 24.500, 17.281, −0.625 | the under-tile mounting bar (below z = 0) |
| `am-5888-{red,blue}{1,2}: Goal April Tag` | 4 | −21.242, 9.227, 34.393 → −4.242, 13.562, 36.901 | the four 17 × 4.3 in AprilTag plates, mounted ON the trays |
| `Perimeter Mid-Section Strap` | 2 | −69.983, −6.500, −0.824 → 69.983, −5.500, −0.419 | under-tile perimeter strap (below z = 0) |
| `am-5706 Artifact Tray` | 2 | 71.650, −7.875, −0.589 → 81.900, 7.875, 2.411 | the human-player tray, OUTSIDE the wall |

### 2.2 Forty structural parts excluded as "hardware"

`RE_HARDWARE` matches the bare substring `rivet`, and `classify()` tests it FIRST — before
`RE_WALL`, whose own `rail with rivet` pattern therefore never gets a chance:

- `am-2556a: FTC Rail with Rivet Holes` ×24 — **the perimeter's top and bottom rails**, the
  structural frame the glass sits in (top rail z 10.474–11.644, bottom rail z −0.589–0.581).
  Without them the field wall is 12 floating glass panes and 16 link plates.
- `Corner Hinge Rivet Field` ×8 and `… FLAT` ×8 — the four corners' hinge plates, top and
  bottom.

### 2.3 What the simplifier then does to what survives

`gltf-transform simplify --ratio 0.06 --error 0.01` runs over the assembled document. Measured
on the committed `field.glb`:

| node | primitives | glPrimitives (tris) | note |
|---|---|---|---|
| `tiles` | 1 | **4** | a 12-triangle box reduced to 4 — the node is hidden at runtime, so nobody noticed |
| `walls` | 2 | 8,282 | |
| `tape` | 2 | 120 | 16 tape boxes = 192 tris in, 120 out; hidden at runtime |
| `hive_red/frame` | 1 | 7,600 | one primitive only — everything is `hive_frame_metal` |
| `hive_red/tray` | 2 | 52,242 | the two Goal Ribs dominate (honeycomb perforation) |
| `flower_0` | 3 | 16,816 | instanced ×4 |

A 0.06 ratio is aggressive enough to visibly damage any part whose own triangle count is small
(the `tiles` box is the proof). That is a second, independent reason a thin plate can "go
missing".

## 3. XCAF colours — the STEP has them, the pipeline never read them

The STEP carries 104 `STYLED_ITEM` entities (exactly one per part definition), 15 `COLOUR_RGB`
and 3 `DRAUGHTING_PRE_DEFINED_COLOUR`. `convert.py` calls `reader.SetColorMode(True)` and then
never queries a colour; `assemble-gltf.mjs` writes a hand-picked placeholder per class; and
`renderFieldGlb.ts` overrides even that with its own literals. The measured table:

| part | CAD RGB | hex |
|---|---|---|
| `am-5857: Flower Layer C` (TOP ring) | 1.000, 0.729, 0.322 | **#ffba52** amber |
| `am-5858: Flower Layer B` (mid ring) | 0.188, 0.188, 0.188 | #303030 |
| `am-5859: Flower Layer X` (lower ring) | 0.188, 0.188, 0.188 | #303030 |
| `am-5862: Flower HIPS Pipe` | 0.373, 0.655, 0.239 | **#5fa73d green** |
| `am-5884: Flower Backstop` | 0.392, 0.110, 0.396 | **#641c65 purple** |
| `am-5860: Flower Field Bracket` | 0.188, 0.188, 0.188 | #303030 |
| `am-5861: Flower Under Field Bracket` | 0.902, 0.902, 0.902 | #e6e6e6 |
| `am-5892: Flower Peanut Support` | 0.902, 0.902, 0.902 | #e6e6e6 |
| `am-5866-red: Red Goal Rib` | 1.000, 0.000, 0.000 | **#ff0000** |
| `am-5866-blue: Blue Goal Rib` | 0.000, 0.000, 1.000 | **#0000ff** |
| `am-5869/71/5888: Hive Goal Top/Back/Bottom Skin` | 0.902, 0.902, 0.902 | #e6e6e6 |
| `am-5868: Basket Base Tube` | 0.902, 0.902, 0.902 | #e6e6e6 |
| `am-5876: A-Frame Leg`, `am-5875: Top Bar`, `am-5867: Churro`, `am-5878: Foot Bar`, `am-5873: Pivot Bracket`, `am-5877: ACM Panel`, `am-5880: Under Tile Bar` | 0.902, 0.902, 0.902 | #e6e6e6 |
| `am-5874: A-Frame Top Corner`, `am-5879-A/B: Frame Foot`, `am-5864: Damper Holder`, `am-5863: Axle Holder` | 0.188, 0.188, 0.188 | #303030 |
| `am-5865: Blumotion 970A Damper` | 0.302, 0.302, 0.302 | #4d4d4d |
| `am-5883: Panel Sticker`, `am-5888-*: Goal April Tag` | 1.000, 1.000, 1.000 | #ffffff |
| `FTC Field Side Glass 11in`, `am-2580a: Panel Link` | 0.902, 0.902, 0.902 | #e6e6e6 |
| `am-2556a: FTC Rail with Rivet Holes` | 0.188, 0.188, 0.188 | #303030 |
| `Corner Hinge Rivet Field` (+FLAT) | 0.702, 0.702, 0.702 | #b3b3b3 |
| `am-2499-*: Field Soft Tiles` | 0.502, 0.502, 0.502 | #808080 |
| `Gaffer Tape, Red, …` | 1.000, 0.000, 0.000 | #ff0000 |
| `Gaffer Tape, Blue, …` | 0.000, 0.000, 1.000 | #0000ff |
| `Perimeter Mid-Section Strap` | 0.188, 0.188, 0.188 | #303030 |
| `am-5706 Artifact Tray` | 0.400, 0.400, 0.400 | #666666 |
| `am-5851: Pollen` | 1.000, 0.937, 0.247 | #ffef3f (element, not field) |

**So a FLOWER is: green stems, an amber top ring, dark-grey mid/lower plates, a purple
backstop.** The shipped renderer painted the ring `#e5e7eb`, the pipes `#c2c4c8` and the base
`#8c929c` — three greys, which is the report.

**And a HIVE CELL's alliance colour is its two RIBS, not its skins.** The shipped pipeline had
it backwards: `tray_material_class()` assigned `tray_panel_red/blue` to the top/back/bottom
SKINS (CAD #e6e6e6, white) and `tray_metal` to the ribs (CAD pure red / pure blue).

Two CAD colours are placeholders rather than intent and are called out where they are
overridden: `am-2499 Soft Tiles` #808080 (a real FTC tile is near-black foam; a 50 %-grey floor
would also break the HUD contrast pairs, which are tuned against `COLORS.mat`/`COLORS.tile`),
and `FTC Field Side Glass` #e6e6e6 opaque (real polycarbonate — keep the CAD hue, force the
0.22 opacity the existing wall policy uses).

## 4. The HIVE — true geometry, and the collider bug

### 4.1 The tray is a rigid body at exactly ±30°

Rotating every tray part's tessellated points by `−captureTheta` about the pivot
(`±12.75, 0, 43.9497`) with `captureTheta = ∓30°` (`BB_HIVE_UP_STAGED` = red `south`, blue
`north`) makes every part axis-aligned to 0.02 in — the Back Skin's v-extent collapses to
9.4188 → 9.4388, i.e. its own 0.020 in sheet thickness. **The capture tilt is exactly 30.000°,
and all four cells are geometrically identical.**

### 4.2 Tray parts in the pivot-local UN-TILTED frame `(x, v, w)`

`world = pivot + Rot_x(θ)·(x, v, w)`. North cell shown; south is the mirror in `v`; red and
blue are identical to 0.001 in.

| part | x | v | w |
|---|---|---|---|
| `Hive Goal Bottom Skin` | −10.091 … 10.107 | 9.644 … 21.394 | **−1.488 … 6.328** |
| `Hive Goal Top Skin` | −9.907 … 9.925 | 9.644 … 21.394 | 6.432 … 12.700 |
| `Hive Goal Back Skin` | −10.460 … 10.477 | 9.419 … 9.439 | −1.858 … 13.079 |
| `Goal Rib` (divider end) | −10.492 … 10.508 | 9.439 … 11.439 | −2.972 … 13.111 |
| `Goal Rib` (mouth end) | −10.492 … 10.508 | 19.457 … 21.457 | −2.972 … 13.111 |
| `Basket Base Tube` | −0.492 … 0.508 | 4.706 … 21.457 | −2.712 … −1.712 |

### 4.3 The cell's real cross-section is a flat-floored gable, not a box

Planar-facet decomposition of the two skins (triangles grouped by normal within 0.02 and plane
offset within 0.03 in; areas in in²):

```
Bottom Skin  n=( 0, 0,+1)  w = −1.4884   area 422.2   x −8.99…9.01  v 9.644…21.394   FLOOR
Bottom Skin  n=(+1, 0, 0)  x = −10.0906  area 146.8   w −0.39…5.86                   SIDE −x
Bottom Skin  n=(−1, 0, 0)  x = +10.1074  area 146.8   w −0.39…5.86                   SIDE +x
Bottom Skin  8 × ~5.7 in² brake-formed chamfers between floor and sides
Top Skin     n=(+0.538,0,−0.843)  area 250.6   x −9.57…−0.57  w 6.77…12.53           ROOF −x
Top Skin     n=(−0.538,0,−0.843)  area 250.6   x  0.58… 9.59  w 6.77…12.53           ROOF +x
Top Skin     apex at w = 12.6996
Back Skin    n=( 0,+1, 0)  v = 9.4388    area 491.7   x −10.46…10.48  w −1.86…13.07  BACK
Goal Rib     39 facets — a perforated hexagonal FRAME plate with an open centre
```

Measured floor plane, centre strip |x| < 4, all four cells identically:
**outer surface w = −1.4884, inner (load-bearing) surface w = −1.4684, sheet 0.020 in.**
Flat floor spans x −9.275…9.291, the cell's full depth v 9.644…21.394.
Ceiling: two 32.5°-from-vertical roof planes meeting at w = 12.6996 (inner ≈ 12.6796).

### 4.4 The bug: a world-frame AABB used as a local extent

`convert.py`'s `tray_hulls()` builds every hull from `bbox_corners_sim(inst)` — the part's
axis-aligned bounding box **in the final sim frame**, i.e. already at the 30° tilt — and then
subtracts the pivot and hands the result to `cadCellBox()` as if the numbers were `(v, w)` in
the tray's own frame. For the red north cell, committed `field-colliders.json`:

| hull | v (as stored) | w (as stored) | TRUE local v | TRUE local w |
|---|---|---|---|---|
| `cell_north_floor` | 7.61 … 21.69 | **−11.99 … 0.66** | 9.644 … 21.394 | **−1.488 … 6.328** |
| `cell_north_back` | 7.23 … 14.71 | −6.33 … 6.62 | 9.419 … 9.439 | −1.858 … 13.079 |
| `cell_north_ceiling` | 11.57 … 24.88 | −5.13 … 6.18 | 9.644 … 21.394 | 6.432 … 12.700 |

`cadCellBox` then takes `wMin = min(floor, back, ceiling) = −11.99` and builds the FLOOR
collider at `w ∈ [−11.99, −10.49]`. With `obliqueBoxCollider` re-inclining it by `refTheta`,
the red UP (south) cell's collider floor lands at

```
world z = 43.9497 + v·sin(−30°) + w·cos(−30°)
   mouth   v = −19.27, w = −10.49 …  but the built box is [wMin, wMin+1.5] → top face w = −10.49
   → rendered as the collider Rapier actually holds:  mouth z 56.64, divider z 49.60
```

while the **GLB tray mesh's own floor**, at the same tilt, is

```
   mouth   v = −21.394, w = −1.4684 → z = 43.9497 + 10.697 − 1.272 = 53.375
   divider v =  −9.644, w = −1.4684 → z = 43.9497 +  4.822 − 1.272 = 47.500
```

**Physics floor 3.26 in above the mesh floor at the mouth, 2.10 in at the divider** — and the
element then rests a further 1.5 in (its radius) above that. That is exactly "the balls are on
a different plane than the actual bottom of the hive", and it is why the up-cell opening was
previously reported as `[47.05, 68.85]`.

### 4.5 The manual's HIVE figures, re-checked against the true geometry

Up-cell opening, measured at the mouth face (v = ±21.394) of the cell that is UP at rest:

| figure | manual | CAD (this audit) | Δ |
|---|---|---|---|
| `BB_HIVE_OPEN_Z[0]` (bottom of opening) | 53.5 | **53.375** | −0.125 |
| `BB_HIVE_OPEN_Z[1]` (top of opening) | 65.6 | **65.627** | +0.027 |

**The CAD and the manual agree to 0.13 in.** The earlier "OPEN: CAD up-cell opening
[47.05, 68.85] vs manual [53.5, 65.6]" finding was entirely an artifact of §4.4 and is
**CLOSED**, not open.

The down-cell clearance is a real disagreement:

| figure | manual | CAD | Δ |
|---|---|---|---|
| `BB_HIVE_BOTTOM_Z` (bottom of the down hive) | 25.5 | **30.648** (the down-mouth Goal Rib's lower corner; the Bottom Skin alone is 31.964) | +5.15 |

Reported as OPEN in §7; nothing moved.

### 4.6 Why the frame had to be excluded from physics, and why it no longer does

`hive_red_frame_a_frame_leg` is stored as ONE convex hull over the **bounding-box corners** of
both legs, so it measures x ∈ [−24.28, −12.24], z ∈ [0.22, 41.40] — a solid slab from the floor
to the pivot reaching the hive centreline, which seals the drive-under G409 assumes. The real
part is a thin diagonal strut from the foot (24.30, ±19.07, 0.22) to the apex (12.26, 0, 41.40).
A true convex hull of its tessellated points IS that strut. Same story for `upright` (the
Churros, each a 10.5-in tube 0.37 in wide in x), `damper`, `damper_holder` and `pivot_bracket`.
The exclusion is a workaround for the AABB, not a property of the geometry.

## 5. TAPE — every part, and the rule the field guide states

All 16 tape parts are **1.000 in wide** (it is in the part name and it measures). There is no
2-in tape anywhere on this field.

### 5.1 On the tiles (z 0.000 → 0.010)

| part | instances → sim extent | what it bounds |
|---|---|---|
| `Gaffer Tape, Red, 1in Wide, 11in Long` ×2 | x −70.101…−59.101, y 23.907…24.907 and y 45.599…46.599 | the RED LOADING ZONE's two depth (short) edges |
| `Gaffer Tape, Red, 1in Wide, 20.69in Long` ×1 | x −60.101…−59.101, y 24.907…45.599 | the RED LOADING ZONE's inner (field-side) edge |
| `Gaffer Tape, Red, 1in Wide, 22.69in Long` ×2 | x −70.101…−47.409, y −70.101…−69.101 and y −69.101…−68.101 | the RED GARDEN — two 1-in tapes laid side by side = one 2-in band |
| blue ×4 | exact 180° point-symmetric images of the above | blue LOADING ZONE / GARDEN |

**The LOADING ZONE's fourth edge — the one on the wall (x = −70.674) — carries NO TAPE.** Three
tapes, not four. The GARDEN likewise has no tape on the wall side and none across its two ends:
the 2-in band IS the zone ("defined by the outside edge of tape", manual §9.3).

Every tape's far end stops at |x| or |y| = 70.101 — **0.573 in clear of the CAD wall's inner
face** (70.674), i.e. tape never runs onto the wall, matching the owner's rule and §9.3's "every
tape line stays inside one tile".

### 5.2 Outside the field, on the gym floor (z −0.589 → −0.579)

| part | sim extent | what it bounds |
|---|---|---|
| `Gaffer Tape, Red, 1in Wide, 54in Long` ×2 | x −125.65…−71.65, y −48.41…−47.41 and y 47.41…48.41 | the RED ALLIANCE AREA's two side edges |
| `Gaffer Tape, Red, 1in Wide, 94.82in Long` ×1 | x −125.65…−124.65, y −47.41…47.41 | its far edge |
| blue ×3 | point-symmetric | BLUE ALLIANCE AREA |

A three-sided rectangle 54 in deep × 96.82 in wide, **open on the field side** because the field
wall bounds it. The glossary's "~97 wide × 54 deep" checks out. Same rule again.

### 5.3 What the sim draws today, and the deltas

`renderField.ts`'s `buildFloorTexture()` calls `strokeRectTex(BB_LZ[a], …, BB_TAPE_1)` and
`strokeRectTex(BB_GARDEN[a], …, BB_TAPE_1)` — a full four-sided rectangle outline each, so the
wall edge gets tape it should not have, and the GARDEN gets a 1-in outline of a 2-in rectangle
instead of a solid 2-in band. No alliance-area tape is drawn at all. `BB_TAPE_2` (2 in) is
exported and, correctly, unused for tape geometry.

Zone-rectangle deltas (gameplay constants — reported, NOT moved):

| zone | `config.ts` | CAD tape (outer edges) | Δ |
|---|---|---|---|
| `BB_LZ.red` | x −72…−61, y 24…48 | x −70.674(wall)…−59.101, y 23.907…46.599 | wall +1.33, inner −1.90, y −0.09 / −1.40 |
| `BB_GARDEN.red` | x −72…−49, y −72…−70 | x −70.101…−47.409, y −70.101…−68.101 | the band sits 1.9 in further into the field |

## 6. FLOWERS — parts, colours, and a bore fit

Per flower: 3 ring plates (`Flower Layer C` top, `B` mid, `X` lower), 4 `Flower HIPS Pipe`,
2 `Flower Peanut Support`, 1 `Flower Field Bracket`, 1 `Flower Under Field Bracket`,
1 `Flower Backstop`. The plate footprint is 6.04 × 4.93 in (matches the reference's "6 × 4.9").

Bore centres by least-squares circle fit to each ring plate's own inner cylindrical surface
(8 iterations, inner-35 %-radius subset; residual RMS in parentheses):

| flower | top ring `Layer C` | mid `Layer B` | lower `Layer X` | 4-pipe centroid | `BB_FLOWERS` |
|---|---|---|---|---|---|
| F1 | (−68.0787, −23.3998) r 2.1104 (0.087) | (−68.0230, −23.3911) r 1.9539 | (−68.0447, −23.3926) r 1.6135 | (−68.0413, −23.3926) | (−69.46, −24) |
| F2 | (−23.3996, 68.0787) | (−23.3911, 68.0230) | (−23.3926, 68.0447) | (−23.3926, 68.0413) | (−24, 69.46) |
| F3 | (68.0786, 23.3993) | (68.0230, 23.3911) | (68.0447, 23.3926) | (68.0413, 23.3926) | (69.46, 24) |
| F4 | (23.3996, −68.0788) | (23.3911, −68.0230) | (23.3926, −68.0447) | (23.3926, −68.0413) | (24, −69.46) |

Bore diameters: top **4.221**, mid **3.908**, lower **3.227** in. Ring-plate z bands: lower
−0.199…0.354, mid 3.904…5.254, top 20.254…21.404 (`BB_FLOWER_TOP_Z` 21.5, Δ −0.10). Backstop
top at z 22.654. Pipes z 4.254…21.254.

**The 1.4-in flower delta is not an independent finding — it is the field-size finding.** The
bore stands **2.595 in** off the CAD wall's inner face (70.674 − 68.079), against
`BB_FLOWER_D = 2.54`: agreement to 0.055 in. All of the apparent offset is that the CAD wall is
at 70.674 and the constant is 72. See §7.

## 7. OPEN — one finding, three symptoms (owner ruling pending; nothing moved)

The three items previously logged as separate OPEN findings are one fact:

**The real field is 141.35 in inside the walls; the sim's is 144 — the sim field is 1.87 %
larger.**

| measurement | CAD | sim constant | Δ |
|---|---|---|---|
| wall inner face | ±70.674 | `BB_HALF_X`/`BB_HALF_Y` 72 | 1.326 |
| interior span | 141.348 | 144 | 2.652 |
| tile field span | 141.170 (−70.585…70.585) | 144 | 2.830 |
| tile pitch | **23.528** (x0 seam set −70.585, −47.409, −23.907, −0.405, 23.097, 46.599; body 24.312 with interlock tabs, effective pitch 23.502–23.528) | `C.TILE` 24 | 0.47 per tile |
| flower bore stand-off from its wall | 2.595 | `BB_FLOWER_D` 2.54 | 0.055 ✓ |
| flower bore along the wall | ±23.400 / ±68.079 | ±24 / ±69.46 | 0.60 / 1.38 |
| wall visual height | 11.644 (rail top; glass 0.09…10.965) | `BB3_WALL_H` 40 (physics, deliberately tall) | n/a |

The flower's 0.60-in along-wall delta is likewise the tile pitch: the CAD flower sits on the
real seam at 23.528, and 24 − 23.400 = 0.60 ≈ one tile's worth of accumulated pitch error at
that station. **So the whole set of "CAD vs constants" deltas reduces to: FTC soft tiles are
23.5 in, not 24, and the perimeter closes on 141.35 in, not 144.**

Second OPEN finding, independent: **`BB_HIVE_BOTTOM_Z` 25.5 vs the CAD's 30.648** (§4.5).

Nothing in `config.ts` is moved for either. The 3D walls and floor stay analytic at the
constants (existing owner rule); the VISUAL field is CAD-absolute, so tape, tiles and flowers
will sit ~1.3 in inside the physics wall line. That is the honest rendering of the delta, not a
correction of it.

## 8. CAD vs current GLB vs current colliders

| what | CAD says | current GLB | current colliders | fix |
|---|---|---|---|---|
| cell floor plane (local w) | −1.4684 | correct (real mesh) | −11.99 … −10.49 | tray hulls from planar facets in the un-tilted frame |
| cell interior | flat floor + 2 vertical sides + gable roof, v-depth 11.75, height 14.15 | correct | one axis-aligned box, v 7.61…21.69, w −11.99…6.62 | idem |
| up-cell opening | 53.375 … 65.627 | correct | 47.05 … 68.85 (reported) | idem |
| hive back / logo panel (`ACM Panel`) | present, 30 × 2.7 × 6 in at z 34–40 | **absent** | absent | class `other` is emitted |
| crossbar (`A-Frame Top Bar`) | present, x ±12, z 41 | **absent** | absent | idem |
| feet, top corners, axle holders | present | **absent** | absent | idem |
| AprilTag plates ×4 | present, on the trays | **absent** | absent | idem (visual only) |
| perimeter rails ×24, corner hinges ×16 | present | **absent** (fastener regex) | n/a (walls analytic) | fastener pattern is an explicit list |
| A-frame legs | thin diagonal struts | present | AABB slab sealing the drive-under → excluded from physics | true convex hulls, physics re-enabled |
| flower colours | amber ring / green pipes / purple backstop | 3 greys | n/a | CAD colour in the glTF material |
| tray alliance colour | the two RIBS | the SKINS | n/a | swap |
| tape | 16 parts, 1 in, 3-sided zones | present but HIDDEN | n/a | GLB tape shown, procedural tape deleted |
| tiles | 36 plates, pitch 23.528, #808080 flat | one box, 4 tris, hidden | one merged hull | procedural seam texture at the CAD pitch; tone overridden (§3) |

## 9. Method notes for whoever re-runs this

- Colours: the STEP's styled items attach to `MANIFOLD_SOLID_BREP`, which carries the part NAME.
  `XCAFDoc_ColorTool.GetColor` on the occurrence label returns nothing here, which is why the
  earlier rounds concluded "no colour". `convert.py` now reads the styled-item chain.
- A flat CAD face tessellates to its corner vertices only, so a vertex-only measurement of a
  floor plate finds no points in the middle of the plate. Every plane in §4.3 is measured from
  barycentric samples over the triangles, not from vertices.
- `BRepTools.Clean_s` before every re-mesh at a different deflection (already documented in
  `convert.py`; still true).
- The axis map is fitted, not assumed; the red/blue tie-break uses the `Goal Rib` names, which
  is now doubly safe because those are the two parts the STEP gives pure red / pure blue.
