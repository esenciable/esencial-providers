/** Proof-of-work + AES-CBC token decrypt for the embed69-family backends
 * (embed69.org /f/, the sololatino gate, megade & entre /vidurl/).
 * Uses pure-JS crypto (lib/crypto.js): no crypto-js, no dependencies. */

const { sha256, bytesToHex, base64ToBytes, aesCbcDecrypt } = require('./crypto.js');

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
    if (bytesToHex(sha256(challenge + String(nonce))).indexOf(prefix) === 0) {
      return sha256(challenge + String(nonce) + salt);
    }
  }
  return null;
}

/** AES-256-CBC: raw = base64(token), iv = first 16 bytes, ciphertext = rest. */
function decryptAesToken(token, keyBytes) {
  try {
    if (!token || !keyBytes) return null;
    if (token.indexOf('http') === 0) return token;
    const raw = base64ToBytes(token);
    if (raw.length <= 16) return null;
    const plaintext = aesCbcDecrypt(raw.subarray(16), keyBytes, raw.subarray(0, 16));
    return plaintext !== null && /^https?:\/\//i.test(plaintext) ? plaintext : null;
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
      const link = decryptLink(embed.link, aesKey);
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

/** AES token when the PoW key was derived, else the legacy `{link}` base64 envelope. */
function decryptLink(token, aesKey) {
  if (token.indexOf('http') !== -1) return token;
  if (aesKey !== null && aesKey !== undefined) {
    const decrypted = decryptAesToken(token, aesKey);
    if (decrypted !== null) return decrypted;
  }
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const payload = String.fromCharCode.apply(null, base64ToBytes(parts[1]));
      const parsed = JSON.parse(payload);
      return typeof parsed.link === 'string' ? parsed.link : null;
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = { deriveAesKey, decryptAesToken, decryptLink, collectEmbedTasks };
