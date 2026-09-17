// Cloudflare Worker entry point. Serves the static app from /public (via the
// ASSETS binding) and handles /api/events itself as a server-side proxy to
// the Ticketmaster Discovery API and (optionally) the SeatGeek Platform API,
// so neither key ever reaches the client or the repo.

const REGIONS = {
  "south-bay": { label: "South Bay", lat: 37.3382, lon: -121.8863, radiusMiles: 15 },
  "peninsula": { label: "Peninsula", lat: 37.4419, lon: -122.1430, radiusMiles: 12 },
  "santa-cruz": { label: "Santa Cruz", lat: 36.9741, lon: -122.0308, radiusMiles: 10 },
};

const CLASSIFICATIONS = ["Music", "Arts & Theatre"];

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

async function fetchTicketmaster(apiKey, regionId, region, classificationName, startDateTime, endDateTime) {
  const params = new URLSearchParams({
    apikey: apiKey,
    latlong: `${region.lat},${region.lon}`,
    radius: String(region.radiusMiles),
    unit: "miles",
    startDateTime,
    endDateTime,
    classificationName,
    size: "50",
    sort: "date,asc",
  });
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`);
  if (!res.ok) {
    const err = new Error(`Ticketmaster request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const events = data?._embedded?.events || [];
  return events.map((e) => ({
    id: `tm-${e.id}`,
    name: e.name,
    date: e.dates?.start?.localDate || null,
    time: e.dates?.start?.localTime || null,
    venue: e._embedded?.venues?.[0]?.name || "Unknown venue",
    city: e._embedded?.venues?.[0]?.city?.name || "",
    url: e.url,
    segment: e.classifications?.[0]?.segment?.name || classificationName,
    regionId,
  }));
}

// SeatGeek taxonomy names -> our display segment.
const SEATGEEK_TAXONOMIES = { concert: "Music", comedy: "Comedy" };

async function fetchSeatGeek(clientId, regionId, region, taxonomyName, startDateTime, endDateTime) {
  const params = new URLSearchParams({
    client_id: clientId,
    lat: String(region.lat),
    lon: String(region.lon),
    range: `${region.radiusMiles}mi`,
    "datetime_local.gte": startDateTime,
    "datetime_local.lte": endDateTime,
    "taxonomies.name": taxonomyName,
    per_page: "50",
    sort: "datetime_local.asc",
  });
  const res = await fetch(`https://api.seatgeek.com/2/events?${params.toString()}`);
  if (!res.ok) {
    const err = new Error(`SeatGeek request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const events = data?.events || [];
  return events.map((e) => {
    const [date, time] = (e.datetime_local || "").split("T");
    return {
      id: `sg-${e.id}`,
      name: e.title || e.short_title,
      date: date || null,
      time: time ? time.slice(0, 5) : null,
      venue: e.venue?.name || "Unknown venue",
      city: e.venue?.city || "",
      url: e.url,
      segment: SEATGEEK_TAXONOMIES[taxonomyName] || taxonomyName,
      regionId,
    };
  });
}

async function handleEvents(request, env) {
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
      calls.push(
        fetchTicketmaster(apiKey, regionId, REGIONS[regionId], classificationName, startDateTime, endDateTime)
      );
    }
  }

  // SeatGeek is an optional second source — skip it silently if no client_id
  // is configured yet, rather than failing the whole request.
  const seatgeekClientId = env.SEATGEEK_CLIENT_ID;
  if (seatgeekClientId) {
    for (const regionId of validRegionIds) {
      for (const taxonomyName of Object.keys(SEATGEEK_TAXONOMIES)) {
        calls.push(
          fetchSeatGeek(seatgeekClientId, regionId, REGIONS[regionId], taxonomyName, startLocal, endLocal)
        );
      }
    }
  }

  const results = await Promise.allSettled(calls);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const failures = results.filter((r) => r.status === "rejected");

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

  const byId = new Map();
  for (const r of fulfilled) {
    for (const event of r.value) {
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
  }

  const events = Array.from(byId.values()).sort((a, b) => {
    const da = `${a.date || ""}${a.time || ""}`;
    const db = `${b.date || ""}${b.time || ""}`;
    return da.localeCompare(db);
  });

  return Response.json({ events });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/events") {
      return handleEvents(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
