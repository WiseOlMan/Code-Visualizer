import { listInquiries } from '../services/inquiryService.js';

/** HTTP entry for listing inquiries. */
export function GET(req, res) {
  return listInquiries(req, res);
}

export function POST(req, res) {
  res.status(404).end();
}
