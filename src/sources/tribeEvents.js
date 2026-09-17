// Venues running the WordPress "The Events Calendar" plugin expose a real
// public JSON API — no auth, no scraping. Adding a future venue on the same
// plugin is just one more entry in this list.
import { classifySegment, decodeEntities } from "../normalize.js";
import { cachedFetch } from "../cache.js";

export const TRIBE_EVENTS_VENUES = [
  { id: "cedar-room", name: "Cedar Room", baseUrl: "https://cedarroomlive.com", regionId: "south-bay", city: "Campbell" },
  { id: "kuumbwa", name: "Kuumbwa Jazz Center", baseUrl: "https://kuumbwajazz.org", regionId: "santa-cruz", city: "Santa Cruz" },
];

const CACHE_TTL_SECONDS = 2 * 60 * 60; // 2 hours — a real API, cheap to re-poll.
const WINDOW_DAYS = 90;
// Bump when fetchRaw()'s parsing/normalization logic changes, so a fix takes
// effect immediately instead of waiting out the old cache entry's TTL.
const CACHE_VERSION = "v2";

function wideWindow() {
  const iso = (d) => d.toISOString().slice(0, 10);
  const start = new Date();
  const end = new Date(start.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { start: iso(start), end: iso(end) };
}

async function fetchRaw(venue) {
  const { start, end } = wideWindow();
  const params = new URLSearchParams({ start_date: start, end_date: end, per_page: "50" });
  const res = await fetch(`${venue.baseUrl}/wp-json/tribe/events/v1/events?${params.toString()}`, {
    headers: {
      "User-Agent": "LocalLineupBot/1.0 (+https://local-lineup.slamb4-mail.workers.dev; personal hobby app, low volume, cached)",
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const err = new Error(`Tribe Events request failed for ${venue.id} (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const events = data?.events || [];
  return events.map((e) => {
    const [date, time] = (e.start_date || "").split(" ");
    const categoryText = (e.categories || []).map((c) => c.name).join(" ");
    return {
      id: `tribe-${venue.id}-${e.id}`,
      name: decodeEntities(e.title),
      date: date || null,
      time: time ? time.slice(0, 5) : null,
      venue: e.venue?.venue || venue.name,
      city: e.venue?.city || venue.city,
      url: e.url,
      segment: classifySegment(categoryText),
      regionId: venue.regionId,
    };
  });
}

export async function fetchTribeEventsVenue(venue, ctx, startDate, endDate) {
  const all = await cachedFetch(ctx, `tribe-${venue.id}-${CACHE_VERSION}`, CACHE_TTL_SECONDS, () => fetchRaw(venue));
  return all.filter((e) => e.date && e.date >= startDate && e.date <= endDate);
}
