/** Bundles every manifest scraper into a self-contained dist/<name>.js
 * (Nuvio loads one file per provider and does not resolve relative requires). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const scrapers = Array.isArray(manifest) ? manifest : manifest.scrapers;

(async () => {
  for (const scraper of scrapers) {
    const entry = path.join(__dirname, scraper.filename.replace(/^dist\//, 'providers/').replace(/\.js$/, '.js'));
    const source = fs.existsSync(entry) ? entry : path.join(__dirname, scraper.filename);
    const outfile = path.join(__dirname, 'dist', path.basename(scraper.filename));
    await esbuild.build({
      entryPoints: [source],
      outfile,
      bundle: true,
      platform: 'browser',
      format: 'cjs',
      minify: false,
      logLevel: 'silent',
    });
    console.log(`bundled ${scraper.id} -> dist/${path.basename(scraper.filename)} (${fs.statSync(outfile).size} bytes)`);
  }
})();
