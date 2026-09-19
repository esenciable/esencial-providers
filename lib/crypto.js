/**
 * Pure-JS crypto for the device runtime: SHA-256, AES-256-CBC and AES-256-CTR over
 * Uint8Array. No Buffer, no node:crypto, no crypto-js - the whole point is that provider
 * bundles stay tiny (~30 KB instead of 250 KB) and dependency-free.
 *
 * Verified against node:crypto vectors in tools/crypto-selftest.mjs.
 */

/* ------------------------------------------------------------------ base64 / hex */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(value) {
  const clean = String(value).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    const n = (a << 18) | (b << 12) | ((c === -1 ? 0 : c) << 6) | (d === -1 ? 0 : d);
    out[o++] = (n >> 16) & 255;
    if (c !== -1) out[o++] = (n >> 8) & 255;
    if (d !== -1) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

function bytesToUtf8(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 0x80) out += String.fromCharCode(byte);
    else if (byte >= 0xc0 && byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 1;
    }
    else if (byte >= 0xe0 && byte < 0xf0) {
      out += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 2;
    }
    else {
      const code = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const offset = code - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      i += 3;
    }
  }
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out;
}

/* ------------------------------------------------------------------ SHA-256 */

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8ToBytes(value) {
  const out = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    }
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
        out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        continue;
      }
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

const SHA256_H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

function rotr(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** SHA-256 of a string or byte array; returns 32 bytes. */
function sha256(input) {
  const message = typeof input === 'string' ? utf8ToBytes(input) : input;
  const bitLength = message.length * 8;
  const padded = new Uint8Array((((message.length + 8) >> 6) + 1) << 6);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);

  const h = SHA256_H.slice();
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
  return out;
}

/* ------------------------------------------------------------------ AES */

const SBOX = new Uint8Array(256);
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

(function buildSbox() {
  let p = 1;
  let q = 1;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ ((p & 0x80) ? 0x1b : 0)) & 0xff;
    q ^= (q << 1) & 0xff;
    q ^= (q << 2) & 0xff;
    q ^= (q << 4) & 0xff;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    SBOX[p] = (q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4)) ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
})();

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

function xtime(value) {
  return ((value << 1) ^ ((value & 0x80) ? 0x1b : 0)) & 0xff;
}

function mul(a, b) {
  let result = 0;
  let left = a;
  let right = b;
  while (right > 0) {
    if (right & 1) result ^= left;
    left = xtime(left);
    right >>= 1;
  }
  return result & 0xff;
}

/** AES-256 key schedule: 60 round-key words (15 round keys). */
function expandKey(key) {
  if (key.length !== 32) throw new Error('AES-256 needs a 32-byte key');
  const words = new Uint32Array(60);
  const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
  for (let i = 0; i < 8; i++) words[i] = view.getUint32(i * 4, false);
  for (let i = 8; i < 60; i++) {
    let temp = words[i - 1];
    if (i % 8 === 0) {
      temp = ((temp << 8) | (temp >>> 24)) >>> 0;
      const b0 = SBOX[(temp >>> 24) & 0xff];
      const b1 = SBOX[(temp >>> 16) & 0xff];
      const b2 = SBOX[(temp >>> 8) & 0xff];
      const b3 = SBOX[temp & 0xff];
      temp = (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0) ^ (RCON[(i / 8) - 1] << 24);
    }
    else if (i % 8 === 4) {
      temp = ((SBOX[(temp >>> 24) & 0xff] << 24) | (SBOX[(temp >>> 16) & 0xff] << 16) | (SBOX[(temp >>> 8) & 0xff] << 8) | SBOX[temp & 0xff]) >>> 0;
    }
    words[i] = (words[i - 8] ^ temp) >>> 0;
  }
  return words;
}

function addRoundKey(state, words, round) {
  const view = new DataView(state.buffer, state.byteOffset, 16);
  for (let c = 0; c < 4; c++) {
    const word = words[round * 4 + c] >>> 0;
    const current = view.getUint32(c * 4, false) >>> 0;
    view.setUint32(c * 4, (current ^ word) >>> 0, false);
  }
}

function subBytes(state, box) {
  for (let i = 0; i < 16; i++) state[i] = box[state[i]];
}

function shiftRows(state) {
  // state is column-major: byte index = column*4 + row
  const copy = state.slice();
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      state[col * 4 + row] = copy[((col + row) % 4) * 4 + row];
    }
  }
}

function invShiftRows(state) {
  const copy = state.slice();
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      state[((col + row) % 4) * 4 + row] = copy[col * 4 + row];
    }
  }
}

function mixColumns(state) {
  for (let c = 0; c < 4; c++) {
    const a0 = state[c * 4], a1 = state[c * 4 + 1], a2 = state[c * 4 + 2], a3 = state[c * 4 + 3];
    state[c * 4] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
    state[c * 4 + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
    state[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
    state[c * 4 + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
  }
}

function invMixColumns(state) {
  for (let c = 0; c < 4; c++) {
    const a0 = state[c * 4], a1 = state[c * 4 + 1], a2 = state[c * 4 + 2], a3 = state[c * 4 + 3];
    state[c * 4] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
    state[c * 4 + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
    state[c * 4 + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
    state[c * 4 + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
  }
}

function encryptBlock(block, words) {
  const state = block.slice();
  addRoundKey(state, words, 0);
  for (let round = 1; round < 14; round++) {
    subBytes(state, SBOX);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, words, round);
  }
  subBytes(state, SBOX);
  shiftRows(state);
  addRoundKey(state, words, 14);
  return state;
}

function decryptBlock(block, words) {
  const state = block.slice();
  addRoundKey(state, words, 14);
  for (let round = 13; round > 0; round--) {
    invShiftRows(state);
    subBytes(state, INV_SBOX);
    addRoundKey(state, words, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  subBytes(state, INV_SBOX);
  addRoundKey(state, words, 0);
  return state;
}

/** AES-256-CBC decrypt with PKCS#7 padding; returns the UTF-8 string or null. */
function aesCbcDecrypt(ciphertext, key, iv) {
  try {
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return null;
    const words = expandKey(key);
    const out = new Uint8Array(ciphertext.length);
    let previous = iv;
    for (let offset = 0; offset < ciphertext.length; offset += 16) {
      const block = ciphertext.subarray(offset, offset + 16);
      const plain = decryptBlock(block, words);
      for (let i = 0; i < 16; i++) out[offset + i] = plain[i] ^ previous[i];
      previous = block;
    }
    const pad = out[out.length - 1];
    if (pad < 1 || pad > 16) return null;
    for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) return null;
    return bytesToUtf8(out.subarray(0, out.length - pad));
  } catch {
    return null;
  }
}

/** AES-256-CTR decrypt (counter starts at `start`); returns the UTF-8 string or null. */
function aesCtrDecrypt(ciphertext, key, iv, start) {
  try {
    if (ciphertext.length === 0) return null;
    const words = expandKey(key);
    const out = new Uint8Array(ciphertext.length);
    let counter = (start === undefined ? 2 : start) >>> 0;
    for (let offset = 0; offset < ciphertext.length; offset += 16) {
      const block = new Uint8Array(16);
      block.set(iv.subarray(0, 12));
      new DataView(block.buffer).setUint32(12, counter, false);
      const keystream = encryptBlock(block, words);
      const length = Math.min(16, ciphertext.length - offset);
      for (let i = 0; i < length; i++) out[offset + i] = ciphertext[offset + i] ^ keystream[i];
      counter = (counter + 1) >>> 0;
    }
    return bytesToUtf8(out);
  } catch {
    return null;
  }
}

module.exports = {
  base64ToBytes, bytesToUtf8, hexToBytes, bytesToHex, utf8ToBytes,
  sha256, expandKey, aesCbcDecrypt, aesCtrDecrypt,
};
