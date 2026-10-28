# Item recipes and charge compatibility

Verified 2026-10-14T09:40:26.985Z. Current parsed Source 2 definitions from [Deadlock Assets API items](https://api.deadlock-api.com/v1/assets/items?language=english) and [heroes](https://api.deadlock-api.com/v1/assets/heroes?language=english); resolved against the app's existing 173 items and 41 heroes. The synchronization script preserves those snapshots and rejects unknown components. Run `node scripts/sync-game-rules.mjs`; cached repeat uses `--offline`. Raw evidence is in `.build-cache/game-rules/verified-source.json`.

Recipe parents come from the actual `component_items` field. Transitive recipe lookup handles multi-step upgrades and recipes with two components. A candidate is never treated as an upgrade just because of its name. 62 items have recipes.

Charge compatibility checks only the selected hero's four signature abilities. Positive numeric `AbilityCharges` at base rank or a positive `AbilityCharges` rank upgrade qualifies. It does not inspect names such as Shoulder Charge, Charged Shot, charge-up timers, or generic movement skills. All four ranks are eventually present in a complete generated skill plan, so abilities that gain charges after an upgrade also qualify.

Only Extra Charge, Rapid Recharge and Recharging Rush require an existing charged ability. Omnicharge Signet has `EnableAbilityCharges=1` and explicitly adds charges to ordinary abilities; keeping it allows a noncharge hero to gain charge compatibility after drawing it. Cultist Sacrifice has useful soul/buff effects without charge abilities. Mystic Burst, Tankbuster, Quicksilver Reload and Mercurial Magnum use their own charge-up timers and are not charge-dependent. Refresher resets ordinary cooldowns too. These remain eligible.

| Hero | Charged signature abilities (base charges / rank granting charges) |
| --- | --- |
| Abrams | None |
| Apollo | None |
| Bebop | None |
| Billy | Bashdown: 1; rank 2 +1 |
| Calico | None |
| Celeste | Radiant Daggers: 1; rank 1 +2 |
| Deadman Danny | None |
| Drifter | None |
| Dynamo | Kinetic Pulse: 1; rank 1 +1 |
| Graves | Jar of Dead: 4 |
| Grey Talon | Charged Shot: 1; rank 1 +1 |
| Haze | Smoke Bomb: 0; rank 2 +2 |
| Holliday | Powder Keg: 2; rank 2 +1 · Bounce Pad: 1 |
| Infernus | Napalm: 1; rank 1 +1 · Flame Dash: 0; rank 3 +2 |
| Ivy | Entangling Thorns: 1; rank 1 +1 |
| Kelvin | Frost Grenade: 2 |
| Lady Geist | Life Drain: 0; rank 3 +3 |
| Lash | Grapple: 1; rank 3 +1 |
| McGinnis | Mini Turret: 1; rank 2 +2 |
| Mina | None |
| Mirage | Fire Scarabs: 2; rank 2 +1 |
| Mo & Krill | None |
| Paige | Bookwyrm: 1; rank 2 +1 |
| Paradox | Time Wall: 0; rank 3 +3 |
| Pocket | None |
| Rat King | Rat Swarm: 1; rank 1 +1 |
| Rem | Pillow Toss: 1; rank 3 +1 |
| Seven | Lightning Ball: 1; rank 1 +1 |
| Shiv | Serrated Knives: 2; rank 2 +2 |
| Silver | None |
| Sinclair | Vexing Bolt: 1 |
| Solomon | None |
| The Doorman | Call Bell: 1; rank 1 +1 |
| Venator | Consecrating Grenade: 0; rank 3 +1 · Hex-Lined Snap Trap: 2; rank 3 +1 |
| Victor | Jumpstart: 1; rank 3 +1 |
| Vindicta | Assassinate: 2 |
| Viscous | Puddle Punch: 1; rank 1 +1 |
| Vyper | Screwjab Dagger: 2; rank 1 +1 |
| Warden | None |
| Wraith | Card Trick: 2; rank 1 +2 |
| Yamato | Flying Slash: 0; rank 3 +2 |

# Curated double items

The 20 pairs in `src/item-combos.js` are app-specific combinations, not a claim that these are official Street Brawl bundles. Pairings are inferred from the actual item descriptions and attributes in the same snapshot. The descriptions explain their purpose without promising a special game interaction. The pairs keep the two ordinary tickets available separately. Recipe ancestors and descendants are never paired together.
