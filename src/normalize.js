// Shared across all sources so every event lands in the same two display
// buckets the frontend's segmentClass() already knows how to style.
export function classifySegment(text) {
  return /comedy/i.test(text || "") ? "Comedy" : "Music";
}

// WordPress-backed sources (the Tribe Events REST API, and raw scraped HTML
// via HTMLRewriter — which is a streaming transformer, not a DOM, so it never
// decodes entities on its own) can hand back literal "&#039;"/"&amp;" style
// entities instead of the real characters. Decode before display.
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(text) {
  return (text || "").replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const codePoint = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    const key = code.toLowerCase();
    return key in NAMED_ENTITIES ? NAMED_ENTITIES[key] : match;
  });
}
