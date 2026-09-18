import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { environmentDef } from '../graphics/environments';
import type { EnvironmentId } from '../graphics/settings';

/**
 * THE ENVIRONMENT MAP — the procedural room, or one of the two CC0 HDRIs, run through
 * `PMREMGenerator` and handed to the scene (`docs/biobuzz/plan-3d.md` §4.5).
 *
 * ── WHAT A PMREM IS FOR, IN ONE LINE ───────────────────────────────────────────────────────
 * A `MeshStandardMaterial` with nothing to reflect is a flat-shaded polygon. `scene.environment`
 * gives every PBR material in the scene an image to gather light from — the diffuse term from
 * its low-frequency content and the specular term from a roughness-indexed mip chain, which is
 * what `PMREMGenerator` pre-filters. One texture, generated once, read by every material with
 * no per-material wiring.
 *
 * ── THE THREE RULES §4.5 SETS, AND WHERE EACH IS KEPT ──────────────────────────────────────
 *   ON DEMAND   — an HDRI is fetched by `HDRLoader` the first time its id is selected, and
 *                 never otherwise. It is `HDRLoader` and NOT `RGBELoader`: three 0.186 renamed
 *                 it and the old name now logs a deprecation warning on every load, which is a
 *                 line of console noise a player would see for picking a setting. Same loader,
 *                 same `.hdr` parser, same few KB in this chunk — which is already the thing a
 *                 2D player never downloads.
 *   CACHED      — twice over. Poly Haven's CDN answers `Cache-Control: max-age=14400`, so a
 *                 re-pick inside four hours is a memory-cache hit; and this loader keeps the
 *                 generated PMREM per id for the life of the scene, so switching back and forth
 *                 in the Graphics section costs nothing at all after the first of each.
 *   NEVER BUNDLED — no `public/` copy, no import, no data URI. `bundleaudit` would see it.
 *
 * ── FAILURE IS THE PROCEDURAL ROOM, NOT A BLACK SCENE ──────────────────────────────────────
 * A blocked CDN, an offline desktop build, a corporate proxy that rewrites `.hdr` to HTML: all
 * of it ends at the same place, the room that needs no network, plus one event-log line. A 3D
 * view that goes black because a decoration failed to download would be a far worse bug than
 * the one it is reporting.
 */

/** what a background looks like when the environment is a photographed room: blurred enough to
 * read as a surround rather than as a picture somebody hung behind the field, and dimmed so the
 * field — whose own colours are FIXED (§4.5: the HUD's on-field contrast pairs depend on it) —
 * stays the brightest thing on screen. */
const BG_BLUR = 0.4;
const BG_INTENSITY = 0.5;

export interface BbEnvironment {
  /** apply `id` to `scene`, replacing whatever is there. Resolves when the map is live; on a
   * failure it resolves having applied the procedural room and called `onEvent`. */
  apply(id: EnvironmentId, onEvent?: (line: string) => void): Promise<void>;
  /** the id currently applied — what the background restore logic checks. */
  readonly current: EnvironmentId;
  /** true while a fetch is in flight, for the picker's own busy state. */
  readonly loading: boolean;
  /** re-read the themed backdrop colour (the theme changed) — a no-op while an HDRI is the
   * background, because that one is not themed and must not be overwritten by a colour. */
  refreshBackdrop(hex: number): void;
  dispose(): void;
}

export function createEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, backdropHex: number): BbEnvironment {
  const pmrem = new THREE.PMREMGenerator(renderer);
  // compiling the equirectangular shader up front keeps the first HDRI's `fromEquirectangular`
  // off the frame it lands on — otherwise the swap costs a visible hitch on a cold shader cache
  pmrem.compileEquirectangularShader();

  /** generated maps, per id, for the life of this scene. A PMREM is renderer-bound, so this
   * cache cannot be module-scope: two scenes (the gallery mounts several) would hand each
   * other's GL context a texture it has never seen. */
  const cache = new Map<EnvironmentId, THREE.Texture>();
  const backdrop = new THREE.Color(backdropHex);
  let current: EnvironmentId = 'room';
  let loading = false;
  /** bumped on every `apply`, so a slow HDRI that lands after the player has picked something
   * else is dropped instead of replacing the newer choice. */
  let epoch = 0;
  let disposed = false;

  const roomTexture = (): THREE.Texture => {
    const hit = cache.get('room');
    if (hit) return hit;
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;
    // `RoomEnvironment` is a throwaway scene of ~12 boxes; the PMREM has already consumed it
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) mat.dispose();
      }
    });
    cache.set('room', tex);
    return tex;
  };

  /** the room is the environment AND the themed letterbox behind the field. */
  const applyRoom = (): void => {
    scene.environment = roomTexture();
    scene.background = backdrop;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;
    current = 'room';
  };

  const applyHdri = (id: EnvironmentId, tex: THREE.Texture): void => {
    scene.environment = tex;
    // THE HDRI IS ALSO THE SURROUND. On the CAD-GLB field path there is no procedural room
    // behind the walls at all (see `renderScene.ts`'s note on `readBackdropColor`), so the
    // background IS most of the picture — leaving it a flat themed colour while the lighting
    // came from a hall would read as a compositing mistake rather than as a setting.
    scene.background = tex;
    scene.backgroundBlurriness = BG_BLUR;
    scene.backgroundIntensity = BG_INTENSITY;
    current = id;
  };

  applyRoom();

  return {
    get current(): EnvironmentId {
      return current;
    },
    get loading(): boolean {
      return loading;
    },
    async apply(id: EnvironmentId, onEvent?: (line: string) => void): Promise<void> {
      if (disposed) return;
      const mine = ++epoch;
      const def = environmentDef(id);
      if (!def.hdri) {
        loading = false;
        applyRoom();
        return;
      }
      const cached = cache.get(id);
      if (cached) {
        loading = false;
        applyHdri(id, cached);
        return;
      }
      loading = true;
      try {
        const src = await new HDRLoader().loadAsync(def.hdri.url);
        if (disposed || mine !== epoch) {
          src.dispose();
          return;
        }
        src.mapping = THREE.EquirectangularReflectionMapping;
        const tex = pmrem.fromEquirectangular(src).texture;
        // the equirectangular SOURCE is a 1k float texture and is not needed once the mip
        // chain exists — keeping it would hold ~8 MB of GPU memory per environment for nothing
        src.dispose();
        cache.set(id, tex);
        applyHdri(id, tex);
      } catch (err) {
        if (disposed || mine !== epoch) return;
        applyRoom();
        onEvent?.(`Couldn’t load the ${def.name} environment. Using the practice room.`);
        // eslint-disable-next-line no-console
        console.warn('BIOBUZZ 3D: HDRI environment failed to load; using the procedural room.', err);
      } finally {
        if (mine === epoch) loading = false;
      }
    },
    refreshBackdrop(hex: number): void {
      backdrop.setHex(hex);
      // only the room path paints the background with a colour; an HDRI background is a
      // texture and `scene.background` already points at it
      if (current === 'room') scene.background = backdrop;
    },
    dispose(): void {
      disposed = true;
      epoch++;
      scene.environment = null;
      scene.background = null;
      for (const tex of cache.values()) tex.dispose();
      cache.clear();
      pmrem.dispose();
    },
  };
}
