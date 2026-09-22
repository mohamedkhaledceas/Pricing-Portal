const fs = require('fs');
const crypto = require('crypto');

/* CSP allow-lists an inline <script> block by the sha256 hash of its exact
   content, not by pattern - the browser recomputes the hash of whatever it
   actually received and compares. Computing hashes here at boot (from the
   real files on disk) instead of hand-copying hash strings into config
   means an edited script can never silently mismatch and get blocked in
   production - the hash always matches what's really being served. Only
   matches <script> tags with no src attribute (external scripts are
   allow-listed via 'self' instead). */
function inlineScriptHashes(htmlFilePath) {
  const html = fs.readFileSync(htmlFilePath, 'utf8');
  const scriptTagPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const hashes = [];
  let match;
  while ((match = scriptTagPattern.exec(html))) {
    const hash = crypto.createHash('sha256').update(match[1], 'utf8').digest('base64');
    hashes.push(`'sha256-${hash}'`);
  }
  return hashes;
}

module.exports = { inlineScriptHashes };
