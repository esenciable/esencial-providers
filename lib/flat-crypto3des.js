/**
 * flat-crypto3des - DES / 3DES-EDE3-ECB and MD5 in pure JS, for the Magis portal wire format.
 * Only loaded by the providers that need it (keeps the others small).
 * Verified against node:crypto by tools/crypto-selftest.mjs.
 */

/* ------------------------------------------------------------------ MD5 */

var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

var MD5_K = (function () {
  var table = [];
  for (var i = 0; i < 64; i++) table.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
  return table;
})();

function md5Bytes(input) {
  var message = typeof input === 'string' ? flatUtf8Bytes(input) : input;
  var length = message.length;
  var padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(message);
  padded[length] = 0x80;
  var view = new DataView(padded.buffer);
  var bits = length * 8;
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 0x100000000), true);

  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (var offset = 0; offset < padded.length; offset += 64) {
    var m = [];
    for (var i = 0; i < 16; i++) m.push(view.getUint32(offset + i * 4, true));
    var a = a0, b = b0, c = c0, d = d0;
    for (var round = 0; round < 64; round++) {
      var f, g;
      if (round < 16) { f = (b & c) | (~b & d); g = round; }
      else if (round < 32) { f = (d & b) | (~d & c); g = (5 * round + 1) % 16; }
      else if (round < 48) { f = b ^ c ^ d; g = (3 * round + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * round) % 16; }
      f = (f + a + MD5_K[round] + m[g]) >>> 0;
      a = d; d = c; c = b;
      b = (b + (((f << MD5_S[round]) | (f >>> (32 - MD5_S[round]))) >>> 0)) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  var out = new Uint8Array(16);
  var outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

function md5Hex(value) {
  return flatHex(md5Bytes(value));
}

/* ------------------------------------------------------------------ DES (base de 3DES) */

var DES_IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
var DES_FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25];
var DES_E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1];
var DES_P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25];
var DES_PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4];
var DES_PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32];
var DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
var DES_SBOXES = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

/** Generic bit permutation over a byte array. `table` values are 1-based source bit
 * positions; the result is ceil(table.length/8) bytes. Pure byte arithmetic: no BigInt,
 * which Hermes (the TV engine) does not support. */
function desPermuteBits(source, table) {
  var out = new Uint8Array(Math.ceil(table.length / 8));
  for (var i = 0; i < table.length; i++) {
    var bitPosition = table[i] - 1;
    var bit = (source[bitPosition >> 3] >> (7 - (bitPosition & 7))) & 1;
    if (bit) out[i >> 3] |= 1 << (7 - (i & 7));
  }
  return out;
}

/** Reads `count` bits (max 28) starting at 0-based bit `start` as a Number. */
function desReadBits(source, start, count) {
  var value = 0;
  for (var i = 0; i < count; i++) {
    var bitPosition = start + i;
    var bit = (source[bitPosition >> 3] >> (7 - (bitPosition & 7))) & 1;
    value = (value << 1) | bit;
  }
  return value;
}

/** Writes `count` bits (max 28) of `value` into a byte array at 0-based bit `start`. */
function desWriteBits(target, start, count, value) {
  for (var i = 0; i < count; i++) {
    var bit = (value >> (count - 1 - i)) & 1;
    if (bit) {
      var bitPosition = start + i;
      target[bitPosition >> 3] |= 1 << (7 - (bitPosition & 7));
    }
  }
  return target;
}

function desRotateLeft28(value, shift) {
  return ((value << shift) | (value >>> (28 - shift))) & 0x0fffffff;
}

/** DES subkeys as 6-byte arrays (48 bits each) for the given 8-byte key. */
function desSubkeys(keyBytes) {
  var pc1 = desPermuteBits(keyBytes, DES_PC1);           // 56 bits = 7 bytes
  var c = desReadBits(pc1, 0, 28);
  var d = desReadBits(pc1, 28, 28);
  var subkeys = [];
  for (var round = 0; round < 16; round++) {
    var shift = DES_SHIFTS[round];
    c = desRotateLeft28(c, shift);
    d = desRotateLeft28(d, shift);
    var cd = new Uint8Array(7);
    desWriteBits(cd, 0, 28, c);
    desWriteBits(cd, 28, 28, d);
    subkeys.push(desPermuteBits(cd, DES_PC2));           // 48 bits = 6 bytes
  }
  return subkeys;
}

/** Feistel function over a 4-byte right half and a 6-byte subkey. */
function desFeistel(right, subkey) {
  var expanded = desPermuteBits(right, DES_E);           // 48 bits
  for (var i = 0; i < 6; i++) expanded[i] ^= subkey[i];
  var substituted = new Uint8Array(4);
  for (var box = 0; box < 8; box++) {
    var chunk = desReadBits(expanded, box * 6, 6);
    var row = ((chunk & 0x20) >> 4) | (chunk & 1);
    var col = (chunk >> 1) & 0x0f;
    var value = DES_SBOXES[box][row * 16 + col];
    substituted[box >> 1] |= value << ((box & 1) === 0 ? 4 : 0);
  }
  return desPermuteBits(substituted, DES_P);             // 32 bits
}

/** One 8-byte DES block, in place. */
function desBlock(block, subkeys, decrypt) {
  var permuted = desPermuteBits(block, DES_IP);
  var left = permuted.slice(0, 4);
  var right = permuted.slice(4, 8);
  for (var round = 0; round < 16; round++) {
    var subkey = subkeys[decrypt ? 15 - round : round];
    var f = desFeistel(right, subkey);
    var next = new Uint8Array(4);
    for (var i = 0; i < 4; i++) next[i] = left[i] ^ f[i];
    left = right;
    right = next;
  }
  // Pre-output is R16 || L16, then the final permutation.
  var preoutput = new Uint8Array(8);
  preoutput.set(right, 0);
  preoutput.set(left, 4);
  var out = desPermuteBits(preoutput, DES_FP);
  for (var j = 0; j < 8; j++) block[j] = out[j];
  return block;
}

function pkcs7Pad(bytes) {
  var pad = 8 - (bytes.length % 8);
  var out = new Uint8Array(bytes.length + pad);
  out.set(bytes);
  for (var i = bytes.length; i < out.length; i++) out[i] = pad;
  return out;
}

function pkcs7Unpad(bytes) {
  if (bytes.length === 0) return null;
  var pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 8 || pad > bytes.length) return null;
  for (var i = bytes.length - pad; i < bytes.length; i++) if (bytes[i] !== pad) return null;
  return bytes.subarray(0, bytes.length - pad);
}

/** 3DES-EDE3-ECB with PKCS#7 over a 24-byte key. */
function tripleDesEcb(bytes, keyBytes, decrypt) {
  var k1 = desSubkeys(keyBytes.subarray(0, 8));
  var k2 = desSubkeys(keyBytes.subarray(8, 16));
  var k3 = desSubkeys(keyBytes.subarray(16, 24));
  // Padding applies to the PLAINTEXT: pad before encrypting, unpad after decrypting
  // (never touch the ciphertext's trailing byte - that was a bug found by the self-test).
  var data = decrypt ? bytes : pkcs7Pad(bytes);
  if (data.length === 0 || data.length % 8 !== 0) return null;
  var out = new Uint8Array(data.length);
  for (var offset = 0; offset < data.length; offset += 8) {
    var block = data.subarray(offset, offset + 8);
    var step1 = desBlock(block.slice(), decrypt ? k3 : k1, decrypt);
    var step2 = desBlock(step1, k2, !decrypt);
    var step3 = desBlock(step2, decrypt ? k1 : k3, decrypt);
    out.set(step3, offset);
  }
  return decrypt ? pkcs7Unpad(out) : out;
}

/* ------------------------------------------------------------------ base64 encode + hex helpers */

function flatHexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function flatBytesToBase64(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += FLAT_B64[b0 >> 2];
    out += FLAT_B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? FLAT_B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? FLAT_B64[b2 & 63] : '=';
  }
  return out;
}

function flatBytesToAsciiHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out;
}

function flatAsciiHexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Magis wire: hex(base64(3DES-EDE3-ECB/PKCS7(json))) */
function magisEncryptBody(plain, keyHex) {
  var key = flatHexToBytes(keyHex);
  var encrypted = tripleDesEcb(flatUtf8Bytes(plain), key, false);
  return flatBytesToAsciiHex(flatUtf8Bytes(flatBytesToBase64(encrypted)));
}

/** Magis wire response: hex -> ascii(base64) -> 3DES decrypt -> json string */
function magisDecryptBlob(wire, keyHex) {
  var key = flatHexToBytes(keyHex);
  var base64Ascii = flatBytesToUtf8(flatAsciiHexToBytes(wire));
  var decrypted = tripleDesEcb(flatB64ToBytes(base64Ascii), key, true);
  return decrypted === null ? null : flatBytesToUtf8(decrypted);
}
