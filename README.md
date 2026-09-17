# Local Lineup

Find live music and comedy near the South Bay, Peninsula, and Santa Cruz on the dates you pick.

Live app: _add the `*.pages.dev` URL here once deployed_

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

Same zero-build pattern as [Tab Tally](https://github.com/slamb4mail-collab/tab-tally): a single
`index.html` with inline CSS/JS, no framework, no npm. The one addition is a small serverless
function (`functions/api/events.js`) that runs on Cloudflare Pages and proxies requests to the
Ticketmaster Discovery API, so the API key never has to live in the browser or in this repo.

## Deploying

1. Push this repo to GitHub.
2. In the Cloudflare dashboard, create a Pages project connected to this repo. Framework preset:
   **None**. Build command: none. Output directory: `/`.
3. In that Pages project's **Settings → Environment variables**, add a secret:
   - `TICKETMASTER_API_KEY` — a free key from [developer.ticketmaster.com](https://developer.ticketmaster.com/)
     (Discovery API, ~5 minute signup).
4. Every push to `main` auto-deploys. The site is served from `https://<project>.pages.dev`.

### Local development

```
npx wrangler pages dev .
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
