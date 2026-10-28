# Patron presentation sources

Verified against the user's installed Deadlock game on 2026-10-14. The read-only VPK reader verifies each original resource's CRC32. The evidence snapshot is `.build-cache/fate-patron-source.json`; the extraction is repeatable with `.build-cache/extract-fate-presentation.mjs` before manual module integration. Game resources belong to Valve Corporation and are used in this fan application.

The exact UI colours come from `panorama/styles/citadel_base_styles.vcss_c`, archive `pak01_130.vpk`, CRC32 `1370036206`, SHA-256 `278aa2f3e5d0522a6281374b77b05298cefbfadf8486c2e50d3bc3f2e2c6d46e`. These are direct CSS definitions, not colours sampled from a screenshot:

| Patron | UI accent | Bright | Darker | Material glow |
| --- | --- | --- | --- | --- |
| Archmother / team 2 | `#4D75C3` | `#BDCBFF` | `#243265` | `#84ADF6` |
| Hidden King / team 1 | `#D4860B` | `#FBDCA0` | `#6F3806` | `#FFC21A` |

The glow references are `g_vSelfIllumTint1`, converted to byte RGB by rounding each normalised channel times 255. Archmother's `models/npc/patron_sapphire/materials/patron_arch_mother_flare.vmat_c` is in `pak01_060.vpk`, CRC32 `3387029525`, SHA-256 `49a5dcea3c5fc6dd54cab748e5c8189eb15c07e4148e78030e75355ecbd6b65f`. King's `models/npc/patron_amber/material/patron_amber_eyes.vmat_c` is in `pak01_200.vpk`, CRC32 `1957407412`, SHA-256 `2a559c1204b54f203d936ff4161d38ad890e5391de8cbb0755999d8253043ba4`. These are material reference tints; final in-game lighting also depends on shaders, exposure and bloom.

The actual team badge paths are `panorama/images/hud/core/team2_icon.vsvg_c` (Archmother's hand/keyhole, CRC32 `769078513`, SHA-256 `a452dac12cfca24dc2872566aa91525956e412e0b5f4491a6a8ab6e3139bd3f7`) and `team1_icon.vsvg_c` (King's crown, CRC32 `1410584164`, SHA-256 `f9db679a9c47e86316fd100cb400ed91b84ed83ee16db505cb1512a33be092cb`), both in `pak01_252.vpk`. The original SVG paths are preserved in `src/fate-presentation.js`; only fixed white fill becomes `currentColor` and dimensions become responsive.

The [Archmother overview](https://deadlock.wiki/Archmother) and [Hidden King overview](https://deadlock.wiki/Hidden_King) corroborate the blue/crystalline and amber/yellow identities in game screenshots. Exact constants and glyphs above are independently verified from Valve's installed files. Chicken and curse are app-specific fate rules; their glyphs and colours are original presentation choices rather than claims about an official game palette.

Badges read only persisted `archmotherOrigin`, `chickenOrigin`, `sealed`, and optional `cursed`/`locked` flags. Global patron activation never implies that old items were gifts. King badges remain on revealed purchases as provenance; source badges are safe to show on anonymous sealed parcels.
