/** Proof-of-work + AES-CBC token decrypt for the embed69-family backends
 * (embed69.org /f/, sololatino gate, megade & entre /vidurl/). Uses crypto-js,
 * which the Nuvio runtime provides and esencial-providers bundles for tests. */

const CryptoJS = require('crypto-js');

/** SHA256(challenge+nonce) hex must start with `difficulty` zeros; the AES key
 * is SHA256(challenge+nonce+salt). Mirrors the provider's 500k nonce budget. */
function deriveAesKey(html, maxNonce) {
  const challenge = (html.match(/POW_CHALLENGE\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  const difficulty = (html.match(/POW_DIFFICULTY\s*=\s*(\d+)/) || [])[1];
  const salt = (html.match(/POW_SALT\s*=\s*['"]([^'"]+)['"]/) || [])[1];
  if (challenge === undefined || difficulty === undefined || salt === undefined) return null;
  const prefix = new Array(parseInt(difficulty, 10) + 1).join('0');
  const budget = maxNonce || 500000;
  for (let nonce = 0; nonce <= budget; nonce++) {
    if (CryptoJS.SHA256(challenge + String(nonce)).toString().indexOf(prefix) === 0) {
      return CryptoJS.SHA256(challenge + String(nonce) + salt);
    }
  }
  return null;
}

/** AES-256-CBC: raw = base64(token), iv = first 16 bytes, ciphertext = rest.
 * Returns the plaintext URL when it looks like http(s), else null. */
function decryptAesToken(token, keyWordArray) {
  try {
    if (!token || !keyWordArray || token.indexOf('http') !== -1) return token.indexOf('http') === 0 ? token : null;
    const raw = CryptoJS.enc.Base64.parse(token);
    if (!raw || raw.sigBytes <= 16) return null;
    const iv = CryptoJS.lib.WordArray.create(raw.words.slice(0, 4), 16);
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.lib.WordArray.create(raw.words.slice(4), raw.sigBytes - 16) }),
      keyWordArray,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
    );
    const out = decrypted.toString(CryptoJS.enc.Utf8);
    return out && /^https?:\/\//i.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** Collect player embeds from a dataLink payload: language filter, token/base64
 * decryption, download-link exclusion, dedupe. */
function collectEmbedTasks(items, aesKey) {
  const LANG_LABELS = { LAT: 'Latino', ESP: 'Castellano', SUB: 'Subtitulado' };
  const tasks = [];
  const seen = {};
  for (const item of items) {
    const language = String((item.video_language || '')).toUpperCase();
    if (LANG_LABELS[language] === undefined) continue;
    const lang = LANG_LABELS[language];
    const embeds = Array.isArray(item.sortedEmbeds) ? item.sortedEmbeds : [];
    for (const embed of embeds) {
      if (!embed.link) continue;
      let link = decryptLink(embed.link, aesKey);
      if (link === null || !/^https?:\/\//i.test(link)) continue;
      const lower = link.toLowerCase();
      const serverName = String(embed.servername || '').toLowerCase();
      const isDownload = serverName.indexOf('download') !== -1 || serverName.indexOf('direct') !== -1 || serverName.indexOf('descarga') !== -1
        || lower.indexOf('/d/') !== -1 || lower.indexOf('/download/') !== -1 || lower.indexOf('/get/') !== -1
        || lower.indexOf('mediafire.com') !== -1 || lower.indexOf('mega.nz') !== -1 || lower.indexOf('embed69.org/d/') !== -1 || lower.indexOf('gdrive') !== -1;
      if (isDownload || seen[link]) continue;
      seen[link] = true;
      tasks.push({ url: link, hint: serverName, lang, server: embed.servername || 'Servidor' });
    }
  }
  return tasks;
}

function decryptLink(token, aesKey) {
  if (token.indexOf('http') !== -1) return token;
  if (aesKey !== null && aesKey !== undefined) {
    const decrypted = decryptAesToken(token, aesKey);
    if (decrypted !== null) return decrypted;
  }
  const parts = token.split('.');
  if (parts.length === 3) {
    const payload = (function (value) {
      try { return atobSafe(value); } catch { return null; }
    })(parts[1]);
    if (payload !== null) {
      try {
        const parsed = JSON.parse(payload);
        return typeof parsed.link === 'string' ? parsed.link : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function atobSafe(value) {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = String(value).replace(/[^A-Za-z0-9+/]/g, '');
    let result = '';
    for (let i = 0; i < clean.length;) {
      const a = chars.indexOf(clean[i++]);
      const b = chars.indexOf(clean[i++]);
      const c = i < clean.length ? chars.indexOf(clean[i++]) : -1;
      const d = i < clean.length ? chars.indexOf(clean[i++]) : -1;
      const n = (a << 18) | (b << 12) | ((c === -1 ? 0 : c) << 6) | (d === -1 ? 0 : d);
      result += String.fromCharCode((n >> 16) & 255);
      if (c !== -1) result += String.fromCharCode((n >> 8) & 255);
      if (d !== -1) result += String.fromCharCode(n & 255);
    }
    return result;
  } catch {
    return null;
  }
}

module.exports = { deriveAesKey, decryptAesToken, decryptLink, collectEmbedTasks };
