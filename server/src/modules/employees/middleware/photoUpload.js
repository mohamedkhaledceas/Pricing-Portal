const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { EmployeesError } = require('../errors');

// Served by index.js's catch-all `app.use(express.static(.../public))` —
// anything under server/public/ is already served at its own path with no
// extra mount needed (same as public/logo-*.png today).
const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', '..', 'public', 'uploads', 'employees');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

// Real image-type detection by magic bytes — the multer fileFilter below
// (client-declared Content-Type) and the original filename/extension are
// both trivially spoofable, so neither is trusted as the real check. This
// reads the actual bytes written to disk and compares against known
// signatures for the three formats this app accepts.
const SIGNATURES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

function detectImageSignature(buffer) {
  for (const sig of SIGNATURES) {
    if (buffer.length >= sig.bytes.length && sig.bytes.every((b, i) => buffer[i] === b)) return sig.mime;
  }
  // WebP: 'RIFF' at bytes 0-3, 'WEBP' at bytes 8-11 — not a fixed prefix,
  // so it doesn't fit the simple table above.
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// Filename is always server-generated (uuid), never the client-supplied
// original name, to rule out path traversal or overwriting another
// employee's file. Extension is picked from the declared MIME type here
// purely for a human-readable file on disk — verifyImageSignature below is
// what actually decides whether the upload is accepted.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${EXT_BY_MIME[file.mimetype] || ''}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new EmployeesError('Only JPEG, PNG, or WebP images are allowed.'));
    }
    cb(null, true);
  },
});

function verifyImageSignature(req, res, next) {
  if (!req.file) return next();
  const buffer = fs.readFileSync(req.file.path);
  if (!detectImageSignature(buffer)) {
    fs.unlinkSync(req.file.path);
    return next(new EmployeesError('The uploaded file is not a valid JPEG, PNG, or WebP image.'));
  }
  next();
}

// Best-effort cleanup for the file a photo_url is about to stop pointing
// at (on replace or removal) — swallows "already gone" and refuses to
// touch anything outside UPLOAD_DIR (photoUrl is trusted-ish app data, not
// direct user input, but this stays defensive rather than assume that).
function deleteStoredPhoto(photoUrl) {
  if (!photoUrl) return;
  const filename = path.basename(photoUrl);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (path.dirname(filePath) !== UPLOAD_DIR) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// TODO(security): this only rules out "not really an image" — it is NOT
// malware scanning. Wire in a real scan (ClamAV daemon via clamdscan, or a
// hosted scanning API) before this goes in front of real users; no local
// ClamAV and no scanning-API infra exists yet as of this endpoint's
// creation (see docs/security.md). Left as an explicit no-op pass-through,
// already in the middleware chain, so adding the real check later is a
// one-function change here rather than a new route/plumbing change.
function scanForMalware(req, res, next) {
  next();
}

module.exports = { upload, verifyImageSignature, scanForMalware, deleteStoredPhoto, UPLOAD_DIR };
