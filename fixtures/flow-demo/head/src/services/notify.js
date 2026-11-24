/** Sends the inquiry notice email. */
export function deliverNotice(row) {
  const email = row.email || '';
  const body = row.body || 'inquiry update';
  return mail.send(email, body);
}
