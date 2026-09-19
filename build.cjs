/** Bundles every manifest scraper into a self-contained dist/<name>.js
 * (Nuvio loads one file per provider and does not resolve relative requires). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const scrapers = Array.isArray(manifest) ? manifest : manifest.scrapers;

/** Two build modes:
 *  - flat/<id>.js exists  -> concatenate lib/flat-prelude.js + the body (NO bundler: the
 *    device runtime rejects esbuild output, verified on a living-room TV).
 *  - otherwise            -> esbuild bundle (legacy, kept for reference). */
(async () => {
  const prelude = fs.readFileSync(path.join(__dirname, 'lib', 'flat-prelude.js'), 'utf8');
  for (const scraper of scrapers) {
    const flatSource = path.join(__dirname, 'flat', `${scraper.id}.js`);
    const outfile = path.join(__dirname, 'dist', path.basename(scraper.filename));
    if (fs.existsSync(flatSource)) {
      const body = fs.readFileSync(flatSource, 'utf8');
      const header = `/** ${scraper.id} - built flat (prelude + body), no bundler. */\n`;
      fs.writeFileSync(outfile, header + prelude + '\n' + body);
      console.log(`flat ${scraper.id} -> dist/${path.basename(scraper.filename)} (${fs.statSync(outfile).size} bytes)`);
      continue;
    }
    if (!fs.existsSync(path.join(__dirname, 'providers', path.basename(scraper.filename)))) {
      console.log(`skip ${scraper.id} (sin fuente flat/ ni providers/)`);
      continue;
    }
    const esbuild = require('esbuild');
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'providers', path.basename(scraper.filename))],
      outfile,
      bundle: true, platform: 'browser', format: 'cjs', target: 'es2020', minify: false, logLevel: 'silent',
    });
    console.log(`bundled ${scraper.id} -> dist/${path.basename(scraper.filename)} (${fs.statSync(outfile).size} bytes)`);
  }
})();
