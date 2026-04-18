# Blue Dot — Multiplayer Globe Game Design

**Date:** 2026-04-18
**Status:** Approved design, ready for implementation planning.

## Context

The current blue-dot project is a single-player React SPA with a draggable
blue dot, parallax background, keyboard controls, and a click-to-summon
animation, deployed to Cloudflare Pages
(https://blue-dot-1og.pages.dev/). This design turns it into a
solo-first, anonymous-multiplayer collector game played on the surface of
a 3D globe. Players come and go freely; the experience must be fun with
one player online and scale cleanly as more join.

## Goals

- Keep the "anyone can drop in, nothing to sign up for" feel.
- Playable and fun as a solo experience from day one.
- Multiplayer adds liveliness (other dots, live leaderboard, bump-to-steal)
  without becoming adversarial.
- Ship an MVP in a handful of focused workdays; stay on Cloudflare
  infrastructure end-to-end.

## Non-goals

- Accounts, auth, cross-device identity.
- Real-time voice/chat.
- Matchmaking, rooms, or private lobbies (single global world).
- Anti-cheat beyond server-authoritative basics.
- Bots in the MVP (deferred to Phase 4).

## Game concept

- **Mode:** Collector on a sphere. Pellets spawn on the globe's surface;
  dots move along the surface eating pellets for points.
- **World:** A single persistent globe shared by everyone online.
- **Solo:** Works with one player — you vs. your own high score, plus the
  all-time leaderboard.
- **Multiplayer:** Other real players appear as differently-colored dots
  in the same world, competing for the same pellets.
- **Interaction:** Bump-to-steal — colliding with another dot transfers
  one pellet's worth of score (1 pt) from the lower-scorer to the
  higher-scorer, with a 2s cooldown to prevent spam.

## Identity & scoring

- **Identity:** localStorage-sticky. On first load, generate a random
  color and nickname (e.g., `blue-dot-7421`). Persisted in localStorage so
  the same browser gets the same dot across sessions. Nickname is
  user-editable; still fully anonymous (no server-side user records).
- **Live leaderboard:** Top 5 currently-online dots, shown in the HUD.
  Session score resets on disconnect.
- **All-time top 100:** Persisted in Cloudflare D1. Final session score is
  submitted to D1 on disconnect and also snapshotted at score thresholds
  (to survive abrupt disconnects). Displayed in a separate HUD pane.

## Camera & controls

- **Camera:** Follow-cam. Camera trails behind and slightly above the
  dot's local tangent frame and smoothly lerps as the dot turns. The
  globe visibly rotates "under" the player; the horizon curves; pellets
  pop over the horizon as the player approaches.
- **Coordinates:** Each dot stores `(lat, lon)` on a unit sphere; 3D
  positions are derived only for rendering.
- **Keyboard (primary):**
  - `↑` / `W`: move forward along current heading.
  - `↓` / `S`: move backward.
  - `←` / `→` / `A` / `D`: rotate heading left/right.
  - `Shift`: big step (keeps existing convention).
  - `R` / `Home`: respawn at a random point on the sphere (not `0,0` —
    avoids everyone stacking).
- **Pointer (secondary):**
  - Tap/click an empty point on the globe: your dot glides there along a
    great-circle arc ("summon", reusing the current delightful animation).
  - Drag on empty space: rotate the view (camera orbit). Dot keeps moving
    under keyboard control.
  - Note: the existing "drag the dot directly" interaction from the 2D
    app is retired — with a follow-cam, the dot is always under the
    camera, so direct dot-drag doesn't translate. Tap-to-summon replaces
    it.
- **Speed:** constant angular velocity. Tune so that traversing a full
  hemisphere takes ~15s.

## Pellets

- **Types (MVP, intentionally minimal):**
  - Common (white, 1 pt) — the baseline spawn.
  - Gold (3 pts) — rarer, visibly pulses so it's spottable from a
    distance and gives players a reason to navigate across the globe.
- **Spawning:** Server-authoritative. The `World` DO targets ~60 live
  pellets at any time, spawning replacements as they're eaten.
  Pellet positions are sampled uniformly on the sphere (random unit
  vector — *not* random lat/lon, which clusters near the poles).
- **Density scaling:** Pellet count scales gently with player count so it
  feels populated for solo and doesn't become a feeding frenzy with 20+
  players. Start with `max(60, 30 * sqrt(players))` and tune.
- **Eating:** Client predicts — when the dot's great-circle distance to a
  pellet drops below `eatRadius`, client sends `eat(pelletId)` to the DO.
  DO is authoritative: first valid claim wins, validates the claimant's
  last-known position is within range, broadcasts removal + scorer. No
  client trust required.

## Architecture

### Frontend

- **Rendering:** Three.js. One added dep. Scene: unit sphere mesh with a
  blue-planet material, ambient + directional light, starfield skybox.
  Player dot is a small emissive mesh positioned on the surface; other
  dots are the same mesh with per-player color. The existing parallax
  background becomes the skybox backdrop (starfield feel is preserved).
- **React integration:** mount a `<canvas>` and run the Three.js scene
  inside a `useEffect` (imperative render loop with `requestAnimationFrame`).
  React owns HUD only; the canvas is an imperative island.
- **State:** a minimal client store for local dot (position, heading,
  score) and remote world state (other dots, pellets, leaderboards). No
  Redux — plain React state + refs is enough at this scope.

### Backend

- **Stack:** Cloudflare Worker + a single `World` Durable Object.
- **Connection:** clients open a WebSocket to the Worker, which routes to
  the single `World` DO.
- **Wire protocol:**
  - Client → server @ ~20 Hz:
    `{ type: "move", lat, lon, heading }`
    and event messages: `{ type: "eat", pelletId }`.
    Bumps are *not* client-reported — the DO detects them from position
    updates to keep the trust boundary clean.
  - Server → clients @ ~15–20 Hz:
    `{ type: "tick", dots: [...], pellets: [...], events: [...] }`
    containing delta updates. Full snapshot on initial connect.
- **Authority:** DO owns pellet spawning, eating validation, collision
  validation for bump-to-steal, and score tallying. DO holds ephemeral
  session state in memory; persists all-time top scores to D1.
- **Persistence:** D1 table `top_scores(id, nickname, color, score,
  created_at)` — top 100 kept, pruned on insert.
- **Why a single DO:** matches "one shared globe, drop in/out." Sharding
  is YAGNI; if concurrency blows up later, shard regionally.
- **Why Cloudflare (vs. Sleeper-hosted Node/PM2):** deployment stays in
  one place — `pnpm run deploy` already ships Pages; Workers/DO/D1
  extend cleanly from there.

## HUD

- Top-left: all-time top 5 (nickname, score).
- Top-right: your nickname (click to edit), your session score, your
  current live rank.
- Bottom-right: live leaderboard (top 5 online).
- Bottom-center hint: control reminder, similar to current build.
- Mobile: HUD panes collapse behind a small toggle button; controls
  default to tap-to-go + drag-to-steer.

## Phasing

**Phase 0 — Scaffolding (~half day).**
Swap the current DOM dot for a Three.js scene (sphere, lights, skybox,
dot mesh). Keyboard steering + click-to-go with great-circle glide.
Follow cam. No backend yet; pellets spawn client-side. Solo-playable.

**Phase 1 — Solo polish (~half day).**
Pellet types (white/gold), eat animation, HUD with live session score,
localStorage-sticky nickname + color on first load. `R` respawn at
random. Confirm solo feel is fun before adding networking.

**Phase 2 — Multiplayer backbone (~1 day).**
Cloudflare Worker + `World` DO, WebSocket endpoint, position broadcast,
authoritative pellet spawning + eating. Render other dots. Live
leaderboard HUD. Bump-to-steal with 2s cooldown.

**Phase 3 — Persistence + polish (~half day).**
D1 `top_scores` table, submit on disconnect and threshold snapshots.
All-time leaderboard HUD. Sound cues (pellet crunch, bump). Mobile
control tweaks.

**Phase 4 — Bots (later, only after solo feels right).**
DO spawns N drifting "ambient dot" entities. Simple AI: wander toward
nearest pellet with occasional direction jitter. Internally flagged as
bots; indistinguishable from real players to clients.

Estimated MVP (Phases 0–3): ~2.5 focused workdays.

## Files likely to change / be added

Existing:

- `src/App.tsx` — replaces DOM dot with Three.js scene mount + HUD.
- `src/ParallaxBackground.tsx`, `ParallaxBackground.css` — repurposed as
  starfield skybox (or retired if Three.js skybox fully replaces it).
- `package.json` — add `three`, `@types/three`.

New:

- `src/game/sphere.ts` — lat/lon ↔ 3D conversions, great-circle math.
- `src/game/scene.ts` — Three.js scene setup, render loop.
- `src/game/controls.ts` — keyboard + pointer input → movement.
- `src/game/camera.ts` — follow-cam logic.
- `src/game/net.ts` — WebSocket client, wire protocol.
- `src/game/state.ts` — client game state (dots, pellets, scores).
- `src/hud/` — React HUD components (leaderboards, nickname, hints).
- `worker/` — Cloudflare Worker entry + `World` DO.
- `worker/wrangler.toml` — Worker/DO/D1 bindings.
- `worker/schema.sql` — D1 schema for `top_scores`.

## Verification

Each phase ends with hands-on verification in a browser.

- **Phase 0:** `pnpm run dev`, open `http://localhost:5173`, confirm:
  dot moves smoothly on sphere via keyboard; click-to-go glides along a
  great circle; camera follows; `pnpm run typecheck` passes.
- **Phase 1:** play solo for 5 minutes. Pellets spawn, get eaten, score
  increments. Nickname persists across refresh. Subjective check: "is
  this fun on its own?"
- **Phase 2:** deploy Worker to a staging environment (or `wrangler dev`
  locally). Open two browser tabs → both dots visible in each. Eat a
  pellet → only one scorer wins. Bump → score transfers with cooldown.
- **Phase 3:** disconnect flow writes to D1 (`wrangler d1 execute … "select
  * from top_scores"`). All-time HUD shows entries. Sound cues fire.
- **Deploy:** `pnpm run deploy` ships Pages; `wrangler deploy` ships
  Worker. Smoke-test on `blue-dot-1og.pages.dev` with a second device.

## Open questions (not blocking)

- Exact tuning values (pellet density scaling coefficient, `eatRadius`,
  angular velocity, bump cooldown) — tune live during Phase 1/2.
- Skybox style: retain the current parallax aesthetic as a procedural
  starfield, or use a static cubemap? Decide visually in Phase 0.
- Whether "Gold (3 pts)" is the right rare-pellet value or if it should
  be higher to really pull players across the globe. Tune during Phase 1.
