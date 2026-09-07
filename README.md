# hubdash

A tiny, backend-free dashboard for tracking your own GitHub pull requests — and the versions they still need to be backported to.

There's no server. hubdash is a static single-page app that talks directly to the GitHub GraphQL API from your browser, using a personal access token you provide. Everything it knows about your PRs lives in `localStorage`.

**[Try it live →](https://dennisoelkers.github.io/hubdash/)** — hosted on GitHub Pages, deployed automatically from `main` (see [Deploying](#deploying)).

## What it does

**Pull Requests tab** — paste or drop a PR link and hubdash tracks it, sorting cards into three columns based on live status from GitHub:

- **Waiting** — open, nothing needed from you right now
- **Needs action** — failing CI, changes requested, or merge conflicts
- **Ready** — approved and green

Merged or closed PRs drop into a collapsed Archive section instead of cluttering the board — and each card now carries an Archive button too, for an open PR you've stopped caring about.

<img width="3840" height="1845" alt="image" src="https://github.com/user-attachments/assets/d1e66ec1-7d32-485f-88f6-70099bf32a89" />

**Backports tab** — track a "main" PR alongside every version it needs to land in. Each target version is a slot; drop the actual backport PR's link into a slot to fill it, and hubdash shows merge status per slot and rolls it up as "N of M landed". A group where everything has landed is marked green, with a button to archive it once you're done tracking it.

<img width="3817" height="1856" alt="image" src="https://github.com/user-attachments/assets/05f0ed4e-4b77-4173-8027-6c6f20d7332b" />

**Tasks tab** — track GitHub issues and pull requests as a single manually ordered list: drag a row to reorder it, and each one shows live status (waiting, needs action, ready, merged, or closed). Full GitHub URLs only — issues and PRs share one number sequence per repo, so `owner/repo#N` can't say which type it names. Finished rows go into a collapsed Archive section of their own.

Arrow keys move a selection around whichever tab is showing — the three columns on Pull Requests, the flat list on Backports and Tasks — and `a` archives whatever is selected. Manual archiving is new on Pull Requests and Tasks, joining the button Backports already had, and every tab's Archive button does the same thing as the key.

All three tabs poll GitHub every 15 seconds, share one request per unique item (so something tracked on more than one tab only costs one query), and are reachable at their own URLs (`/pulls`, `/backports`, `/tasks`) — bookmarkable, shareable, and wired up to the browser's back/forward buttons.

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

Every push to `main` builds the app and publishes it to GitHub Pages automatically (`.github/workflows/deploy.yml`) — no manual steps beyond enabling Pages once, under **Settings → Pages → Source → GitHub Actions**.

`npm run build` also works standalone and produces a static site in `dist/` that can be hosted anywhere that serves static files. Since `/pulls` and `/backports` are client-side routes, the host needs to serve `index.html` for unknown paths (an SPA fallback / rewrite rule) — GitHub Pages has no such rewrite capability, so this repo ships a small `public/404.html` that redirects a deep link back through `index.html` client-side instead (see the comments in `404.html` and `index.html` for how). A host with real rewrite support (Netlify, Vercel, S3 + CloudFront, etc.) doesn't need that trick — a plain fallback rule is enough.

If you deploy somewhere other than a GitHub Pages *project* site (i.e. not at `<user>.github.io/<repo>/`), pass the right `--base` to `vite build` for wherever the app is actually served from — `--base=/` for the domain root, which is also `main.tsx`'s default with no flag at all.

## Tech stack

React 19 + TypeScript (strict) + Vite 6, styled-components for styling, [wouter](https://github.com/molefrog/wouter) for routing, and Vitest + Testing Library for tests. No runtime dependency beyond those — no backend, no database, no build-time secrets.

## Design docs

The reasoning behind hubdash's features — data flow, storage format, edge cases considered — is written up in [`docs/superpowers/specs`](docs/superpowers/specs), with the implementation plans that built them in [`docs/superpowers/plans`](docs/superpowers/plans).

## License

[MIT](LICENSE)
