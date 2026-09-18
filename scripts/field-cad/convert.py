#!/usr/bin/env python
"""
scripts/field-cad/convert.py — BIOBUZZ field CAD import (docs/biobuzz/plan-3d.md §8).

Reads the official FIRST field STEP assembly (CadQuery/OCP, headless), walks every named
(sub)part via XCAF, classifies each through ONE ORDERED TABLE (`PART_RULES`), reads the
part's own CAD COLOUR out of the STEP's styled-item chain, transforms everything from the
CAD's axes/units into the SIM's field frame (inches, origin at the field centre on the tile
top surface, +x = audience right, +y = away from the audience, z = up — see
`src/games/biobuzz/config.ts` and `drawField.ts`), and writes:

  <cache>/field-inventory.json      full part inventory (name, class, colour, bbox, included?)
  <cache>/stl/high/<node>__<finish>_<hex>.stl   visual mesh per (node, material), fine
  <cache>/stl/low/<node>__<finish>_<hex>.stl    ditto, coarse
  <public>/field-colliders.json     { units, frame, statics[], trays{red,blue}, flowers[] }
  <public>/field-measurements.json  the dimensions plan-3d.md §8 asks the CAD to settle

`scripts/field-cad.mjs` runs this with the cache venv's python, then assembles + compresses
the STL groups into `public/models/biobuzz/field.glb` / `field-low.glb` with gltf-transform.

── READ `docs/biobuzz/field-cad-audit.md` BEFORE EDITING ───────────────────────────────────
That document is the measured audit this rewrite came out of, and every rule below has a
number behind it there. The four that bite hardest:

1. EXCLUSION IS AN EXPLICIT FASTENER LIST, NOT A KEYWORD SWEEP. The previous version matched
   the bare substring `rivet`, which swallowed `am-2556a: FTC Rail with Rivet Holes` (×24 —
   the perimeter's top and bottom RAILS) and `Corner Hinge Rivet Field` (×16). 40 structural
   parts silently became washers. `RE_FASTENER` now lists every fastener SKU family it means.

2. NOTHING IS DROPPED FOR BEING UNRECOGNISED. Every part that is not a fastener and not a
   scoring element reaches a node and a material; an unmatched name lands in node `misc`
   with finish `misc` and is PRINTED. The previous version built a `groups["other"]` bucket
   and then never emitted it, so 25 instances — the ACM logo panel (the hive's "back"), the
   A-frame top bar (the crossbar), the top corners, the axle holders, the feet, the under-tile
   bars and the four AprilTag plates — existed in the inventory and in no output at all.

3. A COLLIDER IS A TRUE CONVEX HULL OF THE PART'S OWN TESSELLATED POINTS, NEVER ITS AABB.
   `bbox_corners_sim` is gone. An AABB of a LEANING part bounds the whole box it sweeps
   through: `A-Frame Leg`'s AABB measured x ∈ [−24.28, −12.24], z ∈ [0.22, 41.40] — a solid
   slab from the floor to the pivot — which sealed the drive-under G409 assumes and is why the
   whole `hive_*_frame_*` family had to be excluded from physics. The real part is a thin
   diagonal strut and its true hull is that strut.

4. THE TRAY IS EXPORTED IN ITS PIVOT-LOCAL **UN-TILTED** FRAME, AND ITS COLLIDERS ARE PLANAR
   FACET SLABS, NOT PER-PART HULLS. Two separate bugs live here:
   (a) the tray sits at ±30° in the STEP; the old code subtracted the pivot from a WORLD-frame
       AABB and handed the result to the sim as if it were tray-LOCAL (v, w), which put the
       up-cell floor collider 3.26 in above the mesh floor — the owner's "balls are on a
       different plane than the actual bottom of the hive". Every tray point is now rotated by
       `−captureTheta` about the pivot BEFORE anything else, so the runtime rotation is exactly
       `hiveTiltAngle` and `hiveTrayRefTheta` is 0.
   (b) a cell's parts are OPEN SHELLS, not solids: `Hive Goal Bottom Skin` is a U channel
       (flat floor at local w = −1.4884 plus two side walls rising to w = 6.33) and
       `Hive Goal Top Skin` is a gable roof. A convex hull of either FILLS the cell — an
       element would rest 7.8 in above the floor. So tray colliders are built per PLANAR FACET
       (triangles grouped by normal + plane offset), each extruded 1.5 in AWAY from the cell's
       own interior centre, which puts the collider's inner face exactly on the CAD surface.
       `Goal Rib` (a perforated hexagonal FRAME plate) is visual-only for the same reason the
       flower ring plates are: a hull of a frame fills its own opening, and that opening is the
       cell mouth.

── THE AXIS MAPPING IS NOT HARDCODED, IT IS FIT ───────────────────────────────────────────
The STEP's own axes are whatever the Onshape document's top-level origin happened to be
(empirically: Y is vertical, X and Z are the two horizontal axes), and which of {+X,-X} <->
sim +x and which of {+Z,-Z} <-> sim +y is exactly the thing that has gone wrong before
(CLAUDE.md's mirrored-vs-bird's-eye gotcha). So this script tries every sign/swap combination
of the two horizontal axes, scores each one against two independent, already-known-from-the-
manual anchors — the two HIVE pivots at sim x = -12.75 / +12.75, and the four FLOWER centres
from `BB_FLOWERS` — and keeps the mapping with the smallest total residual. Every candidate's
score is printed, so a future re-run against a revised STEP shows immediately if the fit
degrades instead of silently keeping a stale mapping.
"""
from __future__ import annotations

import json
import math
import re
import struct
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from OCP.BRep import BRep_Tool
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.Bnd import Bnd_Box
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_DocumentTool

MM_PER_IN = 25.4

# ── THE MANUAL/CONFIG ANCHORS convert.py PROVES THE AXIS MAPPING AGAINST ──────────────────
# Mirrors src/games/biobuzz/config.ts exactly (BB_HIVE_X, BB_FLOWERS). Duplicated rather than
# imported: this is a standalone Python CLI outside the TS build, and these six numbers are
# the whole contract between the two files — a drift here is exactly what the residual-report
# in the final commit message is for.
BB_HIVE_X = 12.75
BB_FLOWER_D = 2.54
BB_FLOWERS = [
    {"id": "F1", "wall": "left", "x": -72 + BB_FLOWER_D, "y": -24},
    {"id": "F2", "wall": "rear", "x": -24, "y": 72 - BB_FLOWER_D},
    {"id": "F3", "wall": "right", "x": 72 - BB_FLOWER_D, "y": 24},
    {"id": "F4", "wall": "audience", "x": 24, "y": -72 + BB_FLOWER_D},
]
BB_HALF_X = 72
BB_HALF_Y = 72
BB_HIVE_PIVOT_Z = 43.95  # plan-3d.md §13.1 / manual §9.6.1
BB_HIVE_TILT_DEG = 30.0
# BB_HIVE_UP_STAGED (config.ts): red's SOUTH cell is up at rest, blue's NORTH. Which cell is up
# fixes the SIGN of each tray's capture tilt, and the audit re-derived it from the geometry
# (red's south-cell rib reads z 46.1..60.4, its north-cell bottom skin z 31.9..44.6).
BB_HIVE_UP_STAGED = {"red": "south", "blue": "north"}
BB_HIVE_OPEN_Z = (53.5, 65.6)  # manual Fig 9-10 — reported against, never used as input
BB_HIVE_BOTTOM_Z = 25.5  # manual Fig 9-10 — ditto
BB_FLOWER_TOP_Z = 21.5

# ─────────────────────────────────────────────────────────────────────────────────────────
# 1. CLASSIFICATION — one ordered table, fasteners by explicit family
# ─────────────────────────────────────────────────────────────────────────────────────────

# FASTENERS AND OFF-THE-SHELF SMALL PARTS — the ONLY things this pipeline deliberately drops.
# Excluded from both the visual GLB and the collider set: at sim scale (a 141-in field) a #10
# washer contributes nothing to either the picture or the physics, and 224 pop-rivet instances
# would blow every size budget in §8 for zero benefit.
#
# ⚠️ EVERY ENTRY NAMES A FASTENER FAMILY. Do NOT add a generic word here. The previous version
# had a bare `rivet`, which also matched "FTC Rail with Rivet Holes" (the perimeter rail) and
# "Corner Hinge Rivet Field" (the corner plate) — 40 structural parts gone, and the `RE_WALL`
# pattern that was supposed to catch the rail never ran because fasteners are tested first.
RE_FASTENER = re.compile(
    # `187 pop rivet` is the only rivet SKU in this assembly. NOT a bare `rivet`: that is the
    # exact mistake this list replaces, and `Corner Hinge Rivet Field` (a 4.3 x 1.5 in corner
    # PLATE, 16 of them, top and bottom) reads like a fastener and is not one.
    r"pop rivet"
    r"|\bscrew\b|socket head cap screw|pan head machine screw|sheet metal screw"
    r"|\bbolt\b|elevator bolt"
    r"|hex lock nut|wing nut|\bnut\b"
    r"|\bwasher\b|fender washer|flat washer"
    r"|shielded flanged bearing"
    r"|nylon spacer|stepped spacer|\bspacer\b"
    r"|rivnut|cable tie|strapclip"
    r"|press in plug"
    r"|quick release pin|panel fastener"
    r"|\bfhts\b",
    re.IGNORECASE,
)
# Loose scoring elements ride along in the same STEP assembly (staged Pollen/Nectar) but are
# not field STRUCTURE — BIOBUZZ's own sim spawns them from `config.ts`, not from this pipeline.
RE_ELEMENT = re.compile(r"pollen|nectar", re.IGNORECASE)


@dataclass(frozen=True)
class PartRule:
    """One row of `PART_RULES`. `group` picks the output NODE family (and, for `hive_tray`/
    `hive_frame`/`flowers`, how the alliance/cell/index is resolved from the geometry);
    `phys` is the PHYSICS class `src/games/biobuzz/sim3d/bodies.ts` filters on; `finish` is
    the VISUAL material family `renderFieldGlb.ts` turns into PBR parameters (the COLOUR comes
    from the CAD, not from the finish); `collide` says whether a hull is exported at all."""

    pat: str
    group: str
    phys: str
    finish: str
    collide: bool


# ORDER MATTERS — first match wins. "flower under field bracket" precedes "flower field
# bracket"; the `hive goal * skin` rows precede `goal rib` only for readability (they cannot
# collide). Every one of the STEP's 104 part definitions is covered by a row here; anything a
# future revision adds falls through to `misc`, which is EMITTED and PRINTED, never dropped.
PART_RULES: tuple[PartRule, ...] = (
    # ---- floor and perimeter -------------------------------------------------------------
    PartRule(r"field soft tiles?", "tiles", "tile", "tile", False),
    PartRule(r"gaffer tape", "tape", "tape", "tape", False),
    PartRule(r"field side glass", "walls", "wall", "glass", True),
    PartRule(r"rail with rivet", "walls", "wall", "metal", True),
    PartRule(r"panel link|corner hinge rivet field", "walls", "wall", "metal", True),
    PartRule(r"perimeter mid-section strap", "walls", "under_tile", "metal", False),
    # ---- outside the field ---------------------------------------------------------------
    PartRule(r"artifact tray", "stations", "furniture", "plastic", False),
    PartRule(r"driver station|alliance station", "stations", "furniture", "glass", False),
    # ---- HIVE tray (rides the see-saw) ---------------------------------------------------
    PartRule(r"hive goal bottom skin", "hive_tray", "tray_floor", "plastic", True),
    PartRule(r"hive goal top skin", "hive_tray", "tray_roof", "plastic", True),
    PartRule(r"hive goal back skin", "hive_tray", "tray_back", "plastic", True),
    # ⚠️ VISUAL ONLY: a perforated hexagonal FRAME plate at each end of the cell. Its convex
    # hull — and any planar-facet slab of its own face plane — fills the hexagonal opening,
    # which at the mouth end IS the cell's aperture. Same rule as the flower ring plates.
    PartRule(r"goal rib", "hive_tray", "tray_rib", "plastic", False),
    PartRule(r"basket base tube", "hive_tray", "tray_bar", "metal", True),
    PartRule(r"goal april tag", "hive_tray", "decal", "decal", False),
    # ---- HIVE frame (static) -------------------------------------------------------------
    PartRule(r"a-frame leg", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"a-frame top bar", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"a-frame top corner", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"churro", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"sheet metal foot bar", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"frame foot", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"goal pivot bracket", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"pivot damper holder", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"blumotion", "hive_frame", "hive_frame", "plastic", True),
    PartRule(r"axle holder", "hive_frame", "hive_frame", "metal", True),
    PartRule(r"acm panel", "hive_frame", "hive_frame", "plastic", True),
    PartRule(r"panel sticker", "hive_frame", "decal", "decal", False),
    PartRule(r"under tile bar", "hive_frame", "under_tile", "metal", False),
    # ---- FLOWERS -------------------------------------------------------------------------
    # ⚠️ VISUAL ONLY, unchanged rule: a convex hull of an annulus fills in its own centre hole
    # — exactly the opening a POLLEN must pass through and a NECTAR must seat on (§10.5.2).
    PartRule(r"flower layer", "flowers", "flower_ring", "plastic", False),
    PartRule(r"flower hips pipe", "flowers", "flower_support", "plastic", True),
    PartRule(r"flower backstop", "flowers", "flower_support", "plastic", True),
    PartRule(r"flower peanut support", "flowers", "flower_support", "metal", True),
    PartRule(r"flower under field bracket", "flowers", "flower_support", "metal", True),
    PartRule(r"flower field bracket", "flowers", "flower_support", "metal", True),
)
_COMPILED_RULES = tuple((re.compile(r.pat, re.IGNORECASE), r) for r in PART_RULES)
MISC_RULE = PartRule(r"", "misc", "misc", "misc", False)


def rule_for(name: str) -> PartRule | None:
    """`None` for a fastener or a scoring element (deliberately dropped); `MISC_RULE` for a
    structural part no row matches (emitted into node `misc`, logged, never dropped)."""
    if RE_FASTENER.search(name):
        return None
    if RE_ELEMENT.search(name):
        return None
    for pat, rule in _COMPILED_RULES:
        if pat.search(name):
            return rule
    return MISC_RULE


def clean_name(raw: str) -> str:
    return re.sub(r"\s*<\d+>\s*$", "", raw).strip()


# ─────────────────────────────────────────────────────────────────────────────────────────
# 2. CAD COLOUR — from the STEP's own styled-item chain
# ─────────────────────────────────────────────────────────────────────────────────────────
#
# ⚠️ `XCAFDoc_ColorTool.GetColor` RETURNS NOTHING FOR THIS FILE, at the occurrence label, at
# the referred (prototype) label and on the located shape, for all three colour types. That is
# why two earlier rounds concluded the STEP carried no colour and hand-picked greys — the
# owner's "flowers are still the wrong color".
#
# The colour IS there: 104 `STYLED_ITEM` entities (exactly one per part definition), 15
# `COLOUR_RGB` and 3 `DRAUGHTING_PRE_DEFINED_COLOUR`. Each styled item's `item` is the
# `MANIFOLD_SOLID_BREP`, whose own first string literal is the PART NAME — so a direct parse of
# the STEP text keyed by part name is both simpler and more reliable here than the XCAF walk.
# The chain is STYLED_ITEM -> PRESENTATION_STYLE_ASSIGNMENT -> SURFACE_STYLE_USAGE ->
# SURFACE_SIDE_STYLE -> SURFACE_STYLE_FILL_AREA -> FILL_AREA_STYLE -> FILL_AREA_STYLE_COLOUR ->
# COLOUR_RGB; rather than hardcode those seven hops, `resolve_colour` just follows every
# reference depth-first until it reaches a colour entity, which is stable against a styling
# variant this file has not seen.

PREDEFINED_COLOURS = {
    "red": (1.0, 0.0, 0.0),
    "green": (0.0, 1.0, 0.0),
    "blue": (0.0, 0.0, 1.0),
    "yellow": (1.0, 1.0, 0.0),
    "magenta": (1.0, 0.0, 1.0),
    "cyan": (0.0, 1.0, 1.0),
    "black": (0.0, 0.0, 0.0),
    "white": (1.0, 1.0, 1.0),
}
_NUM_RE = re.compile(r"-?\d+\.\d*(?:[eE][-+]?\d+)?|-?\d+\.")
_ENT_RE = re.compile(r"^#(\d+)\s*=\s*(.*)$", re.S)
_KIND_RE = re.compile(r"^([A-Z_0-9]+)\s*\(")
_REF_RE = re.compile(r"#(\d+)")
_STR_RE = re.compile(r"'([^']*)'")


def read_step_colours(step_path: str) -> dict[str, tuple[float, float, float]]:
    """part name -> (r, g, b) in 0..1, straight out of the STEP text. Missing names simply do
    not appear; the caller falls back to the finish's own neutral and says so."""
    text = Path(step_path).read_text(encoding="utf-8", errors="replace")
    ents: dict[int, str] = {}
    for chunk in text.split(";"):
        m = _ENT_RE.match(chunk.strip())
        if m:
            ents[int(m.group(1))] = re.sub(r"\s*\n\s*", "", m.group(2))

    def kind(e: str) -> str:
        m = _KIND_RE.match(e)
        return m.group(1) if m else ""

    def resolve(eid: int, depth: int = 0) -> tuple[float, float, float] | None:
        if depth > 12 or eid not in ents:
            return None
        e = ents[eid]
        k = kind(e)
        if k == "COLOUR_RGB":
            nums = _NUM_RE.findall(e)
            if len(nums) >= 3:
                return (float(nums[-3]), float(nums[-2]), float(nums[-1]))
            return None
        if k == "DRAUGHTING_PRE_DEFINED_COLOUR":
            m = _STR_RE.search(e)
            return PREDEFINED_COLOURS.get(m.group(1).lower()) if m else None
        for r in (int(x) for x in _REF_RE.findall(e)):
            got = resolve(r, depth + 1)
            if got:
                return got
        return None

    out: dict[str, tuple[float, float, float]] = {}
    for e in ents.values():
        if kind(e) != "STYLED_ITEM":
            continue
        refs = [int(x) for x in _REF_RE.findall(e)]
        if not refs:
            continue
        item = ents.get(refs[-1], "")
        nm = _STR_RE.search(item)
        if not nm:
            continue
        name = clean_name(nm.group(1))
        if name in out:
            continue
        for r in refs[:-1]:
            col = resolve(r)
            if col:
                out[name] = col
                break
    print(f"[convert] read {len(out)} CAD part colours from the STEP styled-item chain", file=sys.stderr)
    return out


# Neutral used when the STEP carries no colour for a part — printed when it happens, so a
# silent grey can never be mistaken for a measured one.
FINISH_FALLBACK = {
    "tile": (0.50, 0.50, 0.50),
    "glass": (0.90, 0.90, 0.90),
    "metal": (0.70, 0.70, 0.70),
    "plastic": (0.80, 0.80, 0.80),
    "decal": (1.00, 1.00, 1.00),
    "tape": (1.00, 1.00, 1.00),
    "misc": (0.60, 0.60, 0.60),
}


def hex_of(rgb: tuple[float, float, float]) -> str:
    return "%02x%02x%02x" % tuple(max(0, min(255, int(round(c * 255)))) for c in rgb)


# ─────────────────────────────────────────────────────────────────────────────────────────
# 3. XCAF WALK
# ─────────────────────────────────────────────────────────────────────────────────────────


@dataclass
class Instance:
    name: str
    rule: PartRule
    shape: object  # located TopoDS_Shape, world (root-assembly) frame, millimetres
    bbox_mm: tuple  # (xmin,ymin,zmin,xmax,ymax,zmax)
    colour: tuple[float, float, float]
    colour_from_cad: bool


def label_name(label: TDF_Label) -> str:
    attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
        return attr.Get().ToExtString()
    return "<unnamed>"


def bbox_of(shape) -> tuple | None:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    if box.IsVoid():
        return None
    return box.Get()


def walk_step(step_path: str, colours: dict[str, tuple[float, float, float]]):
    app = XCAFApp_Application.GetApplication_s()
    doc = TDocStd_Document(TCollection_ExtendedString("mdtv-xcaf"))
    app.NewDocument(TCollection_ExtendedString("MDTV-XCAF"), doc)

    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)
    reader.SetLayerMode(True)

    t0 = time.time()
    status = reader.ReadFile(step_path)
    print(f"[convert] ReadFile status={status} ({time.time() - t0:.1f}s)", file=sys.stderr)
    if int(status) != 1:
        raise RuntimeError(f"STEP ReadFile failed: {status}")

    t0 = time.time()
    ok = reader.Transfer(doc)
    print(f"[convert] Transfer ok={ok} ({time.time() - t0:.1f}s)", file=sys.stderr)

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    free = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free)

    instances: list[Instance] = []
    all_rows: list[dict] = []  # every label visited, for the full inventory dump
    no_colour: set[str] = set()

    def keep(name: str, shape, bbox) -> None:
        rule = rule_for(name)
        if rule is None or shape is None or bbox is None:
            return
        cad = colours.get(name)
        if cad is None:
            no_colour.add(name)
        instances.append(
            Instance(
                name=name,
                rule=rule,
                shape=shape,
                bbox_mm=bbox,
                colour=cad if cad is not None else FINISH_FALLBACK[rule.finish],
                colour_from_cad=cad is not None,
            )
        )

    def walk(label: TDF_Label, depth: int):
        name = label_name(label)
        is_ref = shape_tool.IsReference_s(label)

        if is_ref:
            ref_label = TDF_Label()
            if not shape_tool.GetReferredShape_s(label, ref_label):
                return
            ref_is_assembly = shape_tool.IsAssembly_s(ref_label)
            shape = shape_tool.GetShape_s(label)  # LOCATED (world) shape at this occurrence
            bbox = bbox_of(shape) if shape is not None else None
            rule = rule_for(name)
            all_rows.append(
                {
                    "name": name,
                    "depth": depth,
                    "class": "fastener/element" if rule is None else rule.phys,
                    "bbox_mm": bbox,
                    "assembly": ref_is_assembly,
                }
            )
            if ref_is_assembly:
                # Recurse into the definition to reach its components, but keep walking with
                # THIS occurrence's label so nested locations keep composing correctly.
                children = TDF_LabelSequence()
                shape_tool.GetComponents_s(ref_label, children)
                for i in range(children.Length()):
                    walk(children.Value(i + 1), depth + 1)
            else:
                keep(clean_name(name), shape, bbox)
            return

        # a top-level free shape that is not itself a reference (rare, but handle it)
        if shape_tool.IsAssembly_s(label):
            children = TDF_LabelSequence()
            shape_tool.GetComponents_s(label, children)
            for i in range(children.Length()):
                walk(children.Value(i + 1), depth + 1)
            return
        shape = shape_tool.GetShape_s(label)
        if shape is not None:
            keep(clean_name(name), shape, bbox_of(shape))

    for i in range(free.Length()):
        walk(free.Value(i + 1), 0)

    if no_colour:
        print(
            f"[convert] WARNING: {len(no_colour)} part name(s) had no CAD colour; using the finish fallback: "
            + ", ".join(sorted(no_colour)[:8]),
            file=sys.stderr,
        )
    return instances, all_rows


# ─────────────────────────────────────────────────────────────────────────────────────────
# 4. AXIS MAPPING — fit, then apply
# ─────────────────────────────────────────────────────────────────────────────────────────


@dataclass
class AxisFit:
    horiz_a: str  # 'x' or 'z' — which raw CAD axis feeds sim x
    sign_a: int
    horiz_b: str  # the other raw axis — feeds sim y
    sign_b: int
    origin_a: float  # raw-axis value (mm) that maps to sim 0 on the A axis
    origin_b: float
    vert_axis: str  # always 'y' here, kept named for clarity
    vert_origin: float  # raw Y (mm) of the tile top surface
    residual: float


def centroid_mm(bbox_mm) -> tuple[float, float, float]:
    xmin, ymin, zmin, xmax, ymax, zmax = bbox_mm
    return ((xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2)


def fit_axes(instances: list[Instance]) -> AxisFit:
    tiles = [i for i in instances if i.rule.phys == "tile"]
    if not tiles:
        raise RuntimeError("no tile parts found — cannot anchor the vertical origin or field centre")
    tile_bboxes = [i.bbox_mm for i in tiles]
    # vertical origin = the tiles' own top surface (max Y across every tile part's bbox)
    vert_origin = max(b[4] for b in tile_bboxes)
    origin_x_raw = (min(b[0] for b in tile_bboxes) + max(b[3] for b in tile_bboxes)) / 2
    origin_z_raw = (min(b[2] for b in tile_bboxes) + max(b[5] for b in tile_bboxes)) / 2

    hive_parts = [i for i in instances if i.rule.group in ("hive_tray", "hive_frame")]
    flower_parts = [i for i in instances if i.rule.group == "flowers"]
    if not hive_parts:
        raise RuntimeError("no hive parts found — cannot fit/prove the axis mapping")
    if not flower_parts:
        raise RuntimeError("no flower parts found — cannot fit/prove the axis mapping")

    hive_c = [centroid_mm(i.bbox_mm) for i in hive_parts]
    flower_c = [centroid_mm(i.bbox_mm) for i in flower_parts]

    best: AxisFit | None = None
    print("[convert] axis-mapping candidates (lower residual is better):", file=sys.stderr)
    for horiz_a, horiz_b in (("x", "z"), ("z", "x")):
        for sign_a in (1, -1):
            for sign_b in (1, -1):
                idx_a = 0 if horiz_a == "x" else 2
                idx_b = 0 if horiz_b == "x" else 2
                origin_a = origin_x_raw if horiz_a == "x" else origin_z_raw
                origin_b = origin_x_raw if horiz_b == "x" else origin_z_raw

                def to_sim_xy(c, idx_a=idx_a, idx_b=idx_b, origin_a=origin_a, origin_b=origin_b, sign_a=sign_a, sign_b=sign_b):
                    return (
                        sign_a * (c[idx_a] - origin_a) / MM_PER_IN,
                        sign_b * (c[idx_b] - origin_b) / MM_PER_IN,
                    )

                hive_res = 0.0
                for c in hive_c:
                    sx, _ = to_sim_xy(c)
                    hive_res += min((sx - BB_HIVE_X) ** 2, (sx + BB_HIVE_X) ** 2)
                hive_res /= len(hive_c)

                flower_res = 0.0
                for c in flower_c:
                    sx, sy = to_sim_xy(c)
                    flower_res += min((sx - f["x"]) ** 2 + (sy - f["y"]) ** 2 for f in BB_FLOWERS)
                flower_res /= len(flower_c)

                total = hive_res + flower_res
                print(
                    f"    a={horiz_a}*{sign_a:+d} b={horiz_b}*{sign_b:+d} "
                    f"hive_rmse={math.sqrt(hive_res):.3f}in flower_rmse={math.sqrt(flower_res):.3f}in "
                    f"total={total:.4f}",
                    file=sys.stderr,
                )
                if best is None or total < best.residual:
                    best = AxisFit(
                        horiz_a=horiz_a,
                        sign_a=sign_a,
                        horiz_b=horiz_b,
                        sign_b=sign_b,
                        origin_a=origin_a,
                        origin_b=origin_b,
                        vert_axis="y",
                        vert_origin=vert_origin,
                        residual=total,
                    )
    assert best is not None

    # ---- break the point-symmetry tie -----------------------------------------------------
    # The field is 180°-point-symmetric (config.ts's own header: "POINT-SYMMETRIC, NOT
    # MIRRORED"), so BOTH (sign_a, sign_b) and (-sign_a, -sign_b) score identically — no
    # geometric anchor can tell them apart, only an ALLIANCE-COLOURED one can. "Goal Rib" is
    # the one part name that is trustworthy for this, and the audit made it doubly so: those are
    # the two parts the STEP gives PURE RED (1,0,0) and PURE BLUE (0,0,1). The manual says each
    # HIVE's two cells are the SAME colour, so the red-named ribs must average out on the
    # NEGATIVE sim-x side (RED IS AT y > 0... x < 0, config.ts). If they do not, this is the
    # mirror-image candidate, and flipping BOTH signs together is exactly a 180° rotation.
    idx_a = 0 if best.horiz_a == "x" else 2

    def sim_x_of(inst: Instance) -> float:
        c = centroid_mm(inst.bbox_mm)
        return best.sign_a * (c[idx_a] - best.origin_a) / MM_PER_IN

    red_ribs = [i for i in instances if re.search(r"goal rib", i.name, re.I) and re.search(r"red", i.name, re.I)]
    blue_ribs = [i for i in instances if re.search(r"goal rib", i.name, re.I) and re.search(r"blue", i.name, re.I)]
    if red_ribs and blue_ribs:
        red_x = sum(sim_x_of(i) for i in red_ribs) / len(red_ribs)
        blue_x = sum(sim_x_of(i) for i in blue_ribs) / len(blue_ribs)
        print(f"[convert] disambiguation: red-rib mean sim_x={red_x:.2f}in, blue-rib mean sim_x={blue_x:.2f}in", file=sys.stderr)
        if red_x > blue_x:
            print("[convert] red landed on the +x side — flipping both signs (180° point-symmetry correction)", file=sys.stderr)
            best.sign_a *= -1
            best.sign_b *= -1
    else:
        print("[convert] WARNING: no red/blue 'Goal Rib' parts found — cannot disambiguate the 180° point-symmetry tie; trusting the residual fit's raw sign", file=sys.stderr)

    print(
        f"[convert] FINAL FIT: sim_x = {best.sign_a:+d}*(cad_{best.horiz_a}-{best.origin_a:.2f}mm)/25.4, "
        f"sim_y = {best.sign_b:+d}*(cad_{best.horiz_b}-{best.origin_b:.2f}mm)/25.4, "
        f"sim_z = (cad_y-{best.vert_origin:.2f}mm)/25.4  residual={best.residual:.4f}",
        file=sys.stderr,
    )
    return best


def transform_point_mm(fit: AxisFit, p_mm) -> tuple[float, float, float]:
    """raw CAD point in mm -> sim point in inches, per the fitted mapping."""
    idx_a = 0 if fit.horiz_a == "x" else 2
    idx_b = 0 if fit.horiz_b == "x" else 2
    return (
        fit.sign_a * (p_mm[idx_a] - fit.origin_a) / MM_PER_IN,
        fit.sign_b * (p_mm[idx_b] - fit.origin_b) / MM_PER_IN,
        (p_mm[1] - fit.vert_origin) / MM_PER_IN,
    )


# ─────────────────────────────────────────────────────────────────────────────────────────
# 5. TESSELLATION
# ─────────────────────────────────────────────────────────────────────────────────────────


def mesh_shape_mm(shape, lin_deflection_mm: float, ang_deflection: float):
    """Tessellate `shape` (already in world/root mm coordinates) and return
    (positions_mm: list[3-tuple], triangles: list[3-tuple]) in the raw CAD axes/mm.

    ⚠️ `BRepTools.Clean_s` FIRST, ALWAYS. `BRepMesh_IncrementalMesh` caches its triangulation
    on the shape's own (shared) TShape and silently NO-OPS on a second call at a different
    deflection — the first pass here re-meshed the same shape at "high" then "low" and produced
    byte-identical STL for both, because "low" never actually recomputed anything. Every caller
    that wants a genuinely different level of detail must clear the stale mesh first.
    """
    BRepTools.Clean_s(shape)
    BRepMesh_IncrementalMesh(shape, lin_deflection_mm, False, ang_deflection, True)
    positions: list[tuple] = []
    indices: list[tuple] = []
    dedup: dict[tuple, int] = {}

    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        face = TopoDS.Face_s(explorer.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            trsf = loc.Transformation()
            local_index: dict[int, int] = {}
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i)
                p.Transform(trsf)
                key = (round(p.X(), 3), round(p.Y(), 3), round(p.Z(), 3))
                gi = dedup.get(key)
                if gi is None:
                    gi = len(positions)
                    positions.append(key)
                    dedup[key] = gi
                local_index[i] = gi
            for t in range(1, tri.NbTriangles() + 1):
                n1, n2, n3 = tri.Triangle(t).Get()
                indices.append((local_index[n1], local_index[n2], local_index[n3]))
        explorer.Next()
    return positions, indices


def merge_meshes(meshes: list[tuple[list, list]]):
    positions: list[tuple] = []
    indices: list[tuple] = []
    for pos, idx in meshes:
        base = len(positions)
        positions.extend(pos)
        for a, b, c in idx:
            indices.append((a + base, b + base, c + base))
    return positions, indices


def write_binary_stl(path: Path, positions: list[tuple], indices: list[tuple]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x00" * 80)
        f.write(struct.pack("<I", len(indices)))
        for a, b, c in indices:
            ax, ay, az = positions[a]
            bx, by, bz = positions[b]
            cx, cy, cz = positions[c]
            ux, uy, uz = bx - ax, by - ay, bz - az
            vx, vy, vz = cx - ax, cy - ay, cz - az
            nx = uy * vz - uz * vy
            ny = uz * vx - ux * vz
            nz = ux * vy - uy * vx
            nl = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            f.write(struct.pack("<3f", nx / nl, ny / nl, nz / nl))
            f.write(struct.pack("<3f", ax, ay, az))
            f.write(struct.pack("<3f", bx, by, bz))
            f.write(struct.pack("<3f", cx, cy, cz))
            f.write(struct.pack("<H", 0))


# ─────────────────────────────────────────────────────────────────────────────────────────
# 6. HULLS
# ─────────────────────────────────────────────────────────────────────────────────────────

# Rapier rebuilds a `convexHull` collider's faces from a bare point set, so a hull is exported
# as POINTS only. `HULL_MAX_VERTS` caps each one: a tessellated ROUND part (the Blumotion
# damper's housing, a HIPS pipe, a Churro tube) keeps one hull vertex per facet around the
# curve, which is the single biggest contributor to the collider file's size and buys nothing
# physically -- and it is not free: `field-colliders.json` is compiled into `fieldColliders.gen.ts`,
# which `step.ts` imports STATICALLY, so every byte here lands in the MAIN client bundle whether
# the player ever opens a 3D practice or not (`npm run bundleaudit` is what says so). 24 verts is
# a cube's 8 plus room for a chamfered or lightly-curved part; the residual below is the honest
# measure of what that costs. Decimation is FARTHEST-POINT SAMPLING (deterministic: it always
# starts from the lexicographically smallest point), then the residual — the largest distance from any dropped
# point to the decimated hull's own surface — is MEASURED and printed, and the whole run fails
# if it exceeds `HULL_MAX_RESIDUAL_IN`. A decimated hull is strictly INSIDE the true one, so
# the residual is exactly how much of the part a collider could let something sink into.
HULL_MAX_VERTS = 20
HULL_MAX_RESIDUAL_IN = 0.2


def _convex_hull_points(pts):
    import numpy as np
    from scipy.spatial import ConvexHull

    if len(pts) < 4:
        return np.asarray(pts, dtype=float), None
    arr = np.asarray(pts, dtype=float)
    try:
        hull = ConvexHull(arr)
    except Exception as exc:  # degenerate (near-planar) part
        return arr, exc
    return arr[hull.vertices], None


def _farthest_point_sample(verts, k: int):
    import numpy as np

    arr = np.asarray(verts, dtype=float)
    start = int(np.lexsort((arr[:, 2], arr[:, 1], arr[:, 0]))[0])  # deterministic seed
    chosen = [start]
    d = np.linalg.norm(arr - arr[start], axis=1)
    while len(chosen) < min(k, len(arr)):
        nxt = int(np.argmax(d))
        if nxt in chosen:
            break
        chosen.append(nxt)
        d = np.minimum(d, np.linalg.norm(arr - arr[nxt], axis=1))
    return arr[sorted(chosen)]


def _hull_residual(all_pts, hull_verts) -> float:
    """largest distance from any input point to the OUTSIDE of `hull_verts`' hull (0 when the
    decimated hull still contains everything)."""
    import numpy as np
    from scipy.spatial import ConvexHull

    if len(hull_verts) < 4:
        return 0.0
    try:
        h = ConvexHull(np.asarray(hull_verts, dtype=float))
    except Exception:
        return 0.0
    eq = h.equations  # A·x + b <= 0 inside
    pts = np.asarray(all_pts, dtype=float)
    dist = pts @ eq[:, :3].T + eq[:, 3]
    return float(max(0.0, dist.max()))


def hull_of(points, name: str, residuals: list[tuple[str, float]]):
    """A decimated true convex hull of `points` (already in the output frame, inches), as a flat
    rounded coordinate list. Returns `None` when the point set cannot make a hull at all."""
    verts, err = _convex_hull_points(points)
    if err is not None:
        print(f"[convert]   hull({name}): degenerate ({err}); keeping the raw point set", file=sys.stderr)
    if len(verts) == 0:
        return None
    if len(verts) > HULL_MAX_VERTS:
        kept = _farthest_point_sample(verts, HULL_MAX_VERTS)
        res = _hull_residual(verts, kept)
        residuals.append((name, res))
        verts = kept
    # 2 dp = 0.01 in. Four was a habit, not a requirement: no collider in this sim resolves a
    # hundredth of an inch (the contact slop alone is larger), and the extra digits are ~20% of a
    # file that ships in the MAIN client bundle whether a player opens a 3D practice or not.
    return [round(float(c), 2) for v in verts for c in v]


# ─────────────────────────────────────────────────────────────────────────────────────────
# 7. PLANAR FACET SLABS — the tray's colliders
# ─────────────────────────────────────────────────────────────────────────────────────────

# A cell's parts are OPEN SHELLS (see the file header, point 4b), so a per-part hull fills the
# cell. Each part is instead decomposed into PLANAR FACETS — triangles grouped by (normal,
# plane offset) — and each facet of at least `FACET_MIN_AREA` becomes a thin convex slab whose
# INNER FACE IS THE CAD SURFACE ITSELF, extruded `FACET_SLAB_T` AWAY from the cell's own
# interior centre. So the collider a resting element touches is, to the CAD sheet's own 0.020-in
# thickness, the same plane the GLB mesh draws.
#
# `FACET_MIN_AREA` 20 in² keeps exactly the structural planes and drops the decoration: on the
# measured STEP a cell's Bottom Skin yields the FLOOR (422 in²) and two SIDES (147 in² each)
# and nothing else (its eight brake-formed chamfers are ~5.7 in² apiece); the Top Skin yields
# the two ROOF planes (251 in² each); the Back Skin one BACK plane (492 in²).
#
# `FACET_SLAB_T` 1.5 in is the same anti-tunnelling padding the hand-built tray used
# (`BB3_HIVE_CELL_WALL/2` floored at 0.75, i.e. a 1.5-in-thick wall): a 0.25-in wall meeting a
# 260 in/s sphere is right at the edge of what one narrow-phase substep resolves. ALL of it now
# goes on the OUTSIDE, which is the difference that matters — padding a collider inward is
# exactly how an element ends up resting above the floor it looks like it is sitting on.
FACET_MIN_AREA = 20.0
FACET_SLAB_T = 1.5
FACET_NORMAL_TOL = 0.02  # 1 − cos(angle)
FACET_OFFSET_TOL = 0.03  # in


def planar_facets(pts, tris):
    """[(normal, offset, area, points)] for every planar facet of a tessellated part."""
    import numpy as np

    P = np.asarray(pts, dtype=float)
    T = np.asarray(tris, dtype=int)
    if len(T) == 0:
        return []
    A, B, C = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    cross = np.cross(B - A, C - A)
    length = np.linalg.norm(cross, axis=1)
    live = length > 1e-9
    if not live.any():
        return []
    n = cross[live] / length[live, None]
    area = length[live] / 2
    off = np.einsum("ij,ij->i", n, A[live])
    Al, Bl, Cl = A[live], B[live], C[live]
    used = np.zeros(len(n), bool)
    out = []
    for i in range(len(n)):
        if used[i]:
            continue
        m = (~used) & (n @ n[i] > 1 - FACET_NORMAL_TOL) & (np.abs(off - off[i]) < FACET_OFFSET_TOL)
        used |= m
        out.append((n[i], float(off[i]), float(area[m].sum()), np.vstack([Al[m], Bl[m], Cl[m]])))
    return out


def facet_slab(normal, facet_pts, interior_centre):
    """An ORIENTED BOX on the facet's own plane: the facet's 2D bounding rectangle IN THAT PLANE,
    extruded `FACET_SLAB_T` AWAY from `interior_centre`. Eight points, exactly.

    Why a rectangle and not the facet's own outline: every structural facet on this tray IS a
    rectangle (the floor is x ∈ ±9 × v ∈ 9.6…21.4, each side is w ∈ −0.4…5.9 × the same v, each
    roof plane likewise), so for those the box is EXACT. The one exception is the BACK plate,
    which is a hexagon — and a rectangle that contains it is the right approximation there
    because the back is a closed wall and its extra corners fall outside the cell's own house-
    shaped cross-section anyway. Carrying the true outline instead cost 130+ hull vertices and,
    after the `HULL_MAX_VERTS` decimation, left a 0.24-in bite out of the back wall: a decimated
    hull is strictly INSIDE the true one, so the cheap-looking option was the one that actually
    lost geometry. An oriented box loses none and needs no decimation at all.

    The plane basis is built from the world axis LEAST aligned with the normal, which makes the
    basis axis-aligned for every axis-aligned facet (so the exported numbers read as the same
    x/v/w extents the audit quotes) and merely well-conditioned for the two sloped roof planes.
    """
    import numpy as np

    n = np.asarray(normal, dtype=float)
    n = n / (np.linalg.norm(n) or 1.0)
    P = np.asarray(facet_pts, dtype=float)
    away = 1.0 if float(n @ (P.mean(axis=0) - np.asarray(interior_centre, dtype=float))) > 0 else -1.0

    seed = np.zeros(3)
    seed[int(np.argmin(np.abs(n)))] = 1.0
    u = seed - n * float(n @ seed)
    u /= np.linalg.norm(u) or 1.0
    v = np.cross(n, u)

    origin = P[0] - n * float(n @ P[0])  # any point on the plane through the world origin
    du = (P - origin) @ u
    dv = (P - origin) @ v
    dn = float(np.median((P - origin) @ n))
    corners = [
        origin + a * u + b * v + dn * n
        for a in (du.min(), du.max())
        for b in (dv.min(), dv.max())
    ]
    base = np.asarray(corners, dtype=float)
    return np.vstack([base, base + away * FACET_SLAB_T * n])


def facet_role(normal, offset, facet_pts, interior_centre) -> str:
    """`floor` / `roof_pos` / `roof_neg` / `side_pos` / `side_neg` / `back` / `front`, from the
    facet's own normal and which side of the cell centre it sits on. Purely descriptive — the
    physics does not branch on it — but the names are what the smoke lane and the audit quote."""
    import numpy as np

    n = np.asarray(normal, dtype=float)
    c = np.asarray(facet_pts, dtype=float).mean(axis=0)
    d = c - np.asarray(interior_centre, dtype=float)
    if abs(n[0]) > 0.9:
        return "side_pos" if d[0] > 0 else "side_neg"
    if abs(n[1]) > 0.9:
        return "back" if abs(c[1]) < abs(interior_centre[1]) else "front"
    if abs(n[2]) > 0.9:
        return "floor" if d[2] < 0 else "ceiling"
    return ("roof_pos" if d[0] > 0 else "roof_neg") if d[2] > 0 else ("ramp_pos" if d[0] > 0 else "ramp_neg")


# ─────────────────────────────────────────────────────────────────────────────────────────
# 8. MAIN
# ─────────────────────────────────────────────────────────────────────────────────────────

WALL_SIDES = ("left", "right", "rear", "audience")


def wall_side_of(sx: float, sy: float) -> str:
    """which perimeter wall a point is nearest — matches BB_FLOWERS' own 'wall' vocabulary."""
    d = {
        "left": abs(sx - (-BB_HALF_X)),
        "right": abs(sx - BB_HALF_X),
        "rear": abs(sy - BB_HALF_Y),
        "audience": abs(sy - (-BB_HALF_Y)),
    }
    return min(d, key=d.get)


# Deflections are ABSOLUTE (not relative to each part's own size), in mm. The real tile and hive
# parts carry manufacturing detail (waffle ribbing, small fillets, fastener bosses, the Goal
# Rib's honeycomb perforation) that is invisible at game scale but multiplies triangle count
# hugely at a fine deflection. This is a DRIVER-VIEW / OVERHEAD sim camera, never a close-up
# inspection view.
LIN_HIGH_MM, ANG_HIGH = 3.0, 0.6
# LOW is the distant/cheap LOD — gltf-transform's simplify+meshopt pass on the HIGH data
# plateaus once every small disjoint part hits its own few-triangle floor, which the simplifier
# cannot cross regardless of ratio/error, so LOW needs a genuinely coarser SOURCE tessellation.
LIN_LOW_MM, ANG_LOW = 20.0, 1.1
# Colliders get their OWN, coarser tessellation: a hull only needs the envelope, and a coarse
# mesh of a cylinder is already an octagonal prism — which is most of what `HULL_MAX_VERTS`
# would otherwise have to decimate away.
LIN_COL_MM, ANG_COL = 4.0, 1.0


def main() -> None:
    import argparse

    import numpy as np

    ap = argparse.ArgumentParser()
    ap.add_argument("step_path")
    ap.add_argument("--cache", required=True, help="scratch output dir (STL groups, full inventory)")
    ap.add_argument("--public", required=True, help="public/models/biobuzz (colliders + measurements json)")
    args = ap.parse_args()

    cache = Path(args.cache)
    public = Path(args.public)
    cache.mkdir(parents=True, exist_ok=True)
    public.mkdir(parents=True, exist_ok=True)

    colours = read_step_colours(args.step_path)
    instances, all_rows = walk_step(args.step_path, colours)

    by_phys: dict[str, int] = {}
    for i in instances:
        by_phys[i.rule.phys] = by_phys.get(i.rule.phys, 0) + 1
    print(f"[convert] kept instances by physics class: {by_phys}", file=sys.stderr)
    misc_names = sorted({i.name for i in instances if i.rule is MISC_RULE})
    if misc_names:
        print(
            "[convert] NOTE: these structural parts matched no PART_RULES row and went to node "
            f"`misc` with the `misc` material (they are EMITTED, not dropped): {misc_names}",
            file=sys.stderr,
        )

    fit = fit_axes(instances)

    def to_sim(p_mm):
        return transform_point_mm(fit, p_mm)

    # ---- hive pivots ---------------------------------------------------------------------
    # The pivot SHAFT's own bearing ("am-4457: 8 mm ID 22 mm OD Shielded Flanged Bearing
    # F608ZZ") is coaxial with the true pivot line, unlike a bracket that HOLDS the shaft (whose
    # centroid can sit an inch or more off the axis) — a materially better anchor. Matched on the
    # top-level colon form only (`am-4457:`), not the part's own internal sub-feature names
    # (`am-4457 ..._57155K629__Revolve6`, no colon) which are the SAME 8 physical bearings.
    bearing_rows = [r for r in all_rows if r["bbox_mm"] and re.match(r"^am-4457:", r["name"])]

    def hive_pivot(sign: int, fallback: list[Instance]) -> list[float]:
        pts = []
        source = "bearing (am-4457)"
        for row in bearing_rows:
            p = to_sim(centroid_mm(row["bbox_mm"]))
            if (p[0] < 0) == (sign < 0):
                pts.append(p)
        if not pts:
            source = "pivot-bracket/damper proxy (no bearing match - less precise)"
            for inst in fallback:
                if re.search(r"pivot bracket|blumotion|axle holder", inst.name, re.I):
                    pts.append(to_sim(centroid_mm(inst.bbox_mm)))
            if not pts:
                pts = [to_sim(centroid_mm(i.bbox_mm)) for i in fallback]
        z = sum(p[2] for p in pts) / len(pts)
        x = sum(p[0] for p in pts) / len(pts)
        print(
            f"[convert] hive pivot estimate ({'red' if sign < 0 else 'blue'}): x={x:.3f} z={z:.3f} "
            f"from {len(pts)} pts, source={source}",
            file=sys.stderr,
        )
        return [sign * BB_HIVE_X, 0.0, z]

    hive_insts = [i for i in instances if i.rule.group in ("hive_frame", "hive_tray")]
    pivot = {
        "red": hive_pivot(-1, [i for i in hive_insts if to_sim(centroid_mm(i.bbox_mm))[0] < 0]),
        "blue": hive_pivot(1, [i for i in hive_insts if to_sim(centroid_mm(i.bbox_mm))[0] >= 0]),
    }
    # THE CAPTURE TILT. `BB_HIVE_UP_STAGED` fixes the sign; the magnitude is the manual's ±30°,
    # and §4.1 of the audit PROVES it against this STEP: rotating every tray part's tessellated
    # points by −captureTheta about the pivot makes all of them axis-aligned to 0.020 in (the
    # Back Skin's own sheet thickness). `capture_residual` below re-measures that every run, so
    # a revised field that is not at exactly 30° cannot slip through silently.
    capture_theta = {
        a: (1.0 if BB_HIVE_UP_STAGED[a] == "north" else -1.0) * math.radians(BB_HIVE_TILT_DEG)
        for a in ("red", "blue")
    }

    def tray_local(p_sim, alliance: str):
        """sim world (in) -> the tray's pivot-local UN-TILTED frame (x, v, w)."""
        px, py, pz = pivot[alliance]
        th = -capture_theta[alliance]
        dy, dz = p_sim[1] - py, p_sim[2] - pz
        c, s = math.cos(th), math.sin(th)
        return (p_sim[0] - px, dy * c - dz * s, dy * s + dz * c)

    # ---- group assignment ---------------------------------------------------------------
    @dataclass
    class Placed:
        inst: Instance
        node: str  # output glTF node
        bucket: str  # collider/measurement bucket name
        alliance: str | None
        side: str | None  # 'north' | 'south' for tray parts

    placed: list[Placed] = []
    for inst in instances:
        c = to_sim(centroid_mm(inst.bbox_mm))
        g = inst.rule.group
        if g == "hive_tray":
            alliance = "red" if c[0] < 0 else "blue"
            lv = tray_local(c, alliance)[1]
            side = "north" if lv >= 0 else "south"
            placed.append(Placed(inst, f"hive_{alliance}_tray", f"cell_{side}", alliance, side))
        elif g == "hive_frame":
            # A few frame parts SPAN both hives (the A-Frame Top Bar crossbar, x ∈ ±12; the ACM
            # logo panel, x ∈ ±15). Their centroid sits at x ≈ 0, so a red/blue split by sign
            # would arbitrarily hand a shared part to one hive. They go to their own static node
            # instead — every frame node is world-absolute and never rotates, so which node a
            # static part lives in is a bookkeeping choice, not a geometric one.
            if abs(c[0]) < 4.0:
                placed.append(Placed(inst, "hive_shared_frame", "hive_shared_frame", None, None))
            else:
                alliance = "red" if c[0] < 0 else "blue"
                placed.append(Placed(inst, f"hive_{alliance}_frame", f"hive_{alliance}_frame", alliance, None))
        elif g == "flowers":
            k = min(range(4), key=lambda i: (c[0] - BB_FLOWERS[i]["x"]) ** 2 + (c[1] - BB_FLOWERS[i]["y"]) ** 2)
            placed.append(Placed(inst, f"flower_{k}", f"flower_{k}", None, None))
        elif g == "walls":
            placed.append(Placed(inst, "walls", f"wall_{wall_side_of(c[0], c[1])}", None, None))
        else:
            placed.append(Placed(inst, g, g, None, None))

    # ---- visual STL: one file per (node, finish, CAD colour) -----------------------------
    # A node with several distinct real materials (a flower is an amber ring + green HIPS pipes +
    # a purple backstop + grey brackets; a hive tray is an alliance-coloured RIB over white
    # structural skin) is ONE mesh with one PRIMITIVE per (finish, colour) pair, not one merged
    # blob — merging erases the one thing a material split needs, which part a triangle came
    # from, and that is exactly why the flower rendered as a uniform grey lump.
    #
    # The file stem is `<node>__<finish>_<hex>`; `assemble-gltf.mjs` turns each into a primitive
    # whose glTF material is named `<finish>#<hex>` and carries that base colour, and
    # `renderFieldGlb.ts` reads the finish for the PBR parameters and the hex for the colour.
    visual: dict[tuple[str, str, str], list[Instance]] = {}
    for p in placed:
        key = (p.node, p.inst.rule.finish, hex_of(p.inst.colour))
        visual.setdefault(key, []).append(p.inst)

    def mesh_group(insts: list[Instance], lin: float, ang: float, origin, alliance: str | None):
        parts = []
        for inst in insts:
            pos_mm, idx = mesh_shape_mm(inst.shape, lin, ang)
            pos = [to_sim(p) for p in pos_mm]
            if alliance is not None:
                pos = [tray_local(p, alliance) for p in pos]
            else:
                pos = [(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]) for p in pos]
            parts.append((pos, idx))
        return merge_meshes(parts) if parts else ([], [])

    def box_mesh_in(xr, yr, zr):
        """axis-aligned box, positions in inches, as a simple 8-vert/12-tri mesh."""
        pos = [(x, y, z) for x in xr for y in yr for z in zr]

        def c(xb, yb, zb):
            return xb * 4 + yb * 2 + zb

        faces = [
            (c(0, 0, 0), c(1, 0, 0), c(1, 1, 0)), (c(0, 0, 0), c(1, 1, 0), c(0, 1, 0)),  # z-
            (c(0, 0, 1), c(1, 1, 1), c(1, 0, 1)), (c(0, 0, 1), c(0, 1, 1), c(1, 1, 1)),  # z+
            (c(0, 0, 0), c(0, 1, 0), c(0, 1, 1)), (c(0, 0, 0), c(0, 1, 1), c(0, 0, 1)),  # x-
            (c(1, 0, 0), c(1, 1, 1), c(1, 1, 0)), (c(1, 0, 0), c(1, 0, 1), c(1, 1, 1)),  # x+
            (c(0, 0, 0), c(1, 0, 1), c(1, 0, 0)), (c(0, 0, 0), c(0, 0, 1), c(1, 0, 1)),  # y-
            (c(0, 1, 0), c(1, 1, 0), c(1, 1, 1)), (c(0, 1, 0), c(1, 1, 1), c(0, 1, 1)),  # y+
        ]
        return pos, faces

    # ⚠️ CLEAR THE STL DIRS FIRST. The cache is not wiped between runs, and the file names encode
    # the (node, finish, colour) split — so a renamed part, a changed CAD colour or a reworked
    # class table leaves the OLD file sitting there, and `assemble-gltf.mjs` (which now refuses
    # to leave any STL unclaimed) would either fail on it or, worse, draw last week's geometry.
    for level in ("high", "low"):
        d = cache / "stl" / level
        if d.exists():
            for stale in d.glob("*.stl"):
                stale.unlink()

    size_report = []
    for (node, finish, hexc), insts in sorted(visual.items()):
        alliance = "red" if node == "hive_red_tray" else "blue" if node == "hive_blue_tray" else None
        stem = f"{node}__{finish}_{hexc}"
        if node == "tiles":
            # A DELIBERATE SIMPLIFICATION, both LOD levels: the real tile geometry is a ribbed,
            # perforated foam plate (175,536 triangles for the 36 plates, measured, an 8.8 MB
            # STL) whose detail reads only as noise at this sim's camera distance. The floor's
            # actual on-screen texture — the 23.53-in tile seam grid and the centre mark, at the
            # CAD's OWN measured pitch — is a canvas texture (`renderField.ts`'s
            # `buildFloorTexture`) painted on a flat plane; this box is that plane's CAD-accurate
            # replacement (real thickness, real footprint), not a tessellation of the underside.
            corners = []
            for inst in insts:
                xmin, ymin, zmin, xmax, ymax, zmax = inst.bbox_mm
                corners.extend(to_sim((x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax))
            pos, idx = box_mesh_in(
                (min(p[0] for p in corners), max(p[0] for p in corners)),
                (min(p[1] for p in corners), max(p[1] for p in corners)),
                (min(p[2] for p in corners), max(p[2] for p in corners)),
            )
            for level in ("high", "low"):
                out = cache / "stl" / level / f"{stem}.stl"
                write_binary_stl(out, pos, idx)
                size_report.append((stem, level, len(insts), len(pos), len(idx), out.stat().st_size))
            continue
        for level, lin, ang in (("high", LIN_HIGH_MM, ANG_HIGH), ("low", LIN_LOW_MM, ANG_LOW)):
            pos, idx = mesh_group(insts, lin, ang, (0.0, 0.0, 0.0), alliance)
            out = cache / "stl" / level / f"{stem}.stl"
            write_binary_stl(out, pos, idx)
            size_report.append((stem, level, len(insts), len(pos), len(idx), out.stat().st_size))
    print("[convert] STL groups (node__finish_hex, level, parts, verts, tris, bytes):", file=sys.stderr)
    for row in size_report:
        print("   ", row, file=sys.stderr)

    # ---- collider tessellation, once, at the collider deflection --------------------------
    col_pts: dict[int, tuple[list, list]] = {}
    for k, p in enumerate(placed):
        if not p.inst.rule.collide:
            continue
        pos_mm, idx = mesh_shape_mm(p.inst.shape, LIN_COL_MM, ANG_COL)
        pos = [to_sim(q) for q in pos_mm]
        if p.inst.rule.group == "hive_tray":
            pos = [tray_local(q, p.alliance) for q in pos]
        col_pts[k] = (pos, idx)

    residuals: list[tuple[str, float]] = []

    # ---- STATICS: one true convex hull per PART INSTANCE ----------------------------------
    # Per INSTANCE, not per part-type bucket: two A-frame legs merged into one hull is a solid
    # wedge between them, and the space between the legs is exactly the drive-under. The only
    # merged entries are the four WALL sides, which exist as a MEASUREMENT (`cadWallExtents`) —
    # `bodies.ts` builds the perimeter analytically at the constants (owner rule).
    statics = []
    seen: dict[str, int] = {}

    def static_name(base: str) -> str:
        seen[base] = seen.get(base, 0) + 1
        return base if seen[base] == 1 else f"{base}_{seen[base]}"

    wall_buckets: dict[str, list] = {s: [] for s in WALL_SIDES}
    for k, p in enumerate(placed):
        if k not in col_pts:
            continue
        if p.inst.rule.group == "hive_tray":
            continue  # handled below, in the tray's own frame
        pos, _ = col_pts[k]
        if p.inst.rule.phys == "wall":
            wall_buckets[p.bucket.replace("wall_", "")].extend(pos)
            continue
        nm = static_name(f"{p.bucket}_{re.sub(r'[^a-z0-9]+', '_', p.inst.name.lower()).strip('_')}")
        pts = hull_of(pos, nm, residuals)
        if pts:
            statics.append({"name": nm, "class": p.inst.rule.phys, "points": pts})
    # ⚠️ THE FOUR WALL SIDES ARE NOT EXPORTED AS COLLIDERS AT ALL. They are never built
    # (`PHYSICAL_STATIC_CLASSES` in `sim3d/fieldColliders.ts`: the 3D perimeter is analytic at the
    # constants, owner rule), nothing at runtime reads them, and `field-colliders.json` is compiled
    # into `fieldColliders.gen.ts` which `step.ts` imports STATICALLY — so every byte here lands in
    # the MAIN client bundle (`npm run bundleaudit` is what says so). The CAD wall inner face is a
    # MEASUREMENT and lives in `field-measurements.json`'s `walls.innerFace`, which is where the
    # SIM3D smoke lane reads it from.
    _wall_points_unused = wall_buckets

    # ---- TRAYS: planar facet slabs, in the pivot-local UN-TILTED frame ---------------------
    trays: dict[str, dict] = {}
    tray_measure: dict[str, dict] = {}
    for alliance in ("red", "blue"):
        # the cell's interior centre, per cell, from its own floor+roof parts' extent — the
        # reference point `facet_slab` pushes every slab away from.
        cell_pts: dict[str, list] = {"north": [], "south": []}
        for k, p in enumerate(placed):
            if p.alliance != alliance or p.inst.rule.group != "hive_tray" or k not in col_pts:
                continue
            if p.inst.rule.phys in ("tray_floor", "tray_roof"):
                cell_pts[p.side].extend(col_pts[k][0])
        centres = {}
        for side, pts in cell_pts.items():
            if not pts:
                continue
            A = np.asarray(pts, dtype=float)
            centres[side] = (0.0, float(A[:, 1].mean()), float(A[:, 2].mean()))

        hulls = []
        facet_log = []
        # THE CELL INTERIOR, ACCUMULATED FROM THE FACETS' OWN (UN-EXTRUDED) POINTS — never from
        # the finished hulls. A slab's hull already carries its 1.5-in outward extrusion, so
        # reading `wMax` back off a roof hull gives a number 1.3 in above the real ceiling; and
        # the roof is a GABLE, so its lowest point (the eaves, w 6.77) is not the ceiling either.
        # These four numbers are what `derive.ts`'s membership test and the manual's
        # `BB_HIVE_OPEN_Z` check both read, so they are measured off the surfaces themselves.
        interior: dict[str, dict[str, float]] = {}

        def note_interior(side: str, role: str, fpts) -> None:
            A = np.asarray(fpts, dtype=float)
            d = interior.setdefault(side, {})
            if role == "floor":
                # the floor facet merges the plate's top and bottom surface (0.020 in apart);
                # its MAX w is the load-bearing one.
                d["wMin"] = max(d.get("wMin", -1e9), float(A[:, 2].max()))
                d["vMin"] = min(d.get("vMin", 1e9), float(A[:, 1].min()))
                d["vMax"] = max(d.get("vMax", -1e9), float(A[:, 1].max()))
            elif role.startswith("roof") or role == "ceiling":
                d["wMax"] = max(d.get("wMax", -1e9), float(A[:, 2].max()))
            elif role.startswith("side"):
                d["xHalf"] = min(d.get("xHalf", 1e9), float(np.abs(A[:, 0]).min()))
            elif role == "back":
                d["backV"] = float(A[:, 1].mean())

        for k, p in enumerate(placed):
            if p.alliance != alliance or p.inst.rule.group != "hive_tray" or k not in col_pts:
                continue
            pos, tris = col_pts[k]
            if p.inst.rule.phys == "tray_bar":
                # a real solid tube under the floor — a whole-part hull is correct here
                pts = hull_of(pos, f"{alliance}/bar_{p.side}", residuals)
                if pts:
                    hulls.append({"name": f"bar_{p.side}", "class": "tray_bar", "points": pts})
                continue
            centre = centres.get(p.side)
            if centre is None:
                continue
            for normal, offset, area, fpts in planar_facets(pos, tris):
                if area < FACET_MIN_AREA:
                    continue
                role = facet_role(normal, offset, fpts, centre)
                note_interior(p.side, role, fpts)
                nm = f"cell_{p.side}_{role}"
                slab = facet_slab(normal, fpts, centre)
                pts = hull_of(slab, f"{alliance}/{nm}", residuals)
                if not pts:
                    continue
                base = nm
                n = 2
                while any(h["name"] == nm for h in hulls):
                    nm = f"{base}_{n}"
                    n += 1
                hulls.append({"name": nm, "class": p.inst.rule.phys, "points": pts})
                facet_log.append((nm, round(area, 1), [round(float(v), 4) for v in normal], round(offset, 4)))
        print(f"[convert] {alliance} tray facet slabs:", file=sys.stderr)
        for row in facet_log:
            print("   ", row, file=sys.stderr)

        cells = {}
        for side, d in sorted(interior.items()):
            if not {"wMin", "wMax", "vMin", "vMax"} <= set(d):
                print(f"[convert] WARNING: {alliance}/{side} cell is missing a structural facet: {sorted(d)}", file=sys.stderr)
                continue
            vlo, vhi = d["vMin"], d["vMax"]
            back_v = d.get("backV")
            if back_v is not None:
                # the BACK plate closes the pivot-side end; the floor plate can reach a hair past
                # it, and a membership box that does are-there-any-inches with no floor under
                # them is exactly what let a dropped element fall through in an earlier pass.
                if side == "north":
                    vlo = max(vlo, back_v)
                else:
                    vhi = min(vhi, back_v)
            cells[side] = {
                "xHalf": round(d.get("xHalf", 0.0), 4),
                "vMin": round(vlo, 4),
                "vMax": round(vhi, 4),
                "wMin": round(d["wMin"], 4),
                "wMax": round(d["wMax"], 4),
            }

        trays[alliance] = {
            "pivot": [round(c, 4) for c in pivot[alliance]],
            "axis": [1, 0, 0],
            # 0 BY CONSTRUCTION: every tray point above was rotated by −captureTheta about the
            # pivot, so the runtime's own rotation is exactly `hiveTiltAngle`. The field is kept
            # (rather than removed) because `hiveTrayRefTheta`/`updateBiobuzzField` still read it
            # and because a future revision whose tray is NOT exported un-tilted would need it.
            "refTheta": 0.0,
            "captureTheta": round(capture_theta[alliance], 6),
            "cells": cells,
            "hulls": hulls,
        }

        # residual proof that the capture tilt is right: with the correct θ every tray part is
        # axis-aligned in (v, w), so the THINNEST axis of the Back Skin (a flat sheet) is its own
        # 0.020-in thickness. Any error in θ shows up here immediately as a thicker sheet.
        back_thick = None
        for k, p in enumerate(placed):
            if p.alliance == alliance and p.inst.rule.phys == "tray_back" and k in col_pts:
                A = np.asarray(col_pts[k][0], dtype=float)
                back_thick = float(A[:, 1].max() - A[:, 1].min())
                break
        tray_measure[alliance] = {
            "pivot": [round(c, 4) for c in pivot[alliance]],
            "captureThetaRad": round(capture_theta[alliance], 6),
            "captureThetaDeg": round(math.degrees(capture_theta[alliance]), 4),
            "upStaged": BB_HIVE_UP_STAGED[alliance],
            "backSkinThicknessIn": None if back_thick is None else round(back_thick, 4),
            "cells": cells,
            "facets": facet_log,
        }
        print(
            f"[convert] {alliance} tray: captureTheta={math.degrees(capture_theta[alliance]):+.3f}deg, "
            f"back-skin residual thickness={back_thick if back_thick is None else round(back_thick, 4)}in "
            f"(a wrong theta reads as a THICK sheet)",
            file=sys.stderr,
        )

    # ---- flowers -------------------------------------------------------------------------
    flowers_json = []
    for k, f in enumerate(BB_FLOWERS):
        prefix = f"flower_{k}_"
        flowers_json.append(
            {
                "id": f["id"],
                "wall": f["wall"],
                "pos": [f["x"], f["y"]],
                # the SOLID support statics for this flower (backstop/pipes/brackets/base) — the
                # ring plates are visual-only, see PART_RULES.
                "staticNames": [s["name"] for s in statics if s["name"].startswith(prefix)],
                "visualNode": f"flower_{k}",
            }
        )

    # THE FLOOR'S OWN NUMBERS, carried in the COLLIDER file rather than only in the measurements,
    # because `scene/renderField.ts` needs them at RUNTIME to paint the tile-seam texture at the
    # CAD's real pitch (23.53 in, not `C.TILE`'s 24) and over the CAD's real footprint — and the
    # measurements JSON is not compiled into a module the client can import (`fieldColliders.gen.ts`
    # is). Without this the painted seams sit ~1 in off the CAD tape lying on top of them.
    tiles_bb: list[tuple] = []
    for p in placed:
        if p.inst.rule.phys != "tile":
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = p.inst.bbox_mm
        tiles_bb.extend(to_sim((x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax))
    floor_json = None
    if tiles_bb:
        fx = [min(q[0] for q in tiles_bb), max(q[0] for q in tiles_bb)]
        fy = [min(q[1] for q in tiles_bb), max(q[1] for q in tiles_bb)]
        fz = [min(q[2] for q in tiles_bb), max(q[2] for q in tiles_bb)]
        floor_json = {
            "x": [round(fx[0], 4), round(fx[1], 4)],
            "y": [round(fy[0], 4), round(fy[1], 4)],
            "z": [round(fz[0], 4), round(fz[1], 4)],
            "pitch": round((fx[1] - fx[0]) / 6.0, 4),
        }

    colliders = {
        "units": "in",
        "frame": "sim",
        "source": {"note": "generated by scripts/field-cad/convert.py from the official FIRST field STEP"},
        "floor": floor_json,
        "statics": statics,
        "trays": trays,
        "flowers": flowers_json,
    }
    (public / "field-colliders.json").write_text(json.dumps(colliders))
    print(
        f"[convert] wrote {public / 'field-colliders.json'} "
        f"({(public / 'field-colliders.json').stat().st_size} bytes, {len(statics)} statics)",
        file=sys.stderr,
    )

    # ---- measurements ---------------------------------------------------------------------
    def extent_of(pred) -> dict | None:
        pts = []
        for k, p in enumerate(placed):
            if not pred(p):
                continue
            xmin, ymin, zmin, xmax, ymax, zmax = p.inst.bbox_mm
            pts.extend(to_sim((x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax))
        if not pts:
            return None
        return {
            "x": [round(min(q[0] for q in pts), 4), round(max(q[0] for q in pts), 4)],
            "y": [round(min(q[1] for q in pts), 4), round(max(q[1] for q in pts), 4)],
            "z": [round(min(q[2] for q in pts), 4), round(max(q[2] for q in pts), 4)],
        }

    # TILE PITCH — the seam spacing the floor texture and the tape have to agree with. Real FTC
    # soft tiles are ~23.5 in with interlocking tabs (body 24.31), NOT the 24 `C.TILE` assumes;
    # this is the root of every "CAD vs constants" delta in the audit's §7.
    tile_x0 = sorted({round(to_sim((b[0], b[1], b[2]))[0], 3) for b in (p.inst.bbox_mm for p in placed if p.inst.rule.phys == "tile")})
    tiles_ext = extent_of(lambda p: p.inst.rule.phys == "tile")
    tile_pitch = None
    if tiles_ext:
        tile_pitch = round((tiles_ext["x"][1] - tiles_ext["x"][0]) / 6.0, 4)

    # WALL inner faces, off the GLASS panels' own surfaces (the structural rails sit outboard of
    # them) — reported, never used as a collider input (owner rule: the 3D walls stay analytic at
    # BB_HALF_X/Y for parity with the 2D pipeline and the staging).
    glass_pts: dict[str, list] = {s: [] for s in WALL_SIDES}
    for k, p in enumerate(placed):
        if p.inst.rule.finish != "glass" or p.inst.rule.phys != "wall":
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = p.inst.bbox_mm
        pts = [to_sim((x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)]
        glass_pts[p.bucket.replace("wall_", "")].extend(pts)
    walls_measure = {}
    if all(glass_pts[s] for s in WALL_SIDES):
        walls_measure = {
            "innerFace": {
                "left": round(max(q[0] for q in glass_pts["left"]), 4),
                "right": round(min(q[0] for q in glass_pts["right"]), 4),
                "rear": round(min(q[1] for q in glass_pts["rear"]), 4),
                "audience": round(max(q[1] for q in glass_pts["audience"]), 4),
            },
            "glassZ": [
                round(min(q[2] for s in WALL_SIDES for q in glass_pts[s]), 4),
                round(max(q[2] for s in WALL_SIDES for q in glass_pts[s]), 4),
            ],
            "assemblyZ": (extent_of(lambda p: p.inst.rule.phys == "wall") or {}).get("z"),
            "config_BB_HALF": [BB_HALF_X, BB_HALF_Y],
        }

    # FRAME LEG FOOTPRINTS — what actually stands on the tiles, so the 18/29-in drive-under
    # checks can be reasoned about from data instead of from an AABB.
    leg_footprints = []
    for k, p in enumerate(placed):
        if p.inst.rule.phys != "hive_frame" or k not in col_pts:
            continue
        A = np.asarray(col_pts[k][0], dtype=float)
        low = A[A[:, 2] < 3.0]
        if len(low) == 0:
            continue
        leg_footprints.append(
            {
                "part": p.inst.name,
                "x": [round(float(low[:, 0].min()), 4), round(float(low[:, 0].max()), 4)],
                "y": [round(float(low[:, 1].min()), 4), round(float(low[:, 1].max()), 4)],
                "zTop": round(float(low[:, 2].max()), 4),
            }
        )

    # TAPE — every part, with its own width, length, colour and plane. The part NAME carries the
    # nominal width and length ("Gaffer Tape, Red, 1in Wide, 22.69in Long"); both are re-measured
    # off the geometry here so a name and a shape that disagree are visible.
    tape_rows = []
    for p in placed:
        if p.inst.rule.phys != "tape":
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = p.inst.bbox_mm
        q = [to_sim((x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)]
        bx = [round(min(r[0] for r in q), 4), round(max(r[0] for r in q), 4)]
        by = [round(min(r[1] for r in q), 4), round(max(r[1] for r in q), 4)]
        bz = [round(min(r[2] for r in q), 4), round(max(r[2] for r in q), 4)]
        span = (bx[1] - bx[0], by[1] - by[0])
        nominal = re.search(r"(\d+(?:\.\d+)?)in Wide,\s*(\d+(?:\.\d+)?)in Long", p.inst.name, re.I)
        tape_rows.append(
            {
                "part": p.inst.name,
                "colour": hex_of(p.inst.colour),
                "widthIn": round(min(span), 4),
                "lengthIn": round(max(span), 4),
                "nominalWidthIn": float(nominal.group(1)) if nominal else None,
                "nominalLengthIn": float(nominal.group(2)) if nominal else None,
                "x": bx,
                "y": by,
                "z": bz,
                "plane": "tiles" if bz[0] >= -0.05 else "floor",
            }
        )
    tape_rows.sort(key=lambda r: (r["plane"], r["colour"], -r["lengthIn"], r["x"][0], r["y"][0]))
    tape_widths = sorted({r["widthIn"] for r in tape_rows})

    # FLOWER BORE CENTRES BY CIRCLE FIT — the ring plates are the parts a POLLEN passes through,
    # and their bore is the feature `BB_FLOWERS`/`BB_FLOWER_D` are trying to name. A bbox
    # midpoint is skewed off-axis by the backstop and the wall-side bracket; the 4 HIPS pipes'
    # centroid is better but still assumes they ring the bore symmetrically. This fits the bore
    # itself: take each ring plate's own side-wall band, keep the inner 35 % by radius, and
    # least-squares a circle, re-centring 8 times.
    def fit_bore(pts):
        A = np.asarray(pts, dtype=float)
        if len(A) < 24:
            return None
        zmin, zmax = A[:, 2].min(), A[:, 2].max()
        band = A[(A[:, 2] > zmin + 0.12 * (zmax - zmin)) & (A[:, 2] < zmax - 0.12 * (zmax - zmin))]
        if len(band) < 24:
            band = A
        c = np.array([band[:, 0].mean(), band[:, 1].mean()])
        r = 0.0
        inner = band
        for _ in range(8):
            rad = np.linalg.norm(band[:, :2] - c, axis=1)
            inner = band[rad <= np.percentile(rad, 35)]
            if len(inner) < 8:
                break
            x, y = inner[:, 0], inner[:, 1]
            M = np.stack([x, y, np.ones_like(x)], 1)
            sol, *_ = np.linalg.lstsq(M, x * x + y * y, rcond=None)
            c = np.array([sol[0] / 2, sol[1] / 2])
            r = math.sqrt(max(0.0, sol[2] + c[0] * c[0] + c[1] * c[1]))
        rad = np.linalg.norm(inner[:, :2] - c, axis=1)
        return {
            "centre": [round(float(c[0]), 4), round(float(c[1]), 4)],
            "radius": round(float(r), 4),
            "diameter": round(float(2 * r), 4),
            "rms": round(float(np.std(rad)), 4),
            "n": int(len(inner)),
        }

    RING_ORDER = (("lower", r"flower layer x"), ("mid", r"flower layer b"), ("top", r"flower layer c"))
    flowers_measure = []
    for k, f in enumerate(BB_FLOWERS):
        mine = [p for p in placed if p.node == f"flower_{k}"]
        bores = {}
        for label, pat in RING_ORDER:
            pts = []
            for p in mine:
                if not re.search(pat, p.inst.name, re.I):
                    continue
                pos_mm, _ = mesh_shape_mm(p.inst.shape, 0.3, 0.2)
                pts.extend(to_sim(q) for q in pos_mm)
            got = fit_bore(pts) if pts else None
            if got:
                bores[label] = got
        pipe_centres = []
        for p in mine:
            if not re.search(r"hips pipe", p.inst.name, re.I):
                continue
            xmin, ymin, zmin, xmax, ymax, zmax = p.inst.bbox_mm
            q = [to_sim((x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)]
            pipe_centres.append(((min(r[0] for r in q) + max(r[0] for r in q)) / 2, (min(r[1] for r in q) + max(r[1] for r in q)) / 2))
        flowers_measure.append(
            {
                "id": f["id"],
                "config_pos": [f["x"], f["y"]],
                "bore": bores,
                "pipeCentroid": (
                    [round(sum(c[0] for c in pipe_centres) / len(pipe_centres), 4), round(sum(c[1] for c in pipe_centres) / len(pipe_centres), 4)]
                    if pipe_centres
                    else None
                ),
                "extent": extent_of(lambda p, k=k: p.node == f"flower_{k}"),
                "config_BB_FLOWER_TOP_Z": BB_FLOWER_TOP_Z,
                "config_BB_FLOWER_D": BB_FLOWER_D,
            }
        )

    # the up-cell opening and the down-cell clearance AT REST, from the measured cell interior —
    # the two manual figures this pipeline exists to check, computed, not assumed.
    def rest_z(alliance: str, v: float, w: float) -> float:
        th = capture_theta[alliance]
        return pivot[alliance][2] + v * math.sin(th) + w * math.cos(th)

    hive_measure = {"pivotZ": round(pivot["red"][2], 4), "config_BB3_HIVE_PIVOT_Z": BB_HIVE_PIVOT_Z, "trays": tray_measure}
    for alliance in ("red", "blue"):
        cells = tray_measure[alliance]["cells"]
        up = BB_HIVE_UP_STAGED[alliance]
        down = "south" if up == "north" else "north"
        if up in cells:
            c = cells[up]
            mouth_v = c["vMax"] if up == "north" else c["vMin"]
            hive_measure.setdefault("openingZ", {})[alliance] = [
                round(rest_z(alliance, mouth_v, c["wMin"]), 4),
                round(rest_z(alliance, mouth_v, c["wMax"]), 4),
            ]
        if down in cells:
            c = cells[down]
            lowest = min(
                rest_z(alliance, c["vMin"], c["wMin"]),
                rest_z(alliance, c["vMax"], c["wMin"]),
            )
            hive_measure.setdefault("downCellFloorZ", {})[alliance] = round(lowest, 4)
    # the lowest point of ANY hive structure at rest, tray and frame alike — the real clearance
    # a tall robot meets, which is not the cell floor (the Goal Rib hangs below it).
    lowest_all = None
    for k, p in enumerate(placed):
        if k not in col_pts or p.inst.rule.group not in ("hive_tray", "hive_frame"):
            continue
        A = np.asarray(col_pts[k][0], dtype=float)
        if p.inst.rule.group == "hive_tray":
            th = capture_theta[p.alliance]
            z = pivot[p.alliance][2] + A[:, 1] * math.sin(th) + A[:, 2] * math.cos(th)
            zmin = float(z.min())
        else:
            zmin = float(A[:, 2].min())
        if zmin < 3.0:
            continue  # the frame's own feet stand on the tiles; not an overhead clearance
        if lowest_all is None or zmin < lowest_all[1]:
            lowest_all = (p.inst.name, round(zmin, 4))
    # the ribs are VISUAL-only for physics but they are real steel a robot would hit, so the
    # clearance figure has to include them: measure them here from their own visual tessellation.
    for k, p in enumerate(placed):
        if p.inst.rule.phys != "tray_rib":
            continue
        pos_mm, _ = mesh_shape_mm(p.inst.shape, LIN_COL_MM, ANG_COL)
        A = np.asarray([to_sim(q) for q in pos_mm], dtype=float)
        zmin = float(A[:, 2].min())
        if zmin >= 3.0 and (lowest_all is None or zmin < lowest_all[1]):
            lowest_all = (p.inst.name, round(zmin, 4))
    if lowest_all:
        hive_measure["lowestStructureZAtRest"] = {"part": lowest_all[0], "z": lowest_all[1]}
    hive_measure["config_BB_HIVE_OPEN_Z"] = list(BB_HIVE_OPEN_Z)
    hive_measure["config_BB_HIVE_BOTTOM_Z"] = BB_HIVE_BOTTOM_Z
    hive_measure["frameLegFootprints"] = leg_footprints

    measurements = {
        "source": "scripts/field-cad/convert.py, official FIRST field STEP",
        "units": "in",
        "frame": "sim",
        "hive": hive_measure,
        "flowers": flowers_measure,
        "tiles": {"extent": tiles_ext, "pitch": tile_pitch, "x0Seams": tile_x0, "config_TILE": 24},
        "walls": walls_measure,
        "tape": {"widthsIn": tape_widths, "parts": tape_rows},
        "colours": {
            name: hex_of(rgb)
            for name, rgb in sorted({i.name: i.colour for i in instances if i.colour_from_cad}.items())
        },
        "axisFit": {
            "horiz_a": fit.horiz_a,
            "sign_a": fit.sign_a,
            "horiz_b": fit.horiz_b,
            "sign_b": fit.sign_b,
            "origin_a_mm": fit.origin_a,
            "origin_b_mm": fit.origin_b,
            "vert_origin_mm": fit.vert_origin,
            "residual": fit.residual,
        },
    }
    (public / "field-measurements.json").write_text(json.dumps(measurements, indent=2))
    print(f"[convert] wrote {public / 'field-measurements.json'}", file=sys.stderr)

    # ---- hull decimation report -----------------------------------------------------------
    if residuals:
        residuals.sort(key=lambda r: -r[1])
        print(f"[convert] hull decimation ({len(residuals)} hull(s) over {HULL_MAX_VERTS} verts), worst first:", file=sys.stderr)
        for nm, res in residuals[:10]:
            print(f"    {nm}: residual {res:.4f}in", file=sys.stderr)
        worst = residuals[0][1]
        if worst > HULL_MAX_RESIDUAL_IN:
            raise RuntimeError(
                f"hull decimation residual {worst:.4f}in on '{residuals[0][0]}' exceeds "
                f"HULL_MAX_RESIDUAL_IN {HULL_MAX_RESIDUAL_IN}in — raise HULL_MAX_VERTS or coarsen "
                f"LIN_COL_MM/ANG_COL, do not widen the tolerance silently."
            )
    else:
        print(f"[convert] hull decimation: no hull exceeded {HULL_MAX_VERTS} verts", file=sys.stderr)

    # ---- full inventory (report + audit trail) ----------------------------------------------
    inv_rows = []
    for p in placed:
        xmin, ymin, zmin, xmax, ymax, zmax = p.inst.bbox_mm
        q = [to_sim((x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)]
        inv_rows.append(
            {
                "name": p.inst.name,
                "node": p.node,
                "phys": p.inst.rule.phys,
                "finish": p.inst.rule.finish,
                "collide": p.inst.rule.collide,
                "colour": hex_of(p.inst.colour),
                "colourFromCad": p.inst.colour_from_cad,
                "bbox_sim": [round(min(r[i] for r in q), 4) for i in range(3)] + [round(max(r[i] for r in q), 4) for i in range(3)],
            }
        )
    counts: dict[str, int] = {}
    for r in all_rows:
        counts[r["class"]] = counts.get(r["class"], 0) + 1
    (cache / "field-inventory.json").write_text(
        json.dumps(
            {
                "totalLabelsWalked": len(all_rows),
                "countsByClass": counts,
                "keptInstances": len(instances),
                "miscNames": misc_names,
                "kept": inv_rows,
                "rows": all_rows,
            },
            default=list,
        )
    )
    print(f"[convert] wrote {cache / 'field-inventory.json'} - counts by class: {counts}", file=sys.stderr)
    print("[convert] DONE", file=sys.stderr)


if __name__ == "__main__":
    main()
