// Thin wrapper around the Workers Cache API. Each venue-scoped source (Tribe
// Events, TicketWeb) caches its own wide-window event list here so a user's
// search only ever triggers a fresh upstream call/scrape once per TTL,
// regardless of how many different date ranges get searched in that window.
//
// Only successful fetches are cached — a failure propagates to the caller
// (and from there into Promise.allSettled) instead of being cached, so a
// transient outage doesn't get "stuck" empty for the full TTL.
const CACHE_KEY_ORIGIN = "https://cache.local-lineup.internal";

export async function cachedFetch(ctx, cacheKeyName, ttlSeconds, fetcherFn) {
  const cache = caches.default;
  const cacheKey = new Request(`${CACHE_KEY_ORIGIN}/${cacheKeyName}`);

  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached.json();
  }

  const data = await fetcherFn();

  const response = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${ttlSeconds}`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response));

  return data;
}
