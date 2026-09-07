/* Generic ClickUp webhook signature verification — HMAC-SHA256 over the
   exact raw request bytes with the secret returned when a webhook was
   registered. Promoted out of commercial-leads/controllers/webhookController.js
   once the employees module's KPI webhook needed the identical logic —
   this has zero commercial-leads-specific behavior, so duplicating it a
   second time would have been pure drift risk, the same reasoning
   utils/cairoQuarter.js's own promotion comment already documents. */
const crypto = require('crypto');

function verifyClickupSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const signatureBuf = Buffer.from(signatureHeader, 'hex');
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

module.exports = { verifyClickupSignature };
