// SeatGeek taxonomy names -> our display segment.
export const SEATGEEK_TAXONOMIES = { concert: "Music", comedy: "Comedy" };

export async function fetchSeatGeek(clientId, regionId, region, taxonomyName, startDateTime, endDateTime) {
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
