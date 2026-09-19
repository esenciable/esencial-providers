/** Runs a provider bundle inside real QuickJS (the engine class Nuvio uses) with
 * fetch/console/timeout bridged from Node, and reports what happens. */
import { readFileSync } from 'node:fs';

const { getQuickJS } = await import('quickjs-emscripten');
const QuickJS = await getQuickJS();
const vm = QuickJS.newContext();

// ---- bridge: console ----
const logFn = vm.newFunction('log', (...args) => {
  const parts = args.map(a => { try { return vm.dump(a); } catch { return String(a); } });
  console.log('[qjs]', ...parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)));
});
vm.setProp(vm.global, '__log', logFn);
vm.evalCode(`var console = { log: function(){ __log.apply(null, Array.prototype.slice.call(arguments)) }, error: function(){ __log.apply(null, Array.prototype.slice.call(arguments)) }, warn: function(){ __log.apply(null, Array.prototype.slice.call(arguments)) } };`);

// ---- bridge: fetch (async) ----
const fetchFn = vm.newFunction('fetch', (urlHandle, optionsHandle) => {
  const url = vm.getString(urlHandle);
  let options = {};
  try { if (optionsHandle !== undefined) options = vm.dump(optionsHandle) || {}; } catch {}
  console.log('[bridge] fetch', url.slice(0, 110));
  const deferred = vm.newPromise();
  Promise.resolve()
    .then(() => fetch(url, { method: options.method || 'GET', headers: options.headers || {}, body: options.body, redirect: options.redirect || 'follow' }))
    .then(async response => {
      const text = await response.text();
      const result = { ok: response.ok, status: response.status, url: response.url, headers: { get: null }, _text: text };
      vm.newObject();
      const obj = vm.newObject();
      vm.setProp(obj, 'ok', response.ok ? vm.true : vm.false);
      vm.setProp(obj, 'status', vm.newNumber(response.status));
      vm.setProp(obj, 'url', vm.newString(response.url));
      const headersObj = vm.newObject();
      vm.setProp(headersObj, 'get', vm.newFunction('get', nameHandle => vm.newString(response.headers.get(vm.getString(nameHandle)) ?? '')));
      vm.setProp(obj, 'headers', headersObj);
      vm.setProp(obj, 'text', vm.newFunction('text', () => vm.newString(text)));
      vm.setProp(obj, 'json', vm.newFunction('json', () => {
        try {
          const parsed = JSON.parse(text);
          const handle = vm.newString(JSON.stringify(parsed));
          vm.setProp(vm.global, '__j', handle);
          const out = vm.evalCode('JSON.parse(__j)');
          return out.value ?? vm.undefined;
        } catch (e) { console.log('[bridge] json parse error:', e.message); return vm.undefined; }
      }));
      deferred.resolve(obj);
    })
    .catch(error => {
      const errObj = vm.newError(String(error && error.message ? error.message : error));
      deferred.reject(errObj);
    });
  return deferred.handle;
});
vm.setProp(vm.global, 'fetch', fetchFn);

// ---- bridge: timers (no-op async) ----
vm.evalCode(`
  var setTimeout = function(fn, ms) { Promise.resolve().then(fn); return 0; };
  var clearTimeout = function() {};
  var AbortController = function(){ this.signal = {}; this.abort = function(){} };
  var AbortSignal = { timeout: function(){ return {} } };
`);

const bundlePath = process.argv[2];
const tmdbId = process.argv[3] || 'tt2380307';
const type = process.argv[4] || 'movie';
const bundle = readFileSync(bundlePath, 'utf8');

console.log(`cargando ${bundlePath} en QuickJS...`);
// CJS shim: Nuvio provides module/exports to provider files.
vm.evalCode('var module = { exports: {} }; var exports = module.exports;');
const load = vm.evalCode(bundle);
if (load.error) {
  console.log('❌ ERROR AL CARGAR:', JSON.stringify(vm.dump(load.error)).slice(0, 400));
  process.exit(1);
}
console.log('✅ bundle cargado');

const call = vm.evalCode(`(function(){ try { var m = (typeof module !== 'undefined') ? module.exports : null; if (!m || typeof m.getStreams !== 'function') return 'NO_GETSTREAMS:' + Object.keys(m || {}).join(','); var p = m.getStreams(${JSON.stringify(tmdbId)}, ${JSON.stringify(type)}); p.then(function(s){ __log('RESULT:' + (s ? s.length : 'null')) }).catch(function(e){ __log('REJECTED:' + (e && e.message)) }); return 'CALLED' } catch (e) { return 'THROW:' + e.message } })()`);
if (call.error) {
  console.log('❌ ERROR AL INVOCAR:', JSON.stringify(vm.dump(call.error)).slice(0, 400));
  process.exit(1);
}
console.log('invocación:', vm.dump(call.value));
// bombear jobs pendientes (promesas + fetch bridge)
for (let i = 0; i < 200; i++) {
  vm.runtime.executePendingJobs();
  await new Promise(r => setTimeout(r, 25));
}
console.log('--- fin ---');
