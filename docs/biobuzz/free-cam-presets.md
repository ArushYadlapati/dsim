# Free camera — the CAD navigation presets, and where every row came from

The BIOBUZZ 3D free camera copies a CAD package's mouse layout so that a hand already trained on
one does not have to learn a sixth. This file is the EVIDENCE for each preset: the vendor page,
its own wording, and — just as important — what that vendor does **not** state, so the next pass
does not "correct" a deliberate choice back into a guess.

Written 2026-09-21 after the owner's report: *"The presets for free camera are incorrect. Onshape
orbit is right drag but it is reversed."* The code is `src/games/biobuzz/graphics/freeCam.ts`;
the behaviour is pinned by `freeCamChecks` in `scripts/smoke-biobuzz/render.ts`.

## The shipped table

| preset | orbit | pan | zoom by dragging | wheel forward |
|---|---|---|---|---|
| `dsim` | right · left | middle · Ctrl+right · Shift+left | — | in |
| `onshape` | right | middle · Ctrl+right | — | in |
| `solidworks` | middle | Ctrl+middle | Shift+middle | in \* |
| `fusion` | Shift+middle | middle | Ctrl+Shift+middle | in \* |
| `blender` | middle | Shift+middle | Ctrl+middle | in |
| `custom` | whatever the player binds | | | in |

`⌘` counts as Ctrl everywhere (`renderScene.ts` folds `metaKey` into the same flag). **Alt is
ignored by a preset** and exact in a custom layout — so Onshape's own `Alt + right-drag`
constrained rotate lands on a plain orbit here rather than on nothing.

`*` the vendor publishes the buttons but not the wheel's default DIRECTION; ours follows the two
that do publish it. Every preset's wheel is overridable per device.

## Sources

### Onshape — [View Navigation and the View Cube](https://cad.onshape.com/help/Content/View/view_navigation_and_the_view_cube.htm)

> "Onshape provides the following default input device navigation settings"

- **3D rotate (mouse)**: "Right-mouse-button click, then drag" (Windows and macOS alike).
- **2D pan (mouse)**: "Ctrl + Right-mouse-button click, then drag / Middle-mouse-button click, then drag".
- **Zoom (mouse)**: "Scroll wheel down: Zoom out" / "Scroll wheel up: Zoom in" — the one vendor
  statement of a wheel DIRECTION we have, and it is what `dsim` and `onshape` default to.
- Keyboard, not copied (see "what we deliberately left out"): arrows rotate 15°, Shift+arrows 90°,
  Ctrl+arrows 5°, Ctrl+Shift+arrows pan, `Z` / `Shift+Z` zoom.
- Also: "Alt + Right Mouse button: horizontal mouse movement about model; vertical mouse movement
  pitches over model" — a CONSTRAINED rotate, which is why Alt must not read as "no gesture".

[My Account — Preferences](https://cad.onshape.com/help/Content/Plans/my_account_preferences.htm)
adds the two switches Onshape itself offers: *"Keep Onshape's default settings for mouse mappings,
or select another CAD system's default settings"* and *"Reverse scroll wheel zoom direction"* —
i.e. Onshape's own answer to this whole feature is a preset list plus a wheel-direction toggle,
which is the shape this setting now has. The named alternatives are SOLIDWORKS, NX 10, Creo and
AutoCAD ([Onshape tech tip](https://www.onshape.com/en/resource-center/tech-tips/tech-tip-changing-rotate-pan-and-zoom)).

**Not stated anywhere**: which way the model turns for a given drag, and whether the wheel zooms
toward the cursor.

### SOLIDWORKS — [Middle Mouse Button Functions](https://help.solidworks.com/2026/english/SolidWorks/Sldworks/r_Middle_Mouse_Button.htm)

Rotate is a middle-mouse drag. ⚠️ **The page body is client-rendered and could not be read
directly**; the rotate binding is from the search index's own summary of that page, and the
modifiers below come from Autodesk's SolidWorks preset instead. The mapping is corroborated but
the primary page was not fully readable — flagged rather than smoothed over.

### Autodesk Fusion — [Fusion preferences reference](https://help.autodesk.com/view/fusion360/ENU/?guid=GUID-878489CD-3A23-4303-8450-C2F4F8E410B1)

"Mouse setup (pan, zoom, orbit)" is Fusion's own preset list — Fusion (default), Alias, Inventor,
PowerMill, SolidWorks, Tinkercad — and the page prints each one's bindings. Two rows of our table
come straight off it:

- **Fusion**: "Zoom: Roll the middle mouse button or Ctrl + Shift + middle mouse button. Pan:
  Middle mouse button. Orbit: Shift + middle mouse button."
- **SolidWorks** (Autodesk's emulation of it): "Zoom: Shift + roll middle mouse button. Pan: Ctrl
  + middle mouse button (Windows) or Command + middle mouse button (MacOS). Orbit: Middle mouse
  button."

**Not stated**: the wheel's default direction, or any zoom-to-cursor behaviour.

### Blender — [3D Viewport Navigation](https://docs.blender.org/manual/en/latest/editors/3dview/navigate/navigation.html) and the default keymap

- Orbit: "Rotate the view around the point of interest by clicking and dragging MMB".
- Pan: "Shift-MMB – Pan the view freely by dragging the mouse."
- Zoom: "You can zoom in and out by rolling the Wheel or dragging with Ctrl-MMB."
- Wheel DIRECTION, from Blender's own shipped keymap
  (`scripts/presets/keyconfig/keymap_data/blender_default.py`, `projects.blender.org`):
  `("view3d.zoom", {"type": 'WHEELINMOUSE'}, {"properties": [("delta", 1)]})` — a forward push
  zooms IN.
- [Preferences ▸ Navigation](https://docs.blender.org/manual/en/latest/editors/preferences/navigation.html)
  describes **Zoom to Mouse Position** as something you enable: *"When enabled, the mouse pointer
  position becomes the focus point of zooming instead of the 2D window center."* That is the ONE
  vendor statement about zoom-to-cursor anywhere in this file, and it says the default is the
  centre — which is why ours is off by default.
- The same page defines the **Turntable** orbit method ("Rotates the view keeping the horizon
  horizontal") against Trackball. Ours is turntable-only, deliberately — see below.

## What could not be verified, and what was dropped

- **Inventor, Creo, NX, FreeCAD, SketchUp, Tinkercad** — none ships, because none was verifiable
  from its own vendor page inside this pass. Autodesk's preference reference above does document
  Inventor-style (`F2`/`F3`/`F4` + left), PowerMill-style and Tinkercad-style bindings, but those
  are AUTODESK's emulations inside Fusion, not those packages' own published defaults, and a
  preset named after a package has to be that package. Onshape's own preference list also offers
  NX 10, Creo and AutoCAD without saying what they map to.
- **The direction sense of an orbit or a pan** is published by NOBODY. Ours is the CAD gesture
  every one of them implements — put a finger on the model and turn it — established here by the
  owner's report against Onshape plus this app's own spectator orbit camera, which has always
  dragged the field with the cursor (`orbitDrag`'s `orbitYaw -= dx`). It is written up in
  `freeCam.ts` under THE DIRECTION SENSES and pinned with explicit geometry in the lane.
- **Zoom toward the cursor** is implemented and offered, and OFF by default everywhere, because
  the only vendor that documents it documents it as opt-in.
- **SOLIDWORKS' and Fusion's wheel direction** default to "forward zooms in" like the two that
  publish one. If somebody can read either vendor's own statement of it, that is a one-line change
  to `FREE_CAM_PRESET_WHEEL`.

## Where we deliberately differ from all of them

- **Turntable orbit, always, with the floor plane as the look-at target.** This is a field viewer,
  not a modeller: the horizon staying level is what keeps "which alliance wall am I behind"
  answerable, and a trackball roll would make the tape lines read as a bug. Blender's own manual
  makes the same argument for its default.
- **Orbit pivots on the look-at point, never on a selection or on the geometry under the cursor.**
  There is no selection in a 3D match view, and the two packages that pivot on a picked point do
  it to work on a part.
- **No keyboard view keys.** Onshape's arrow-key rotate is the obvious thing to copy and it cannot
  ship: the arrows are a DEFAULT DRIVE BIND (`docs/area/ui.md`: "Q/E or ←/→ turn") and every bind
  in this app is rebindable, so a camera that ate them would either steal a driving control or
  need a runtime conflict check against `effectiveBindings` on every keystroke. The free camera is
  mouse-only, and `c` still cycles cameras.
