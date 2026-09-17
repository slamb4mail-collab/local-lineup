// Venues with no public API but running the TicketWeb "event-discovery"
// WordPress plugin have stable, semantic CSS classes we can parse with
// Cloudflare's built-in streaming HTML parser (HTMLRewriter) instead of a
// fragile regex or an npm HTML-parsing dependency. Confirmed live against
// moesalley.com — a future venue on the same plugin is just one more entry
// in this list, no new parsing code.
import { classifySegment } from "../normalize.js";
import { cachedFetch } from "../cache.js";

export const TICKETWEB_VENUES = [
  { id: "moes-alley", name: "Moe's Alley", pageUrl: "https://moesalley.com/", regionId: "santa-cruz", city: "Santa Cruz" },
];

const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours — be polite to a small venue's own site.

// "Wed Sep, 16 2026" + "8:00 PM" -> { date: "2026-09-16", time: "20:00" }
function parseEventDateTime(dateText, timeText) {
  const cleaned = dateText.replace(/^[A-Za-z]+\s+/, "").replace(",", "");
  const dt = timeText ? new Date(`${cleaned} ${timeText}`) : new Date(cleaned);
  if (isNaN(dt.getTime())) return { date: null, time: null };
  const date = dt.toISOString().slice(0, 10);
  const time = timeText
    ? `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`
    : null;
  return { date, time };
}

function slugify(...parts) {
  return parts.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function scrapeVenue(venue) {
  const res = await fetch(venue.pageUrl);
  if (!res.ok) {
    const err = new Error(`TicketWeb scrape failed for ${venue.id} (${res.status})`);
    err.status = res.status;
    throw err;
  }

  const records = [];
  let current = null;
  let buf = "";

  const flush = (field) => {
    if (current) current[field] = (current[field] || "") + buf;
    buf = "";
  };

  const rewriter = new HTMLRewriter()
    .on(".tw-section", {
      element() {
        current = { name: "", url: "", dateText: "", doorTimeText: "", showTimeText: "" };
        records.push(current);
      },
    })
    .on(".tw-name a", {
      element(el) {
        if (current && !current.url) current.url = el.getAttribute("href") || "";
      },
      text(t) {
        buf += t.text;
        if (t.lastInTextNode) flush("name");
      },
    })
    .on(".tw-event-date", {
      text(t) {
        buf += t.text;
        if (t.lastInTextNode) flush("dateText");
      },
    })
    .on(".tw-event-door-time", {
      text(t) {
        buf += t.text;
        if (t.lastInTextNode) flush("doorTimeText");
      },
    })
    .on(".tw-event-time", {
      text(t) {
        buf += t.text;
        if (t.lastInTextNode) flush("showTimeText");
      },
    });

  await rewriter.transform(res).arrayBuffer();

  if (records.length === 0) {
    console.log(
      JSON.stringify({ level: "warn", source: "ticketweb", venue: venue.id, msg: "zero events parsed — selectors may be stale" })
    );
  }

  return records
    .map((r, i) => {
      const name = r.name.trim();
      const showTime = r.showTimeText.replace(/^\s*\/\s*Show:\s*/i, "").trim();
      const doorTime = r.doorTimeText.trim();
      const { date, time } = parseEventDateTime(r.dateText.trim(), showTime || doorTime);
      return {
        id: `ticketweb-${venue.id}-${slugify(name, date || "", time || "") || i}`,
        name,
        date,
        time,
        venue: venue.name,
        city: venue.city,
        url: r.url,
        segment: classifySegment(name),
        regionId: venue.regionId,
      };
    })
    .filter((e) => e.name && e.date);
}

export async function fetchTicketWebVenue(venue, ctx, startDate, endDate) {
  const all = await cachedFetch(ctx, `ticketweb-${venue.id}`, CACHE_TTL_SECONDS, () => scrapeVenue(venue));
  return all.filter((e) => e.date && e.date >= startDate && e.date <= endDate);
}
