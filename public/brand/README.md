# Season artwork

Publisher files, cropped and resized only. Site-root paths; consumers prefix the Vite base
(`brandUrl`, `src/seasons.ts`).

| dir | season | source |
|---|---|---|
| `decode/` | DECODE presented by RTX (FTC 2025-26) | FIRST season brand pack `FIRST_AGE-FTC-logos.zip` (info.firstinspires.org, 2026 Season Assets): `first_age_ftc_decode_logo_vertical_rgb_fullcolor.png` (`poster`), `first_age_ftc_decode_wordmark_rgb_{black,white}.png` |
| `biobuzz/` | BIOBUZZ presented by RTX (FTC 2026-27) | FIRST season brand pack `first-biobuzz-logos.zip` (firstinspires.org/hubfs/web/brand/season/2027/downloads): `first_canopy_ftc_biobuzz_logo_vertical_rgb_fullcolor.png` (`poster`; its hex panel cropped as `mark`), `first_canopy_ftc_biobuzz_wordmark_rgb_{black,white}.png` |
| `chain/` | Chain Reaction (2026 Unofficial FTC CAD competition) | supplied by the owner 2026-09-22: the ring mark, the wide and stacked wordmarks and the full lockup, all white on transparent. `poster.webp` is the mark over the stacked wordmark. |

FIRST's marks are FIRST's trademarks, used to identify the season being simulated, within each
season's style guide (`FIRST_AGE-FTC-style-guide.pdf`, `ftc-biobuzz-styleguide.pdf`). Owner
decision 2026-09-22. Do not recolour, skew or crop the marks further; the `wordmark-*` files exist
because the style guides supply them as separate assets.

`biobuzz/mark.webp` and `biobuzz/wordmark-black.webp` are also fetched at runtime by the 3D scene
(`scene/renderFieldGlb.ts`) to paint the hive's `am-5883 Panel Sticker`.
