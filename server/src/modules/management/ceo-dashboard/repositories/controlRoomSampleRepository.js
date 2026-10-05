/* The CEO Control Room's design-review data — the `D` object from the
   ceas-control-room.html prototype (supplied 2026-10-05), lifted verbatim
   into data/controlRoomSample.json. Every figure, client name and decision
   in it is invented. It stays the page's only source until phase 2 swaps
   blocks over to Odoo/ClickUp; the frontend labels the page as sample data
   for as long as this is what it serves.

   Read once at boot: the file is static and the object is never mutated
   server-side (the page edits its own in-memory copy). */
const fs = require('fs');
const path = require('path');

const SAMPLE_PATH = path.join(__dirname, 'data', 'controlRoomSample.json');

function createControlRoomSampleRepository() {
  const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));

  function getSample() {
    return sample;
  }

  return { getSample };
}

module.exports = createControlRoomSampleRepository;
