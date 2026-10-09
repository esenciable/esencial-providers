// Local logic verification (the real playback test happens in Nuvio on-device).
// Parte 1: selftest determinista del filtro del dueño (S1) contra lib/flat-prelude.js (sin red).
// Parte 2: casos en vivo contra los dist de los proveedores que quedan.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);

let selftestFailures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { selftestFailures++; console.log(`FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
  else console.log(`ok   ${name}`);
}
console.log('--- selftest filtro del dueño (S1, offline) ---');
const prelude = require('./lib/flat-prelude.js');
const ownerOpts = prelude.flatOwnerRankOptions();
const OWNER_STREAMS = [
  { title: 'Latino - Uqload 1080p', url: 'https://strm5.uqload.vc/abc.m3u8', quality: '1080p' },
  { title: 'Castellano - Uqload 720p', url: 'https://strm2.uqload.vc/def.m3u8', quality: '720p' },
  { title: 'Subtitulado - Uqload 720p', url: 'https://strm3.uqload.vc/ghi.m3u8', quality: '720p' },
  { title: 'Latino - Vimeos 720p', url: 'https://p4.vimeos.zip/vod.m3u8', quality: '720p' },
  { title: 'Latino - GoodStream 720p', url: 'https://hls2.goodstream.one/lol.m3u8', quality: '720p' },
  { title: 'Servidor 1080p', url: 'https://cdn.ejemplo.org/video/master.m3u8', quality: '1080p' },
  { title: 'Servidor 480p', url: 'https://cdn2.ejemplo.org/video/sd.m3u8', quality: '480p' },
  { title: 'Latino - VOE 720p', url: 'https://voe.sx/e/xyz', quality: '720p' },
];
check('surviving titles', prelude.flatRankStreams(OWNER_STREAMS, ownerOpts).map(s => s.title), [
  'Latino - Uqload 1080p',
  'Latino - Vimeos 720p',
  'Online 1080p',
]);
const many = [];
for (let i = 0; i < 9; i++) many.push({ title: 'Latino - Uqload 720p', url: 'https://uqload.io/v' + i + '.m3u8', quality: '720p' });
check('limit 4', prelude.flatRankStreams(many, ownerOpts).length, 4);
check('unlabeled kept', prelude.flatRankStreams([
  { title: 'Servidor HD', url: 'https://cdn.ejemplo.org/video/master.m3u8', quality: 'HD' },
], ownerOpts).length, 1);
check('latino before unlabeled', prelude.flatRankStreams([
  { title: 'Servidor 1080p', url: 'https://cdn.ejemplo.org/video/master.m3u8', quality: '1080p' },
  { title: 'Latino - Uqload 720p', url: 'https://strm5.uqload.vc/abc.m3u8', quality: '720p' },
], ownerOpts).map(s => s.title), ['Latino - Uqload 720p', 'Online 1080p']);
check('default limit unchanged', prelude.flatRankStreams(many).length, 9);

console.log('--- selftest flatResolveVimeos configurable (hackstore-plain, offline) ---');
// Stub de fetch: el resolver debe seguir enviando el referer de LaMovie por defecto y aceptar
// el referer/Accept propios de HackStore (el standalone providers/hackstore-plain.js usa
// Referer https://vimeos.net/ + Accept text/html y se queda con el PRIMER master m3u8,
// sin el bucle de reintento por el parámetro i que usa LaMovie).
{
  const realFetch = globalThis.fetch;
  const MASTER = 'https://s14.vimeos.net/hls2/03/00000/4300knyazv7g_,n,h,.urlset/master.m3u8?t=x&s=1&e=2&v=3';
  const HTML_I03 = '<html>file:"' + MASTER + '&i=0.3&sp=0"</html>';
  const HTML_I00 = '<html>file:"' + MASTER + '&i=0.0&sp=0"</html>';
  let calls = [];
  const stub = (html) => {
    calls = [];
    globalThis.fetch = (url, init) => {
      calls.push({ url, headers: (init && init.headers) || {} });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(html) });
    };
  };
  try {
    stub(HTML_I00);
    const def00 = await prelude.flatResolveVimeos('https://vimeos.net/embed-x.html');
    check('vimeos default: referer LaMovie intacto', calls[0].headers.Referer, 'https://lamovie.org/');
    check('vimeos default: Accept-Language intacto', calls[0].headers['Accept-Language'], 'es-MX,es;q=0.9');
    check('vimeos default: master i=0.0 al primer fetch', [def00 && def00.url, calls.length], [MASTER + '&i=0.0&sp=0', 1]);

    stub(HTML_I03);
    const def03 = await prelude.flatResolveVimeos('https://vimeos.net/embed-x.html');
    check('vimeos default: i=0.3 reintenta y se agota (3 fetchs, null)', [def03, calls.length], [null, 3]);

    stub(HTML_I03);
    const hs = await prelude.flatResolveVimeos('https://vimeos.net/embed-x.html', { referer: 'https://vimeos.net/', accept: 'text/html', firstMatch: true });
    check('vimeos hackstore: referer propio', calls[0].headers.Referer, 'https://vimeos.net/');
    check('vimeos hackstore: Accept text/html', calls[0].headers.Accept, 'text/html');
    check('vimeos hackstore: primer master i=0.3 al primer fetch', [hs && hs.url, calls.length], [MASTER + '&i=0.3&sp=0', 1]);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('--- selftest magisSelectCandidate (regla de aceptación de candidatos, offline) ---');
// Carga el núcleo real (lib/flat-magis-core.js) vía el puente de pruebas: el test no puede
// desincronizarse de lo que corre en el dist (mismo archivo que concatena build.cjs).
// flatStr vive en el prelude (no exportado); el núcleo la resuelve como global en Node.
const magisCore = require('./lib/flat-magis-core.js');
globalThis.flatStr = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const select = magisCore.magisSelectCandidate;
{
  // Datos reales observados en el portal (búsqueda "Dunas", incidente Dune 1984 -> Tuareg).
  const TUAREGS = { type: 'movie', contentId: '947BBBB6BDC24DA6B5D6405C9399BC78', name: 'Tuaregs, los guerreros de las dunas', programType: 'movie', releaseTime: '2013-08-03', score: 5 };
  const DUNA_2021 = { type: 'movie', contentId: 'DUNA2021', name: 'Duna', programType: 'movie', releaseTime: '2021-10-22', score: 8.2 };
  const movie = (name, year, score, id) => ({ type: 'movie', contentId: id || name, name, programType: 'movie', releaseTime: year, score });
  // 1. El bug reportado: un candidato débil y único NO se acepta a ciegas (year 1984 vs 2013).
  check('dunas 1984 no acepta Tuareg (year)', select([TUAREGS], 'Dunas', false, '1984'), null);
  // 2. Con año conocido, gana el candidato del año correcto aunque el portal puntúe menos.
  check('duna 2021 gana por año', select([TUAREGS, DUNA_2021], 'Duna', false, '2021')?.contentId, 'DUNA2021');
  // 3. Cobertura mínima: compartir una palabra de un título de dos no es match
  //    (magisTokens solo cuenta tokens de 3+ chars, así que el par debe tener dos tokens reales).
  check('cobertura mínima rechaza match parcial', select([movie('Mad', '2015-05-14', 9)], 'Mad Max', false, null), null);
  check('cobertura completa acepta', select([movie('El Padrino', '1972-03-15', 9)], 'El Padrino', false, '1972')?.contentId, 'El Padrino');
  // 4. Desempate por el score del portal entre candidatos que pasan.
  const weakPortal = movie('Duna', '2021-10-22', 5, 'WEAK');
  const strongPortal = movie('Duna', '2021-10-22', 8.2, 'STRONG');
  check('desempate por score del portal', select([weakPortal, strongPortal], 'Duna', false, '2021')?.contentId, 'STRONG');
  // 5. Tolerancia de año ±1 (drift de fecha de estreno).
  check('tolerancia de año ±1', select([movie('Otra', '2022-01-05', 5, 'OTRA')], 'Otra', false, '2021')?.contentId, 'OTRA');
  check('año fuera de ±1 rechaza', select([movie('Otra', '2023-01-05', 5, 'OTRA')], 'Otra', false, '2021'), null);
  // 6. Sin año no se bloquea: candidato sin releaseTime verificable pasa si el nombre cubre.
  check('sin releaseTime no rechaza por año', select([{ type: 'movie', contentId: 'SINFECHA', name: 'Duna', programType: 'movie', score: 5 }], 'Duna', false, '2021')?.contentId, 'SINFECHA');
  // 7. Filtro programType y contentId siguen mandando (comportamiento que ya estaba bien).
  const bb = { type: 'teleplay', contentId: 'BB', name: 'Breaking Bad', programType: 'series', releaseTime: '2008-01-20', score: 9 };
  const camino = { type: 'movie', contentId: 'CAMINO', name: 'El Camino: A Breaking Bad Movie', programType: 'movie', releaseTime: '2019-10-11', score: 9.5 };
  check('serie: filtra programa y elige la serie', select([camino, bb], 'Breaking Bad', true, '2008')?.contentId, 'BB');
  check('sin contentId se descarta', select([{ type: 'movie', contentId: '', name: 'Duna', programType: 'movie', releaseTime: '2021-10-22', score: 9 }], 'Duna', false, '2021'), null);
  // 8. Ranking por año: entre candidatos que pasan, el de año EXACTO gana al de score más alto
  //    (el portal lista cada temporada como entrada propia: Breaking Bad T1 2008 vs T2 2009).
  const t1 = { type: 'teleplay', contentId: 'BB_T1', name: 'Breaking Bad T1', programType: 'teleplay', releaseTime: '2008-01-20', score: 8.8 };
  const t2 = { type: 'teleplay', contentId: 'BB_T2', name: 'Breaking Bad T2', programType: 'teleplay', releaseTime: '2009-03-08', score: 9.5 };
  check('año exacto gana al score más alto (temporadas)', select([t2, t1], 'Breaking Bad', true, '2008')?.contentId, 'BB_T1');
  check('sin año verificable queda al final del ranking', select([t2, t1, { type: 'teleplay', contentId: 'BB_T0', name: 'Breaking Bad T0', programType: 'teleplay', score: 9.9 }], 'Breaking Bad', true, '2008')?.contentId, 'BB_T1');
}

if (selftestFailures > 0) process.exit(1);

console.log('--- casos en vivo (dist) ---');

// Resolve each scraper id to its cache-busted dist filename via the manifest.
let scrapers = [];
try {
  const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  scrapers = Array.isArray(manifest) ? manifest : manifest.scrapers;
} catch (error) {
  console.log(`manifest no legible: ${error.message}`);
}
const distFile = Object.fromEntries(scrapers.map(s => [s.id, `./dist/${s.filename.split('/').pop()}`]));

const CASES = [
  ['magis', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['magis', 'tt0903747', 'tv', 1, 1, 'Breaking Bad S1E1'],
  ['hackstore-plain', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['hackstore-plain', 'tt0903747', 'tv', 1, 1, 'Breaking Bad S1E1'],
  ['embed69', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['embed69', 'tt0903747', 'tv', 1, 1, 'Breaking Bad S1E1'],
  ['cinemitas', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['seriesmetro', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['seriesmetro', 'tt0903747', 'tv', 1, 1, 'Breaking Bad S1E1'],
];

for (const [name, tmdbId, type, season, episode, label] of CASES) {
  if (!distFile[name] || !existsSync(new URL(distFile[name], import.meta.url))) {
    console.log(`${name.padEnd(12)} SKIP (disabled o sin dist)`);
    continue;
  }
  const provider = require(distFile[name]);
  const startedAt = Date.now();
  try {
    const streams = await Promise.race([
      provider.getStreams(tmdbId, type, season, episode),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 75s')), 75_000)),
    ]);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const hosts = [...new Set(streams.map(s => { try { return new URL(s.url).host; } catch { return '(url inválida)'; } }))];
    console.log(`${name.padEnd(10)} ${label.padEnd(18)} ${String(streams.length).padStart(2)} streams en ${seconds}s | hosts: ${hosts.slice(0, 3).join(', ') || '-'}`);
  } catch (error) {
    console.log(`${name.padEnd(10)} ${label.padEnd(18)} ERROR: ${error.message}`);
  }
}
