# Local Lineup

Find live music and comedy near the South Bay, Peninsula, and Santa Cruz on the dates you pick.

Live app: https://local-lineup.slamb4-mail.workers.dev

## What it does

Pick a date (or date range) and one or more regions, and the app searches Ticketmaster,
(if configured) SeatGeek, and two small venues directly (Kuumbwa Jazz Center and Moe's Alley —
see "Event sources" below) for matching shows. Below the results is a set of "browse more" links
to Bandsintown, Songkick, and a growing list of other small local venues (The Continental Bar,
The Caravan Lounge, San Jose Improv, Rooster T. Feathers, Cedar Room, Poor House Bistro, San
Pedro Square Market, Guild Theatre, Catalyst, The Ritz) that aren't wired into search results —
just outbound links to check manually for now.

Regions are approximated as a center point + radius, not exact city boundaries:

- **South Bay** — San Jose, Santa Clara, Sunnyvale, Campbell, Los Gatos, Mountain View
- **Peninsula** — Palo Alto, Redwood City, San Mateo, Menlo Park
- **Santa Cruz** — Santa Cruz, Capitola, Scotts Valley

## How it's built

Same zero-build spirit as [Tab Tally](https://github.com/slamb4mail-collab/tab-tally): the frontend
(`public/index.html`) is a single file with inline CSS/JS, no framework. It's served as static
assets from a Cloudflare Worker (`src/index.js`), which also handles one route itself —
`/api/events` — merging results from every configured source below into one list. No upstream
key ever has to live in the browser or in this repo.

```
local-lineup/
  wrangler.jsonc         # Worker config: entry point + static assets directory
  package.json           # just enough to pin the wrangler version Cloudflare's build uses
  src/
    index.js             # fetch handler + /api/events: call assembly, merge, dedupe, sort
    regions.js            # South Bay / Peninsula / Santa Cruz lat/lon + radius
    cache.js               # Workers Cache API wrapper used by the venue-specific sources
    normalize.js            # shared Music/Comedy classifier
    sources/
      ticketmaster.js        # Ticketmaster Discovery API (region-wide search)
      seatgeek.js             # SeatGeek Platform API (region-wide search, optional)
      tribeEvents.js           # Cedar Room + Kuumbwa Jazz Center — real per-venue JSON API
      ticketweb.js              # Moe's Alley — HTMLRewriter scrape of a stable plugin markup
  public/
    index.html
    manifest.json
    icon-192.png
    icon-512.png
```

### Event sources

| Source | Coverage | How | Key needed |
|---|---|---|---|
| Ticketmaster | All 3 regions | Live API search by lat/lon | `TICKETMASTER_API_KEY` (required) |
| SeatGeek | All 3 regions | Live API search by lat/lon | `SEATGEEK_CLIENT_ID` (optional — skipped if unset) |
| Kuumbwa Jazz Center | Santa Cruz | Real per-venue JSON API (WordPress "The Events Calendar" plugin) | none |
| Moe's Alley | Santa Cruz | Server-side scrape of the venue's own homepage via Cloudflare's `HTMLRewriter`, cached 6h | none |

**Cedar Room** also runs the same "The Events Calendar" plugin (same code path as Kuumbwa,
`tribeEvents.js`) but its site blocks the Worker's server-side requests — very likely
IP-reputation/bot-detection flagging Cloudflare Workers' datacenter traffic, since the exact
same URL works fine from a normal browser. We're not attempting to work around that; it just
fails gracefully (excluded from results, visible via `?debug=1`) and stays a "browse more" link
only until/unless that changes on their end.

The venue-specific sources (`tribeEvents.js`, `ticketweb.js`) cache their raw per-venue event
list using the Workers Cache API so a search only triggers a real upstream call/scrape once per
cache window, not once per user search — see the comments in `src/cache.js`. That cache is
per-Cloudflare-datacenter, not globally shared, which is a fine tradeoff at this app's traffic
level but worth knowing if event counts seem to lag slightly behind a venue's live site. Each
source has a `CACHE_VERSION` constant — bump it when you change that source's parsing logic so
the fix takes effect immediately instead of waiting out the old cached entries' TTL.

Nine other curated venues (The Continental Bar, The Caravan Lounge, San Jose Improv, Rooster T.
Feathers, Poor House Bistro, San Pedro Square Market, Guild Theatre, Catalyst, The Ritz) don't
expose a public API or a shared, easily-scraped plugin, so they remain "browse more" links only
for now — a future pass could add bespoke scrapers for these one at a time.

## Deploying

1. Push this repo to GitHub.
2. In the Cloudflare dashboard ([Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) → **Create application** → **Continue with GitHub**), connect this repo. Because it already has a `wrangler.jsonc`, Cloudflare deploys it as-is (no framework detection/build step needed) — just confirm the project name and select **Deploy**.
3. In that Worker's **Settings → Variables and Secrets**, add:
   - `TICKETMASTER_API_KEY` — a free key from [developer.ticketmaster.com](https://developer.ticketmaster.com/)
     (Discovery API, ~5 minute signup). Toggle **Encrypt** so it's stored as a secret.
   - `SEATGEEK_CLIENT_ID` *(optional)* — a free `client_id` from the
     [SeatGeek Platform](https://platform.seatgeek.com/) (requires creating a free developer
     account — their docs are behind a login now, but the classic `client_id` query-param API
     still works the same way). Adds a second live source; the app works fine without it.
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
SEATGEEK_CLIENT_ID=your-client-id-here
```

## Add to your phone's home screen

**Android (Chrome):** open the site, tap the **⋮** menu, then **Add to Home screen**.

**iPhone (Safari):** open the site, tap the **Share** icon, then **Add to Home Screen**.

Once added it launches full-screen like a regular app, using the icon and colors from
`manifest.json`.
