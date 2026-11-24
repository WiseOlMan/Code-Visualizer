import { searchInquiries } from './search.js';
import { deliverNotice, sendLegacyNotice } from './legacyNotify.js';

/** Loads inquiries and notifies the legacy mailer. */
export function listInquiries(req, res) {
  const rows = searchInquiries(req.query || {});
  deliverNotice(rows[0] || {});
  sendLegacyNotice(rows[0] || {});
  return res.json(rows);
}

export function unusedHelper() {
  return null;
}
