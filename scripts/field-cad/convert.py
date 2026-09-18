#!/usr/bin/env python
"""
scripts/field-cad/convert.py — BIOBUZZ field CAD import (docs/biobuzz/plan-3d.md §8).

Reads the official FIRST field STEP assembly (CadQuery/OCP, headless), walks every named
(sub)part via XCAF, classifies each into a field-structure category, transforms every
kept part from the CAD's own axes/units into the SIM's field frame (inches, origin at the
field centre on the tile top surface, +x = audience right, +y = away from the audience,
z = up — see `src/games/biobuzz/config.ts` and `drawField.ts`), and writes:

  <cache>/field-inventory.json      full part inventory (name, class, bbox, included?)
  <cache>/stl/high/<group>.stl      visual mesh per output group, fine tessellation
  <cache>/stl/low/<group>.stl       visual mesh per output group, coarse tessellation
  <public>/field-colliders.json     { units, frame, statics[], trays{red,blue}, flowers[] }
  <public>/field-measurements.json  the dimensions plan-3d.md §8 asks the CAD to settle

`scripts/field-cad.mjs` runs this with the cache venv's python, then assembles + compresses
the STL groups into `public/models/biobuzz/field.glb` / `field-low.glb` with gltf-transform.

── THE AXIS MAPPING IS NOT HARDCODED, IT IS FIT ───────────────────────────────────────────
The STEP's own axes are whatever the Onshape document's top-level origin happened to be
(empirically: Y is vertical, X and Z are the two horizontal axes — see the report), and
which of {+X,-X} <-> sim +x and which of {+Z,-Z} <-> sim +y is exactly the thing that has
gone wrong before (CLAUDE.md's mirrored-vs-bird's-eye gotcha). So this script tries every
sign/swap combination of the two horizontal axes, scores each one against two independent,
already-known-from-the-manual anchors — the two HIVE pivots at sim x = -12.75 / +12.75, and
the four FLOWER centres from `BB_FLOWERS` — and keeps the mapping with the smallest total
residual. Every candidate's score is printed, so a future re-run against a revised STEP
shows immediately if the fit degrades instead of silently keeping a stale mapping.
"""
from __future__ import annotations

import json
import math
import re
import struct
import sys
import time
from dataclasses import dataclass, field
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

# ─────────────────────────────────────────────────────────────────────────────────────────
# 1. NAME CLASSIFICATION
# ─────────────────────────────────────────────────────────────────────────────────────────

# Hardware this pipeline never meshes: fasteners, off-the-shelf small parts. Excluded from
# both the visual GLB and the collider set — at sim scale (a 144-in field) a #10 washer
# contributes nothing to either the picture or the physics, and 224 pop-rivet instances would
# blow every size budget in §8 for zero benefit.
RE_HARDWARE = re.compile(
    r"screw|bolt|nut|rivet|washer|bearing|spacer|rivnut|wing nut|cable tie|hinge rivet"
    r"|elevator bolt|sheet metal screw|fhts|press in plug|strapclip|quick release pin"
    r"|panel fastener|shielded flanged bearing",
    re.IGNORECASE,
)
# Loose scoring elements ride along in the same STEP assembly (staged Pollen/Nectar) but are
# not field STRUCTURE — BIOBUZZ's own sim spawns them from `config.ts`, not from this pipeline.
RE_ELEMENT = re.compile(r"pollen|nectar", re.IGNORECASE)

RE_TILE = re.compile(r"field soft tiles?", re.IGNORECASE)
RE_TAPE = re.compile(r"gaffer tape", re.IGNORECASE)
RE_WALL = re.compile(
    r"rail with rivet|riveted ftc panel|field side glass|panel link|corner hinge for riveted field",
    re.IGNORECASE,
)
RE_FLOWER = re.compile(r"flower", re.IGNORECASE)
# Everything that is the HIVE structure, frame or tray, red or blue: split later by geometry
# (x sign), not by the SKU name — see the header on why name-colour is not trusted for this.
RE_HIVE = re.compile(
    r"a-frame leg|goal pivot bracket|pivot damper holder|blumotion|churro|under tile assembly"
    r"|basket base tube|goal rib|hive goal (top|back|bottom) skin",
    re.IGNORECASE,
)
# Sub-classification inside RE_HIVE, to place a part on the TRAY (the dynamic see-saw body)
# vs the FRAME (static): only the bar and the cell skins ride the tray.
RE_TRAY_BAR = re.compile(r"basket base tube", re.IGNORECASE)
RE_TRAY_SIDE = re.compile(r"goal rib", re.IGNORECASE)
RE_TRAY_FLOOR = re.compile(r"hive goal bottom skin", re.IGNORECASE)
RE_TRAY_BACK = re.compile(r"hive goal back skin", re.IGNORECASE)
RE_TRAY_CEILING = re.compile(r"hive goal top skin", re.IGNORECASE)

STATION_RE = re.compile(r"driver station|alliance station", re.IGNORECASE)


def classify(name: str) -> str:
    if RE_HARDWARE.search(name):
        return "hardware"
    if RE_ELEMENT.search(name):
        return "element"
    if RE_TILE.search(name):
        return "tile"
    if RE_TAPE.search(name):
        return "tape"
    if STATION_RE.search(name):
        return "station"
    if RE_HIVE.search(name):
        return "hive"
    if RE_FLOWER.search(name):
        return "flower"
    if RE_WALL.search(name):
        return "wall"
    return "other"


def clean_name(raw: str) -> str:
    n = re.sub(r"\s*<\d+>\s*$", "", raw).strip()
    return n


# ─────────────────────────────────────────────────────────────────────────────────────────
# 2. XCAF WALK
# ─────────────────────────────────────────────────────────────────────────────────────────


@dataclass
class Instance:
    name: str
    cls: str
    shape: object  # located TopoDS_Shape, world (root-assembly) frame, millimetres
    bbox_mm: tuple  # (xmin,ymin,zmin,xmax,ymax,zmax)


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


def walk_step(step_path: str):
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

    def walk(label: TDF_Label, depth: int):
        name = label_name(label)
        is_assembly = shape_tool.IsAssembly_s(label)
        is_ref = shape_tool.IsReference_s(label)

        if is_ref:
            ref_label = TDF_Label()
            if not shape_tool.GetReferredShape_s(label, ref_label):
                return
            ref_is_assembly = shape_tool.IsAssembly_s(ref_label)
            shape = shape_tool.GetShape_s(label)  # LOCATED (world) shape at this occurrence
            bbox = bbox_of(shape) if shape is not None else None
            cls = classify(name)
            all_rows.append({"name": name, "depth": depth, "class": cls, "bbox_mm": bbox, "assembly": ref_is_assembly})
            if ref_is_assembly:
                # Recurse into the definition to reach its components, but keep walking with
                # THIS occurrence's label so nested locations keep composing correctly.
                children = TDF_LabelSequence()
                shape_tool.GetComponents_s(ref_label, children)
                for i in range(children.Length()):
                    walk(children.Value(i + 1), depth + 1)
            else:
                if cls not in ("hardware",) and shape is not None and bbox is not None:
                    instances.append(Instance(name=clean_name(name), cls=cls, shape=shape, bbox_mm=bbox))
            return

        # a top-level free shape that is not itself a reference (rare, but handle it)
        is_asm = shape_tool.IsAssembly_s(label)
        shape = shape_tool.GetShape_s(label)
        if is_asm:
            children = TDF_LabelSequence()
            shape_tool.GetComponents_s(label, children)
            for i in range(children.Length()):
                walk(children.Value(i + 1), depth + 1)
        elif shape is not None:
            bbox = bbox_of(shape)
            cls = classify(name)
            if cls != "hardware" and bbox is not None:
                instances.append(Instance(name=clean_name(name), cls=cls, shape=shape, bbox_mm=bbox))

    for i in range(free.Length()):
        walk(free.Value(i + 1), 0)

    return instances, all_rows


# ─────────────────────────────────────────────────────────────────────────────────────────
# 3. AXIS MAPPING — fit, then apply
# ─────────────────────────────────────────────────────────────────────────────────────────


def mm_to_in(v: float) -> float:
    return v / MM_PER_IN


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
    tiles = [i for i in instances if i.cls == "tile"]
    if not tiles:
        raise RuntimeError("no tile parts found — cannot anchor the vertical origin or field centre")
    txs = [centroid_mm(i.bbox_mm) for i in tiles]
    tile_bboxes = [i.bbox_mm for i in tiles]
    # vertical origin = the tiles' own top surface (max Y across every tile part's bbox)
    vert_origin = max(b[4] for b in tile_bboxes)  # ymax
    # horizontal field-centre = the mid-point of the tiles' own combined bbox on X and Z
    tile_xmin = min(b[0] for b in tile_bboxes)
    tile_xmax = min(b[3] for b in tile_bboxes) if False else max(b[3] for b in tile_bboxes)
    tile_zmin = min(b[2] for b in tile_bboxes)
    tile_zmax = max(b[5] for b in tile_bboxes)
    origin_x_raw = (tile_xmin + tile_xmax) / 2
    origin_z_raw = (tile_zmin + tile_zmax) / 2

    hive_parts = [i for i in instances if i.cls == "hive"]
    flower_parts = [i for i in instances if i.cls == "flower"]
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

                def to_sim_xy(c):
                    sx = sign_a * (c[idx_a] - origin_a) / MM_PER_IN
                    sy = sign_b * (c[idx_b] - origin_b) / MM_PER_IN
                    return sx, sy

                # hive score: each hive part's sim-x should land near +-12.75
                hive_res = 0.0
                for c in hive_c:
                    sx, _ = to_sim_xy(c)
                    hive_res += min((sx - BB_HIVE_X) ** 2, (sx + BB_HIVE_X) ** 2)
                hive_res /= len(hive_c)

                # flower score: each flower part should land near one of the 4 known centres
                flower_res = 0.0
                for c in flower_c:
                    sx, sy = to_sim_xy(c)
                    best_d = min((sx - f["x"]) ** 2 + (sy - f["y"]) ** 2 for f in BB_FLOWERS)
                    flower_res += best_d
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
    # the one part name that is trustworthy for this (unlike the cable-tie SKUs, which come in
    # red/blue as generic stock colours, not alliance signal — see the header note): the manual
    # says each HIVE's two cells are the SAME colour, so the red-named ribs must average out on
    # the NEGATIVE sim-x side (RED IS AT y > 0... x < 0, config.ts). If they do not, this is
    # the mirror-image candidate, and flipping BOTH signs together is exactly a 180° rotation.
    idx_a = 0 if best.horiz_a == "x" else 2
    idx_b = 0 if best.horiz_b == "x" else 2

    def sim_x_of(inst: "Instance") -> float:
        c = centroid_mm(inst.bbox_mm)
        return best.sign_a * (c[idx_a] - best.origin_a) / MM_PER_IN

    red_ribs = [i for i in instances if re.search(r"goal rib", i.name, re.IGNORECASE) and re.search(r"red", i.name, re.IGNORECASE)]
    blue_ribs = [i for i in instances if re.search(r"goal rib", i.name, re.IGNORECASE) and re.search(r"blue", i.name, re.IGNORECASE)]
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


def transform_point_mm(fit: AxisFit, p_mm: tuple[float, float, float]) -> tuple[float, float, float]:
    """raw CAD point in mm -> sim point in inches, per the fitted mapping."""
    idx_a = 0 if fit.horiz_a == "x" else 2
    idx_b = 0 if fit.horiz_b == "x" else 2
    sx = fit.sign_a * (p_mm[idx_a] - fit.origin_a) / MM_PER_IN
    sy = fit.sign_b * (p_mm[idx_b] - fit.origin_b) / MM_PER_IN
    sz = (p_mm[1] - fit.vert_origin) / MM_PER_IN
    return (sx, sy, sz)


# ─────────────────────────────────────────────────────────────────────────────────────────
# 4. TESSELLATION
# ─────────────────────────────────────────────────────────────────────────────────────────


def mesh_shape_mm(shape, lin_deflection_mm: float, ang_deflection: float):
    """Tessellate `shape` (already in world/root mm coordinates) and return a merged,
    vertex-deduplicated (positions_mm: list[3-tuple], indices: list[3-tuple]) in the shape's
    OWN coordinate frame (still millimetres, still the raw CAD axes — callers transform).

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
# 5. MAIN
# ─────────────────────────────────────────────────────────────────────────────────────────


def convex_hull_points(positions_in: list[tuple]) -> list[tuple]:
    import numpy as np
    from scipy.spatial import ConvexHull

    if len(positions_in) < 4:
        return positions_in
    pts = np.array(positions_in)
    try:
        hull = ConvexHull(pts)
    except Exception as e:  # degenerate (near-planar) part — fall back to the raw point set
        print(f"[convert]   convex hull failed ({e}); keeping raw point set", file=sys.stderr)
        return positions_in
    verts = pts[hull.vertices]
    return [tuple(v) for v in verts]


def convex_hull_mesh(positions_in: list[tuple]):
    """Convex hull as an actual (positions, indices) TRIMESH — for `statics`, which needs real
    triangle faces, not just a bare point set (that is what `trays[].hulls` wants instead)."""
    import numpy as np
    from scipy.spatial import ConvexHull

    if len(positions_in) < 4:
        idx = list(range(len(positions_in)))
        return positions_in, ([tuple(idx)] if len(idx) == 3 else [])
    pts = np.array(positions_in)
    try:
        hull = ConvexHull(pts)
    except Exception as e:
        print(f"[convert]   convex hull failed ({e}); keeping raw (undecimated) point/triangle set", file=sys.stderr)
        return positions_in, []
    remap: dict[int, int] = {}
    out_pos: list[tuple] = []
    out_idx: list[tuple] = []
    for simplex in hull.simplices:
        tri = []
        for v in simplex:
            v = int(v)
            gi = remap.get(v)
            if gi is None:
                gi = len(out_pos)
                out_pos.append(tuple(pts[v]))
                remap[v] = gi
            tri.append(gi)
        out_idx.append(tuple(tri))
    return out_pos, out_idx


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


# Cosmetic ring/layer plates: a convex hull of an annulus (or a torus) fills in the centre
# hole, which is exactly the opening a POLLEN must pass through and a NECTAR must seat on
# (§10.5.2) — a solid disk collider there would silently block every flower interaction. So
# these are VISUAL-ONLY; the flower's collider covers its solid support (pipes, backstop,
# brackets, foot) and nothing that is supposed to have a hole in it. The fallback torus/
# cylinder colliders already in `scene/renderField.ts` stay authoritative for the ring passage
# until a from-CAD annulus collider is worth the complexity — see the report's gotchas.
RE_FLOWER_RING = re.compile(r"flower layer", re.IGNORECASE)


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("step_path")
    ap.add_argument("--cache", required=True, help="scratch output dir (STL groups, full inventory)")
    ap.add_argument("--public", required=True, help="public/models/biobuzz (colliders + measurements json)")
    args = ap.parse_args()

    cache = Path(args.cache)
    public = Path(args.public)
    cache.mkdir(parents=True, exist_ok=True)
    public.mkdir(parents=True, exist_ok=True)

    instances, all_rows = walk_step(args.step_path)

    by_class: dict[str, int] = {}
    for i in instances:
        by_class[i.cls] = by_class.get(i.cls, 0) + 1
    print(f"[convert] kept instances by class: {by_class}", file=sys.stderr)

    fit = fit_axes(instances)

    # ---- hive pivots, computed early: the TRAY output below is authored PIVOT-RELATIVE -------
    # (local origin AT the pivot, matching `buildTray()`'s own existing convention in
    # `scene/renderField.ts` — "CylinderGeometry's axis is local Y... cellY = s * HIVE_ARM" is a
    # small LOCAL value, not a world-absolute one) so the runtime can park a node at the pivot's
    # world transform and drive the live tilt with nothing more than that node's own rotation,
    # exactly like `updateBiobuzzField`'s `handles.trays[a].rotation.set(angle, 0, 0)` expects.
    # The FRAME (static) is left in absolute world coordinates — it never rotates, so a pivot
    # offset would only be one more number an integrator has to remember to re-add.
    #
    # The pivot SHAFT's own bearing ("am-4457: 8 mm ID 22 mm OD Shielded Flanged Bearing
    # F608ZZ") is coaxial with the true pivot line, unlike a bracket that HOLDS the shaft (whose
    # centroid can sit an inch or more off the axis depending on the bracket's own shape) — this
    # is a materially better anchor than a bracket/damper proxy. Matched on the top-level colon
    # form only (`am-4457:`), not the part's own internal sub-feature names (`am-4457
    # ..._57155K629__Revolve6`, no colon) which are the SAME 8 physical bearings' internal
    # geometry, not 8 more instances.
    bearing_rows = [r for r in all_rows if r["bbox_mm"] and re.match(r"^am-4457:", r["name"])]

    def hive_pivot_estimate(sign: int, frame_insts_fallback: list[Instance]):
        pts = []
        for row in bearing_rows:
            c = centroid_mm(row["bbox_mm"])
            p = transform_point_mm(fit, c)
            if (p[0] < 0) == (sign < 0):
                pts.append(p)
        source = "bearing (am-4457)"
        if not pts:
            source = "pivot-bracket/damper proxy (no bearing match - less precise)"
            for inst in frame_insts_fallback:
                if re.search(r"pivot bracket|blumotion", inst.name, re.IGNORECASE):
                    pts.append(transform_point_mm(fit, centroid_mm(inst.bbox_mm)))
            if not pts:
                pts = [transform_point_mm(fit, centroid_mm(i.bbox_mm)) for i in frame_insts_fallback]
        z = sum(p[2] for p in pts) / len(pts)
        x = sum(p[0] for p in pts) / len(pts)
        print(
            f"[convert] hive pivot estimate ({'red' if sign < 0 else 'blue'}): x={x:.3f} z={z:.3f} "
            f"from {len(pts)} pts, source={source}",
            file=sys.stderr,
        )
        return [sign * BB_HIVE_X, 0.0, z]

    # ---- group assignment ---------------------------------------------------------------
    # walls + tiles + tape + stations + "other": merged one mesh per class (or per-wall for
    # tape, but the collider/visual need is coarse — one group is enough).
    groups: dict[str, list[Instance]] = {"walls": [], "tiles": [], "tape": [], "stations": [], "other": []}
    hive_red_frame: list[Instance] = []
    hive_blue_frame: list[Instance] = []
    tray_red: dict[str, list[Instance]] = {}
    tray_blue: dict[str, list[Instance]] = {}
    flower_groups: list[list[Instance]] = [[], [], [], []]

    def tray_bucket(name: str) -> str | None:
        if RE_TRAY_BAR.search(name):
            return "bar"
        if RE_TRAY_FLOOR.search(name):
            return "floor"
        if RE_TRAY_BACK.search(name):
            return "back"
        if RE_TRAY_CEILING.search(name):
            return "ceiling"
        if RE_TRAY_SIDE.search(name):
            return "side"
        return None

    unclassified_hive = []
    for inst in instances:
        c = centroid_mm(inst.bbox_mm)
        sx, sy, sz = transform_point_mm(fit, c)
        if inst.cls == "wall":
            groups["walls"].append(inst)
        elif inst.cls == "tile":
            groups["tiles"].append(inst)
        elif inst.cls == "tape":
            groups["tape"].append(inst)
        elif inst.cls == "station":
            groups["stations"].append(inst)
        elif inst.cls == "flower":
            best_i, best_d = 0, 1e18
            for k, f in enumerate(BB_FLOWERS):
                d = (sx - f["x"]) ** 2 + (sy - f["y"]) ** 2
                if d < best_d:
                    best_d, best_i = d, k
            flower_groups[best_i].append(inst)
        elif inst.cls == "hive":
            red = sx < 0
            bucket = tray_bucket(inst.name)
            if bucket is None:
                # frame part (A-Frame Leg, Goal Pivot Bracket, Pivot Damper Holder, Blumotion
                # damper, Under Tile Assembly, Churro Lite) — static, not on the tray
                (hive_red_frame if red else hive_blue_frame).append(inst)
            else:
                target = tray_red if red else tray_blue
                if bucket == "side":
                    # two ribs per cell, split by local +/-x around the hive's own pivot
                    side_sign = "pos" if (sx - (-BB_HIVE_X if red else BB_HIVE_X)) >= 0 else "neg"
                    key_prefix = f"cell_{'north' if sy >= 0 else 'south'}_side_{side_sign}"
                else:
                    key_prefix = f"cell_{'north' if sy >= 0 else 'south'}_{bucket}" if bucket != "bar" else "bar"
                target.setdefault(key_prefix, []).append(inst)
        else:
            groups["other"].append(inst)
            if inst.cls == "hive":
                unclassified_hive.append(inst.name)

    pivot_red_in = hive_pivot_estimate(-1, hive_red_frame)
    pivot_blue_in = hive_pivot_estimate(1, hive_blue_frame)

    # ---- tessellate + write STL groups (visual meshes) -----------------------------------
    # Deflections are ABSOLUTE (not relative to each part's own size), in mm. The real tile and
    # hive parts carry manufacturing detail (waffle ribbing, small fillets, fastener bosses)
    # that is invisible at game scale but multiplies triangle count hugely at a fine deflection
    # — the first pass at 0.4/3.0mm produced a 13.5 MB tessellation for the 36 tile plates
    # alone. This is a DRIVER-VIEW / OVERHEAD sim camera, never a close-up inspection view, so
    # 3/12mm keeps the SHAPE (a driver can tell a tile seam from a hive rib) without chasing
    # sub-millimetre rib geometry nobody will ever see at this camera distance.
    LIN_HIGH_MM, ANG_HIGH = 3.0, 0.6
    # LOW is the distant/cheap LOD — gltf-transform's simplify+meshopt pass on the HIGH data
    # plateaus once every small disjoint part (a bracket, a rib) hits its own few-triangle
    # floor, which the simplifier cannot cross regardless of ratio/error, so LOW needs a
    # genuinely coarser SOURCE tessellation rather than leaning on more aggressive simplify
    # flags against the same starting mesh.
    LIN_LOW_MM, ANG_LOW = 20.0, 1.1

    def mesh_group_sim(insts: list[Instance], lin_mm: float, ang: float, origin: tuple = (0.0, 0.0, 0.0)):
        """tessellate every instance, transform each vertex into sim inches (optionally
        re-centred on `origin` — the tray groups use their hive's pivot, see above), return
        merged (positions_in, indices)"""
        parts = []
        for inst in insts:
            pos_mm, idx = mesh_shape_mm(inst.shape, lin_mm, ang)
            pos_in = [
                (p[0] - origin[0], p[1] - origin[1], p[2] - origin[2])
                for p in (transform_point_mm(fit, p) for p in pos_mm)
            ]
            parts.append((pos_in, idx))
        return merge_meshes(parts) if parts else ([], [])

    # ---- PART-CLASS SPLIT (2026-09-18 fidelity pass, owner playtest: "the flower has lost its
    # colour"). Each output NODE used to be one merged STL with one flat placeholder material
    # (`assemble-gltf.mjs`'s old per-GROUP `MAT.*`), which is exactly why a flower — four rings,
    # four HIPS pipes and a base/backstop, all genuinely different materials on the real part —
    # rendered as one uniform grey lump: merging erases the one thing a material split needs,
    # which part a triangle came from. `visual_groups` is now `node -> {class -> [Instance]}`, so
    # the STL-writing loop below emits ONE FILE PER (node, class) PAIR
    # (`"<node>__<class>.stl"`), and `assemble-gltf.mjs` turns each node's class files into
    # several PRIMITIVES of one mesh, each carrying its own NAMED glTF material —
    # `renderFieldGlb.ts` assigns the runtime PBR material BY THAT NAME, not by walking parent
    # node names. The class vocabulary matches the report's contract exactly: `flower_ring`,
    # `flower_pipe`, `flower_base`, `hive_frame_metal`, `tray_panel_red`, `tray_panel_blue`,
    # `tray_metal`, `wall_panel`, `wall_extrusion`, `tile`, `tape_red`, `tape_blue`, `tape_white`.
    def wall_part_class(name: str) -> str:
        # "am-2580a: FIRST Tech Challenge Panel Link" is the aluminium extrusion joining panels;
        # everything else in this class is the glass/polycarbonate panel itself.
        if re.search(r"panel link", name, re.IGNORECASE):
            return "wall_extrusion"
        return "wall_panel"

    def flower_part_class(name: str) -> str:
        # "am-5857/58/59: Flower Layer C/B/X" are the three ring plates (top/mid/lower);
        # "am-5862: Flower HIPS Pipe" is the vertical support; everything else (Field Bracket,
        # Under Field Bracket, Backstop) is the solid base/backstop hardware.
        if RE_FLOWER_RING.search(name):
            return "flower_ring"
        if re.search(r"hips pipe", name, re.IGNORECASE):
            return "flower_pipe"
        return "flower_base"

    def tape_part_class(name: str) -> str:
        if re.search(r"blue", name, re.IGNORECASE):
            return "tape_blue"
        if re.search(r"red", name, re.IGNORECASE):
            return "tape_red"
        return "tape_white"

    def tray_material_class(key_prefix: str, alliance: str) -> str:
        # the skins (floor/back/ceiling) are the alliance-coloured sheet paneling a cell is
        # built from; the bar and the side ribs are the bare structural metal underneath it.
        if any(k in key_prefix for k in ("floor", "back", "ceiling")):
            return f"tray_panel_{alliance}"
        return "tray_metal"

    visual_groups: dict[str, dict[str, list[Instance]]] = {}

    def add_visual(node: str, cls: str, insts: list[Instance]) -> None:
        if not insts:
            return
        visual_groups.setdefault(node, {}).setdefault(cls, []).extend(insts)

    for inst in groups["walls"]:
        add_visual("walls", wall_part_class(inst.name), [inst])
    for inst in groups["tiles"]:
        add_visual("tiles", "tile", [inst])
    for inst in groups["tape"]:
        add_visual("tape", tape_part_class(inst.name), [inst])
    add_visual("hive_red_frame", "hive_frame_metal", hive_red_frame)
    add_visual("hive_blue_frame", "hive_frame_metal", hive_blue_frame)
    for key_prefix, insts in tray_red.items():
        add_visual("hive_red_tray", tray_material_class(key_prefix, "red"), insts)
    for key_prefix, insts in tray_blue.items():
        add_visual("hive_blue_tray", tray_material_class(key_prefix, "blue"), insts)
    for k in range(4):
        for inst in flower_groups[k]:
            add_visual(f"flower_{k}", flower_part_class(inst.name), [inst])
    if groups["stations"]:
        # no driver-station geometry in this STEP revision (README) — panel-like fallback class
        # so a future revision that DOES carry one renders with a sensible material immediately.
        for inst in groups["stations"]:
            add_visual("stations", "wall_panel", [inst])

    def box_mesh_in(xr, yr, zr):
        """axis-aligned box, positions in inches, as a simple 8-vert/12-tri mesh."""
        xs, ys, zs = xr, yr, zr
        pos = [(x, y, z) for x in xs for y in ys for z in zs]
        # 8 corners indexed 0..7 as (x,y,z) bit pattern (x-bit=4, y-bit=2, z-bit=1)
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

    size_report = []
    for node, by_class in visual_groups.items():
        tray_origin = (
            tuple(pivot_red_in) if node == "hive_red_tray" else tuple(pivot_blue_in) if node == "hive_blue_tray" else (0.0, 0.0, 0.0)
        )
        for cls, insts in by_class.items():
            file_stem = f"{node}__{cls}"
            if node == "tiles":
                # A DELIBERATE SIMPLIFICATION, both LOD levels: the real tile geometry is a
                # ribbed, perforated foam plate whose detail reads only as noise at this sim's
                # camera distance (overhead or driver-eye, never a close-up), and it dominated
                # every early size pass (10+ MB for 36 plates) for zero visible benefit. The
                # floor's actual on-screen texture (tile grid lines, tape) is a canvas texture
                # already (`renderField.ts`'s `buildFloorTexture`) painted over a flat plane —
                # this box is that plane's CAD-accurate replacement (real thickness, real
                # footprint), not a tessellation of the true underside.
                corners = []
                for inst in insts:
                    xmin, ymin, zmin, xmax, ymax, zmax = inst.bbox_mm
                    corners.extend(
                        transform_point_mm(fit, (x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)
                    )
                xr = (min(p[0] for p in corners), max(p[0] for p in corners))
                yr = (min(p[1] for p in corners), max(p[1] for p in corners))
                zr = (min(p[2] for p in corners), max(p[2] for p in corners))
                pos, idx = box_mesh_in(xr, yr, zr)
                for level in ("high", "low"):
                    out = cache / "stl" / level / f"{file_stem}.stl"
                    write_binary_stl(out, pos, idx)
                    size_report.append((file_stem, level, len(insts), len(pos), len(idx), out.stat().st_size))
                continue
            for level, lin_mm, ang in (("high", LIN_HIGH_MM, ANG_HIGH), ("low", LIN_LOW_MM, ANG_LOW)):
                pos, idx = mesh_group_sim(insts, lin_mm, ang, tray_origin)
                out = cache / "stl" / level / f"{file_stem}.stl"
                write_binary_stl(out, pos, idx)
                size_report.append((file_stem, level, len(insts), len(pos), len(idx), out.stat().st_size))
    print("[convert] STL groups (node__class, level, parts, verts, tris, bytes):", file=sys.stderr)
    for row in size_report:
        print("   ", row, file=sys.stderr)

    # ---- collider meshes (statics) --------------------------------------------------------
    # NOT one merged trimesh per group (§8's 200 KB raw budget, and — more importantly — a
    # merged hull across a whole hive FRAME or the whole WALL perimeter would fill in space a
    # robot is explicitly allowed to occupy: G409 assumes driving UNDER the hive crossbar, and
    # the walls form a hollow square, not a filled one). Every static is instead a small convex
    # hull PER PART-TYPE BUCKET (per wall side, per frame-part kind, per flower's solid support
    # parts) so real gaps between separate physical pieces stay real gaps. TILES are the one
    # deliberate exception — a flat floor's hull IS its bounding box, merging all 36 loses
    # nothing physical, and a per-tile split would be 36 collider entries for one flat plane.
    #
    # Built from each instance's own BOUNDING BOX CORNERS (8 pts), not a re-tessellation of the
    # true surface. A physics collider never needs a bracket's fillets or a damper's cylindrical
    # skin — only the envelope something can actually touch — and every part this pipeline
    # classifies as hive-frame/flower-solid/tray hardware is prismatic enough that its bbox IS
    # a faithful (if slightly generous) stand-in. This also sidesteps a real trap: a true convex
    # hull of a tessellated ROUND part (the Blumotion damper's cylindrical housing) keeps a hull
    # vertex per facet around the curve, which is small in triangle terms but was still the
    # single biggest contributor to the first collider pass's size.
    def bbox_corners_sim(inst: "Instance") -> list[tuple]:
        xmin, ymin, zmin, xmax, ymax, zmax = inst.bbox_mm
        return [transform_point_mm(fit, (x, y, z)) for x in (xmin, xmax) for y in (ymin, ymax) for z in (zmin, zmax)]

    def hull_bucket_static(name: str, insts: list[Instance]) -> dict | None:
        pos: list[tuple] = []
        for inst in insts:
            pos.extend(bbox_corners_sim(inst))
        if not pos:
            return None
        hp, hi = convex_hull_mesh(pos)
        if not hi:
            return None
        return {
            "name": name,
            "kind": "trimesh",
            "vertices": [round(c, 4) for p in hp for c in p],
            "indices": [c for t in hi for c in t],
        }

    statics_json = []

    tile_static = hull_bucket_static("tiles", groups["tiles"])
    if tile_static:
        statics_json.append(tile_static)

    wall_buckets: dict[str, list[Instance]] = {s: [] for s in WALL_SIDES}
    for inst in groups["walls"]:
        sx, sy, _sz = transform_point_mm(fit, centroid_mm(inst.bbox_mm))
        wall_buckets[wall_side_of(sx, sy)].append(inst)
    for side, insts in wall_buckets.items():
        st = hull_bucket_static(f"wall_{side}", insts)
        if st:
            statics_json.append(st)

    def frame_type_key(name: str) -> str:
        for pat, key in (
            (r"a-frame leg", "a_frame_leg"),
            (r"goal pivot bracket", "pivot_bracket"),
            (r"pivot damper holder", "damper_holder"),
            (r"blumotion", "damper"),
            (r"under tile assembly", "under_tile"),
            (r"churro", "upright"),
        ):
            if re.search(pat, name, re.IGNORECASE):
                return key
        return "misc"

    for alliance, frame_insts in (("red", hive_red_frame), ("blue", hive_blue_frame)):
        buckets: dict[str, list[Instance]] = {}
        for inst in frame_insts:
            buckets.setdefault(frame_type_key(inst.name), []).append(inst)
        for key, insts in buckets.items():
            st = hull_bucket_static(f"hive_{alliance}_frame_{key}", insts)
            if st:
                statics_json.append(st)

    def flower_type_key(name: str) -> str:
        for pat, key in (
            (r"hips pipe", "pipe"),
            (r"peanut support", "support"),
            (r"backstop", "backstop"),
            (r"under field bracket", "under_bracket"),
            (r"field bracket", "bracket"),
            (r"flower assembly", "base"),
        ):
            if re.search(pat, name, re.IGNORECASE):
                return key
        return "misc"

    for k, insts in enumerate(flower_groups):
        solid = [i for i in insts if not RE_FLOWER_RING.search(i.name)]
        buckets: dict[str, list[Instance]] = {}
        for inst in solid:
            buckets.setdefault(flower_type_key(inst.name), []).append(inst)
        for key, bi in buckets.items():
            st = hull_bucket_static(f"flower_{k}_{key}", bi)
            if st:
                statics_json.append(st)

    # ---- tray convex hulls -----------------------------------------------------------------
    # Same bbox-corner rationale as the statics above — each tray part (bar, a cell's floor/
    # back/ceiling/side) is prismatic, and Rapier rebuilds its own hull faces from `points` at
    # runtime (the schema asks for points only, no indices, for exactly that reason). PIVOT-
    # RELATIVE: `origin` is subtracted so these points sit in the tray's own local frame — see
    # the header note by `pivot_red_in`/`pivot_blue_in` above.
    def tray_hulls(buckets: dict[str, list[Instance]], origin: list[float]):
        hulls = []
        for key, insts in buckets.items():
            pos: list[tuple] = []
            for inst in insts:
                pos.extend(bbox_corners_sim(inst))
            pos = [(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]) for p in pos]
            hull_pts = convex_hull_points(pos)
            hulls.append({"name": key, "points": [round(c, 4) for p in hull_pts for c in p]})
        return hulls

    trays_json = {
        "red": {"pivot": pivot_red_in, "axis": [1, 0, 0], "hulls": tray_hulls(tray_red, pivot_red_in)},
        "blue": {"pivot": pivot_blue_in, "axis": [1, 0, 0], "hulls": tray_hulls(tray_blue, pivot_blue_in)},
    }

    flowers_json = []
    for k, f in enumerate(BB_FLOWERS):
        static_prefix = f"flower_{k}_"
        matching = [s["name"] for s in statics_json if s["name"].startswith(static_prefix)]
        flowers_json.append(
            {
                "id": f["id"],
                "wall": f["wall"],
                "pos": [f["x"], f["y"]],
                # the SOLID support statics for this flower (backstop/pipes/brackets/base) — the
                # ring plates are visual-only, see RE_FLOWER_RING's header.
                "staticNames": matching,
                "visualNode": f"flower_{k}",
            }
        )

    colliders = {
        "units": "in",
        "frame": "sim",
        "source": {
            "note": "generated by scripts/field-cad/convert.py from the official FIRST field STEP",
        },
        "statics": statics_json,
        "trays": trays_json,
        "flowers": flowers_json,
    }
    (public / "field-colliders.json").write_text(json.dumps(colliders))
    print(f"[convert] wrote {public / 'field-colliders.json'} ({(public / 'field-colliders.json').stat().st_size} bytes)", file=sys.stderr)

    # ---- measurements -----------------------------------------------------------------------
    def part_extent_in(insts: list[Instance]):
        pts = [transform_point_mm(fit, centroid_mm(i.bbox_mm)) for i in insts]
        if not pts:
            return None
        return {
            "x": [min(p[0] for p in pts), max(p[0] for p in pts)],
            "y": [min(p[1] for p in pts), max(p[1] for p in pts)],
            "z": [min(p[2] for p in pts), max(p[2] for p in pts)],
        }

    def cell_open_z(buckets: dict[str, list[Instance]]):
        floor = buckets.get("cell_north_floor") or buckets.get("cell_south_floor") or []
        ceiling_key = "cell_north_ceiling" if "cell_north_floor" in buckets else "cell_south_ceiling"
        ceiling = buckets.get(ceiling_key) or []
        zf = part_extent_in(floor)
        zc = part_extent_in(ceiling)
        if not zf or not zc:
            return None
        return [zf["z"][1], zc["z"][0]]

    hive_pivot_red = trays_json["red"]["pivot"]
    hive_pivot_blue = trays_json["blue"]["pivot"]
    measurements = {
        "source": "scripts/field-cad/convert.py, official FIRST field STEP",
        "units": "in",
        "frame": "sim",
        "hive": {
            "pivot_x": {"red": hive_pivot_red[0], "blue": hive_pivot_blue[0], "config_BB_HIVE_X": BB_HIVE_X},
            "pivot_z": {
                "red": hive_pivot_red[2],
                "blue": hive_pivot_blue[2],
                "config_BB3_HIVE_PIVOT_Z": BB_HIVE_PIVOT_Z,
            },
            "cell_open_z_red": cell_open_z(tray_red),
            "cell_open_z_blue": cell_open_z(tray_blue),
            "frame_extent_red_in": part_extent_in(hive_red_frame),
            "frame_extent_blue_in": part_extent_in(hive_blue_frame),
        },
        "flowers": [
            {
                "id": f["id"],
                "config_pos": [f["x"], f["y"]],
                # the 4 HIPS pipes ring the true bore axis symmetrically, so their centroid
                # average is a much tighter fix on ring CENTRE than the whole assembly's bbox
                # midpoint (which the backstop and the wall-side extrusion skew off-axis).
                "measured_ring_center": (
                    lambda pts: [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)] if pts else None
                )(
                    [
                        transform_point_mm(fit, centroid_mm(i.bbox_mm))
                        for i in flower_groups[k]
                        if re.search(r"hips pipe", i.name, re.IGNORECASE)
                    ]
                ),
                "measured_extent": part_extent_in(flower_groups[k]),
                "measured_top_ring_z": (
                    lambda zs: max(zs) if zs else None
                )(
                    [
                        transform_point_mm(fit, centroid_mm(i.bbox_mm))[2]
                        for i in flower_groups[k]
                        if re.search(r"flower layer", i.name, re.IGNORECASE)
                    ]
                ),
                "config_BB_FLOWER_TOP_Z": 21.5,
            }
            for k, f in enumerate(BB_FLOWERS)
        ],
        "tiles_extent_in": part_extent_in(groups["tiles"]),
        "walls_extent_in": part_extent_in(groups["walls"]),
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

    # ---- full inventory (report + audit trail) ----------------------------------------------
    inv_by_class: dict[str, list[dict]] = {}
    for row in all_rows:
        inv_by_class.setdefault(row["class"], []).append(row)
    counts = {k: len(v) for k, v in inv_by_class.items()}
    inventory = {
        "totalLabelsWalked": len(all_rows),
        "countsByClass": counts,
        "keptInstances": len(instances),
        "unclassifiedHiveNames": sorted(set(unclassified_hive)),
        "rows": all_rows,
    }
    (cache / "field-inventory.json").write_text(json.dumps(inventory, default=list))
    print(f"[convert] wrote {cache / 'field-inventory.json'} - counts by class: {counts}", file=sys.stderr)
    print("[convert] DONE", file=sys.stderr)


if __name__ == "__main__":
    main()
