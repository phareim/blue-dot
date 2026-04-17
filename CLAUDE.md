# Blue Dot

React web app with a draggable blue dot (Pointer Events, works for mouse + touch + pen).

## Tech Stack

- TypeScript, React 18
- Vite
- pnpm

## Commands

- `pnpm install` — install dependencies
- `pnpm run dev` — start Vite dev server
- `pnpm run build` — type-check + production build
- `pnpm run typecheck` — type-check only
- `pnpm run deploy` — build and deploy to Cloudflare Pages (`blue-dot` project)

## Deployment

Cloudflare Pages project: `blue-dot` (live at https://blue-dot-1og.pages.dev/).
Pushes to `main` auto-deploy via `.github/workflows/deploy.yml`. The workflow
uses GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
