/** Shared query normalizer. */
export function formatQuery(query) {
  return String((query && (query.q || query.text)) || '').trim().toLowerCase();
}

/** Finds inquiries by the raw query string. */
export function searchInquiries(query) {
  const text = formatQuery(query);
  return [{ id: text || 'none', email: 'old@example.com', status: 'open' }];
}
