export const CLASSIFICATIONS = ["Music", "Arts & Theatre"];

export async function fetchTicketmaster(apiKey, regionId, region, classificationName, startDateTime, endDateTime) {
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
