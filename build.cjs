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
  const magisCore = fs.readFileSync(path.join(__dirname, 'lib', 'flat-magis-core.js'), 'utf8');

  /** Operator constants for the Magis portal (public APK values + the portal 3DES key).
   * SINGLE SOURCE OF TRUTH: `magis-config.json` at the repo root — the SAME file NuvioES fetches
   * at runtime, so a rotation of hosts, versions or key is one push and needs no app release.
   * Falls back to the environment, then to the sibling addon .env. Never printed. */
  function magisConstantsBlock() {
    const KEYS = [
      'MAGIS_HOSTS', 'MAGIS_APP_ID', 'MAGIS_APK_VERSION', 'MAGIS_3DES_KEY',
      'MAGIS_APK_VER_HEADER', 'MAGIS_SPKG_VER',
    ];
    const values = {};
    const configPath = path.join(__dirname, 'magis-config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (Array.isArray(cfg.hosts) && cfg.hosts.length > 0) values.MAGIS_HOSTS = cfg.hosts.join(',');
      for (const [from, to] of [['appId', 'MAGIS_APP_ID'], ['apkVersion', 'MAGIS_APK_VERSION'],
        ['apkVerHeader', 'MAGIS_APK_VER_HEADER'], ['spkgVer', 'MAGIS_SPKG_VER'],
        ['threeDesKeyHex', 'MAGIS_3DES_KEY']]) {
        if (cfg[from]) values[to] = String(cfg[from]);
      }
    }
    for (const key of KEYS) {
      if (!values[key] && process.env[key]) values[key] = process.env[key];
    }
    if (KEYS.some(key => !values[key])) {
      const envPath = path.join(__dirname, '..', 'kino-light-addon', '.env');
      if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const index = trimmed.indexOf('=');
          const key = trimmed.slice(0, index).trim();
          const value = trimmed.slice(index + 1).trim();
          if (KEYS.includes(key) && !values[key]) values[key] = value;
        }
      }
    }
    const hosts = (values.MAGIS_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);
    return [
      `var MAGIS_HOSTS = ${JSON.stringify(hosts)};`,
      `var MAGIS_APP_ID = ${JSON.stringify(values.MAGIS_APP_ID || '')};`,
      `var MAGIS_APK_VERSION = ${JSON.stringify(values.MAGIS_APK_VERSION || '')};`,
      `var MAGIS_APK_VER_HEADER = ${JSON.stringify(values.MAGIS_APK_VER_HEADER || '')};`,
      `var MAGIS_SPKG_VER = ${JSON.stringify(values.MAGIS_SPKG_VER || '')};`,
      `var MAGIS_3DES_KEY = ${JSON.stringify(values.MAGIS_3DES_KEY || '')};`,
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
      const extra = needsMagis ? magisConstantsBlock() + crypto3des + '\n' + magisCore + '\n' : '';
      // Minify the concatenated flat file: Nuvio's loader appears to have a size ceiling
      // (~50KB: 40-43KB providers load, 56-62KB ones do not), and minification only removes
      // comments/whitespace - no module wrappers, no bundling.
      const esbuild = require('esbuild');
      const flatSourceText = header + prelude + '\n' + extra + body;
      const minified = await esbuild.transform(flatSourceText, { minify: true, target: 'es2016', loader: 'js' });
      fs.writeFileSync(outfile, minified.code);
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
