/**
 * Shared embed/CDN resolvers (plain-JS port of the server's resolvers.ts).
 * Every resolver returns null (skip) instead of throwing - never hand an
 * unplayable page to the player.
 */

function absolute(href, base) {
  if (href.startsWith('http')) return href;
  const origin = (base.match(/^(https?:\/\/[^/]+)/) || [])[1] || '';
  return href.charAt(0) === '/' ? origin + href : origin + '/' + href;
}

function base64Decode(value) {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = String(value).replace(/[^A-Za-z0-9+/]/g, '');
    let result = '';
    for (let i = 0; i < clean.length;) {
      const a = chars.indexOf(clean[i++]);
      const b = chars.indexOf(clean[i++]);
      const c = i < clean.length ? chars.indexOf(clean[i++]) : -1;
      const d = i < clean.length ? chars.indexOf(clean[i++]) : -1;
      const n = (a << 18) | (b << 12) | ((c === -1 ? 0 : c) << 6) | (d === -1 ? 0 : d);
      result += String.fromCharCode((n >> 16) & 255);
      if (c !== -1) result += String.fromCharCode((n >> 8) & 255);
      if (d !== -1) result += String.fromCharCode(n & 255);
    }
    return result;
  } catch {
    return null;
  }
}

/* ---------------- P.A.C.K.E.R. unpacker ---------------- */

const PACKED_MATCH = /eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/;
const B36 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function unpackPackedParts(payload, radix, symtab) {
  return payload.replace(/\b([0-9a-zA-Z]+)\b/g, token => {
    let value = 0;
    for (let i = 0; i < token.length; i++) {
      const pos = B36.indexOf(token[i]);
      if (pos === -1) return token;
      value = value * radix + pos;
    }
    if (!isFinite(value) || value >= symtab.length) return token;
    return symtab[value] !== '' ? symtab[value] : token;
  });
}

function unpackPacked(html) {
  const match = html.match(PACKED_MATCH);
  if (match === null) return null;
  return unpackPackedParts(match[1], parseInt(match[2], 10), match[4].split('|'));
}

/* ---------------- VOE token decoders ---------------- */

function voeDecodeWithLut(encoded, luts) {
  try {
    const tokens = luts.replace(/^\[|\]$/g, '').split("','").map(t => t.replace(/^'+|'+$/g, ''));
    const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    let text = '';
    for (const character of encoded) {
      let code = character.charCodeAt(0);
      if (code > 64 && code < 91) code = ((code - 52) % 26) + 65;
      else if (code > 96 && code < 123) code = ((code - 84) % 26) + 97;
      text += String.fromCharCode(code);
    }
    for (const token of escaped) text = text.replace(new RegExp(token, 'g'), '_');
    text = text.split('_').join('');
    const first = base64Decode(text);
    if (first === null) return null;
    let shifted = '';
    for (const character of first) shifted += String.fromCharCode((character.charCodeAt(0) - 3 + 256) % 256);
    const second = base64Decode(shifted.split('').reverse().join(''));
    if (second === null) return null;
    return JSON.parse(second);
  } catch {
    return null;
  }
}

function voeDecodeRot13(encoded) {
  try {
    let decoded = encoded.replace(/[a-zA-Z]/g, character => {
      const code = character.charCodeAt(0);
      const limit = character <= 'Z' ? 90 : 122;
      const shifted = code + 13;
      return String.fromCharCode(limit >= shifted ? shifted : shifted - 26);
    });
    for (const noise of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) decoded = decoded.split(noise).join('');
    const first = base64Decode(decoded);
    if (first === null) return null;
    let shifted = '';
    for (const character of first) shifted += String.fromCharCode(character.charCodeAt(0) - 3);
    const second = base64Decode(shifted.split('').reverse().join(''));
    if (second === null) return null;
    return JSON.parse(second);
  } catch {
    return null;
  }
}

/* ---------------- Quality from URL ---------------- */

const QUALITY_MAPS = {
  vimeos: { h: '720p', n: '480p' },
  goodstream: { x: '1080p', h: '720p', n: '480p', l: '360p' },
  vidhide: { n: '720p', l: '480p' },
  streamwish: { x: '1080p', h: '1080p', n: '720p', l: '480p' },
  voe: { n: '720p', l: '360p' },
};
const LETTER_ORDER = ['x', 'o', 'h', 'n', 'l'];

function qualityFromUrl(url) {
  if (!url) return 'Unknown';
  let map = null;
  if (url.indexOf('vimeos') !== -1) map = QUALITY_MAPS.vimeos;
  else if (url.indexOf('goodstream') !== -1) map = QUALITY_MAPS.goodstream;
  else if (url.indexOf('cloudwindow-route') !== -1) map = QUALITY_MAPS.voe;
  else if (url.indexOf('minochinos') !== -1 || url.indexOf('vidhide') !== -1 || url.indexOf('dintezuvio') !== -1 || url.indexOf('dramiyos') !== -1) map = QUALITY_MAPS.vidhide;
  else if (url.indexOf('premilkyway') !== -1 || url.indexOf('hlswish') !== -1 || url.indexOf('vibuxer') !== -1 || url.indexOf('streamwish') !== -1) map = QUALITY_MAPS.streamwish;
  if (map !== null) {
    const ladder = url.match(/_,([a-z,]+),\.urlset/);
    if (ladder !== null) {
      const letters = ladder[1].split(',').filter(Boolean);
      for (const letter of LETTER_ORDER) {
        if (letters.indexOf(letter) !== -1 && map[letter] !== undefined) return map[letter];
      }
    }
  }
  const explicit = url.match(/[_\-\/](\d{3,4})p/);
  return explicit !== null ? explicit[1] + 'p' : 'Unknown';
}

/* ---------------- Host families & routing ---------------- */

const FAMILIES = {
  voe: ['voe.sx', 'voe-sx', 'voex.sx', 'marissashare', 'cloudwindow'],
  streamwish: ['hlswish', 'streamwish', 'hglink', 'audinifer', 'embedwish', 'awish', 'dwish', 'strwish', 'filelions', 'wishembed', 'wishfast', 'hanerix', 'vibuxer'],
  vidhide: ['vidhide', 'minochinos', 'dintezuvio', 'acek-cdn', 'vedonm', 'vidhidepro', 'masukestin', 'dramiyos'],
  goodstream: ['goodstream', 'gs.one'],
  vimeos: ['vimeos'],
  lacloud: ['lacloud.live'],
  doodstream: ['dood', 'd0000d', 'ds2video', 'ds2play', 'dsvplay'],
  filemoon: ['filemoon', 'moonalu', 'moonembed', 'bysedikamoum', 'r66nv9ed', '398fitus', 'fmoon.top'],
  uqload: ['uqload'],
  packer: ['earnvids.com', 'earnl.one', 'vidnova.online', 'streamfort.online'],
};
const FAMILY_ORDER = ['voe', 'filemoon', 'streamwish', 'vidhide', 'uqload', 'goodstream', 'vimeos', 'lacloud', 'doodstream', 'packer'];

function familyFor(url) {
  const lower = url.toLowerCase();
  for (const family of FAMILY_ORDER) {
    if (FAMILIES[family].some(host => lower.indexOf(host) !== -1)) return family;
  }
  return null;
}

function serverLabelFor(url) {
  const family = familyFor(url);
  if (family === null) return 'Online';
  if (family === 'streamwish') return 'StreamWish';
  if (family === 'voe') return 'VOE';
  if (family === 'goodstream') return 'GoodStream';
  if (family === 'vimeos') return 'Vimeos';
  if (family === 'filemoon') return 'Filemoon';
  if (family === 'vidhide') return 'VidHide';
  if (family === 'doodstream') return 'DoodStream';
  if (family === 'uqload') return 'Uqload';
  if (family === 'lacloud') return 'Lacloud';
  return 'EarnVids';
}

module.exports = {
  absolute, base64Decode, unpackPacked, voeDecodeWithLut, voeDecodeRot13,
  qualityFromUrl, familyFor, serverLabelFor,
  FAMILIES, FAMILY_ORDER,
};
