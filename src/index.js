// Cloudflare Worker entry point. Serves the static app from /public (via the
// ASSETS binding) and handles /api/events itself as a server-side proxy that
// merges results from several event sources, so no upstream key/scrape ever
// reaches the client or the repo.
import { REGIONS } from "./regions.js";
import { CLASSIFICATIONS, fetchTicketmaster } from "./sources/ticketmaster.js";
import { SEATGEEK_TAXONOMIES, fetchSeatGeek } from "./sources/seatgeek.js";
import { TRIBE_EVENTS_VENUES, fetchTribeEventsVenue } from "./sources/tribeEvents.js";
import { TICKETWEB_VENUES, fetchTicketWebVenue } from "./sources/ticketweb.js";

// Approximates Pacific local-day boundaries in UTC using a fixed -8h offset
// (no timezone library available in the Workers runtime). Good enough for a
// hobby tool; events right at a midnight boundary may occasionally land on
// the adjacent day during PDT.
function toUtcBoundary(dateStr, endOfDay) {
  const time = endOfDay ? "23:59:59" : "00:00:00";
  const local = new Date(`${dateStr}T${time}-08:00`);
  return local.toISOString().replace(/\.\d+Z$/, "Z");
}

// SeatGeek's datetime_local filters are literally local to each venue, so no
// UTC conversion is needed (unlike Ticketmaster above) — just a plain boundary.
function toLocalBoundary(dateStr, endOfDay) {
  return `${dateStr}T${endOfDay ? "23:59:59" : "00:00:00"}`;
}

async function handleEvents(request, env, ctx) {
  const apiKey = env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "server_not_configured", message: "TICKETMASTER_API_KEY is not set on this deployment." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const regionIds = (url.searchParams.get("regions") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate") || startDate;
  const debug = url.searchParams.get("debug") === "1";

  if (regionIds.length === 0 || !startDate) {
    return Response.json(
      { error: "bad_request", message: "regions and startDate are required." },
      { status: 400 }
    );
  }

  const validRegionIds = regionIds.filter((id) => REGIONS[id]);
  if (validRegionIds.length === 0) {
    return Response.json({ error: "bad_request", message: "No valid region ids." }, { status: 400 });
  }

  const startDateTime = toUtcBoundary(startDate, false);
  const endDateTime = toUtcBoundary(endDate, true);
  const startLocal = toLocalBoundary(startDate, false);
  const endLocal = toLocalBoundary(endDate, true);

  const calls = [];

  for (const regionId of validRegionIds) {
    for (const classificationName of CLASSIFICATIONS) {
      calls.push({
        meta: { source: "ticketmaster", venueId: regionId },
        promise: fetchTicketmaster(apiKey, regionId, REGIONS[regionId], classificationName, startDateTime, endDateTime),
      });
    }
  }

  // SeatGeek is an optional second source — skip it silently if no client_id
  // is configured yet, rather than failing the whole request.
  const seatgeekClientId = env.SEATGEEK_CLIENT_ID;
  if (seatgeekClientId) {
    for (const regionId of validRegionIds) {
      for (const taxonomyName of Object.keys(SEATGEEK_TAXONOMIES)) {
        calls.push({
          meta: { source: "seatgeek", venueId: regionId },
          promise: fetchSeatGeek(seatgeekClientId, regionId, REGIONS[regionId], taxonomyName, startLocal, endLocal),
        });
      }
    }
  }

  // Fixed-location venues (not lat/lon region searches) — only fetch a venue
  // when its region is among the ones requested.
  for (const venue of TRIBE_EVENTS_VENUES) {
    if (!validRegionIds.includes(venue.regionId)) continue;
    calls.push({
      meta: { source: "tribeEvents", venueId: venue.id },
      promise: fetchTribeEventsVenue(venue, ctx, startDate, endDate),
    });
  }

  for (const venue of TICKETWEB_VENUES) {
    if (!validRegionIds.includes(venue.regionId)) continue;
    calls.push({
      meta: { source: "ticketweb", venueId: venue.id },
      promise: fetchTicketWebVenue(venue, ctx, startDate, endDate),
    });
  }

  const results = await Promise.allSettled(calls.map((c) => c.promise));

  const fulfilled = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") fulfilled.push(r);
    else failures.push({ ...calls[i].meta, reason: r.reason });
  });

  if (fulfilled.length === 0 && failures.length > 0) {
    const authFailure = failures.find((f) => f.reason?.status === 401 || f.reason?.status === 403);
    if (authFailure) {
      return Response.json(
        { error: "upstream_auth", message: "An upstream API key was rejected." },
        { status: 502 }
      );
    }
    const rateLimited = failures.find((f) => f.reason?.status === 429);
    if (rateLimited) {
      return Response.json(
        { error: "upstream_rate_limited", message: "Rate limit hit, try again shortly." },
        { status: 429 }
      );
    }
    return Response.json(
      { error: "upstream_error", message: "Couldn't reach event sources right now." },
      { status: 502 }
    );
  }

  // Some venues (e.g. Moe's Alley) sell tickets through a platform that's
  // also indexed by Ticketmaster directly, so the same real show can arrive
  // from two sources with different ids. Id-based dedup alone won't catch
  // that, so also collapse by a normalized venue+date+time signature.
  const signatureOf = (e) => `${(e.venue || "").toLowerCase().replace(/[^a-z0-9]/g, "")}|${e.date || ""}|${e.time || ""}`;

  const byId = new Map();
  const seenSignatures = new Set();
  for (const r of fulfilled) {
    for (const event of r.value) {
      if (byId.has(event.id)) continue;
      const signature = signatureOf(event);
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);
      byId.set(event.id, event);
    }
  }

  const events = Array.from(byId.values()).sort((a, b) => {
    const da = `${a.date || ""}${a.time || ""}`;
    const db = `${b.date || ""}${b.time || ""}`;
    return da.localeCompare(db);
  });

  const body = { events };
  if (debug) {
    body.sourcesFailed = failures.map((f) => ({
      source: f.source,
      venueId: f.venueId,
      message: f.reason?.message || String(f.reason),
    }));
  }

  return Response.json(body);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/events") {
      return handleEvents(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
