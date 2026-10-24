# AI context - StackingGame-Events v2.6.13

Minecraft 1.20.1 / Forge 47.4.10+ / Java 17.

Current canonical Bridge integration is the user-provided My-game-pack 1.0.46 / BridgeMOD 1.4.0 API:
`jp.douma.bridgemod.api.GameEvents`.

Do NOT reintroduce `streamtorearn-common-api` as a runtime dependency unless the external Bridge architecture changes again.

Game API contract:
- GAME_ID / game.json modId: `stackinggame_events`
- register: `GameEvents.register("stackinggame_events", receiver, statusSupplier)`
- new round/reset: `GameEvents.beginSession("stackinggame_events")`
- end/stop: `GameEvents.endSession("stackinggame_events")`
- stale session: `GameEvents.DISCARDED`
- queue temporarily unavailable: `GameEvents.WAIT`
- accepted/duplicate already accepted: `GameEvents.ACCEPTED`

Bridge payload keys used by StackingGame:
`server`, `requestId`, `key`, `count`, `listenerName`, `type`, `gameSessionId`, `args`, `announce`.

Stacking materials in the actual game are `minecraft:diamond_block` and `minecraft:gold_block`.
The arena frame is obsidian. `minecraft:obsidian` and `minecraft:crying_obsidian` are hard-protected from event destruction.

Known next-step work after v2.6.2:
- Decide/remove FallingBlock entities outside arena.
- Optionally prevent players from mining the obsidian frame via Forge BlockEvent.BreakEvent.
- Add My-game-pack `game-packs/umetate/game.json`.

## v2.6.2 fixed Arena contract

- Production stack bounds default to X=-6..6, Y=49..56, Z=-6..6 (1,352 block positions).
- Coordinates are absolute world coordinates; the source command did not use `~`.
- `ArenaService` owns the normalized bounds and is available through `EventContext.arena()`.
- `StackBlockService` never removes/lifts/ejects tagged gold/diamond stack blocks outside the Arena.
- No-arg `meteor_purge`, `void_singularity`, `tornado`, `orbital_laser`, and `shockwave_collapse` use the fixed Arena center.
- Player-targeted events such as `meteor_shower` remain player-oriented.


## v2.6.13 architecture notes
- BlockInteractionMode is now a lightweight runtime audit, not a hard lock. Unexpected block operation => WARN once per execution/operation.
- EventRegistryConsistency validates Event Master stacking keys against concrete Java event registrations at runtime construction.
- Event implementations use `ctx.encounter()`; encounter key/kind/attackKind come from StackingEventCatalog/Event Master.
- Temporary blocks, managed FallingBlock entities and timed event mobs all carry/retain the owning `executionId`.
- Do not remove the intentional short FallingBlock visual tail on normal END.
