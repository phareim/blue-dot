# Blue Dot Phase 2 — Multiplayer Backbone Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a single Cloudflare Worker + `World` Durable Object that owns pellet spawning, movement broadcast, eat validation, and bump-to-steal. Clients talk over WebSocket; remote players render as other-colored dots. Live leaderboard (top 5 online) shown in HUD.

**Architecture:**
- Worker (`worker/index.ts`) upgrades `/ws` requests to WebSocket and routes them all to one `World` Durable Object (the singleton keeps "one shared globe" semantics).
- `World` DO holds ephemeral in-memory state: connected sessions (id, nickname, color, lat/lon/heading, score, lastBumpMs), pellets (id, lat/lon, kind), tick timer. Broadcasts a compact `tick` every ~66 ms.
- Client wraps the WS in `src/game/net.ts` with auto-reconnect; `Game.tsx` renders `state.remotes` + `state.pellets` coming from the server, removes local pellet spawning, keeps client prediction of local movement.

**Tech Stack:** Cloudflare Workers + Durable Objects (DO class bindings), TypeScript, `wrangler` (already installed), Vite dev proxy for local WS.

**Wire protocol (JSON, compact):**
- Client → server:
  - `{ t: 'hello', nickname, color }` — first message after connect.
  - `{ t: 'move', lat, lon, h }` — ~20 Hz.
  - `{ t: 'eat', id }` — pellet claim.
- Server → client:
  - `{ t: 'welcome', you, pellets, dots }` — initial snapshot.
  - `{ t: 'tick', dots, spawned, removed, events }` — delta. `dots: [[id, lat, lon, h, s]]`, `spawned: [[id, lat, lon, k]]` (`k` = 0 common / 1 gold), `removed: [id]`, `events: [{t:'bump', a, b, dir}]`.

---

## Task 1: Wrangler config + Worker skeleton

**Files:**
- Create: `worker/index.ts`, `worker/world.ts`, `worker/wrangler.toml`, `worker/tsconfig.json`.
- Modify: `tsconfig.json` (workspace), `package.json` (scripts).

Scope: Worker returns 426 for non-WS requests, upgrades `/ws` and proxies the pair to `World` DO. DO echoes a `welcome` on open.

- [ ] Create `worker/wrangler.toml`:
  ```toml
  name = "blue-dot-world"
  main = "index.ts"
  compatibility_date = "2025-10-01"
  compatibility_flags = ["nodejs_compat"]

  [[durable_objects.bindings]]
  name = "WORLD"
  class_name = "World"

  [[migrations]]
  tag = "v1"
  new_sqlite_classes = ["World"]
  ```

- [ ] Create `worker/tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2022"],
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "strict": true,
      "skipLibCheck": true,
      "types": ["@cloudflare/workers-types"],
      "noEmit": true,
      "isolatedModules": true
    },
    "include": ["**/*.ts"]
  }
  ```

- [ ] `pnpm add -D @cloudflare/workers-types` (dev dep for typing).

- [ ] Create `worker/index.ts` with fetch handler that upgrades WS and forwards to DO (id derived from a fixed name `"world"`).

- [ ] Create `worker/world.ts` with DO class that accepts WebSocket pair, sends `{t:'welcome', you:{id}}`, and logs close.

- [ ] Add npm scripts: `worker:dev` (`wrangler dev --config worker/wrangler.toml --port 8787`), `worker:deploy` (`wrangler deploy --config worker/wrangler.toml`), `worker:typecheck` (`tsc -p worker`).

- [ ] Verify `pnpm run worker:typecheck` passes.

- [ ] Commit: `feat(worker): scaffold Worker + World DO with WebSocket echo`.

## Task 2: World DO — session state + authoritative pellets

- [ ] In `worker/world.ts`, expand `World` to:
  - Track `sessions: Map<id, Session>` and `pellets: Map<id, Pellet>`.
  - On connect: accept, assign short id, read `hello` for nickname/color, reply with `welcome` including current dots+pellets snapshot.
  - Spawn pellets to target `max(60, 30 * sqrt(n))` using uniform sphere sampling. 10% gold.
  - On disconnect: drop session, broadcast.

- [ ] Commit: `feat(worker): session + pellet state in World DO`.

## Task 3: World DO — movement broadcast + eat validation

- [ ] Handle `move` messages: update session lat/lon/h; clamp abusive rates (drop updates faster than 40 Hz).
- [ ] Handle `eat`: if pellet exists and claimant's great-circle distance ≤ `EAT_RADIUS` (shared constant), award `kind === 'gold' ? 3 : 1` and remove; respawn a new pellet to keep target. First-claim-wins.
- [ ] `setInterval`-style tick every 66 ms via `setTimeout` chain (DO alarm would be overkill here): send `tick` to all sessions with current dot positions, spawned pellets since last tick, removed pellet ids, and events buffered since last tick.
- [ ] Commit: `feat(worker): move broadcast + authoritative eat`.

## Task 4: World DO — bump-to-steal

- [ ] After processing `move`, check distance to every other session. If ≤ `BUMP_RADIUS` and both sessions past their `lastBumpMs + 2000`, transfer 1 pt from lower → higher. Push `{t:'bump', a, b}` event. Set both sessions' `lastBumpMs`.
- [ ] Commit: `feat(worker): bump-to-steal with 2s cooldown`.

## Task 5: Client net module

**Files:** `src/game/protocol.ts` (shared types), `src/game/net.ts`.

- [ ] `protocol.ts`: the message type unions from the design doc, shared by client and worker (worker imports via relative path).
- [ ] `net.ts`: `createNetClient({url, identity, onWelcome, onTick})` opens WS, sends `hello`, exposes `sendMove(lat, lon, h)` and `sendEat(id)` with rate limiting (≤ 25 Hz for move). Reconnect on close with backoff.
- [ ] Commit: `feat(client): net module + shared protocol types`.

## Task 6: Client — remote dots + server pellets

- [ ] `state.ts` grows a `remotes: Map<id, Remote>` with interpolation buffers (last two server positions per dot for smooth rendering).
- [ ] `Game.tsx`:
  - Start `createNetClient` on mount; drop `spawnPellet`/local pellet seeding.
  - Pellets are created/removed in response to server `spawned`/`removed`.
  - Remote dot meshes (one per remote session) updated each frame from interpolation buffer.
  - Eating → `sendEat(id)` on the wire, but also optimistically hide the pellet (server authoritative `removed` confirms).
  - Emit `sendMove` on local movement at ~20 Hz.
- [ ] Commit: `feat(client): render server pellets + remote dots`.

## Task 7: Live leaderboard HUD

- [ ] `Hud.tsx` gains a bottom-right leaderboard pane that shows up to top 5 sessions by score (data from `tick.dots`).
- [ ] Commit: `feat(hud): live top-5 online leaderboard`.

## Task 8: Local dev wiring + verification

- [ ] Add Vite proxy: `ws://localhost:5173/ws` → `ws://localhost:8787/ws` in `vite.config.ts`.
- [ ] `pnpm run dev` and `pnpm run worker:dev` in two terminals.
- [ ] Open two browser tabs → confirm both dots visible, eating is first-claim-wins, bumps transfer 1 pt, leaderboard updates.
- [ ] Commit (if polish tweaks): `chore: phase 2 polish`.

## Verification
- `pnpm run typecheck && pnpm run worker:typecheck && pnpm test:run` clean.
- `pnpm run worker:deploy` ships the worker on its own subdomain; live site (Pages) points WS URL at it via `import.meta.env.VITE_WS_URL`.
- Two-tab manual test as above.
