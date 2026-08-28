# hubdash

A tiny, backend-free dashboard for tracking your own GitHub pull requests — and the versions they still need to be backported to.

There's no server. hubdash is a static single-page app that talks directly to the GitHub GraphQL API from your browser, using a personal access token you provide. Everything it knows about your PRs lives in `localStorage`.

## What it does

**Board tab** — paste or drop a PR link and hubdash tracks it, sorting cards into three columns based on live status from GitHub:

- **Waiting** — open, nothing needed from you right now
- **Needs action** — failing CI, changes requested, or merge conflicts
- **Ready** — approved and green

Merged or closed PRs drop into a collapsed Archive section instead of cluttering the board.

**Backports tab** — track a "main" PR alongside every version it needs to land in. Each target version is a slot; drop the actual backport PR's link into a slot to fill it, and hubdash shows merge status per slot and rolls it up as "N of M landed". A group where everything has landed is marked green, with a button to archive it once you're done tracking it.

Both tabs poll GitHub every 15 seconds, share one request per unique PR (so a PR tracked on both tabs only costs one query), and are reachable at their own URLs (`/pulls`, `/backports`) — bookmarkable, shareable, and wired up to the browser's back/forward buttons.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- A [GitHub personal access token](https://github.com/settings/tokens) — no scopes needed for public repositories, the `repo` scope for private ones

## Install and run

```bash
git clone <this-repo-url>
cd hubdash
npm install
npm run dev
```

Open the URL Vite prints (`http://localhost:5173` by default). On first launch hubdash asks for a GitHub token — paste one in and save. It's stored only in your browser's `localStorage` and sent only to GitHub's own API; hubdash has no server of its own to send it to.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Typecheck, then build a production bundle into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Typecheck only (`tsc --noEmit`) |

## Deploying

`npm run build` produces a static site in `dist/` that can be hosted anywhere that serves static files (GitHub Pages, Netlify, S3, etc.). Since `/pulls` and `/backports` are client-side routes, the host needs to serve `index.html` for unknown paths (an SPA fallback / rewrite rule) — otherwise a direct load or refresh on `/backports` will 404.

## Tech stack

React 19 + TypeScript (strict) + Vite 6, styled-components for styling, [wouter](https://github.com/molefrog/wouter) for routing, and Vitest + Testing Library for tests. No runtime dependency beyond those — no backend, no database, no build-time secrets.

## Design docs

The reasoning behind hubdash's features — data flow, storage format, edge cases considered — is written up in [`docs/superpowers/specs`](docs/superpowers/specs), with the implementation plans that built them in [`docs/superpowers/plans`](docs/superpowers/plans).
