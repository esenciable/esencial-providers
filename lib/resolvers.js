/**
 * Embed resolution strategies (plain-JS port of the server's resolvers).
 * resolveEmbed(url, fetch) -> { url, quality, serverName, headers } | null
 */

const { fetchText } = require('./http.js');
const {
  absolute, base64Decode, unpackPacked, voeDecodeWithLut, voeDecodeRot13,
  qualityFromUrl, familyFor, serverLabelFor,
} = require('./embeds.js');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

async function getPage(url, headers, fetcher) {
  return await fetchText(url, { headers, retries: 1, fetcher });
}

function stringField(value, field) {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value[field];
  return typeof candidate === 'string' && candidate !== '' ? candidate : null;
}

/* ---------------- per-family resolvers ---------------- */

async function resolveGoodstream(embedUrl, fetcher) {
  const html = await getPage(embedUrl, { Referer: 'https://goodstream.one', Origin: 'https://goodstream.one', Accept: HTML_ACCEPT }, fetcher);
  if (html === null) return null;
  const file = (html.match(/file:\s*"([^"]+)"/) || [])[1];
  if (file === undefined) return null;
  return { url: file, quality: qualityFromUrl(file), serverName: 'GoodStream', headers: { Referer: embedUrl, Origin: 'https://goodstream.one', 'User-Agent': DESKTOP_UA } };
}

async function resolveStreamWish(embedUrl, fetcher) {
  const url = embedUrl.replace('hglink.to', 'vibuxer.com');
  const origin = (url.match(/^(https?:\/\/[^/]+)/) || [null, 'https://hlswish.com'])[1] || 'https://hlswish.com';
  const html = await getPage(url, {
    Referer: 'https://embed69.org/', Origin: 'https://embed69.org',
    'Accept-Language': 'es-MX,es;q=0.9', Accept: HTML_ACCEPT,
  }, fetcher);
  if (html === null) return null;
  const file = (html.match(/file\s*:\s*["']([^"']+)["']/i) || [])[1];
  if (file !== undefined) {
    let target = absolute(file, origin);
    if (target.indexOf('vibuxer.com/stream/') !== -1) {
      try {
        const followed = await fetcher(target, { headers: { 'User-Agent': DESKTOP_UA, Referer: origin + '/' }, redirect: 'follow' });
        if (followed.url && followed.url.indexOf('.m3u8') !== -1) target = followed.url;
      } catch { /* keep pre-redirect URL */ }
    }
    return { url: target, quality: qualityFromUrl(target), serverName: 'StreamWish', headers: { 'User-Agent': DESKTOP_UA, Referer: origin + '/' } };
  }
  const unpacked = unpackPacked(html);
  if (unpacked !== null) {
    const fromHls = (unpacked.match(/\{[^{}]*"hls[234]"\s*:\s*"([^"]+)"[^{}]*\}/) || [])[1]
      || (unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/) || [])[1];
    if (fromHls !== undefined) {
      const target = absolute(fromHls, origin);
      return { url: target, quality: qualityFromUrl(target), serverName: 'StreamWish', headers: { 'User-Agent': DESKTOP_UA, Referer: origin + '/' } };
    }
  }
  // DooPlay-style /dl view keyed by a 32-hex file hash printed in the page.
  const fileCode = (url.match(/\/e\/([\w-]+)/) || [])[1] || '';
  const pageHash = (html.match(/[0-9a-f]{32}/i) || [])[0];
  if (fileCode !== '' && pageHash !== undefined) {
    const dl = await fetchText(origin + '/dl?op=view&file_code=' + encodeURIComponent(fileCode) + '&hash=' + pageHash + '&embed=1&referer=&adb=1&hls4=1', {
      headers: { 'User-Agent': DESKTOP_UA, Referer: url, 'X-Requested-With': 'XMLHttpRequest' },
    }, fetcher);
    const fromDl = dl !== null ? (dl.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i) || [])[0] : undefined;
    if (fromDl !== undefined) {
      return { url: fromDl, quality: qualityFromUrl(fromDl), serverName: 'StreamWish', headers: { 'User-Agent': DESKTOP_UA, Referer: origin + '/' } };
    }
  }
  const raw = (html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i) || [])[0];
  if (raw !== undefined) {
    return { url: raw, quality: qualityFromUrl(raw), serverName: 'StreamWish', headers: { 'User-Agent': DESKTOP_UA, Referer: origin + '/' } };
  }
  return null;
}

async function resolveVoe(embedUrl, fetcher) {
  let html = await getPage(embedUrl, { Referer: embedUrl, Accept: HTML_ACCEPT }, fetcher);
  if (html === null) return null;
  if (/permanentToken/i.test(html)) {
    const redirect = (html.match(/window\.location\.href\s*=\s*'([^']+)'/i) || [])[1];
    if (redirect !== undefined) {
      const next = await getPage(redirect, { Referer: embedUrl, Accept: HTML_ACCEPT }, fetcher);
      if (next !== null) html = next;
    }
  }
  const lutPair = html.match(/json">\s*\[\s*['"]([^'"]+)['"]\s*\]\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
  if (lutPair !== null) {
    const loader = await getPage(absolute(lutPair[2], embedUrl), { Referer: embedUrl }, fetcher);
    const luts = loader !== null
      ? ((loader.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || [])[1] || (loader.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i) || [])[1])
      : undefined;
    if (luts !== undefined) {
      const decoded = voeDecodeWithLut(lutPair[1], luts);
      const source = stringField(decoded, 'source') || stringField(decoded, 'direct_access_url');
      if (source !== null) {
        return { url: source, quality: qualityFromUrl(source), serverName: 'VOE', headers: { Referer: embedUrl, 'User-Agent': DESKTOP_UA } };
      }
    }
  }
  const rot13 = (html.match(/<script type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
  if (rot13 !== undefined) {
    const decoded = voeDecodeRot13(rot13.trim());
    const source = stringField(decoded, 'source') || stringField(decoded, 'direct_access_url');
    if (source !== null) {
      return { url: source, quality: qualityFromUrl(source), serverName: 'VOE', headers: { Referer: embedUrl, 'User-Agent': DESKTOP_UA } };
    }
  }
  const fields = [];
  const re = /(?:mp4|hls)['"]\s*:\s*['"]([^'"]+)['"]/gi;
  let match;
  while ((match = re.exec(html)) !== null) fields.push(match[1]);
  for (const value of fields) {
    if (value === '') continue;
    const target = value.indexOf('aHR0') === 0 ? base64Decode(value) || value : value;
    return { url: target, quality: qualityFromUrl(target), serverName: 'VOE', headers: { Referer: embedUrl, 'User-Agent': DESKTOP_UA } };
  }
  return null;
}

async function resolveVimeos(embedUrl, fetcher) {
  const origin = (embedUrl.match(/^(https?:\/\/[^/]+)/) || [null, 'https://vimeos.net'])[1] || 'https://vimeos.net';
  for (let attempt = 0; attempt < 3; attempt++) {
    const html = await getPage(embedUrl, { Referer: 'https://la.movie/tv/', 'Accept-Language': 'es-MX,es;q=0.9', Accept: HTML_ACCEPT }, fetcher);
    if (html === null) return null;
    const unpacked = unpackPacked(html);
    const master = unpacked !== null
      ? ((unpacked.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/) || [])[1] || (unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/) || [])[1])
      : undefined;
    if (master === undefined) return null;
    const iParam = (master.match(/[?&]i=([^&]*)/) || ['', ''])[1];
    if (iParam === '0.0') {
      return { url: master, quality: qualityFromUrl(master), serverName: 'Vimeos', headers: { 'User-Agent': DESKTOP_UA, Referer: origin + '/', Origin: origin } };
    }
  }
  return null;
}

async function resolveLacloud(embedUrl, fetcher) {
  const html = await getPage(embedUrl, { Referer: 'https://lamovie.org/' }, fetcher);
  if (html === null) return null;
  const src = (html.match(/const src\s*=\s*["']([^"']+)["']/) || [])[1];
  if (src === undefined) return null;
  return { url: src, quality: qualityFromUrl(src), serverName: 'Lacloud', headers: { Referer: embedUrl, 'User-Agent': DESKTOP_UA } };
}

async function resolvePacker(embedUrl, fetcher) {
  const html = await getPage(embedUrl, { Referer: 'https://lamovie.org/' }, fetcher);
  if (html === null) return null;
  const unpacked = unpackPacked(html);
  const stream = unpacked !== null
    ? ((unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) || [])[1]
      || (unpacked.match(/["'](\/[^"']+\.m3u8[^"']*)["']/) || [])[1]
      || (unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) || [])[1])
    : undefined;
  if (stream === undefined) return null;
  const target = absolute(stream, embedUrl);
  return { url: target, quality: qualityFromUrl(target), serverName: 'EarnVids', headers: { Referer: embedUrl, 'User-Agent': DESKTOP_UA } };
}

async function resolveDoodstream(embedUrl, fetcher) {
  const host = embedUrl.replace(/\/(d|f)\//, '/e/').replace('dsvplay.com', 'd0000d.com');
  const html = await getPage(host, { Referer: 'https://lamovie.org/', Origin: 'https://lamovie.org' }, fetcher);
  if (html === null) return null;
  const match = html.match(/\$\.get\(['"](\/pass_md5\/[\w-]+\/([\w-]+))['"]/i);
  if (match === null) return null;
  const origin = host.split('/').slice(0, 3).join('/');
  const base = await getPage(origin + match[1], { Referer: host }, fetcher);
  if (base === null || base === '') return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let padding = '';
  for (let i = 0; i < 10; i++) padding += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  const target = base + padding + '?token=' + match[2] + '&expiry=' + Date.now();
  return { url: target, quality: '720p', serverName: 'DoodStream', headers: { 'User-Agent': DESKTOP_UA, Referer: origin + '/' } };
}

async function resolveUqload(embedUrl, fetcher) {
  const html = await getPage(embedUrl, { Referer: 'https://uqload.com/' }, fetcher);
  if (html === null) return null;
  let sources = (html.match(/sources\s*[=:]\s*\[([^\]]+)\]/) || [])[1];
  if (sources === undefined) {
    const unpacked = unpackPacked(html);
    sources = unpacked !== null ? (unpacked.match(/sources\s*[=:]\s*\[([^\]]+)\]/) || [])[1] : undefined;
  }
  if (sources === undefined) return null;
  const url = (sources.match(/https?:\/\/[^\s"'<>]+/) || [])[0];
  if (url === undefined) return null;
  return { url, quality: qualityFromUrl(url), serverName: 'Uqload', headers: { Referer: 'https://uqload.com/', 'User-Agent': DESKTOP_UA } };
}

async function resolveVidhide(embedUrl, fetcher) {
  const parts = embedUrl.split('/');
  const host = parts[2];
  const html = await getPage(embedUrl, { Referer: 'https://' + host + '/' }, fetcher);
  if (html === null) return null;
  let target = (html.match(/"hls[24]"\s*:\s*"([^"]+)"/) || [])[1]
    || (html.match(/file\s*:\s*["']([^"']+)["']/i) || [])[1]
    || null;
  if (target === null) {
    const unpacked = unpackPacked(html);
    target = unpacked !== null ? (unpacked.match(/"hls[24]"\s*:\s*"([^"]+)"/) || [])[1] : null;
  }
  if (target === null) return null;
  if (target.indexOf('http') !== 0) target = 'https://' + host + target;
  if (target.indexOf('referer=') === -1) target += (target.indexOf('?') === -1 ? '?' : '&') + 'referer=embed69.org';
  return {
    url: target, quality: qualityFromUrl(target), serverName: 'VidHide',
    headers: { Referer: embedUrl.split('?')[0], Origin: 'https://' + host, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': DESKTOP_UA },
  };
}

/** White-label jwplayer page: unpack and pull the media URL; null when there is none. */
async function resolveGeneric(embedUrl, fetcher) {
  const html = await getPage(embedUrl, { Referer: 'https://embed69.org/', 'Accept-Language': 'es-MX,es;q=0.9' }, fetcher);
  if (html === null) return null;
  if (html.slice(0, 200).indexOf('<html') === -1 && html.slice(0, 200).toLowerCase().indexOf('<!doctype') === -1) {
    return { url: embedUrl, quality: qualityFromUrl(embedUrl), serverName: 'Directo', headers: { Referer: 'https://embed69.org/', 'User-Agent': DESKTOP_UA } };
  }
  const unpacked = unpackPacked(html);
  const candidate = unpacked !== null
    ? ((unpacked.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/) || [])[1]
      || (unpacked.match(/["']([^"']*master\.txt[^"']*)["']/) || [])[1]
      || (unpacked.match(/file\s*:\s*["']([^"']+)["']/i) || [])[1])
    : undefined;
  const fromRaw = candidate !== undefined ? candidate : (html.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || [])[1];
  if (fromRaw === undefined) return null;
  const target = absolute(fromRaw, embedUrl);
  return { url: target, quality: qualityFromUrl(target), serverName: 'Directo', headers: { Referer: embedUrl, 'User-Agent': DESKTOP_UA } };
}

const RESOLVERS = {
  goodstream: resolveGoodstream,
  streamwish: resolveStreamWish,
  voe: resolveVoe,
  vimeos: resolveVimeos,
  lacloud: resolveLacloud,
  packer: resolvePacker,
  doodstream: resolveDoodstream,
  filemoon: null, // needs AES-CTR (crypto-js); embeds on filemoon are skipped for now
  vidhide: resolveVidhide,
  uqload: resolveUqload,
};

/** Resolve an embed URL to direct media. Returns null when nothing works. */
async function resolveEmbed(embedUrl, fetcher) {
  const family = familyFor(embedUrl);
  if (family === null || family === 'filemoon') return null;
  const resolver = RESOLVERS[family];
  if (resolver === null || resolver === undefined) return null;
  try {
    return await resolver(embedUrl, fetcher);
  } catch {
    return null;
  }
}

module.exports = { resolveEmbed, serverLabelFor, qualityFromUrl, DESKTOP_UA };
