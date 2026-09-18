// Local logic verification (the real playback test happens in Nuvio on-device).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const CASES = [
  ['magis', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['magis', 'tt0903747', 'tv', 1, 1, 'Breaking Bad S1E1'],
  ['hackstore', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['lamovie', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['sololatino', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['areshd', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['cinemitas', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['megadede', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['entre', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['cinecalidad', 'tt2380307', 'movie', undefined, undefined, 'Coco'],
  ['hackstore', 'tt0903747', 'tv', 1, 1, 'Breaking Bad S1E1'],
  ['lamovie', 'tt0903747', 'tv', 1, 1, 'Breaking Bad S1E1'],
  ['areshd', 'tt0903747', 'tv', 1, 1, 'Breaking Bad S1E1'],
];

for (const [name, tmdbId, type, season, episode, label] of CASES) {
  const provider = require(`./providers/${name}.js`);
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
