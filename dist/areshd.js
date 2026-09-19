var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// lib/http.js
var require_http = __commonJS({
  "lib/http.js"(exports2, module2) {
    var DESKTOP_UA2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    var HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async function fetchText2(url, options = {}) {
      const retries = options.retries === void 0 ? 1 : options.retries;
      const headers = Object.assign(
        { "User-Agent": DESKTOP_UA2, Accept: HTML_ACCEPT },
        options.headers || {}
      );
      const doFetch = options.fetcher || fetch;
      let attempt = 0;
      for (; ; ) {
        let response;
        try {
          response = await doFetch(url, { method: "GET", headers, redirect: "follow" });
        } catch {
          return null;
        }
        const retryable = response.status === 429 || response.status === 408 || response.status >= 500 && response.status < 600;
        if (retryable && attempt < retries) {
          attempt += 1;
          await sleep(Math.min(3200, 400 * Math.pow(2, attempt - 1)));
          continue;
        }
        if (!response.ok) return null;
        try {
          return await response.text();
        } catch {
          return null;
        }
      }
    }
    async function fetchJson2(url, options = {}) {
      const body = await fetchText2(url, Object.assign({}, options, { headers: Object.assign({ Accept: "application/json" }, options.headers || {}) }));
      if (body === null) return null;
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    }
    module2.exports = { fetchText: fetchText2, fetchJson: fetchJson2, sleep, DESKTOP_UA: DESKTOP_UA2, HTML_ACCEPT };
  }
});

// lib/titles.js
var require_titles = __commonJS({
  "lib/titles.js"(exports2, module2) {
    var STOPWORDS = { las: 1, los: 1, una: 1, uno: 1, del: 1, con: 1, que: 1, por: 1, para: 1, the: 1, and: 1, for: 1, from: 1, with: 1 };
    function normalizeTitle(title) {
      let normalized = String(title || "").toLowerCase();
      try {
        normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      } catch {
      }
      return normalized.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    }
    function buildSlug(title, year) {
      let slug = String(title || "");
      try {
        slug = slug.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      } catch {
      }
      slug = slug.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      return year ? slug + "-" + year : slug;
    }
    function wordCoverage(candidate, reference) {
      const words = reference.split(" ").filter((word) => (word.length > 3 || /^\d+$/.test(word)) && !STOPWORDS[word]);
      if (words.length === 0) return 0;
      const tokens = candidate.split(" ");
      let matched = 0;
      for (const word of words) if (tokens.indexOf(word) !== -1) matched += 1;
      return matched / words.length;
    }
    function scoreCandidate2(candidateTitle, tmdbTitle, originalTitle, year) {
      const normCandidate = normalizeTitle(candidateTitle);
      const normTmdb = normalizeTitle(tmdbTitle);
      const normOriginal = normalizeTitle(originalTitle || tmdbTitle);
      let score = 0;
      if (year !== null && year !== "" && normCandidate.indexOf(year) !== -1) score += 50;
      score += wordCoverage(normCandidate, normTmdb) * 30;
      score += wordCoverage(normCandidate, normOriginal) * 20;
      const sequel = normTmdb.match(/\b(\d+)\s*$/);
      if (sequel !== null && normCandidate.split(" ").indexOf(sequel[1]) === -1) score -= 100;
      const candidateYear = (normCandidate.match(/\b(19|20)\d{2}\b/) || [])[0];
      if (year !== null && year !== "" && candidateYear !== void 0 && candidateYear !== year) score -= 60;
      return score;
    }
    module2.exports = { normalizeTitle, buildSlug, scoreCandidate: scoreCandidate2 };
  }
});

// lib/embeds.js
var require_embeds = __commonJS({
  "lib/embeds.js"(exports2, module2) {
    function absolute(href, base) {
      if (href.startsWith("http")) return href;
      const origin = (base.match(/^(https?:\/\/[^/]+)/) || [])[1] || "";
      return href.charAt(0) === "/" ? origin + href : origin + "/" + href;
    }
    function base64Decode(value) {
      try {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const clean = String(value).replace(/[^A-Za-z0-9+/]/g, "");
        let result = "";
        for (let i = 0; i < clean.length; ) {
          const a = chars.indexOf(clean[i++]);
          const b = chars.indexOf(clean[i++]);
          const c = i < clean.length ? chars.indexOf(clean[i++]) : -1;
          const d = i < clean.length ? chars.indexOf(clean[i++]) : -1;
          const n = a << 18 | b << 12 | (c === -1 ? 0 : c) << 6 | (d === -1 ? 0 : d);
          result += String.fromCharCode(n >> 16 & 255);
          if (c !== -1) result += String.fromCharCode(n >> 8 & 255);
          if (d !== -1) result += String.fromCharCode(n & 255);
        }
        return result;
      } catch {
        return null;
      }
    }
    var PACKED_MATCH = /eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/;
    var B36 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    function unpackPackedParts(payload, radix, symtab) {
      return payload.replace(/\b([0-9a-zA-Z]+)\b/g, (token) => {
        let value = 0;
        for (let i = 0; i < token.length; i++) {
          const pos = B36.indexOf(token[i]);
          if (pos === -1) return token;
          value = value * radix + pos;
        }
        if (!isFinite(value) || value >= symtab.length) return token;
        return symtab[value] !== "" ? symtab[value] : token;
      });
    }
    function unpackPacked(html) {
      const match = html.match(PACKED_MATCH);
      if (match === null) return null;
      return unpackPackedParts(match[1], parseInt(match[2], 10), match[4].split("|"));
    }
    function voeDecodeWithLut(encoded, luts) {
      try {
        const tokens = luts.replace(/^\[|\]$/g, "").split("','").map((t) => t.replace(/^'+|'+$/g, ""));
        const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        let text = "";
        for (const character of encoded) {
          let code = character.charCodeAt(0);
          if (code > 64 && code < 91) code = (code - 52) % 26 + 65;
          else if (code > 96 && code < 123) code = (code - 84) % 26 + 97;
          text += String.fromCharCode(code);
        }
        for (const token of escaped) text = text.replace(new RegExp(token, "g"), "_");
        text = text.split("_").join("");
        const first = base64Decode(text);
        if (first === null) return null;
        let shifted = "";
        for (const character of first) shifted += String.fromCharCode((character.charCodeAt(0) - 3 + 256) % 256);
        const second = base64Decode(shifted.split("").reverse().join(""));
        if (second === null) return null;
        return JSON.parse(second);
      } catch {
        return null;
      }
    }
    function voeDecodeRot13(encoded) {
      try {
        let decoded = encoded.replace(/[a-zA-Z]/g, (character) => {
          const code = character.charCodeAt(0);
          const limit = character <= "Z" ? 90 : 122;
          const shifted2 = code + 13;
          return String.fromCharCode(limit >= shifted2 ? shifted2 : shifted2 - 26);
        });
        for (const noise of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) decoded = decoded.split(noise).join("");
        const first = base64Decode(decoded);
        if (first === null) return null;
        let shifted = "";
        for (const character of first) shifted += String.fromCharCode(character.charCodeAt(0) - 3);
        const second = base64Decode(shifted.split("").reverse().join(""));
        if (second === null) return null;
        return JSON.parse(second);
      } catch {
        return null;
      }
    }
    var QUALITY_MAPS = {
      vimeos: { h: "720p", n: "480p" },
      goodstream: { x: "1080p", h: "720p", n: "480p", l: "360p" },
      vidhide: { n: "720p", l: "480p" },
      streamwish: { x: "1080p", h: "1080p", n: "720p", l: "480p" },
      voe: { n: "720p", l: "360p" }
    };
    var LETTER_ORDER = ["x", "o", "h", "n", "l"];
    function qualityFromUrl(url) {
      if (!url) return "Unknown";
      let map = null;
      if (url.indexOf("vimeos") !== -1) map = QUALITY_MAPS.vimeos;
      else if (url.indexOf("goodstream") !== -1) map = QUALITY_MAPS.goodstream;
      else if (url.indexOf("cloudwindow-route") !== -1) map = QUALITY_MAPS.voe;
      else if (url.indexOf("minochinos") !== -1 || url.indexOf("vidhide") !== -1 || url.indexOf("dintezuvio") !== -1 || url.indexOf("dramiyos") !== -1) map = QUALITY_MAPS.vidhide;
      else if (url.indexOf("premilkyway") !== -1 || url.indexOf("hlswish") !== -1 || url.indexOf("vibuxer") !== -1 || url.indexOf("streamwish") !== -1) map = QUALITY_MAPS.streamwish;
      if (map !== null) {
        const ladder = url.match(/_,([a-z,]+),\.urlset/);
        if (ladder !== null) {
          const letters = ladder[1].split(",").filter(Boolean);
          for (const letter of LETTER_ORDER) {
            if (letters.indexOf(letter) !== -1 && map[letter] !== void 0) return map[letter];
          }
        }
      }
      const explicit = url.match(/[_\-\/](\d{3,4})p/);
      return explicit !== null ? explicit[1] + "p" : "Unknown";
    }
    var FAMILIES = {
      voe: ["voe.sx", "voe-sx", "voex.sx", "marissashare", "cloudwindow"],
      streamwish: ["hlswish", "streamwish", "hglink", "audinifer", "embedwish", "awish", "dwish", "strwish", "filelions", "wishembed", "wishfast", "hanerix", "vibuxer"],
      vidhide: ["vidhide", "minochinos", "dintezuvio", "acek-cdn", "vedonm", "vidhidepro", "masukestin", "dramiyos"],
      goodstream: ["goodstream", "gs.one"],
      vimeos: ["vimeos"],
      lacloud: ["lacloud.live"],
      doodstream: ["dood", "d0000d", "ds2video", "ds2play", "dsvplay"],
      filemoon: ["filemoon", "moonalu", "moonembed", "bysedikamoum", "r66nv9ed", "398fitus", "fmoon.top"],
      uqload: ["uqload"],
      packer: ["earnvids.com", "earnl.one", "vidnova.online", "streamfort.online"]
    };
    var FAMILY_ORDER = ["voe", "filemoon", "streamwish", "vidhide", "uqload", "goodstream", "vimeos", "lacloud", "doodstream", "packer"];
    function familyFor(url) {
      const lower = url.toLowerCase();
      for (const family of FAMILY_ORDER) {
        if (FAMILIES[family].some((host) => lower.indexOf(host) !== -1)) return family;
      }
      return null;
    }
    function serverLabelFor(url) {
      const family = familyFor(url);
      if (family === null) return "Online";
      if (family === "streamwish") return "StreamWish";
      if (family === "voe") return "VOE";
      if (family === "goodstream") return "GoodStream";
      if (family === "vimeos") return "Vimeos";
      if (family === "filemoon") return "Filemoon";
      if (family === "vidhide") return "VidHide";
      if (family === "doodstream") return "DoodStream";
      if (family === "uqload") return "Uqload";
      if (family === "lacloud") return "Lacloud";
      return "EarnVids";
    }
    module2.exports = {
      absolute,
      base64Decode,
      unpackPacked,
      voeDecodeWithLut,
      voeDecodeRot13,
      qualityFromUrl,
      familyFor,
      serverLabelFor,
      FAMILIES,
      FAMILY_ORDER
    };
  }
});

// lib/resolvers.js
var require_resolvers = __commonJS({
  "lib/resolvers.js"(exports2, module2) {
    var { fetchText: fetchText2 } = require_http();
    var {
      absolute,
      base64Decode,
      unpackPacked,
      voeDecodeWithLut,
      voeDecodeRot13,
      qualityFromUrl,
      familyFor,
      serverLabelFor
    } = require_embeds();
    var DESKTOP_UA2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    var HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    async function getPage(url, headers, fetcher) {
      return await fetchText2(url, { headers, retries: 1, fetcher });
    }
    function stringField(value, field) {
      if (typeof value !== "object" || value === null) return null;
      const candidate = value[field];
      return typeof candidate === "string" && candidate !== "" ? candidate : null;
    }
    async function resolveGoodstream(embedUrl, fetcher) {
      const html = await getPage(embedUrl, { Referer: "https://goodstream.one", Origin: "https://goodstream.one", Accept: HTML_ACCEPT }, fetcher);
      if (html === null) return null;
      const file = (html.match(/file:\s*"([^"]+)"/) || [])[1];
      if (file === void 0) return null;
      return { url: file, quality: qualityFromUrl(file), serverName: "GoodStream", headers: { Referer: embedUrl, Origin: "https://goodstream.one", "User-Agent": DESKTOP_UA2 } };
    }
    async function resolveStreamWish(embedUrl, fetcher) {
      const url = embedUrl.replace("hglink.to", "vibuxer.com");
      const origin = (url.match(/^(https?:\/\/[^/]+)/) || [null, "https://hlswish.com"])[1] || "https://hlswish.com";
      const html = await getPage(url, {
        Referer: "https://embed69.org/",
        Origin: "https://embed69.org",
        "Accept-Language": "es-MX,es;q=0.9",
        Accept: HTML_ACCEPT
      }, fetcher);
      if (html === null) return null;
      const file = (html.match(/file\s*:\s*["']([^"']+)["']/i) || [])[1];
      if (file !== void 0) {
        let target = absolute(file, origin);
        if (target.indexOf("vibuxer.com/stream/") !== -1) {
          try {
            const followed = await fetcher(target, { headers: { "User-Agent": DESKTOP_UA2, Referer: origin + "/" }, redirect: "follow" });
            if (followed.url && followed.url.indexOf(".m3u8") !== -1) target = followed.url;
          } catch {
          }
        }
        return { url: target, quality: qualityFromUrl(target), serverName: "StreamWish", headers: { "User-Agent": DESKTOP_UA2, Referer: origin + "/" } };
      }
      const unpacked = unpackPacked(html);
      if (unpacked !== null) {
        const fromHls = (unpacked.match(/\{[^{}]*"hls[234]"\s*:\s*"([^"]+)"[^{}]*\}/) || [])[1] || (unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/) || [])[1];
        if (fromHls !== void 0) {
          const target = absolute(fromHls, origin);
          return { url: target, quality: qualityFromUrl(target), serverName: "StreamWish", headers: { "User-Agent": DESKTOP_UA2, Referer: origin + "/" } };
        }
      }
      const fileCode = (url.match(/\/e\/([\w-]+)/) || [])[1] || "";
      const pageHash = (html.match(/[0-9a-f]{32}/i) || [])[0];
      if (fileCode !== "" && pageHash !== void 0) {
        const dl = await fetchText2(origin + "/dl?op=view&file_code=" + encodeURIComponent(fileCode) + "&hash=" + pageHash + "&embed=1&referer=&adb=1&hls4=1", {
          headers: { "User-Agent": DESKTOP_UA2, Referer: url, "X-Requested-With": "XMLHttpRequest" }
        }, fetcher);
        const fromDl = dl !== null ? (dl.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i) || [])[0] : void 0;
        if (fromDl !== void 0) {
          return { url: fromDl, quality: qualityFromUrl(fromDl), serverName: "StreamWish", headers: { "User-Agent": DESKTOP_UA2, Referer: origin + "/" } };
        }
      }
      const raw = (html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i) || [])[0];
      if (raw !== void 0) {
        return { url: raw, quality: qualityFromUrl(raw), serverName: "StreamWish", headers: { "User-Agent": DESKTOP_UA2, Referer: origin + "/" } };
      }
      return null;
    }
    async function resolveVoe(embedUrl, fetcher) {
      let html = await getPage(embedUrl, { Referer: embedUrl, Accept: HTML_ACCEPT }, fetcher);
      if (html === null) return null;
      if (/permanentToken/i.test(html)) {
        const redirect = (html.match(/window\.location\.href\s*=\s*'([^']+)'/i) || [])[1];
        if (redirect !== void 0) {
          const next = await getPage(redirect, { Referer: embedUrl, Accept: HTML_ACCEPT }, fetcher);
          if (next !== null) html = next;
        }
      }
      const lutPair = html.match(/json">\s*\[\s*['"]([^'"]+)['"]\s*\]\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
      if (lutPair !== null) {
        const loader = await getPage(absolute(lutPair[2], embedUrl), { Referer: embedUrl }, fetcher);
        const luts = loader !== null ? (loader.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || [])[1] || (loader.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i) || [])[1] : void 0;
        if (luts !== void 0) {
          const decoded = voeDecodeWithLut(lutPair[1], luts);
          const source = stringField(decoded, "source") || stringField(decoded, "direct_access_url");
          if (source !== null) {
            return { url: source, quality: qualityFromUrl(source), serverName: "VOE", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA2 } };
          }
        }
      }
      const rot13 = (html.match(/<script type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
      if (rot13 !== void 0) {
        const decoded = voeDecodeRot13(rot13.trim());
        const source = stringField(decoded, "source") || stringField(decoded, "direct_access_url");
        if (source !== null) {
          return { url: source, quality: qualityFromUrl(source), serverName: "VOE", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA2 } };
        }
      }
      const fields = [];
      const re = /(?:mp4|hls)['"]\s*:\s*['"]([^'"]+)['"]/gi;
      let match;
      while ((match = re.exec(html)) !== null) fields.push(match[1]);
      for (const value of fields) {
        if (value === "") continue;
        const target = value.indexOf("aHR0") === 0 ? base64Decode(value) || value : value;
        return { url: target, quality: qualityFromUrl(target), serverName: "VOE", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA2 } };
      }
      return null;
    }
    async function resolveVimeos(embedUrl, fetcher) {
      const origin = (embedUrl.match(/^(https?:\/\/[^/]+)/) || [null, "https://vimeos.net"])[1] || "https://vimeos.net";
      for (let attempt = 0; attempt < 3; attempt++) {
        const html = await getPage(embedUrl, { Referer: "https://la.movie/tv/", "Accept-Language": "es-MX,es;q=0.9", Accept: HTML_ACCEPT }, fetcher);
        if (html === null) return null;
        const unpacked = unpackPacked(html);
        const master = unpacked !== null ? (unpacked.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/) || [])[1] || (unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/) || [])[1] : void 0;
        if (master === void 0) return null;
        const iParam = (master.match(/[?&]i=([^&]*)/) || ["", ""])[1];
        if (iParam === "0.0") {
          return { url: master, quality: qualityFromUrl(master), serverName: "Vimeos", headers: { "User-Agent": DESKTOP_UA2, Referer: origin + "/", Origin: origin } };
        }
      }
      return null;
    }
    async function resolveLacloud(embedUrl, fetcher) {
      const html = await getPage(embedUrl, { Referer: "https://lamovie.org/" }, fetcher);
      if (html === null) return null;
      const src = (html.match(/const src\s*=\s*["']([^"']+)["']/) || [])[1];
      if (src === void 0) return null;
      return { url: src, quality: qualityFromUrl(src), serverName: "Lacloud", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA2 } };
    }
    async function resolvePacker(embedUrl, fetcher) {
      const html = await getPage(embedUrl, { Referer: "https://lamovie.org/" }, fetcher);
      if (html === null) return null;
      const unpacked = unpackPacked(html);
      const stream = unpacked !== null ? (unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) || [])[1] || (unpacked.match(/["'](\/[^"']+\.m3u8[^"']*)["']/) || [])[1] || (unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) || [])[1] : void 0;
      if (stream === void 0) return null;
      const target = absolute(stream, embedUrl);
      return { url: target, quality: qualityFromUrl(target), serverName: "EarnVids", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA2 } };
    }
    async function resolveDoodstream(embedUrl, fetcher) {
      const host = embedUrl.replace(/\/(d|f)\//, "/e/").replace("dsvplay.com", "d0000d.com");
      const html = await getPage(host, { Referer: "https://lamovie.org/", Origin: "https://lamovie.org" }, fetcher);
      if (html === null) return null;
      const match = html.match(/\$\.get\(['"](\/pass_md5\/[\w-]+\/([\w-]+))['"]/i);
      if (match === null) return null;
      const origin = host.split("/").slice(0, 3).join("/");
      const base = await getPage(origin + match[1], { Referer: host }, fetcher);
      if (base === null || base === "") return null;
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let padding = "";
      for (let i = 0; i < 10; i++) padding += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      const target = base + padding + "?token=" + match[2] + "&expiry=" + Date.now();
      return { url: target, quality: "720p", serverName: "DoodStream", headers: { "User-Agent": DESKTOP_UA2, Referer: origin + "/" } };
    }
    async function resolveUqload(embedUrl, fetcher) {
      const html = await getPage(embedUrl, { Referer: "https://uqload.com/" }, fetcher);
      if (html === null) return null;
      let sources = (html.match(/sources\s*[=:]\s*\[([^\]]+)\]/) || [])[1];
      if (sources === void 0) {
        const unpacked = unpackPacked(html);
        sources = unpacked !== null ? (unpacked.match(/sources\s*[=:]\s*\[([^\]]+)\]/) || [])[1] : void 0;
      }
      if (sources === void 0) return null;
      const url = (sources.match(/https?:\/\/[^\s"'<>]+/) || [])[0];
      if (url === void 0) return null;
      return { url, quality: qualityFromUrl(url), serverName: "Uqload", headers: { Referer: "https://uqload.com/", "User-Agent": DESKTOP_UA2 } };
    }
    async function resolveVidhide(embedUrl, fetcher) {
      const parts = embedUrl.split("/");
      const host = parts[2];
      const html = await getPage(embedUrl, { Referer: "https://" + host + "/" }, fetcher);
      if (html === null) return null;
      let target = (html.match(/"hls[24]"\s*:\s*"([^"]+)"/) || [])[1] || (html.match(/file\s*:\s*["']([^"']+)["']/i) || [])[1] || null;
      if (target === null) {
        const unpacked = unpackPacked(html);
        target = unpacked !== null ? (unpacked.match(/"hls[24]"\s*:\s*"([^"]+)"/) || [])[1] : null;
      }
      if (target === null) return null;
      if (target.indexOf("http") !== 0) target = "https://" + host + target;
      if (target.indexOf("referer=") === -1) target += (target.indexOf("?") === -1 ? "?" : "&") + "referer=embed69.org";
      return {
        url: target,
        quality: qualityFromUrl(target),
        serverName: "VidHide",
        headers: { Referer: embedUrl.split("?")[0], Origin: "https://" + host, "X-Requested-With": "XMLHttpRequest", "User-Agent": DESKTOP_UA2 }
      };
    }
    var RESOLVERS = {
      goodstream: resolveGoodstream,
      streamwish: resolveStreamWish,
      voe: resolveVoe,
      vimeos: resolveVimeos,
      lacloud: resolveLacloud,
      packer: resolvePacker,
      doodstream: resolveDoodstream,
      filemoon: null,
      // needs AES-CTR (crypto-js); embeds on filemoon are skipped for now
      vidhide: resolveVidhide,
      uqload: resolveUqload
    };
    async function resolveEmbed2(embedUrl, fetcher) {
      const family = familyFor(embedUrl);
      if (family === null || family === "filemoon") return null;
      const resolver = RESOLVERS[family];
      if (resolver === null || resolver === void 0) return null;
      try {
        return await resolver(embedUrl, fetcher);
      } catch {
        return null;
      }
    }
    module2.exports = { resolveEmbed: resolveEmbed2, serverLabelFor, qualityFromUrl, DESKTOP_UA: DESKTOP_UA2 };
  }
});

// providers/areshd.js
var { fetchText, fetchJson } = require_http();
var { scoreCandidate } = require_titles();
var { resolveEmbed, DESKTOP_UA } = require_resolvers();
var BASE_URL = "https://areshd.com";
var HEADERS = { Referer: BASE_URL + "/", "Accept-Language": "es-MX,es;q=0.9" };
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var MATCH_THRESHOLD = 45;
function stringValue(value) {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}
async function tmdbFind(id, type) {
  const base = type === "movie" ? "movie" : "tv";
  let tmdbId = null;
  if (id.indexOf("tmdb:") === 0) tmdbId = id.split(":")[1];
  else if (/^tt\d+$/.test(id)) {
    const found = await fetchJson("https://api.themoviedb.org/3/find/" + encodeURIComponent(id) + "?external_source=imdb_id&api_key=" + TMDB_KEY);
    const list = found !== null ? found[base === "movie" ? "movie_results" : "tv_results"] : null;
    const first = Array.isArray(list) && typeof list[0] === "object" ? list[0] : null;
    tmdbId = first !== null ? String(first.id) : null;
  }
  if (tmdbId === null || tmdbId === "") return null;
  const detail = await fetchJson("https://api.themoviedb.org/3/" + base + "/" + tmdbId + "?language=es-MX&api_key=" + TMDB_KEY);
  if (detail === null) return null;
  const title = stringValue(detail[base === "movie" ? "title" : "name"]);
  const originalTitle = stringValue(detail[base === "movie" ? "original_title" : "original_name"]);
  if (title === "" && originalTitle === "") return null;
  const date = stringValue(detail[base === "movie" ? "release_date" : "first_air_date"]);
  return { title: title || originalTitle, originalTitle: originalTitle || title, year: date === "" ? null : date.slice(0, 4) };
}
function parseCards(html) {
  const cards = [];
  const re = /<a class="Posters-link"[\s\S]*?href="([^"]+)"[\s\S]*?<img alt="([^"]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    if (match[1].indexOf("guia-") !== -1) continue;
    cards.push({ href: match[1], title: match[2].trim() });
  }
  return cards;
}
function bestMatch(html, title, originalTitle, year, kind) {
  let best = null;
  for (const card of parseCards(html)) {
    const isSeries = card.href.indexOf("/serie/") !== -1;
    if (kind === "series" !== isSeries) continue;
    const score = scoreCandidate(card.title, title, originalTitle, year);
    if (best === null || score > best.score) best = { href: card.href, score };
  }
  if (best === null || best.score < MATCH_THRESHOLD) return null;
  return best.href.indexOf("http") === 0 ? best.href : BASE_URL + best.href;
}
function parseLanguageTabs(html) {
  const langs = [];
  const re = /<li class="pres"><a class="playr">([^<]+)<\/a><\/li>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const label = match[1].toLowerCase();
    if (label.indexOf("latino") !== -1) langs.push("Latino");
    else if (label.indexOf("castellano") !== -1 || label.indexOf("espa\xF1ol") !== -1) langs.push("Castellano");
    else if (label.indexOf("subtitulado") !== -1 || label.indexOf("vose") !== -1) langs.push("Subtitulado");
    else langs.push("Desconocido");
  }
  return langs;
}
function parsePlayerBlocks(html) {
  const blocks = [];
  const re = /<ul class="TbVideoNv[^"]*"[^>]*>([\s\S]*?)<\/ul>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const players = [];
    const inner = /<li class="pres" data-tr="([^"]+)"/g;
    let m;
    while ((m = inner.exec(match[1])) !== null) players.push(m[1]);
    blocks.push(players);
  }
  return blocks;
}
async function getStreams(tmdbId, mediaType, season, episode) {
  const type = mediaType === "tv" || mediaType === "series" ? "series" : "movie";
  const id = String(tmdbId == null ? "" : tmdbId);
  const fetcher = fetch;
  try {
    const info = await tmdbFind(id, type);
    if (info === null) return [];
    let pageUrl = null;
    for (const keyword of [info.title, info.originalTitle]) {
      if (keyword === "" || keyword === void 0) continue;
      const html = await fetchText(BASE_URL + "/search/" + encodeURIComponent(keyword).replace(/%20/g, "+"), { headers: HEADERS, fetcher });
      if (html === null) continue;
      pageUrl = bestMatch(html, info.title, info.originalTitle, info.year, type);
      if (pageUrl !== null) break;
    }
    if (pageUrl === null) return [];
    let targetUrl = pageUrl;
    if (type === "series") {
      const seriesName = (pageUrl.match(/\/serie\/([^/?]+)/) || [])[1];
      if (seriesName === void 0 || season === null || season === void 0 || episode === null || episode === void 0) return [];
      targetUrl = BASE_URL + "/episodio/" + seriesName + "-temporada-" + season + "-episodio-" + episode;
    }
    const pageHtml = await fetchText(targetUrl, { headers: HEADERS, fetcher });
    if (pageHtml === null) return [];
    const languages = parseLanguageTabs(pageHtml);
    const blocks = parsePlayerBlocks(pageHtml);
    const tasks = [];
    blocks.forEach((players, index) => {
      const lang = languages[index] || "Desconocido";
      for (const playerUrl of players) tasks.push({ playerUrl, lang });
    });
    const settled = await Promise.all(tasks.map((task) => resolveOne(task, pageUrl, fetcher)));
    return settled.filter((stream) => stream !== null);
  } catch (error) {
    console.log("[areshd] resolve failed: " + (error && error.message ? error.message : error));
    return [];
  }
}
async function resolveOne(task, pageUrl, fetcher) {
  const playerHtml = await fetchText(task.playerUrl, { headers: Object.assign({ Referer: pageUrl }, HEADERS), fetcher });
  if (playerHtml === null) return null;
  const embedUrl = (playerHtml.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/i) || [])[1];
  if (embedUrl === void 0 || !/^https?:\/\//.test(embedUrl) || embedUrl.indexOf("youtube") !== -1) return null;
  const resolved = await resolveEmbed(embedUrl, fetcher).catch(() => null);
  if (resolved === null) return null;
  const quality = resolved.quality === "Unknown" ? "HD" : resolved.quality;
  return {
    name: "AresHD - " + quality,
    title: task.lang + " - " + (resolved.serverName || "AresHD") + " " + quality,
    url: resolved.url,
    quality,
    headers: Object.assign({ "User-Agent": DESKTOP_UA }, resolved.headers || {})
  };
}
module.exports = { getStreams };
