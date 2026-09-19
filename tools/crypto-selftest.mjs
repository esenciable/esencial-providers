/** Verifies lib/crypto.js against node:crypto: SHA-256, AES-256-CBC and AES-256-CTR. */
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sha256, aesCbcDecrypt, aesCtrDecrypt, base64ToBytes, bytesToHex } = require('../lib/crypto.js');

let failures = 0;
const check = (label, actual, expected) => {
  const okay = actual === expected;
  if (!okay) failures += 1;
  console.log(`${okay ? '✅' : '❌'} ${label}${okay ? '' : `\n   esperado: ${expected}\n   obtenido: ${actual}`}`);
};

// --- SHA-256 sobre textos variados ---
for (const text of ['', 'abc', 'challenge0salt', 'áéíóú ñ 中文 🎬', 'x'.repeat(1000)]) {
  check(`sha256("${text.slice(0, 18)}")`, bytesToHex(sha256(text)), createHash('sha256').update(text, 'utf8').digest('hex'));
}

// --- AES-256-CBC (descifrado, con PKCS#7) ---
for (let i = 0; i < 4; i++) {
  const key = randomBytes(32);
  const iv = randomBytes(16);
  const plaintext = i === 0 ? 'a'.repeat(15) : i === 1 ? 'x'.repeat(16) : `https://cdn.example.com/hls/master.m3u8?t=${i}`;
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  check(`aes-256-cbc #${i}`, aesCbcDecrypt(new Uint8Array(ciphertext), new Uint8Array(key), new Uint8Array(iv)), plaintext);
}

// --- AES-256-CTR (descifrado, contador en 2 como usa Byse) ---
for (let i = 0; i < 3; i++) {
  const key = randomBytes(32);
  const iv12 = randomBytes(12);
  const counter = Buffer.concat([iv12, Buffer.from([0, 0, 0, 2])]);
  const plaintext = JSON.stringify({ sources: [{ url: `https://cdn.example.com/seg${i}.m3u8`, label: '1080p' }] });
  const cipher = createCipheriv('aes-256-ctr', key, counter);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  check(`aes-256-ctr #${i}`, aesCtrDecrypt(new Uint8Array(ciphertext), new Uint8Array(key), new Uint8Array(iv12), 2), plaintext);
}

// --- base64 de la vida real (token de embed69) ---
const token = Buffer.from('https://vidhide.example.com/v/abc123').toString('base64');
check('base64ToBytes round-trip', Buffer.from(base64ToBytes(token)).toString('base64'), token);

console.log(failures === 0 ? '\n🎉 crypto pura OK — idéntica a node:crypto' : `\n💥 ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
