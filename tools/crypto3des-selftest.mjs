/** Verifies lib/flat-crypto3des.js (MD5 + 3DES-EDE3-ECB) against node:crypto. */
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const flat = readFileSync('lib/flat-prelude.js', 'utf8') + '\n' + readFileSync('lib/flat-crypto3des.js', 'utf8');
const exportsBlock = '\nmodule.exports = { md5Hex, md5Bytes, magisEncryptBody, magisDecryptBlob, tripleDesEcb, flatHexToBytes, flatUtf8Bytes, flatBytesToBase64, flatBytesToAsciiHex };\n';
writeFileSync('/tmp/flat-libs.cjs', flat + exportsBlock);
const { md5Hex, magisEncryptBody, magisDecryptBlob, flatHexToBytes, flatUtf8Bytes, flatBytesToBase64 } = await import('/tmp/flat-libs.cjs');

let failures = 0;
const check = (label, actual, expected) => {
  const okay = actual === expected;
  if (!okay) { failures++; console.log(`❌ ${label}\n   esperado: ${expected}\n   obtenido: ${actual}`); }
  else console.log(`✅ ${label}`);
};

// --- MD5 ---
for (const text of ['', 'abc', 'password123cloudstream', 'x'.repeat(100)]) {
  check(`md5("${text.slice(0, 16)}")`, md5Hex(text), createHash('md5').update(text, 'utf8').digest('hex'));
}

// --- 3DES-EDE3-ECB con PKCS7 (ida y vuelta + comparación con node) ---
for (let i = 0; i < 3; i++) {
  const keyHex = randomBytes(24).toString('hex');
  const plain = JSON.stringify({ portalCode: 'masnew', userId: '123', pageNum: 1, value: i === 2 ? 'Coco' : 'x'.repeat(20 + i) });
  // node: base64(3DES(json))
  const cipher = createCipheriv('des-ede3-ecb', Buffer.from(keyHex, 'hex'), null);
  cipher.setAutoPadding(true);
  const nodeBase64 = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
  const nodeAsciiHex = Buffer.from(nodeBase64, 'ascii').toString('hex');
  check(`3DES encrypt #${i} (formato Magis)`, magisEncryptBody(plain, keyHex), nodeAsciiHex);
  check(`3DES decrypt #${i} (round-trip Magis)`, magisDecryptBlob(magisEncryptBody(plain, keyHex), keyHex), plain);
  // y decrypt de un blob producido por node
  check(`3DES decrypt #${i} (blob de node)`, magisDecryptBlob(nodeAsciiHex, keyHex), plain);
}

console.log(failures === 0 ? '\n🎉 MD5 + 3DES idénticos a node:crypto' : `\n💥 ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
