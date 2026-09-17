# Local Lineup

Find live music and comedy near the South Bay, Peninsula, and Santa Cruz on the dates you pick.

Live app: https://local-lineup.slamb4-mail.workers.dev

## What it does

Pick a date (or date range) and one or more regions, and the app searches Ticketmaster for
matching shows. Below the results is a set of "browse more" links to Bandsintown, Songkick,
and a handful of small local venues (Cafe Stritch, The Blank Club, Moe's Alley, Kuumbwa Jazz
Center, etc.) that don't show up on Ticketmaster.

Regions are approximated as a center point + radius, not exact city boundaries:

- **South Bay** — San Jose, Santa Clara, Sunnyvale, Campbell, Los Gatos, Mountain View
- **Peninsula** — Palo Alto, Redwood City, San Mateo, Menlo Park
- **Santa Cruz** — Santa Cruz, Capitola, Scotts Valley

## How it's built

Same zero-build spirit as [Tab Tally](https://github.com/slamb4mail-collab/tab-tally): the frontend
(`public/index.html`) is a single file with inline CSS/JS, no framework. It's served as static
assets from a Cloudflare Worker (`src/index.js`), which also handles one route itself —
`/api/events` — proxying requests to the Ticketmaster Discovery API so the API key never has to
live in the browser or in this repo.

```
local-lineup/
  wrangler.jsonc     # Worker config: entry point + static assets directory
  package.json       # just enough to pin the wrangler version Cloudflare's build uses
  src/index.js        # Worker: serves /public, handles /api/events itself
  public/
    index.html
    manifest.json
    icon-192.png
    icon-512.png
```

## Deploying

1. Push this repo to GitHub.
2. In the Cloudflare dashboard ([Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → **Create application** → **Continue with GitHub**), connect this repo. Because it already has a `wrangler.jsonc`, Cloudflare deploys it as-is (no framework detection/build step needed) — just confirm the project name and select **Deploy**.
3. In that Worker's **Settings → Variables and Secrets**, add:
   - `TICKETMASTER_API_KEY` — a free key from [developer.ticketmaster.com](https://developer.ticketmaster.com/)
     (Discovery API, ~5 minute signup). Toggle **Encrypt** so it's stored as a secret.
4. Redeploy once (secrets added after the first deploy need one more deploy to take effect).
5. Every push to `main` auto-deploys after that. The site is served from `https://local-lineup.<your-subdomain>.workers.dev`.

### Local development

```
npm install
npx wrangler dev
```

Create a `.dev.vars` file (already gitignored) in the project root with:

```
TICKETMASTER_API_KEY=your-key-here
```

## Add to your phone's home screen

**Android (Chrome):** open the site, tap the **⋮** menu, then **Add to Home screen**.

**iPhone (Safari):** open the site, tap the **Share** icon, then **Add to Home Screen**.

Once added it launches full-screen like a regular app, using the icon and colors from
`manifest.json`.
