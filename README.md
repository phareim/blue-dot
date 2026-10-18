# Blue

A fast arcade game on tiny planets. You are a comet. Loop your trail around the swarm to catch it, and paint the ground you enclose. Light up each world, then slingshot to the next. Light every world and the sun goes supernova. Plays on phones and desktop.

Live at https://blue.phareim.no. The design, its inspirations and a map of the code are in [docs/design.md](docs/design.md).

## Stack

- TypeScript, Three.js (WebGL 2), React for the HUD only, Vite, pnpm
- Sound is synthesised with Web Audio; there are no asset files
- No backend. The best score is kept in the browser's localStorage

## Commands

- `pnpm install`
- `pnpm dev`: dev server
- `pnpm build`: typecheck and production build to `dist/`
- `pnpm test:run`: geometry tests
- `node scripts/lab.mjs` / `node scripts/tour.mjs`: headless browser checks with stills (see docs/design.md, Checking it)

## Deployment

Push to `main`. `.github/workflows/deploy.yml` builds and deploys `dist/` to the Cloudflare Pages project `blue-dot`, which serves blue.phareim.no (custom domain verified 2026-10-18). The repo is public, so it deploys with GitHub Actions rather than Sleeper's deploy hook. The secrets are `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## The old multiplayer Worker

Until 2026-10-18, Blue was a multiplayer pellet collector on one globe. That game ran on a Cloudflare Worker with a Durable Object (`worker/`, deployed as `blue-dot-world`). The new game does not use it. The Worker is still deployed and its code is still in `worker/`. Nothing calls it now, so it can be retired with `wrangler delete --config worker/wrangler.toml` and `worker/` removed. That is Petter's decision to make.
