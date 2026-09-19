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
  const crypto3des = fs.readFileSync(path.join(__dirname, 'lib', 'flat-crypto3des.js'), 'utf8');

  /** Operator constants for the Magis portal (public APK values + the portal 3DES key).
   * Read from the environment first, else from the sibling addon .env. Never printed. */
  function magisConstantsBlock() {
    const fromEnv = {};
    for (const key of ['MAGIS_HOSTS', 'MAGIS_APP_ID', 'MAGIS_APK_VERSION', 'MAGIS_3DES_KEY']) {
      if (process.env[key]) fromEnv[key] = process.env[key];
    }
    const envPath = path.join(__dirname, '..', 'kino-light-addon', '.env');
    if (Object.keys(fromEnv).length < 4 && fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const index = trimmed.indexOf('=');
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim();
        if (['MAGIS_HOSTS', 'MAGIS_APP_ID', 'MAGIS_APK_VERSION', 'MAGIS_3DES_KEY'].includes(key) && !fromEnv[key]) fromEnv[key] = value;
      }
    }
    const hosts = (fromEnv.MAGIS_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);
    return [
      `var MAGIS_HOSTS = ${JSON.stringify(hosts)};`,
      `var MAGIS_APP_ID = ${JSON.stringify(fromEnv.MAGIS_APP_ID || '')};`,
      `var MAGIS_APK_VERSION = ${JSON.stringify(fromEnv.MAGIS_APK_VERSION || '')};`,
      `var MAGIS_3DES_KEY = ${JSON.stringify(fromEnv.MAGIS_3DES_KEY || '')};`,
      '',
    ].join('\n');
  }
  for (const scraper of scrapers) {
    if (scraper.enabled === false || fs.existsSync(path.join(__dirname, 'flat', `${scraper.id}.js`)) === false && scraper.filename.startsWith('providers/')) continue;
    const flatSource = path.join(__dirname, 'flat', `${scraper.id}.js`);
    // Cache-busting: the raw CDN caches provider files by URL, so the file name carries the
    // scraper version. Bump `version` in manifest.json whenever a provider changes.
    const versioned = `${scraper.id}-v${String(scraper.version || '1').split('.')[0]}.js`;
    const outfile = path.join(__dirname, 'dist', versioned);
    if (fs.existsSync(flatSource)) {
      const body = fs.readFileSync(flatSource, 'utf8');
      const header = `/** ${scraper.id} - built flat (prelude + body), no bundler. */\n`;
      const needsMagis = scraper.id === 'magis' || scraper.id === 'diag-magis';
      const extra = needsMagis ? magisConstantsBlock() + crypto3des + '\n' : '';
      fs.writeFileSync(outfile, header + prelude + '\n' + extra + body);
      console.log(`flat ${scraper.id} -> dist/${path.basename(scraper.filename)} (${fs.statSync(outfile).size} bytes)`);
      continue;
    }
    const legacySource = path.join(__dirname, 'providers', `${scraper.id}.js`);
    if (!fs.existsSync(legacySource)) {
      console.log(`skip ${scraper.id} (sin fuente flat/ ni providers/)`);
      continue;
    }
    const esbuild = require('esbuild');
    await esbuild.build({
      entryPoints: [legacySource],
      outfile,
      bundle: true, platform: 'browser', format: 'cjs', target: 'es2020', minify: false, logLevel: 'silent',
    });
    console.log(`bundled ${scraper.id} -> dist/${path.basename(scraper.filename)} (${fs.statSync(outfile).size} bytes)`);
  }
})();
