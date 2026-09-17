// Shared across all sources so every event lands in the same two display
// buckets the frontend's segmentClass() already knows how to style.
export function classifySegment(text) {
  return /comedy/i.test(text || "") ? "Comedy" : "Music";
}
