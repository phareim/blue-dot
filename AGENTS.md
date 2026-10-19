# Blue: notes for agents

Read `README.md` and `docs/design.md` first. The game is in `src/blue/`, the HUD in `src/ui/`.

## Working on it

- Tuning (speeds, scores, paint targets, enemy mix, boons) lives in `src/blue/config.ts`. Change numbers there, not in `game.ts`.
- `src/blue/geo.ts` does the sphere maths, and its tests guard the loop logic. Run `pnpm test:run` after touching it.
- Everything per-frame avoids allocation: module-level temp vectors (`tA`, `tB`, …), pooled particles, instanced enemies, one ribbon buffer per trail. Keep it that way. The target is a phone.
- Colours above 1.0 are deliberate: bloom picks up HDR values. When something looks washed out, lower its intensity before touching bloom.
- `window.blue` is the running `Game`. The lab scripts drive it through its fields; TypeScript's `private` does not hide them at runtime.

## Checking a change

- Sleeper has no GPU. Headless Chrome draws WebGL only with SwiftShader:
  `CHROME_BIN=<wrapper> heavy -x chrome -- node scripts/lab.mjs`. The wrapper runs Chrome for Testing with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. It is slow, so the scripts wait in game time.
- For look and frame rate, run the tour on the Mac: build, then `rsync -a --delete dist scripts mac:blue-lab/` and `ssh mac 'sh ~/blue-lab/scripts/mac-tour.sh desktop'` (or `phone`). Stills land in `mac:blue-lab/shots/`.
- Before a deploy, run a phone-sized lab with a real finger drag (`lab.mjs … phone`). The script swipes left with a negative touch id, rests the finger, and checks that the comet runs right: the finger spins the planet.
- No game run posts anything anywhere, so the scripts are safe against any server. They are written for a local preview (`npx vite preview --port 4173`).
