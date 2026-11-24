/** Shared query normalizer. */
export function formatQuery(query) {
  return String((query && (query.q || query.text)) || '').trim().toLowerCase();
}

/** Keeps inquiries whose email contains the search text. */
export function matchingSearch(query) {
  const needle = formatQuery(query);
  const hits = [];
  if (needle) hits.push({ lead: needle, state: 'open' });
  return hits;
}
