var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// lib/http.js
var require_http = __commonJS({
  "lib/http.js"(exports2, module2) {
    var DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    var HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    function fetchText(_0) {
      return __async(this, arguments, function* (url, options = {}) {
        const retries = options.retries === void 0 ? 1 : options.retries;
        const headers = Object.assign(
          { "User-Agent": DESKTOP_UA, Accept: HTML_ACCEPT },
          options.headers || {}
        );
        const doFetch = options.fetcher || fetch;
        let attempt = 0;
        for (; ; ) {
          let response;
          try {
            response = yield doFetch(url, { method: "GET", headers, redirect: "follow" });
          } catch (e) {
            return null;
          }
          const retryable = response.status === 429 || response.status === 408 || response.status >= 500 && response.status < 600;
          if (retryable && attempt < retries) {
            attempt += 1;
            yield sleep(Math.min(3200, 400 * Math.pow(2, attempt - 1)));
            continue;
          }
          if (!response.ok) return null;
          try {
            return yield response.text();
          } catch (e) {
            return null;
          }
        }
      });
    }
    function fetchJson(_0) {
      return __async(this, arguments, function* (url, options = {}) {
        const body = yield fetchText(url, Object.assign({}, options, { headers: Object.assign({ Accept: "application/json" }, options.headers || {}) }));
        if (body === null) return null;
        try {
          return JSON.parse(body);
        } catch (e) {
          return null;
        }
      });
    }
    module2.exports = { fetchText, fetchJson, sleep, DESKTOP_UA, HTML_ACCEPT };
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
      } catch (e) {
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
      } catch (e) {
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
      } catch (e) {
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
      zilla: ["zilla-networks"],
      streamtape: ["streamtape"],
      mp4upload: ["mp4upload"],
      nyuu: ["streamhj"],
      packer: ["earnvids.com", "earnl.one", "vidnova.online", "streamfort.online"]
    };
    var FAMILY_ORDER = ["voe", "filemoon", "streamwish", "vidhide", "uqload", "zilla", "streamtape", "mp4upload", "nyuu", "goodstream", "vimeos", "lacloud", "doodstream", "packer"];
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
      if (family === "zilla") return "Zilla";
      if (family === "streamtape") return "Streamtape";
      if (family === "mp4upload") return "MP4Upload";
      if (family === "nyuu") return "Nyuu";
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

// lib/crypto.js
var require_crypto = __commonJS({
  "lib/crypto.js"(exports2, module2) {
    var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function base64ToBytes(value) {
      const clean = String(value).replace(/[^A-Za-z0-9+/]/g, "");
      const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
      let o = 0;
      for (let i = 0; i < clean.length; i += 4) {
        const a = B64.indexOf(clean[i]);
        const b = B64.indexOf(clean[i + 1]);
        const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
        const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
        const n = a << 18 | b << 12 | (c === -1 ? 0 : c) << 6 | (d === -1 ? 0 : d);
        out[o++] = n >> 16 & 255;
        if (c !== -1) out[o++] = n >> 8 & 255;
        if (d !== -1) out[o++] = n & 255;
      }
      return out.subarray(0, o);
    }
    function bytesToUtf8(bytes) {
      let out = "";
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (byte < 128) out += String.fromCharCode(byte);
        else if (byte >= 192 && byte < 224) {
          out += String.fromCharCode((byte & 31) << 6 | bytes[i + 1] & 63);
          i += 1;
        } else if (byte >= 224 && byte < 240) {
          out += String.fromCharCode((byte & 15) << 12 | (bytes[i + 1] & 63) << 6 | bytes[i + 2] & 63);
          i += 2;
        } else {
          const code = (byte & 7) << 18 | (bytes[i + 1] & 63) << 12 | (bytes[i + 2] & 63) << 6 | bytes[i + 3] & 63;
          const offset = code - 65536;
          out += String.fromCharCode(55296 + (offset >> 10), 56320 + (offset & 1023));
          i += 3;
        }
      }
      return out;
    }
    function hexToBytes(hex) {
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
      return out;
    }
    function bytesToHex(bytes) {
      let out = "";
      for (let i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
      return out;
    }
    var SHA256_K = [
      1116352408,
      1899447441,
      3049323471,
      3921009573,
      961987163,
      1508970993,
      2453635748,
      2870763221,
      3624381080,
      310598401,
      607225278,
      1426881987,
      1925078388,
      2162078206,
      2614888103,
      3248222580,
      3835390401,
      4022224774,
      264347078,
      604807628,
      770255983,
      1249150122,
      1555081692,
      1996064986,
      2554220882,
      2821834349,
      2952996808,
      3210313671,
      3336571891,
      3584528711,
      113926993,
      338241895,
      666307205,
      773529912,
      1294757372,
      1396182291,
      1695183700,
      1986661051,
      2177026350,
      2456956037,
      2730485921,
      2820302411,
      3259730800,
      3345764771,
      3516065817,
      3600352804,
      4094571909,
      275423344,
      430227734,
      506948616,
      659060556,
      883997877,
      958139571,
      1322822218,
      1537002063,
      1747873779,
      1955562222,
      2024104815,
      2227730452,
      2361852424,
      2428436474,
      2756734187,
      3204031479,
      3329325298
    ];
    function utf8ToBytes(value) {
      const out = [];
      for (let i = 0; i < value.length; i++) {
        let code = value.charCodeAt(i);
        if (code < 128) out.push(code);
        else if (code < 2048) {
          out.push(192 | code >> 6, 128 | code & 63);
        } else if (code >= 55296 && code <= 56319 && i + 1 < value.length) {
          const next = value.charCodeAt(i + 1);
          if (next >= 56320 && next <= 57343) {
            code = 65536 + (code - 55296 << 10) + (next - 56320);
            i += 1;
            out.push(240 | code >> 18, 128 | code >> 12 & 63, 128 | code >> 6 & 63, 128 | code & 63);
            continue;
          }
          out.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
        } else if (code < 65536) {
          out.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
        }
      }
      return new Uint8Array(out);
    }
    var SHA256_H = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
    function rotr(value, bits) {
      return (value >>> bits | value << 32 - bits) >>> 0;
    }
    function sha256(input) {
      const message = typeof input === "string" ? utf8ToBytes(input) : input;
      const bitLength = message.length * 8;
      const padded = new Uint8Array((message.length + 8 >> 6) + 1 << 6);
      padded.set(message);
      padded[message.length] = 128;
      const view = new DataView(padded.buffer);
      view.setUint32(padded.length - 4, bitLength >>> 0, false);
      view.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296), false);
      const h = SHA256_H.slice();
      const w = new Uint32Array(64);
      for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
        for (let i = 16; i < 64; i++) {
          const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3) >>> 0;
          const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10) >>> 0;
          w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
          const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
          const ch = (e & f ^ ~e & g) >>> 0;
          const temp1 = hh + S1 + ch + SHA256_K[i] + w[i] >>> 0;
          const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
          const maj = (a & b ^ a & c ^ b & c) >>> 0;
          const temp2 = S0 + maj >>> 0;
          hh = g;
          g = f;
          f = e;
          e = d + temp1 >>> 0;
          d = c;
          c = b;
          b = a;
          a = temp1 + temp2 >>> 0;
        }
        h[0] = h[0] + a >>> 0;
        h[1] = h[1] + b >>> 0;
        h[2] = h[2] + c >>> 0;
        h[3] = h[3] + d >>> 0;
        h[4] = h[4] + e >>> 0;
        h[5] = h[5] + f >>> 0;
        h[6] = h[6] + g >>> 0;
        h[7] = h[7] + hh >>> 0;
      }
      const out = new Uint8Array(32);
      const outView = new DataView(out.buffer);
      for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
      return out;
    }
    var SBOX = new Uint8Array(256);
    var RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54, 108, 216, 171, 77];
    (function buildSbox() {
      let p = 1;
      let q = 1;
      do {
        p = (p ^ p << 1 & 255 ^ (p & 128 ? 27 : 0)) & 255;
        q ^= q << 1 & 255;
        q ^= q << 2 & 255;
        q ^= q << 4 & 255;
        q &= 255;
        if (q & 128) q ^= 9;
        SBOX[p] = (q ^ (q << 1 | q >> 7) ^ (q << 2 | q >> 6) ^ (q << 3 | q >> 5) ^ (q << 4 | q >> 4) ^ 99) & 255;
      } while (p !== 1);
      SBOX[0] = 99;
    })();
    var INV_SBOX = new Uint8Array(256);
    for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
    function xtime(value) {
      return (value << 1 ^ (value & 128 ? 27 : 0)) & 255;
    }
    function mul(a, b) {
      let result = 0;
      let left = a;
      let right = b;
      while (right > 0) {
        if (right & 1) result ^= left;
        left = xtime(left);
        right >>= 1;
      }
      return result & 255;
    }
    function expandKey(key) {
      if (key.length !== 32) throw new Error("AES-256 needs a 32-byte key");
      const words = new Uint32Array(60);
      const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
      for (let i = 0; i < 8; i++) words[i] = view.getUint32(i * 4, false);
      for (let i = 8; i < 60; i++) {
        let temp = words[i - 1];
        if (i % 8 === 0) {
          temp = (temp << 8 | temp >>> 24) >>> 0;
          const b0 = SBOX[temp >>> 24 & 255];
          const b1 = SBOX[temp >>> 16 & 255];
          const b2 = SBOX[temp >>> 8 & 255];
          const b3 = SBOX[temp & 255];
          temp = (b0 << 24 | b1 << 16 | b2 << 8 | b3) >>> 0 ^ RCON[i / 8 - 1] << 24;
        } else if (i % 8 === 4) {
          temp = (SBOX[temp >>> 24 & 255] << 24 | SBOX[temp >>> 16 & 255] << 16 | SBOX[temp >>> 8 & 255] << 8 | SBOX[temp & 255]) >>> 0;
        }
        words[i] = (words[i - 8] ^ temp) >>> 0;
      }
      return words;
    }
    function addRoundKey(state, words, round) {
      const view = new DataView(state.buffer, state.byteOffset, 16);
      for (let c = 0; c < 4; c++) {
        const word = words[round * 4 + c] >>> 0;
        const current = view.getUint32(c * 4, false) >>> 0;
        view.setUint32(c * 4, (current ^ word) >>> 0, false);
      }
    }
    function subBytes(state, box) {
      for (let i = 0; i < 16; i++) state[i] = box[state[i]];
    }
    function shiftRows(state) {
      const copy = state.slice();
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          state[col * 4 + row] = copy[(col + row) % 4 * 4 + row];
        }
      }
    }
    function invShiftRows(state) {
      const copy = state.slice();
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          state[(col + row) % 4 * 4 + row] = copy[col * 4 + row];
        }
      }
    }
    function mixColumns(state) {
      for (let c = 0; c < 4; c++) {
        const a0 = state[c * 4], a1 = state[c * 4 + 1], a2 = state[c * 4 + 2], a3 = state[c * 4 + 3];
        state[c * 4] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
        state[c * 4 + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
        state[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
        state[c * 4 + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
      }
    }
    function invMixColumns(state) {
      for (let c = 0; c < 4; c++) {
        const a0 = state[c * 4], a1 = state[c * 4 + 1], a2 = state[c * 4 + 2], a3 = state[c * 4 + 3];
        state[c * 4] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
        state[c * 4 + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
        state[c * 4 + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
        state[c * 4 + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
      }
    }
    function encryptBlock(block, words) {
      const state = block.slice();
      addRoundKey(state, words, 0);
      for (let round = 1; round < 14; round++) {
        subBytes(state, SBOX);
        shiftRows(state);
        mixColumns(state);
        addRoundKey(state, words, round);
      }
      subBytes(state, SBOX);
      shiftRows(state);
      addRoundKey(state, words, 14);
      return state;
    }
    function decryptBlock(block, words) {
      const state = block.slice();
      addRoundKey(state, words, 14);
      for (let round = 13; round > 0; round--) {
        invShiftRows(state);
        subBytes(state, INV_SBOX);
        addRoundKey(state, words, round);
        invMixColumns(state);
      }
      invShiftRows(state);
      subBytes(state, INV_SBOX);
      addRoundKey(state, words, 0);
      return state;
    }
    function aesCbcDecrypt(ciphertext, key, iv) {
      try {
        if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return null;
        const words = expandKey(key);
        const out = new Uint8Array(ciphertext.length);
        let previous = iv;
        for (let offset = 0; offset < ciphertext.length; offset += 16) {
          const block = ciphertext.subarray(offset, offset + 16);
          const plain = decryptBlock(block, words);
          for (let i = 0; i < 16; i++) out[offset + i] = plain[i] ^ previous[i];
          previous = block;
        }
        const pad = out[out.length - 1];
        if (pad < 1 || pad > 16) return null;
        for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) return null;
        return bytesToUtf8(out.subarray(0, out.length - pad));
      } catch (e) {
        return null;
      }
    }
    function aesCtrDecrypt(ciphertext, key, iv, start) {
      try {
        if (ciphertext.length === 0) return null;
        const words = expandKey(key);
        const out = new Uint8Array(ciphertext.length);
        let counter = (start === void 0 ? 2 : start) >>> 0;
        for (let offset = 0; offset < ciphertext.length; offset += 16) {
          const block = new Uint8Array(16);
          block.set(iv.subarray(0, 12));
          new DataView(block.buffer).setUint32(12, counter, false);
          const keystream = encryptBlock(block, words);
          const length = Math.min(16, ciphertext.length - offset);
          for (let i = 0; i < length; i++) out[offset + i] = ciphertext[offset + i] ^ keystream[i];
          counter = counter + 1 >>> 0;
        }
        return bytesToUtf8(out);
      } catch (e) {
        return null;
      }
    }
    module2.exports = {
      base64ToBytes,
      bytesToUtf8,
      hexToBytes,
      bytesToHex,
      utf8ToBytes,
      sha256,
      expandKey,
      aesCbcDecrypt,
      aesCtrDecrypt
    };
  }
});

// lib/resolvers.js
var require_resolvers = __commonJS({
  "lib/resolvers.js"(exports2, module2) {
    var { fetchText, fetchJson } = require_http();
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
    var DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    var HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    function getPage(url, headers, fetcher) {
      return __async(this, null, function* () {
        return yield fetchText(url, { headers, retries: 1, fetcher });
      });
    }
    function stringField(value, field) {
      if (typeof value !== "object" || value === null) return null;
      const candidate = value[field];
      return typeof candidate === "string" && candidate !== "" ? candidate : null;
    }
    function resolveGoodstream(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const html = yield getPage(embedUrl, { Referer: "https://goodstream.one", Origin: "https://goodstream.one", Accept: HTML_ACCEPT }, fetcher);
        if (html === null) return null;
        const file = (html.match(/file:\s*"([^"]+)"/) || [])[1];
        if (file === void 0) return null;
        return { url: file, quality: qualityFromUrl(file), serverName: "GoodStream", headers: { Referer: embedUrl, Origin: "https://goodstream.one", "User-Agent": DESKTOP_UA } };
      });
    }
    function resolveStreamWish(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const url = embedUrl.replace("hglink.to", "vibuxer.com");
        const origin = (url.match(/^(https?:\/\/[^/]+)/) || [null, "https://hlswish.com"])[1] || "https://hlswish.com";
        const html = yield getPage(url, {
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
              const followed = yield fetcher(target, { headers: { "User-Agent": DESKTOP_UA, Referer: origin + "/" }, redirect: "follow" });
              if (followed.url && followed.url.indexOf(".m3u8") !== -1) target = followed.url;
            } catch (e) {
            }
          }
          return { url: target, quality: qualityFromUrl(target), serverName: "StreamWish", headers: { "User-Agent": DESKTOP_UA, Referer: origin + "/" } };
        }
        const unpacked = unpackPacked(html);
        if (unpacked !== null) {
          const fromHls = (unpacked.match(/\{[^{}]*"hls[234]"\s*:\s*"([^"]+)"[^{}]*\}/) || [])[1] || (unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/) || [])[1];
          if (fromHls !== void 0) {
            const target = absolute(fromHls, origin);
            return { url: target, quality: qualityFromUrl(target), serverName: "StreamWish", headers: { "User-Agent": DESKTOP_UA, Referer: origin + "/" } };
          }
        }
        const fileCode = (url.match(/\/e\/([\w-]+)/) || [])[1] || "";
        const pageHash = (html.match(/[0-9a-f]{32}/i) || [])[0];
        if (fileCode !== "" && pageHash !== void 0) {
          const dl = yield fetchText(origin + "/dl?op=view&file_code=" + encodeURIComponent(fileCode) + "&hash=" + pageHash + "&embed=1&referer=&adb=1&hls4=1", {
            headers: { "User-Agent": DESKTOP_UA, Referer: url, "X-Requested-With": "XMLHttpRequest" }
          }, fetcher);
          const fromDl = dl !== null ? (dl.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i) || [])[0] : void 0;
          if (fromDl !== void 0) {
            return { url: fromDl, quality: qualityFromUrl(fromDl), serverName: "StreamWish", headers: { "User-Agent": DESKTOP_UA, Referer: origin + "/" } };
          }
        }
        const raw = (html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i) || [])[0];
        if (raw !== void 0) {
          return { url: raw, quality: qualityFromUrl(raw), serverName: "StreamWish", headers: { "User-Agent": DESKTOP_UA, Referer: origin + "/" } };
        }
        return null;
      });
    }
    function resolveVoe(embedUrl, fetcher) {
      return __async(this, null, function* () {
        let html = yield getPage(embedUrl, { Referer: embedUrl, Accept: HTML_ACCEPT }, fetcher);
        if (html === null) return null;
        if (/permanentToken/i.test(html)) {
          const redirect = (html.match(/window\.location\.href\s*=\s*'([^']+)'/i) || [])[1];
          if (redirect !== void 0) {
            const next = yield getPage(redirect, { Referer: embedUrl, Accept: HTML_ACCEPT }, fetcher);
            if (next !== null) html = next;
          }
        }
        const lutPair = html.match(/json">\s*\[\s*['"]([^'"]+)['"]\s*\]\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
        if (lutPair !== null) {
          const loader = yield getPage(absolute(lutPair[2], embedUrl), { Referer: embedUrl }, fetcher);
          const luts = loader !== null ? (loader.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || [])[1] || (loader.match(/(\[(?:"[^"]{1,10}"[,\s]*){4,12}\])/i) || [])[1] : void 0;
          if (luts !== void 0) {
            const decoded = voeDecodeWithLut(lutPair[1], luts);
            const source = stringField(decoded, "source") || stringField(decoded, "direct_access_url");
            if (source !== null) {
              return { url: source, quality: qualityFromUrl(source), serverName: "VOE", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA } };
            }
          }
        }
        const rot13 = (html.match(/<script type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
        if (rot13 !== void 0) {
          const decoded = voeDecodeRot13(rot13.trim());
          const source = stringField(decoded, "source") || stringField(decoded, "direct_access_url");
          if (source !== null) {
            return { url: source, quality: qualityFromUrl(source), serverName: "VOE", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA } };
          }
        }
        const fields = [];
        const re = /(?:mp4|hls)['"]\s*:\s*['"]([^'"]+)['"]/gi;
        let match;
        while ((match = re.exec(html)) !== null) fields.push(match[1]);
        for (const value of fields) {
          if (value === "") continue;
          const target = value.indexOf("aHR0") === 0 ? base64Decode(value) || value : value;
          return { url: target, quality: qualityFromUrl(target), serverName: "VOE", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA } };
        }
        return null;
      });
    }
    function resolveVimeos(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const origin = (embedUrl.match(/^(https?:\/\/[^/]+)/) || [null, "https://vimeos.net"])[1] || "https://vimeos.net";
        for (let attempt = 0; attempt < 3; attempt++) {
          const html = yield getPage(embedUrl, { Referer: "https://la.movie/tv/", "Accept-Language": "es-MX,es;q=0.9", Accept: HTML_ACCEPT }, fetcher);
          if (html === null) return null;
          const unpacked = unpackPacked(html);
          const master = unpacked !== null ? (unpacked.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/) || [])[1] || (unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/) || [])[1] : void 0;
          if (master === void 0) return null;
          const iParam = (master.match(/[?&]i=([^&]*)/) || ["", ""])[1];
          if (iParam === "0.0") {
            return { url: master, quality: qualityFromUrl(master), serverName: "Vimeos", headers: { "User-Agent": DESKTOP_UA, Referer: origin + "/", Origin: origin } };
          }
        }
        return null;
      });
    }
    function resolveLacloud(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const html = yield getPage(embedUrl, { Referer: "https://lamovie.org/" }, fetcher);
        if (html === null) return null;
        const src = (html.match(/const src\s*=\s*["']([^"']+)["']/) || [])[1];
        if (src === void 0) return null;
        return { url: src, quality: qualityFromUrl(src), serverName: "Lacloud", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA } };
      });
    }
    function resolvePacker(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const html = yield getPage(embedUrl, { Referer: "https://lamovie.org/" }, fetcher);
        if (html === null) return null;
        const unpacked = unpackPacked(html);
        const stream = unpacked !== null ? (unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) || [])[1] || (unpacked.match(/["'](\/[^"']+\.m3u8[^"']*)["']/) || [])[1] || (unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) || [])[1] : void 0;
        if (stream === void 0) return null;
        const target = absolute(stream, embedUrl);
        return { url: target, quality: qualityFromUrl(target), serverName: "EarnVids", headers: { Referer: embedUrl, "User-Agent": DESKTOP_UA } };
      });
    }
    function resolveDoodstream(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const host = embedUrl.replace(/\/(d|f)\//, "/e/").replace("dsvplay.com", "d0000d.com");
        const html = yield getPage(host, { Referer: "https://lamovie.org/", Origin: "https://lamovie.org" }, fetcher);
        if (html === null) return null;
        const match = html.match(/\$\.get\(['"](\/pass_md5\/[\w-]+\/([\w-]+))['"]/i);
        if (match === null) return null;
        const origin = host.split("/").slice(0, 3).join("/");
        const base = yield getPage(origin + match[1], { Referer: host }, fetcher);
        if (base === null || base === "") return null;
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let padding = "";
        for (let i = 0; i < 10; i++) padding += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        const target = base + padding + "?token=" + match[2] + "&expiry=" + Date.now();
        return { url: target, quality: "720p", serverName: "DoodStream", headers: { "User-Agent": DESKTOP_UA, Referer: origin + "/" } };
      });
    }
    function resolveUqload(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const html = yield getPage(embedUrl, { Referer: "https://uqload.com/" }, fetcher);
        if (html === null) return null;
        let sources = (html.match(/sources\s*[=:]\s*\[([^\]]+)\]/) || [])[1];
        if (sources === void 0) {
          const unpacked = unpackPacked(html);
          sources = unpacked !== null ? (unpacked.match(/sources\s*[=:]\s*\[([^\]]+)\]/) || [])[1] : void 0;
        }
        if (sources === void 0) return null;
        const url = (sources.match(/https?:\/\/[^\s"'<>]+/) || [])[0];
        if (url === void 0) return null;
        return { url, quality: qualityFromUrl(url), serverName: "Uqload", headers: { Referer: "https://uqload.com/", "User-Agent": DESKTOP_UA } };
      });
    }
    function resolveVidhide(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const parts = embedUrl.split("/");
        const host = parts[2];
        const html = yield getPage(embedUrl, { Referer: "https://" + host + "/" }, fetcher);
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
          headers: { Referer: embedUrl.split("?")[0], Origin: "https://" + host, "X-Requested-With": "XMLHttpRequest", "User-Agent": DESKTOP_UA }
        };
      });
    }
    function resolveZilla(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const id = (embedUrl.match(/\/play\/([a-fA-F0-9]{32})/) || embedUrl.match(/\/([a-fA-F0-9]{32})/) || [])[1];
        const target = id !== void 0 ? "https://player.zilla-networks.com/m3u8/" + id : embedUrl.replace("/play/", "/m3u8/");
        if (target.indexOf(".m3u8") === -1 && target.indexOf("/m3u8/") === -1) return null;
        const headers = { "User-Agent": DESKTOP_UA, Referer: "https://player.zilla-networks.com/", Origin: "https://player.zilla-networks.com" };
        const quality = yield probePlaylistQuality(target, headers, fetcher);
        return { url: target, quality, serverName: "Zilla", headers };
      });
    }
    function resolveStreamtape(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const target = embedUrl.replace("/v/", "/e/");
        const html = yield getPage(target, { Referer: target }, fetcher);
        if (html === null) return null;
        const match = html.match(/document\.getElementById\(['"](?:robotlink|ideoolink|noroot)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*(?:\(['"]([^'"]+)['"]\)\.substring\((\d+)\)|['"]([^'"]+)['"])/i);
        if (match === null) return null;
        const tail = match[2] !== void 0 && match[3] !== void 0 ? match[2].substring(parseInt(match[3], 10)) : match[4] || "";
        const url = "https:" + match[1] + tail;
        return { url, quality: qualityFromUrl(url), serverName: "Streamtape", headers: { "User-Agent": DESKTOP_UA, Referer: target } };
      });
    }
    function resolveMp4upload(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const html = yield getPage(embedUrl, { Referer: "https://www.mp4upload.com/" }, fetcher);
        if (html === null) return null;
        const quality = /FHD|1080/.test(html) ? "1080p" : /HD|720/.test(html) ? "720p" : /SD|480/.test(html) ? "480p" : "1080p";
        const unpacked = unpackPacked(html);
        const fromPacked = unpacked !== null ? (unpacked.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i) || [])[0] : void 0;
        const direct = fromPacked !== void 0 ? fromPacked : (html.match(/https?:\/\/[a-zA-Z0-9.-]+\.mp4upload\.com(?::\d+)?\/[a-zA-Z0-9/._-]+\.mp4/i) || [])[0];
        if (direct === void 0) return null;
        return { url: direct, quality, serverName: "MP4Upload", headers: { "User-Agent": DESKTOP_UA, Referer: embedUrl } };
      });
    }
    function resolveNyuu(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const html = yield getPage(embedUrl, { Referer: embedUrl }, fetcher);
        if (html === null) return null;
        const unpacked = unpackPacked(html);
        const source = unpacked !== null ? unpacked : html;
        const url = (source.match(/https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)[^"'\s\\]*/i) || [])[0];
        if (url === void 0) return null;
        return { url, quality: qualityFromUrl(url), serverName: "Nyuu", headers: { "User-Agent": DESKTOP_UA, Referer: embedUrl } };
      });
    }
    function probePlaylistQuality(url, headers, fetcher) {
      return __async(this, null, function* () {
        try {
          const response = yield fetcher(url, { headers, redirect: "follow" });
          if (!response.ok) return "Unknown";
          const text = yield response.text();
          const matches = [];
          const re = /RESOLUTION=\d+x(\d+)/gi;
          let match;
          while ((match = re.exec(text)) !== null) matches.push(parseInt(match[1], 10));
          if (matches.length === 0) return qualityFromUrl(url);
          const best = Math.max.apply(null, matches);
          if (best >= 2160) return "4K";
          if (best >= 1080) return "1080p";
          if (best >= 720) return "720p";
          if (best >= 480) return "480p";
          return "360p";
        } catch (e) {
          return qualityFromUrl(url);
        }
      });
    }
    var { base64ToBytes, aesCtrDecrypt } = require_crypto();
    function resolveFilemoon(embedUrl, fetcher) {
      return __async(this, null, function* () {
        try {
          const parts = embedUrl.split("/");
          const host = parts[2];
          const videoId = parts.filter(Boolean).pop();
          if (videoId === void 0 || host === void 0) return null;
          const apiHeaders = { "X-Requested-With": "XMLHttpRequest", Referer: embedUrl, "User-Agent": DESKTOP_UA };
          const details = yield fetchJson("https://" + host + "/api/videos/" + videoId + "/embed/details", { headers: apiHeaders, fetcher });
          if (details === null || !details.embed_frame_url) return null;
          const frame = details.embed_frame_url;
          const playbackOrigin = frame.split("/").slice(0, 3).join("/");
          const challenge = yield fetchJson(playbackOrigin + "/api/videos/access/challenge", { headers: Object.assign({}, apiHeaders, { Referer: frame, Origin: playbackOrigin }), fetcher });
          if (challenge === null || !challenge.challenge_id) return null;
          const viewerId = Math.random().toString(36).slice(2, 15);
          const deviceId = Math.random().toString(36).slice(2, 15);
          const attest = yield postJson(playbackOrigin + "/api/videos/access/attest", {
            viewer_id: viewerId,
            device_id: deviceId,
            challenge_id: challenge.challenge_id,
            nonce: challenge.nonce,
            signature: "MEUCIQDYi5fX9gG8_5t_4v8p_Q8o8l5v8v8v8v8v8v8v8v8v",
            public_key: { kty: "EC", crv: "P-256", x: "thRcTF9d89tZ704lTYciJq48dtIaoqf9L0Is1gK29II", y: "v8Oo5z9N9406uE4RnU3dlmpbAaMQtt61uynn6kgz4_Q" },
            client: { user_agent: DESKTOP_UA, platform: "Windows", languages: ["es-ES"] },
            storage: { cookie: viewerId, local_storage: viewerId },
            attributes: { entropy: "high" }
          }, Object.assign({}, apiHeaders, { Referer: frame, Origin: playbackOrigin }), fetcher);
          if (attest === null || !attest.token) return null;
          const playback = yield postJson(playbackOrigin + "/api/videos/" + videoId + "/embed/playback", {
            fingerprint: { token: attest.token, viewer_id: attest.viewer_id || viewerId, device_id: attest.device_id || deviceId, confidence: attest.confidence }
          }, Object.assign({}, apiHeaders, { Referer: frame, Origin: playbackOrigin, "X-Embed-Parent": embedUrl }), fetcher);
          if (playback === null || !playback.playback) return null;
          const decrypted = decryptByse(playback.playback);
          if (decrypted === null) return null;
          const data = JSON.parse(decrypted);
          const sources = Array.isArray(data.sources) ? data.sources : [];
          const direct = sources[0] && sources[0].url || data.url;
          if (direct === void 0) return null;
          return { url: direct, quality: sources[0] && sources[0].label || "HD", serverName: "Filemoon", headers: { "User-Agent": DESKTOP_UA, Referer: playbackOrigin, Origin: playbackOrigin } };
        } catch (e) {
          return null;
        }
      });
    }
    function postJson(url, body, headers, fetcher) {
      return __async(this, null, function* () {
        try {
          const response = yield fetcher(url, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });
          if (!response.ok) return null;
          return yield response.json();
        } catch (e) {
          return null;
        }
      });
    }
    function decryptByse(playback) {
      try {
        if (!playback || !playback.key_parts || !playback.iv || !playback.payload) return null;
        const keyParts = playback.key_parts.map((part) => base64ToBytes(String(part).replace(/-/g, "+").replace(/_/g, "/")));
        const key = new Uint8Array(keyParts.reduce((total, part) => total + part.length, 0));
        let offset = 0;
        for (const part of keyParts) {
          key.set(part, offset);
          offset += part.length;
        }
        const iv = base64ToBytes(String(playback.iv).replace(/-/g, "+").replace(/_/g, "/"));
        const payload = base64ToBytes(String(playback.payload).replace(/-/g, "+").replace(/_/g, "/"));
        if (payload.length <= 16) return null;
        if ([16, 24, 32].indexOf(key.length) === -1) return null;
        const text = aesCtrDecrypt(payload.subarray(0, payload.length - 16), key, iv.subarray(0, 12), 2);
        return text === null || text === "" ? null : text;
      } catch (e) {
        return null;
      }
    }
    var RESOLVERS = {
      goodstream: resolveGoodstream,
      streamwish: resolveStreamWish,
      voe: resolveVoe,
      vimeos: resolveVimeos,
      lacloud: resolveLacloud,
      packer: resolvePacker,
      doodstream: resolveDoodstream,
      filemoon: resolveFilemoon,
      vidhide: resolveVidhide,
      uqload: resolveUqload,
      zilla: resolveZilla,
      streamtape: resolveStreamtape,
      mp4upload: resolveMp4upload,
      nyuu: resolveNyuu
    };
    function resolveEmbed(embedUrl, fetcher) {
      return __async(this, null, function* () {
        const family = familyFor(embedUrl);
        if (family === null || family === "filemoon") return null;
        const resolver = RESOLVERS[family];
        if (resolver === null || resolver === void 0) return null;
        try {
          return yield resolver(embedUrl, fetcher);
        } catch (e) {
          return null;
        }
      });
    }
    module2.exports = { resolveEmbed, serverLabelFor, qualityFromUrl, DESKTOP_UA };
  }
});

// lib/pow.js
var require_pow = __commonJS({
  "lib/pow.js"(exports2, module2) {
    var { sha256, bytesToHex, base64ToBytes, aesCbcDecrypt } = require_crypto();
    function deriveAesKey(html, maxNonce) {
      const challenge = (html.match(/POW_CHALLENGE\s*=\s*['"]([^'"]+)['"]/) || [])[1];
      const difficulty = (html.match(/POW_DIFFICULTY\s*=\s*(\d+)/) || [])[1];
      const salt = (html.match(/POW_SALT\s*=\s*['"]([^'"]+)['"]/) || [])[1];
      if (challenge === void 0 || difficulty === void 0 || salt === void 0) return null;
      const prefix = new Array(parseInt(difficulty, 10) + 1).join("0");
      const budget = maxNonce || 5e5;
      for (let nonce = 0; nonce <= budget; nonce++) {
        if (bytesToHex(sha256(challenge + String(nonce))).indexOf(prefix) === 0) {
          return sha256(challenge + String(nonce) + salt);
        }
      }
      return null;
    }
    function decryptAesToken(token, keyBytes) {
      try {
        if (!token || !keyBytes) return null;
        if (token.indexOf("http") === 0) return token;
        const raw = base64ToBytes(token);
        if (raw.length <= 16) return null;
        const plaintext = aesCbcDecrypt(raw.subarray(16), keyBytes, raw.subarray(0, 16));
        return plaintext !== null && /^https?:\/\//i.test(plaintext) ? plaintext : null;
      } catch (e) {
        return null;
      }
    }
    function collectEmbedTasks(items, aesKey) {
      const LANG_LABELS = { LAT: "Latino", ESP: "Castellano", SUB: "Subtitulado" };
      const tasks = [];
      const seen = {};
      for (const item of items) {
        const language = String(item.video_language || "").toUpperCase();
        if (LANG_LABELS[language] === void 0) continue;
        const lang = LANG_LABELS[language];
        const embeds = Array.isArray(item.sortedEmbeds) ? item.sortedEmbeds : [];
        for (const embed of embeds) {
          if (!embed.link) continue;
          const link = decryptLink(embed.link, aesKey);
          if (link === null || !/^https?:\/\//i.test(link)) continue;
          const lower = link.toLowerCase();
          const serverName = String(embed.servername || "").toLowerCase();
          const isDownload = serverName.indexOf("download") !== -1 || serverName.indexOf("direct") !== -1 || serverName.indexOf("descarga") !== -1 || lower.indexOf("/d/") !== -1 || lower.indexOf("/download/") !== -1 || lower.indexOf("/get/") !== -1 || lower.indexOf("mediafire.com") !== -1 || lower.indexOf("mega.nz") !== -1 || lower.indexOf("embed69.org/d/") !== -1 || lower.indexOf("gdrive") !== -1;
          if (isDownload || seen[link]) continue;
          seen[link] = true;
          tasks.push({ url: link, hint: serverName, lang, server: embed.servername || "Servidor" });
        }
      }
      return tasks;
    }
    function decryptLink(token, aesKey) {
      if (token.indexOf("http") !== -1) return token;
      if (aesKey !== null && aesKey !== void 0) {
        const decrypted = decryptAesToken(token, aesKey);
        if (decrypted !== null) return decrypted;
      }
      const parts = token.split(".");
      if (parts.length === 3) {
        try {
          const payload = String.fromCharCode.apply(null, base64ToBytes(parts[1]));
          const parsed = JSON.parse(payload);
          return typeof parsed.link === "string" ? parsed.link : null;
        } catch (e) {
          return null;
        }
      }
      return null;
    }
    module2.exports = { deriveAesKey, decryptAesToken, decryptLink, collectEmbedTasks };
  }
});

// lib/vidurl.js
var require_vidurl = __commonJS({
  "lib/vidurl.js"(exports2, module2) {
    var { fetchText, fetchJson } = require_http();
    var { resolveEmbed, DESKTOP_UA } = require_resolvers();
    var { deriveAesKey, collectEmbedTasks } = require_pow();
    var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
    function stringValue(value) {
      return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
    }
    function createVidurlProvider2(config) {
      return function getStreams(tmdbId, mediaType, season, episode) {
        return __async(this, null, function* () {
          const type = mediaType === "tv" || mediaType === "series" ? "series" : "movie";
          const id = String(tmdbId == null ? "" : tmdbId);
          const fetcher = fetch;
          try {
            const info = yield tmdbFind(id, type);
            if (info === null || info.imdbId === null) return [];
            const pagePath = type === "series" && season !== null && season !== void 0 && episode !== null && episode !== void 0 ? "/vidurl/" + info.imdbId + "-" + season + "x" + String(episode).padStart(2, "0") + "/" : "/vidurl/" + info.imdbId + "/";
            const html = yield fetchText(config.host + pagePath, { headers: { Referer: config.host + "/" }, fetcher });
            if (html === null) return [];
            const payload = (html.match(/let\s+dataLink\s*=\s*((\[[\s\S]*?\])|(\{[\s\S]*?\}))\s*;/) || [])[1];
            if (payload === void 0) return [];
            const aesKey = deriveAesKey(html);
            const raw = JSON.parse(payload.replace(/\\\//g, "/"));
            const items = Array.isArray(raw) ? raw : Object.keys(raw).map((key) => raw[key]);
            const tasks = collectEmbedTasks(items, aesKey);
            const settled = yield Promise.all(tasks.map((task) => resolveOne(task, fetcher)));
            return settled.filter((stream) => stream !== null);
          } catch (error) {
            console.log("[" + config.id + "] resolve failed: " + (error && error.message ? error.message : error));
            return [];
          }
        });
      };
      function tmdbFind(id, type) {
        return __async(this, null, function* () {
          const base = type === "movie" ? "movie" : "tv";
          let tmdbId = null;
          if (id.indexOf("tmdb:") === 0) tmdbId = id.split(":")[1];
          else if (/^tt\d+$/.test(id)) {
            const found = yield fetchJson("https://api.themoviedb.org/3/find/" + encodeURIComponent(id) + "?external_source=imdb_id&api_key=" + TMDB_KEY);
            const list = found !== null ? found[base === "movie" ? "movie_results" : "tv_results"] : null;
            const first = Array.isArray(list) && typeof list[0] === "object" ? list[0] : null;
            tmdbId = first !== null ? String(first.id) : null;
          }
          if (tmdbId === null || tmdbId === "") return null;
          const detail = yield fetchJson("https://api.themoviedb.org/3/" + base + "/" + tmdbId + "?language=es-MX&api_key=" + TMDB_KEY);
          if (detail === null) return null;
          const title = stringValue(detail[base === "movie" ? "title" : "name"]);
          const originalTitle = stringValue(detail[base === "movie" ? "original_title" : "original_name"]);
          if (title === "" && originalTitle === "") return null;
          const imdbRaw = detail.external_ids !== void 0 ? detail.external_ids.imdb_id : detail.imdb_id;
          const imdbId = stringValue(imdbRaw);
          return { title: title || originalTitle, originalTitle: originalTitle || title, imdbId: imdbId === "" ? null : imdbId };
        });
      }
      function resolveOne(task, fetcher) {
        return __async(this, null, function* () {
          const resolved = yield resolveEmbed(task.url, fetcher).catch(() => null);
          if (resolved === null) return null;
          const quality = resolved.quality === "Unknown" ? "HD" : resolved.quality;
          return {
            name: config.brand + " - " + quality,
            title: task.lang + " - " + task.server + " " + quality,
            url: resolved.url,
            quality,
            headers: Object.assign({ "User-Agent": DESKTOP_UA }, resolved.headers || {})
          };
        });
      }
    }
    module2.exports = { createVidurlProvider: createVidurlProvider2 };
  }
});

// providers/entre.js
var { createVidurlProvider } = require_vidurl();
module.exports = { getStreams: createVidurlProvider({ id: "entre", host: "https://entrepeliculasyseries.nz", brand: "EntrePeliculas" }) };
