/**
 * Kino Light — Magis VOD provider for Nuvio (client-side port).
 *
 * Ported from the kino-light server addon (src/magis/*) to the Nuvio on-device
 * provider contract:
 *   getStreams(tmdbId, type, season?, episode?) -> Promise<Stream[]>
 *   Stream = { name, title, url, quality, headers }
 *
 * Differences vs the server port:
 * - Runs on-device: node:crypto is unavailable, so 3DES-ECB and MD5 come from
 *   crypto-js (bundled at build time by ../build.cjs).
 * - Sessions are per-invocation in memory; the portal issues anonymous device
 *   sessions for VOD exactly like the Android app, so no Magis account is
 *   required. Account login is supported but optional.
 * - Playback headers (Content-Auth / Content-License / Ranger UA) are attached
 *   to the stream object; the Nuvio player applies them.
 *
 * Build-time configuration is injected by ../build.cjs via process.env defines:
 *   MAGIS_HOSTS, MAGIS_APP_ID, MAGIS_APK_VERSION, MAGIS_3DES_KEY, TMDB_API_KEY.
 */
'use strict';

const CryptoJS = require('crypto-js');

/* ------------------------------------------------------------------ */
/* Configuration (injected at build time)                              */
/* ------------------------------------------------------------------ */

const HOSTS = ["osuhk.m3x8o50te.com", "oogoy.f30c96w8.com"].map(h => h.trim()).filter(Boolean);
const APP_ID = "com.android.msandroid";
const APK_VERSION = "49902";
const DES_KEY_HEX = "e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8";
const TMDB_API_KEY = "1de4a8a5cd1bfed72634b1090d2a65e8";

/* Anonymous device activation is ALWAYS used: the portal serves full VOD for
 * anonymous devices (same as the Android app), and this avoids embedding any
 * operator Magis account in the distributed bundle.
 *
 * The Android app mints ONE device and reuses its sn forever: two identities
 * over the same sn kick each other out on every activation, so re-minting a
 * device on every call (every getStreams = fresh JS runtime here) looks like
 * device churn to the portal. A pre-minted device (build-time defines, written
 * by scripts/mint-device) is reused as the stable identity; if the portal
 * rejects its session, the fallback mints a fresh one and abandons the old sn
 * entirely (no ping-pong). */
const ACCOUNT = { username: '', password: '' };
/* When enabled (MAGIS_DEBUG_ERRORS=1 at build time), failures return a stream
 * whose title states the exact reason — visible on devices without logs (TVs). */
const DEBUG_ERRORS = false; // on-device debugging: flip to true to surface portal errors as streams

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function stringValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function objects(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'object' && item !== null) : [];
}

function objectAt(value, index) {
  return Array.isArray(value) && typeof value[index] === 'object' && value[index] !== null ? value[index] : {};
}

function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  // The Nuvio fetch polyfill ignores the abort signal; the timeout is best-effort.
  if (typeof AbortController !== 'function' || typeof setTimeout !== 'function') {
    return fetch(url, options);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, options).finally(() => {
    if (typeof clearTimeout === 'function') clearTimeout(timer);
  });
}

const sleep = ms => new Promise(resolve => {
  // The Nuvio JS runtime may not provide timers; degrade gracefully.
  if (typeof setTimeout === 'function') setTimeout(resolve, ms);
  else resolve();
});

/* ------------------------------------------------------------------ */
/* Magis wire crypto: hex(base64(3DES-EDE/ECB/PKCS7(json)))            */
/* ------------------------------------------------------------------ */

class MagisCrypto {
  constructor(keyHex) {
    if (!/^[0-9a-fA-F]{48}$/.test(keyHex)) throw new Error('Magis 3DES key must be 48 hex chars');
    this.key = CryptoJS.enc.Hex.parse(keyHex);
  }

  encryptBody(plain) {
    const encrypted = CryptoJS.TripleDES.encrypt(CryptoJS.enc.Utf8.parse(plain), this.key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    });
    const base64 = encrypted.toString(); // base64 ciphertext
    let hex = '';
    for (let i = 0; i < base64.length; i++) hex += base64.charCodeAt(i).toString(16).padStart(2, '0');
    return hex;
  }

  decryptBlob(wire) {
    const inner = atobHexToString(wire); // hex -> ascii(base64)
    // CryptoJS requires a CipherParams (or base64 string) as the message: a raw
    // ciphertext WordArray silently decrypts to garbage/empty.
    const decrypted = CryptoJS.TripleDES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(inner) }),
      this.key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
    );
    const plain = decrypted.toString(CryptoJS.enc.Utf8);
    if (plain === '') throw new Error('Magis blob decryption produced no output');
    return plain;
  }
}

function atobHexToString(hex) {
  let ascii = '';
  for (let i = 0; i < hex.length; i += 2) ascii += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return ascii;
}

function md5Hex(value) {
  return CryptoJS.MD5(CryptoJS.enc.Utf8.parse(value)).toString();
}

/* ------------------------------------------------------------------ */
/* Portal client                                                       */
/* ------------------------------------------------------------------ */

class MagisPortalError extends Error {
  constructor(code, message) {
    super(`Magis portal rejected request (${code}${message ? `: ${message}` : ''})`);
    this.name = 'MagisPortalError';
  }
}

/** Transport variants for the encrypted POST. Nuvio's FetchBridge may re-wrap string bodies
 * (observed portal code 1 "请求参数异常" for requests that succeed byte-identical from Node),
 * so on code 1 the client walks the ladder: JSON string -> raw bytes -> text/plain. The first
 * transport the portal accepts is remembered for the rest of the session. */
const TRANSPORTS = [
  {
    name: 'hex-string-json',
    wire: (crypto, plain) => crypto.encryptBody(plain),
    headers: appId => ({
      'content-type': 'application/json;charset=utf-8',
      'apk': appId, 'apkVer': '43404', 'spkgVer': '2025-08-07 05:40:11_36_16_',
      'User-Agent': 'okhttp/3.12.12',
    }),
  },
  {
    name: 'hex-bytes-json',
    wire: (crypto, plain) => {
      const hex = crypto.encryptBody(plain);
      const bytes = new Uint8Array(hex.length);
      for (let i = 0; i < hex.length; i++) bytes[i] = hex.charCodeAt(i);
      return bytes;
    },
    headers: appId => ({
      'content-type': 'application/json;charset=utf-8',
      'apk': appId, 'apkVer': '43404', 'spkgVer': '2025-08-07 05:40:11_36_16_',
      'User-Agent': 'okhttp/3.12.12',
    }),
  },
  {
    name: 'hex-string-text',
    wire: (crypto, plain) => crypto.encryptBody(plain),
    headers: appId => ({
      'content-type': 'text/plain;charset=utf-8',
      'apk': appId, 'apkVer': '43404', 'spkgVer': '2025-08-07 05:40:11_36_16_',
      'User-Agent': 'okhttp/3.12.12',
    }),
  },
];

class MagisPortalClient {
  constructor(crypto) {
    this.crypto = crypto;
    this.preferredHost = null;
    this.queueTail = Promise.resolve();
  }

  transportOrder() {
    if (this.workingTransport === undefined) return [...TRANSPORTS];
    return [...TRANSPORTS].sort((a, b) => (a.name === this.workingTransport ? -1 : b.name === this.workingTransport ? 1 : 0));
  }

  async call(path, bean = {}, session = {}, baseFields = true) {
    const body = {
      ...(baseFields ? { portalCode: 'masnew', userId: session.userId ?? '', userToken: session.userToken ?? '' } : {}),
      ...bean,
      ...this.deviceFields(session.sn ?? ''),
    };
    const plain = JSON.stringify(body);
    await this.waitTurn();

    const attempts = [];
    let lastError = null;
    outer:
    for (const host of this.hostOrder()) {
      for (const transport of this.transportOrder()) {
        try {
          const response = await fetchWithTimeout(`https://${host}/api/portalCore/${path}`, {
            method: 'POST',
            // Header keys use exact casing: Nuvio's FetchBridge checks for
            // "User-Agent" case-sensitively and injects a Mozilla default when
            // it does not find it.
            // apkVer MUST stay 43404: empirically the portal rejects newer
            // versions in this header with portal200001 ("version
            // discontinued") — verified 2026-09-18.
            headers: transport.headers(APP_ID),
            body: transport.wire(this.crypto, plain),
          });
          const json = await response.json();
          const returnCode = typeof json.returnCode === 'string' ? json.returnCode : '';
          if (returnCode !== '' && returnCode !== '0') {
            attempts.push(`${host}/${transport.name}:${returnCode}`);
            // Code 1 (generic "bad parameters") is the signature of a mangled
            // request body from the bridge: try the next transport on this
            // host before failing over. Other business errors fail over
            // hosts directly (observed portal200001 on one edge only).
            lastError = new MagisPortalError(returnCode, `path=${path} host=${host} via=${transport.name}${typeof json.errorMessage === 'string' ? `: ${json.errorMessage}` : ''}`);
            if (returnCode === '1') continue;
            continue outer;
          }
          this.preferredHost = host;
          this.workingTransport = transport.name;
          const data = typeof json.data === 'string' ? json.data : '';
          if (data === '') return json;
          return JSON.parse(this.crypto.decryptBlob(data));
        } catch (error) {
          if (error instanceof MagisPortalError) throw error;
          attempts.push(`${host}/${transport.name}:network`);
          lastError = error;
        }
      }
    }
    const trace = attempts.length > 0 ? ` [${attempts.join(', ')}]` : '';
    throw new Error(`Magis portal unavailable: ${lastError ? String(lastError.message ?? lastError) : 'unknown'}${trace}`);
  }

  async waitTurn() {
    const previous = this.queueTail;
    let release;
    this.queueTail = new Promise(resolve => { release = resolve; });
    await previous;
    await sleep(400);
    release();
  }

  hostOrder() {
    return this.preferredHost === null
      ? [...HOSTS]
      : [this.preferredHost, ...HOSTS.filter(host => host !== this.preferredHost)];
  }

  deviceFields(sn) {
    return {
      loginType: '2',
      appLanguage: 'en',
      apkVersion: APK_VERSION,
      sysVersion: '2025-08-07 05:40:11_36_16_',
      appId: APP_ID,
      hardwareInfo: 'ranchu',
      model: 'sdk_gphone64_arm64',
      product: 'sdk_gphone64_arm64',
      cpu: 'arm64-v8a',
      B29: '',
      reserve1: '',
      deviceToken: '',
      sn,
      drmId: '',
      sdkVer: 36,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Session: anonymous device activation (fallback: account login)      */
/* ------------------------------------------------------------------ */

class MagisSession {
  constructor(portal) {
    this.portal = portal;
    this.state = null;
  }

  async ensure(account) {
    if (this.state !== null) return this.state;
    // Fresh anonymous device per session: nothing precomputed ships in this public repo.
    if (!account.username || !account.password) return this.activateAnonymous();
    return this.login(account);
  }

  async activateAnonymous() {
    const snTokenRes = await this.portal.call('v3/snToken', {
      hardwareInfo: 'ranchu', model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64', cpu: 'arm64-v8a',
    }, {}, false);
    const snToken = stringValue(snTokenRes.snToken);
    if (snToken === '') throw new Error('Magis portal returned no snToken');
    const sn = (stringValue(snTokenRes.sn) || md5Hex(snToken + 'ntFT65w6itH!lHCPw7D=@qnsFC5adD28')).toLowerCase();
    const response = await this.portal.call('v8/active', {
      snToken, authVersion: '', authCode: '', preCode: '',
      macAddr: '02:00:00:00:00:00', reserve1: '', openNum: 4, channel: 'default',
      matadata: '', signdata: '',
    }, { sn }, false);
    const state = { userId: stringValue(response.userId), userToken: stringValue(response.userToken) };
    if (state.userId === '' || state.userToken === '') throw new Error('Magis anonymous activation returned no session');
    this.state = state;
    return state;
  }

  async login(account) {
    if (!account.username || !account.password) return this.activateAnonymous();
    const hashedPassword = md5Hex(`${account.password}cloudstream`);
    const response = await this.portal.call('v8/login', {
      accountType: '2',
      userName: account.username,
      password: hashedPassword,
      type: '1',
      macAddr: '02:00:00:00:00:00',
      areaCode: '',
      verificationCode: '',
      verificationToken: '',
      matadata: '',
      signdata: '',
      channel: 'default',
    }, {}, false);
    const state = { userId: stringValue(response.userId), userToken: stringValue(response.userToken) };
    if (state.userId === '' || state.userToken === '') throw new Error('Magis login returned no session');
    this.state = state;
    return state;
  }

  async withValidSession(account, action) {
    const current = await this.ensure(account);
    try {
      return await action(current);
    } catch (error) {
      if (!(error instanceof MagisPortalError)) throw error;
      const refreshed = await this.login(account);
      return action(refreshed);
    }
  }
}

/* ------------------------------------------------------------------ */
/* VOD resolver                                                        */
/* ------------------------------------------------------------------ */

class MagisResolver {
  constructor(portal, session) {
    this.portal = portal;
    this.session = session;
    this.slb = null;
  }

  async resolveVod(account, contentId, seriesContentId = '') {
    const play = await this.session.withValidSession(account, session => this.portal.call('v10/startPlayVOD', {
      contentId,
      seriesContentId,
      startTime: 0,
      type: '1',
      columnId: 0,
      authType: '',
    }, session));
    const episode = objectAt(play.episodeList, 0);
    const media = this.bestMedia(episode);
    if (media === null) throw new Error('Magis returned no playable media');
    const license = stringValue(objectAt(media.licenseList, 0).license);
    if (license === '') throw new Error('Magis returned no media license');

    const slb = await this.session.withValidSession(account, session => this.sessionSlb(session.userToken, session));
    const cdn = this.vodCdn(slb);
    if (cdn === null) throw new Error('Magis returned no VOD CDN');

    const container = stringValue(media.videoFormat).toLowerCase();
    const extension = container === 'ts' ? 'ts' : 'mp4';
    const resolvedContentId = stringValue(media.contentId) || contentId;
    return {
      url: `${cdn.base}/vod/${resolvedContentId}_media.${extension}`,
      headers: {
        'Content-Auth': cdn.auth,
        'Content-License': license,
        'User-Agent': 'Ranger/4.9.4-17294ac0',
        App: APP_ID,
        'App-Version': APK_VERSION,
      },
      mime: extension === 'ts' ? 'video/mp2t' : 'video/mp4',
    };
  }

  async sessionSlb(tokenOwner, session) {
    if (this.slb !== null && this.slb.tokenOwner === tokenOwner && this.slb.expiresAt > Date.now()) {
      return this.slb.data;
    }
    const data = await this.portal.call('v14/getSlbInfo', {
      hasPay: '0',
      userIdentity: '1',
      type: 'merge',
      appVer: APK_VERSION,
      lang: 'es',
      encMediaSupported: 1,
      liveCodeList: ['masnew_live'],
      appParams: '',
      reserve1: '02:00:00:00:00:00',
      pipFlag: '0',
    }, session);
    const ttl = numberValue(data.invalidTime) || 300;
    this.slb = { tokenOwner, expiresAt: Date.now() + ttl * 1000 - 300000, data };
    return data;
  }

  bestMedia(episode) {
    const candidates = [];
    for (const total of objects(episode.totalMovieList)) candidates.push(...objects(total.movieList));
    if (candidates.length === 0) return null;
    return candidates.reduce((best, candidate) => (scoreMedia(candidate) < scoreMedia(best) ? candidate : best));
  }

  vodCdn(slb) {
    for (const cdn of objects(slb.cdn_list)) {
      if (stringValue(cdn.tag) !== 'vod') continue;
      for (const entry of objects(cdn.url_list)) {
        const auth = stringValue(entry.url);
        if (stringValue(entry.tag) === 'free' && (isCfl(auth) || stringValue(entry.sign_type) === 'cfl')) {
          const address = stringValue(cdn.main_addr).replace(/\/$/, '');
          if (address !== '') return { base: address.startsWith('http') ? address : `https://${address}`, auth };
        }
      }
    }
    return null;
  }
}

function scoreMedia(media) {
  const codec = stringValue(media.encodeFormat).toLowerCase() === 'h264' ? 0 : 2;
  const container = stringValue(media.videoFormat).toLowerCase() === 'mp4' ? 0 : 1;
  return codec + container;
}

function isCfl(value) {
  return value.split('&').some(part => part.trim() === 'sign_type=cfl');
}

/* ------------------------------------------------------------------ */
/* TMDB title lookup (es-MX, like the server port)                     */
/* ------------------------------------------------------------------ */

async function tmdbTitleFor(id, type) {
  const isTmdb = id.startsWith('tmdb:') || /^\d+$/.test(id);
  const tmdbId = id.startsWith('tmdb:') ? id.split(':')[1] : id;
  // NOTE: build the URL by string concatenation. The Nuvio URL polyfill does not
  // reflect searchParams mutations into href, so api_key would be lost silently.
  const endpoint = isTmdb
    ? `https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${encodeURIComponent(tmdbId)}`
    : `https://api.themoviedb.org/3/find/${encodeURIComponent(id)}?external_source=imdb_id`;
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(TMDB_API_KEY)}&language=es-MX`;
  let json;
  try {
    const response = await fetchWithTimeout(url, {}, 10000);
    if (!response.ok) return null;
    json = await response.json();
  } catch {
    return null;
  }
  let detail = json;
  if (!isTmdb) {
    const key = type === 'movie' ? 'movie_results' : 'tv_results';
    detail = Array.isArray(json[key]) && typeof json[key][0] === 'object' && json[key][0] !== null ? json[key][0] : null;
    if (detail === null) return null;
  }
  const title = stringValue(detail[type === 'movie' ? 'title' : 'name']);
  const originalTitle = stringValue(detail[type === 'movie' ? 'original_title' : 'original_name']);
  if (title === '' && originalTitle === '') return null;
  return { title: title || originalTitle, originalTitle: originalTitle || title };
}

/* ------------------------------------------------------------------ */
/* Search + candidate selection (faithful port of provider.ts)          */
/* ------------------------------------------------------------------ */

const SERIES_TYPES = new Set(['teleplay', 'series', 'variety']);

function portalQuery(title) {
  const head = title.split(/[:,\u2013\u2014|]/, 2)[0].trim();
  return head.length >= 3 ? head : title.trim();
}

function uniqueTitles(...titles) {
  return [...new Set(titles.map(t => t.trim()).filter(Boolean))];
}

function searchItems(response) {
  const direct = objects(response.searchItem);
  if (direct.length > 0) return direct;
  const grouped = objects(response.searchItemList).flatMap(group => objects(group.itemList));
  if (grouped.length > 0) return grouped;
  return objects(response.assetList ?? response.list);
}

function tokens(value) {
  let normalized = value.toLowerCase();
  try {
    normalized = normalized.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    // String.normalize may be unavailable in embedded runtimes; raw lowercase is enough.
  }
  return new Set(normalized.match(/[a-z0-9]{3,}/g) ?? []);
}

function scoreCandidate(item, wanted) {
  const name = stringValue(item.name) || stringValue(item.viewPoint) || stringValue(item.alias);
  const itemTokens = tokens(name);
  let hits = 0;
  for (const token of wanted) if (itemTokens.has(token)) hits++;
  return hits;
}

function selectCandidate(items, title, type) {
  const wanted = tokens(title);
  const compatible = items.filter(item => {
    const programType = stringValue(item.programType);
    if (type === 'series') return SERIES_TYPES.has(programType);
    return programType === '' || !SERIES_TYPES.has(programType);
  });
  const pool = compatible.length > 0 ? compatible : items;
  return pool
    .filter(item => stringValue(item.contentId) !== '')
    .sort((a, b) => scoreCandidate(b, wanted) - scoreCandidate(a, wanted))[0] ?? null;
}

function episodeFrom(detail, wanted) {
  const data = typeof detail.assetData === 'object' && detail.assetData !== null && !Array.isArray(detail.assetData)
    ? detail.assetData : {};
  const episodes = objects(data.simpleProgramList);
  const selected = wanted > 0
    ? episodes.find(episode => numberValue(episode.seriesNumber) === wanted)
    : episodes[0];
  return selected === undefined ? null : stringValue(selected.contentId) || null;
}

/* ------------------------------------------------------------------ */
/* Nuvio entry point                                                   */
/* ------------------------------------------------------------------ */

const portal = new MagisPortalClient(new MagisCrypto(DES_KEY_HEX));
const session = new MagisSession(portal);
const resolver = new MagisResolver(portal, session);

function debugStream(message) {
  return [{
    name: 'Magis VOD ⚠',
    title: `Magis debug: ${message}`,
    url: 'https://magis-debug.invalid/no-stream',
    quality: '',
    headers: {},
  }];
}

async function getStreams(tmdbId, type, _season, episode) {
  const streamType = type === 'tv' ? 'series' : 'movie';
  const wantedEpisode = numberValue(episode);
  const argsTag = `id=${tmdbId} type=${type} s=${_season} e=${episode}`;

  if (HOSTS.length === 0 || DES_KEY_HEX === '' || APP_ID === '' || APK_VERSION === '' || TMDB_API_KEY === '') {
    console.log('[MagisVOD] provider not configured (build-time constants missing)');
    return DEBUG_ERRORS ? debugStream(`not configured (${argsTag})`) : [];
  }

  try {
    return await resolveStreams(String(tmdbId ?? ''), streamType, wantedEpisode, argsTag);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.log(`[MagisVOD] resolve failed: ${message}`);
    return DEBUG_ERRORS ? debugStream(`${message} (${argsTag})`) : [];
  }
}

async function resolveStreams(tmdbId, streamType, wantedEpisode, argsTag) {
  const title = await tmdbTitleFor(tmdbId, streamType);
  if (title === null) return DEBUG_ERRORS ? debugStream(`TMDB title not found (${argsTag})`) : [];

  let selected = null;
  for (const query of uniqueTitles(title.title, title.originalTitle)) {
    const search = await session.withValidSession(ACCOUNT, state => portal.call('v3/searchByName', {
      value: portalQuery(query),
      type: '0',
      columnId: '',
      filter: '',
      pageNum: 1,
      pageSize: 20,
    }, state));
    selected = selectCandidate(searchItems(search), query, streamType);
    if (selected !== null) break;
  }
  if (selected === null) return DEBUG_ERRORS ? debugStream(`no results in Magis search (${argsTag})`) : [];

  let contentId = stringValue(selected.contentId);
  let seriesContentId = '';
  if (streamType === 'series' || SERIES_TYPES.has(stringValue(selected.programType))) {
    seriesContentId = contentId;
    const detail = await session.withValidSession(ACCOUNT, state => portal.call('v4/getItemData', {
      contentId,
      type: '0',
      sortType: '0',
      language: 'en',
      macAddr: '02:00:00:00:00:00',
    }, state));
    const episodeId = episodeFrom(detail, wantedEpisode);
    if (episodeId === null) return DEBUG_ERRORS ? debugStream(`episode not found (${argsTag})`) : [];
    contentId = episodeId;
  }

  try {
    const playable = await resolver.resolveVod(ACCOUNT, contentId, seriesContentId);
    return [{
      name: 'Magis VOD',
      title: `${title.title} · Magis`,
      url: playable.url,
      quality: 'Auto',
      headers: playable.headers,
    }];
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.log(`[MagisVOD] resolve failed: ${message}`);
    return DEBUG_ERRORS ? debugStream(`${message} (${argsTag})`) : [];
  }
}

module.exports = { getStreams };
