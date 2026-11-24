/** Sends the inquiry notice email. */
export function deliverNotice(row) {
  const email = row.email || '';
  const body = row.body || 'inquiry update';
  return mail.send(email, body);
}

/** Old mail path this PR removes. */
export function sendLegacyNotice(row) {
  const email = row.email || '';
  return mail.send(email, 'legacy inquiry notice');
}
