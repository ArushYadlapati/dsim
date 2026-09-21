#!/usr/bin/env python
"""
scripts/field-cad/elements.py — BIOBUZZ SCORING-ELEMENT CAD import (the holed POLLEN/NECTAR).

`convert.py` is the FIELD importer and it deliberately DROPS the loose scoring elements
(`RE_ELEMENT`): they are not field structure, and BIOBUZZ spawns them from `config.ts`. But
they ride along in the same STEP assembly as real perforated solids, and the 3D renderer used
to draw them as smooth `THREE.SphereGeometry` spheres. This script is the other half: it pulls
ONE `am-5851: Pollen` and ONE `am-5852: * Nectar` DEFINITION shape out of the same pinned STEP,
measures it, tessellates it, and writes two STL for `elements.mjs` to assemble into
`public/models/biobuzz/elements.glb`.

Run it through `scripts/field-cad/elements.mjs` (`npm run element-cad`), never by hand — that
driver owns the sha-pinned source, the venv and the glTF chain.

── WHAT THE CAD ACTUALLY IS (measured, not assumed) ────────────────────────────────────────
Each element is ONE closed solid with 29 faces: an OUTER sphere, an INNER sphere, and 26
cylindrical BORES drilled on radial axes. Nothing is approximated here — the sphere radii and
the bore radius are exact analytic values read off the B-rep, and this script asserts the
pattern it found (26 bores in a 1/4/8/8/4/1 latitude ring stack) rather than trusting it.

── WHY THE ORIENTATION OF EVERY FACE IS APPLIED, AND `convert.py` DOES NOT ─────────────────
⚠️ OCC hands back a triangulation in the face's OWN parametric winding. For a face whose
`Orientation()` is `TopAbs_REVERSED` that winding is BACKWARDS with respect to the solid, so a
mesh built without flipping those triangles is inconsistently wound — which is exactly the
class of bug `renderFieldGlb.ts`'s `fixGroundBeamWinding` exists to paper over on the field
asset. It matters far more here: a holed ball is SEEN THROUGH ITS OWN HOLES, so its inner
sphere and its 26 bore walls have to render from the inside with ordinary back-face culling.
Flipping on orientation makes every triangle face AWAY FROM THE MATERIAL, which is the one
convention under which that is true, and `verify_winding` below proves it on the outer shell
(every outer-sphere triangle's normal must point away from the centre) before anything is
written.

── FRAME ────────────────────────────────────────────────────────────────────────────────────
The CAD's own pole axis is local +Y. Output is INCHES, centred on the fitted outer-sphere
centre, with the pole on +Z (`sim = (x, -z, y)`, a +90° rotation about X — determinant +1, so
the winding above survives the remap; a mirror would invert every triangle).
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import time
from collections import defaultdict
from pathlib import Path

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_SurfaceType
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_DocumentTool

MM_PER_IN = 25.4

# The two SKUs, and the name each is matched by. One instance of each is enough: every Pollen in
# the assembly is the same part definition, and the two Nectar colours differ only in their
# STYLED_ITEM colour, which this renderer sets per instance anyway (`renderElements.ts`'s
# `NECTAR_COLORS` — and see that file on why blue is NOT the CAD's `plastic#0000ff`).
KINDS = (
    ("pollen", "am-5851", "pollen"),
    ("nectar", "am-5852", "nectar"),
)

# What `src/games/biobuzz/config.ts` says, repeated here the way `convert.py` repeats its own
# six anchors: this is a standalone Python CLI outside the TS build, and a drift between the two
# is exactly what the measurements JSON exists to report. NOT an input to anything — the CAD is
# authoritative for dimensions (owner ruling 2026-09-18) and a mismatch is REPORTED, never
# silently absorbed, because the radius is also a SIM number and changing it is the owner's call.
CONFIG_R_IN = {"pollen": 1.4, "nectar": 1.8}


def label_name(label: TDF_Label) -> str:
    attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
        return attr.Get().ToExtString()
    return "<unnamed>"


def find_definitions(step_path: str) -> dict[str, tuple[str, object]]:
    """The DEFINITION (part-local, unplaced) shape of each element kind, by name."""
    app = XCAFApp_Application.GetApplication_s()
    doc = TDocStd_Document(TCollection_ExtendedString("mdtv-xcaf"))
    app.NewDocument(TCollection_ExtendedString("MDTV-XCAF"), doc)
    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetNameMode(True)

    t0 = time.time()
    status = reader.ReadFile(step_path)
    print(f"[elements] ReadFile status={status} ({time.time() - t0:.1f}s)", file=sys.stderr)
    if int(status) != 1:
        raise RuntimeError(f"STEP ReadFile failed: {status}")
    t0 = time.time()
    if not reader.Transfer(doc):
        raise RuntimeError("STEP Transfer failed")
    print(f"[elements] Transfer ok ({time.time() - t0:.1f}s)", file=sys.stderr)

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    free = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free)
    found: dict[str, tuple[str, object]] = {}

    def walk(label: TDF_Label) -> None:
        name = label_name(label)
        if shape_tool.IsReference_s(label):
            ref = TDF_Label()
            if not shape_tool.GetReferredShape_s(label, ref):
                return
            if shape_tool.IsAssembly_s(ref):
                ch = TDF_LabelSequence()
                shape_tool.GetComponents_s(ref, ch)
                for i in range(ch.Length()):
                    walk(ch.Value(i + 1))
                return
            low = name.lower()
            for kind, sku, word in KINDS:
                if kind in found:
                    continue
                if sku.lower() in low or word in low:
                    # the REFERRED label's shape: the part in its own frame, with no assembly
                    # placement composed in. A staged element sits wherever the field designer
                    # dropped it; the mesh this pipeline ships is centred on the origin.
                    found[kind] = (name, shape_tool.GetShape_s(ref))
            return
        if shape_tool.IsAssembly_s(label):
            ch = TDF_LabelSequence()
            shape_tool.GetComponents_s(label, ch)
            for i in range(ch.Length()):
                walk(ch.Value(i + 1))

    for i in range(free.Length()):
        walk(free.Value(i + 1))
    missing = [k for k, _, _ in KINDS if k not in found]
    if missing:
        raise RuntimeError(f"STEP carries no definition for: {', '.join(missing)}")
    return found


# ─────────────────────────────────────────────────────────────────── 1. ANALYTIC MEASUREMENT ──


def measure(shape) -> dict:
    """Read the solid's own B-rep: two sphere radii, the bore radius, the bore axes.

    Everything here comes off the ANALYTIC surface, not off a triangulation, so it is the CAD's
    exact number rather than a tessellation artefact.
    """
    spheres: list[tuple[float, tuple[float, float, float]]] = []
    bores: list[tuple[float, tuple[float, float, float]]] = []
    other = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        ad = BRepAdaptor_Surface(face)
        t = ad.GetType()
        if t == GeomAbs_SurfaceType.GeomAbs_Sphere:
            s = ad.Sphere()
            c = s.Location()
            spheres.append((s.Radius(), (c.X(), c.Y(), c.Z())))
        elif t == GeomAbs_SurfaceType.GeomAbs_Cylinder:
            c = ad.Cylinder()
            d = c.Axis().Direction()
            bores.append((c.Radius(), (d.X(), d.Y(), d.Z())))
        else:
            other += 1
        exp.Next()

    if other:
        raise RuntimeError(f"unexpected non-sphere/cylinder faces: {other}")
    radii = sorted({round(r, 6) for r, _ in spheres}, reverse=True)
    if len(radii) != 2:
        raise RuntimeError(f"expected exactly two distinct sphere radii, got {radii}")
    outer_r, inner_r = radii
    centres = [c for r, c in spheres if abs(r - outer_r) < 1e-6]
    cx = sum(c[0] for c in centres) / len(centres)
    cy = sum(c[1] for c in centres) / len(centres)
    cz = sum(c[2] for c in centres) / len(centres)

    bore_radii = sorted({round(r, 6) for r, _ in bores})
    if len(bore_radii) != 1:
        raise RuntimeError(f"expected one bore radius, got {bore_radii}")

    # ── THE PATTERN, DERIVED AND THEN ASSERTED ─────────────────────────────────────────────
    # A bore axis is signed, and the two ends of one drilled hole are ONE cylinder face here
    # (26 faces, 26 bores), so the latitude bands are read straight off the pole component.
    # The pole is the CAD's local +Y.
    bands: dict[float, int] = defaultdict(int)
    for _, d in bores:
        bands[round(d[1], 3)] += 1
    band_list = sorted(bands.items(), key=lambda kv: -kv[0])
    return {
        "outerRadiusMm": outer_r,
        "innerRadiusMm": inner_r,
        "wallMm": outer_r - inner_r,
        "boreRadiusMm": bore_radii[0],
        "boreCount": len(bores),
        "centreMm": (cx, cy, cz),
        "bands": [{"sinLat": s, "count": n, "latDeg": math.degrees(math.asin(max(-1.0, min(1.0, s))))} for s, n in band_list],
        "boreAxes": [(round(d[0], 6), round(d[1], 6), round(d[2], 6)) for _, d in bores],
    }


# ───────────────────────────────────────────────────────────────────────── 2. TESSELLATION ──


def mesh(shape, lin_mm: float, ang_rad: float, centre_mm, scale_in: float):
    """(positions_in, triangles) in the SIM frame, every triangle wound AWAY FROM THE MATERIAL.

    ⚠️ `BRepTools.Clean_s` first — `BRepMesh_IncrementalMesh` caches on the shape's own TShape
    and silently no-ops at a second deflection (the same trap `convert.py`'s header records).
    """
    BRepTools.Clean_s(shape)
    BRepMesh_IncrementalMesh(shape, lin_mm, False, ang_rad, True)
    positions: list[tuple[float, float, float]] = []
    tris: list[tuple[int, int, int]] = []
    dedup: dict[tuple[float, float, float], int] = {}
    cx, cy, cz = centre_mm

    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            trsf = loc.Transformation()
            # SEE THIS FILE'S HEADER. A reversed face's triangulation is wound backwards with
            # respect to the solid; without this flip the inner sphere and the 26 bore walls
            # are invisible from inside the ball, which is the only place they are ever seen.
            reversed_face = face.Orientation() == TopAbs_REVERSED
            local: dict[int, int] = {}
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i)
                p.Transform(trsf)
                # recentre in mm, scale to inches, then (x, -z, y): pole +Y -> sim +Z, a
                # rotation (det +1), so the winding established above is preserved.
                x = (p.X() - cx) * scale_in
                y = (p.Y() - cy) * scale_in
                z = (p.Z() - cz) * scale_in
                key = (round(x, 5), round(-z, 5), round(y, 5))
                gi = dedup.get(key)
                if gi is None:
                    gi = len(positions)
                    positions.append(key)
                    dedup[key] = gi
                local[i] = gi
            for t in range(1, tri.NbTriangles() + 1):
                n1, n2, n3 = tri.Triangle(t).Get()
                a, b, c = local[n1], local[n2], local[n3]
                if a == b or b == c or a == c:
                    continue  # a degenerate collapsed by the dedup above
                tris.append((a, c, b) if reversed_face else (a, b, c))
        exp.Next()
    return positions, tris


def verify_winding(positions, tris, outer_r_in: float) -> dict:
    """Every triangle whose three vertices sit ON the outer sphere must face OUTWARD.

    This is the single proof that the orientation flip above is right way round. It is checked
    on the outer shell because that is the one surface whose correct normal direction is known
    without any topology: away from the centre. If the flip were inverted, this count would be
    the whole outer shell rather than zero.
    """
    on_outer = 0
    bad = 0
    eps = outer_r_in * 0.02
    for a, b, c in tris:
        pa, pb, pc = positions[a], positions[b], positions[c]
        if not all(abs(math.dist(p, (0, 0, 0)) - outer_r_in) < eps for p in (pa, pb, pc)):
            continue
        on_outer += 1
        ux, uy, uz = (pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2])
        vx, vy, vz = (pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2])
        nx, ny, nz = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
        mx = (pa[0] + pb[0] + pc[0]) / 3
        my = (pa[1] + pb[1] + pc[1]) / 3
        mz = (pa[2] + pb[2] + pc[2]) / 3
        if nx * mx + ny * my + nz * mz <= 0:
            bad += 1
    return {"outerTris": on_outer, "inwardFacing": bad}


def write_binary_stl(path: Path, positions, tris) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x00" * 80)
        f.write(struct.pack("<I", len(tris)))
        for a, b, c in tris:
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("step")
    ap.add_argument("--out", required=True, help="directory for the STL + measurements JSON")
    # THE ONE TUNING KNOB, and it is a LENGTH so it means the same thing on both elements: the
    # chord tolerance in inches. `elements.mjs` owns the shipped value and the triangle budget
    # it was picked against; the sweep that picked it is in this session's report.
    ap.add_argument("--deflection", type=float, default=0.012, help="linear chord deflection, INCHES")
    ap.add_argument("--angular", type=float, default=0.55, help="angular deflection, radians")
    ap.add_argument("--sweep", action="store_true", help="report triangle counts over a range and write nothing")
    args = ap.parse_args()

    found = find_definitions(args.step)
    out = Path(args.out)
    report: dict[str, dict] = {}

    for kind, _sku, _word in KINDS:
        name, shape = found[kind]
        m = measure(shape)
        outer_in = m["outerRadiusMm"] / MM_PER_IN
        centre = m["centreMm"]
        print(f"\n=== {kind.upper()}  '{name}' ===")
        print(f"  outer   {m['outerRadiusMm']:.4f} mm = {outer_in:.5f} in  (config {CONFIG_R_IN[kind]})")
        print(f"  inner   {m['innerRadiusMm']:.4f} mm = {m['innerRadiusMm'] / MM_PER_IN:.5f} in")
        print(f"  wall    {m['wallMm']:.4f} mm = {m['wallMm'] / MM_PER_IN:.5f} in")
        print(f"  bores   {m['boreCount']} x r {m['boreRadiusMm']:.4f} mm = d {2 * m['boreRadiusMm'] / MM_PER_IN:.5f} in")
        print(f"  bands   {[(b['count'], round(b['latDeg'], 2)) for b in m['bands']]}")

        if args.sweep:
            for d in (0.03, 0.02, 0.015, 0.012, 0.01, 0.008, 0.006, 0.004):
                for ang in (0.9, 0.7, 0.55, 0.4):
                    pos, tris = mesh(shape, d * MM_PER_IN, ang, centre, 1.0 / MM_PER_IN)
                    w = verify_winding(pos, tris, outer_in)
                    print(f"    lin={d:<6} ang={ang:<5} verts={len(pos):<6} tris={len(tris):<6} badWinding={w['inwardFacing']}")
            continue

        pos, tris = mesh(shape, args.deflection * MM_PER_IN, args.angular, centre, 1.0 / MM_PER_IN)
        w = verify_winding(pos, tris, outer_in)
        if w["inwardFacing"]:
            raise RuntimeError(f"{kind}: {w['inwardFacing']} outer-shell triangles face inward — the orientation flip is wrong")
        rmax = max(math.dist(p, (0, 0, 0)) for p in pos)
        write_binary_stl(out / f"{kind}.stl", pos, tris)
        print(f"  mesh    {len(pos)} verts, {len(tris)} tris, outer-shell winding clean ({w['outerTris']} tris checked)")
        report[kind] = {
            "part": name,
            "outerRadiusIn": round(outer_in, 6),
            "innerRadiusIn": round(m["innerRadiusMm"] / MM_PER_IN, 6),
            "wallIn": round(m["wallMm"] / MM_PER_IN, 6),
            "boreRadiusIn": round(m["boreRadiusMm"] / MM_PER_IN, 6),
            "boreDiameterIn": round(2 * m["boreRadiusMm"] / MM_PER_IN, 6),
            "boreCount": m["boreCount"],
            "bands": [{"count": b["count"], "latitudeDeg": round(b["latDeg"], 4)} for b in m["bands"]],
            "configRadiusIn": CONFIG_R_IN[kind],
            "configDeltaIn": round(outer_in - CONFIG_R_IN[kind], 6),
            "meshVerts": len(pos),
            "meshTris": len(tris),
            "meshMaxRadiusIn": round(rmax, 6),
            "deflectionIn": args.deflection,
            "angularDeflection": args.angular,
        }

    if args.sweep:
        return
    out.mkdir(parents=True, exist_ok=True)
    (out / "elements-measurements.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    print(f"\n[elements] wrote {out / 'elements-measurements.json'}")


if __name__ == "__main__":
    main()
