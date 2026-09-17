/* Manual, one-off verification that RESEND_API_KEY/EMAIL_FROM are wired up
   correctly and a real send actually lands — same CLI-script precedent as
   create-user.js/seed-owner.js, not an HTTP route (a permanent
   authenticated "send an email" endpoint isn't worth the extra surface
   just for this one-time check). Delete this file once Forgot Password /
   Notifications give resendClient a real caller, if it's no longer useful
   as an ops sanity-check tool at that point. */
require('dotenv').config();
const { sendEmail } = require('./common/integrations/resendClient');

const [, , toArg] = process.argv;

if (!toArg) {
  console.error('Usage: node src/test-email.js <to-address>');
  process.exit(1);
}

sendEmail({
  to: toArg,
  subject: 'CEAS Portal — test email',
  html: '<p>This is a test email from the CEAS Portal\'s new Resend integration. If you received this, the email module is wired up correctly.</p>',
})
  .then((result) => {
    console.log(`Sent. Resend message id: ${result.id}`);
  })
  .catch((err) => {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  });
