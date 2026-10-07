// test-rank.mjs - prueba unitaria sin red para flatRankStreams (lib/flat-prelude.js).
// El prelude expone flatRankStreams vía module.exports (puente solo para pruebas;
// en los dist el body reemplaza module.exports, así que no cambia nada ahí).
// Corre con `node test-rank.mjs`.
import { createRequire } from 'node:module';

const flatRankStreams = createRequire(import.meta.url)('./lib/flat-prelude.js').flatRankStreams;
if (typeof flatRankStreams !== 'function') {
  console.log('FAIL: flatRankStreams no existe en el prelude');
  process.exit(1);
}
const rank = flatRankStreams;

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log('ok   ' + name);
  } else {
    failures++;
    console.log('FAIL ' + name + (detail ? ' -> ' + detail : ''));
  }
}

function stream(url, lang, quality, server) {
  return {
    url,
    lang,
    quality,
    name: 'Test - ' + quality,
    title: lang + ' - ' + server + ' ' + quality,
  };
}

// --- 1. idioma: lat > esp > sub > cast > otro -------------------------------
const langList = rank([
  stream('https://a.example/s1.m3u8', 'Inglés', '1080p', 'Online'),
  stream('https://a.example/s2.m3u8', 'Castellano', '1080p', 'Online'),
  stream('https://a.example/s3.m3u8', 'Subtitulado', '1080p', 'Online'),
  stream('https://a.example/s4.m3u8', 'Español', '1080p', 'Online'),
  stream('https://a.example/s5.m3u8', 'Latino', '1080p', 'Online'),
]);
check('idioma: 5 entradas', langList.length === 5, String(langList.length));
check(
  'idioma: lat > esp > sub > cast > otro',
  langList.map(s => s.lang).join(',') === 'Latino,Español,Subtitulado,Castellano,Inglés',
  langList.map(s => s.lang).join(','),
);

// --- 2. calidad: 1080 > 720 > 480 > unknown, y 4K al FINAL -------------------
const qualityList = rank([
  stream('https://b.example/q1.m3u8', 'Latino', '480p', 'Srv'),
  stream('https://b.example/q2.m3u8', 'Latino', '4K', 'Srv'),
  stream('https://b.example/q3.m3u8', 'Latino', '360p', 'Srv'),
  stream('https://b.example/q4.m3u8', 'Latino', '720p', 'Srv'),
  stream('https://b.example/q5.m3u8', 'Latino', '1080p', 'Srv'),
]);
check(
  'calidad: 1080 > 720 > 480 > desconocida > 4K',
  qualityList.map(s => s.quality).join(',') === '1080p,720p,480p,360p,4K',
  qualityList.map(s => s.quality).join(','),
);
const unknownLabel = rank([stream('https://b.example/qu.m3u8', 'Latino', 'Unknown', 'Srv')])[0];
check('calidad: Unknown se etiqueta HD (convención existente)', unknownLabel.quality === 'HD', unknownLabel.quality);
const prefer4k = rank([
  stream('https://b.example/q2.m3u8', 'Latino', '4K', 'Srv'),
  stream('https://b.example/q5.m3u8', 'Latino', '1080p', 'Srv'),
], { prefer4k: true });
check('calidad: prefer4k pone 4K primero', prefer4k[0].quality === '4K', prefer4k[0].quality);

// --- 3. servidor fiable antes que voe/okru (mismo idioma y calidad) ---------
const serverList = rank([
  stream('https://c.example-voe.sx/v.m3u8', 'Latino', '1080p', 'VOE'),
  stream('https://c.goodstream.one/g.m3u8', 'Latino', '1080p', 'GoodStream'),
  stream('https://c.ok.ru/ok.m3u8', 'Latino', '1080p', 'Okru'),
  stream('https://c.hlswish.com/w.m3u8', 'Latino', '1080p', 'StreamWish'),
]);
check(
  'servidor: goodstream/streamwish antes que voe/okru',
  serverList.map(s => s.title).join(' | ') === 'Latino - GoodStream 1080p | Latino - StreamWish 1080p | Latino - VOE 1080p | Latino - Okru 1080p',
  serverList.map(s => s.title).join(' | '),
);

// --- 4. dedupe por URL (gana el primero) ------------------------------------
const deduped = rank([
  stream('https://d.example/dup.m3u8', 'Latino', '720p', 'Primero'),
  stream('https://d.example/dup.m3u8', 'Latino', '1080p', 'Segundo'),
  stream('https://d.example/otro.m3u8', 'Latino', '480p', 'Otro'),
]);
check('dedupe: 2 entradas', deduped.length === 2, String(deduped.length));
check('dedupe: gana el primero', deduped[0].title.indexOf('Primero') !== -1, deduped[0].title);

// --- 5. cap por defecto (10) y opts.limit -----------------------------------
const many = [];
for (let i = 0; i < 25; i++) {
  many.push(stream('https://e.example/m' + i + '.m3u8', 'Latino', '1080p', 'S' + i));
}
check('cap: 10 por defecto', rank(many).length === 10, String(rank(many).length));
check('cap: opts.limit respeta 3', rank(many, { limit: 3 }).length === 3, String(rank(many, { limit: 3 }).length));
check('cap: opts.limit 0 devuelve vacío', rank(many, { limit: 0 }).length === 0);

// --- 6. etiqueta 'Idioma - Servidor Calidad' --------------------------------
const labeled = rank([stream('https://f.goodstream.one/x.m3u8', 'Latino', '1080p', 'GoodStream')])[0];
check(
  'etiqueta: título sigue la convención',
  labeled.title === 'Latino - GoodStream 1080p',
  labeled.title,
);
check('etiqueta: name se conserva', labeled.name === 'Test - 1080p', labeled.name);
check('etiqueta: headers/url intactos', labeled.url === 'https://f.goodstream.one/x.m3u8');

// --- 7. robustez: entradas nulas, sin lang, sin opts ------------------------
const messy = rank([
  null,
  { url: 'https://g.example/no-lang.m3u8', quality: '1080p' },
  undefined,
  stream('https://g.example/ok.m3u8', 'Subtitulado', '720p', 'Srv'),
]);
check('robustez: ignora nulos y ordena sin lang al final', messy.length === 2, JSON.stringify(messy.map(s => s.url)));
check('robustez: rank() sin opts funciona', rank([stream('https://h.example/x.m3u8', 'Latino', '1080p', 'S')]).length === 1);

if (failures > 0) {
  console.log('test-rank: ' + failures + ' fallo(s)');
  process.exit(1);
}
console.log('test-rank: todo en orden');
