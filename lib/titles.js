/** Title normalization/slug/scoring shared by the providers (port of the server's title-match). */

const STOPWORDS = { las: 1, los: 1, una: 1, uno: 1, del: 1, con: 1, que: 1, por: 1, para: 1, the: 1, and: 1, for: 1, from: 1, with: 1 };

function normalizeTitle(title) {
  let normalized = String(title || '').toLowerCase();
  try {
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    // normalize may be unavailable in embedded runtimes; raw lowercase still works
  }
  return normalized.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSlug(title, year) {
  let slug = String(title || '');
  try {
    slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch { /* keep raw */ }
  slug = slug.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return year ? slug + '-' + year : slug;
}

function wordCoverage(candidate, reference) {
  const words = reference.split(' ').filter(word => (word.length > 3 || /^\d+$/.test(word)) && !STOPWORDS[word]);
  if (words.length === 0) return 0;
  const tokens = candidate.split(' ');
  // Whole-token match, never substring: 'coco' must not match 'cocorico'.
  let matched = 0;
  for (const word of words) if (tokens.indexOf(word) !== -1) matched += 1;
  return matched / words.length;
}

function scoreCandidate(candidateTitle, tmdbTitle, originalTitle, year) {
  const normCandidate = normalizeTitle(candidateTitle);
  const normTmdb = normalizeTitle(tmdbTitle);
  const normOriginal = normalizeTitle(originalTitle || tmdbTitle);
  let score = 0;
  if (year !== null && year !== '' && normCandidate.indexOf(year) !== -1) score += 50;
  score += wordCoverage(normCandidate, normTmdb) * 30;
  score += wordCoverage(normCandidate, normOriginal) * 20;
  const sequel = normTmdb.match(/\b(\d+)\s*$/);
  if (sequel !== null && normCandidate.split(' ').indexOf(sequel[1]) === -1) score -= 100;
  const candidateYear = (normCandidate.match(/\b(19|20)\d{2}\b/) || [])[0];
  if (year !== null && year !== '' && candidateYear !== undefined && candidateYear !== year) score -= 60;
  return score;
}

module.exports = { normalizeTitle, buildSlug, scoreCandidate };
