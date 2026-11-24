import { matchingSearch } from './search.js';
import { deliverNotice } from './notify.js';

/** Loads inquiries, filters them, and queues follow-up. */
export function listInquiries(req, res) {
  const rows = matchingSearch(req.query || {});
  enqueueJob('lead-follow-up', { inquiryId: rows[0] && rows[0].id });
  prisma.inquiry.create({ data: { email: req.body.email, status: 'open' } });
  deliverNotice(rows[0] || {});
  return res.json(rows);
}

export function unusedHelper() {
  return null;
}
