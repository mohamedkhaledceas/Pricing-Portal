/* Suggests which portal client an Odoo customer probably is. Suggestions
   only — a person confirms every link (docs/adr/0013 §8), so this favours
   recall: a wrong suggestion costs one click to reject, a missed one means
   linking by hand.

   Two signals: the same normalized name, or the same real company domain
   (website host or email domain). Free-mail, social and link-shortener
   domains are ignored — many portal clients' "website" is an Instagram
   link and their email a gmail address, which identify nobody. */
const LEGAL_SUFFIXES = new Set([
  'llc', 'fze', 'fz', 'fzco', 'fzllc', 'sae', 'co', 'company', 'ltd', 'limited', 'inc', 'group', 'br',
]);

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'msn.com',
  'instagram.com', 'facebook.com', 'fb.com', 'linkedin.com', 'tiktok.com', 'x.com', 'twitter.com',
  'linktr.ee', 'tinyurl.com', 'bit.ly', 'wa.me', 'google.com', 'sites.google.com',
  // CEAS's own domain — staff addresses sometimes sit in a client's contact
  // field, which would otherwise "match" every Odoo record CEAS appears on.
  'theceas.com',
]);

function normalizeName(name) {
  const tokens = (name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\.com\b/g, '')
    // "L.L.C" -> "llc" before punctuation becomes spaces.
    .replace(/\b([a-z])\.(?=[a-z]\b)/g, '$1')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = tokens.filter((t) => !LEGAL_SUFFIXES.has(t));
  return (meaningful.length ? meaningful : tokens).join('');
}

function hostOf(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (raw.includes('@')) return raw.split('@').pop().replace(/[>\s].*$/, '') || null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(raw) ? raw : `http://${raw}`).hostname;
    return host.replace(/^www\./, '') || null;
  } catch (error) {
    // Not a parseable URL (free text in a website field) — no domain signal.
    return null;
  }
}

function domainsOf(...values) {
  return [...new Set(values.map(hostOf).filter((d) => d && d.includes('.') && !GENERIC_DOMAINS.has(d)))];
}

/* Returns, per partner id, the candidate clients and why. `rejected` is a
   Set of "clientId:partnerId" pairs a person already said are different. */
function buildSuggestions(partners, clients, rejected) {
  const byName = new Map();
  const byDomain = new Map();
  const add = (map, key, client) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(client);
  };
  for (const client of clients) {
    add(byName, normalizeName(client.name), client);
    for (const d of domainsOf(client.website, client.primaryContactEmail)) add(byDomain, d, client);
  }

  const result = new Map();
  for (const partner of partners) {
    const found = new Map();
    const note = (client, reason) => {
      if (rejected.has(`${client.id}:${partner.odooPartnerId}`)) return;
      const entry = found.get(client.id) || { clientId: client.id, name: client.name, reasons: [] };
      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
      found.set(client.id, entry);
    };
    for (const client of byName.get(normalizeName(partner.name)) || []) note(client, 'name');
    for (const d of domainsOf(partner.website, partner.email)) {
      for (const client of byDomain.get(d) || []) note(client, 'domain');
    }
    result.set(partner.odooPartnerId, [...found.values()]);
  }
  return result;
}

module.exports = { normalizeName, domainsOf, buildSuggestions };
