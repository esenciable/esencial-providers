# tools/quickjs-check.mjs

Runs a built bundle inside **real QuickJS** (via `quickjs-emscripten`) with `fetch`, `console`
and timers bridged from Node. This reproduces the *device* runtime locally, so a provider that
works in Node but not on a TV can be diagnosed without guessing.

```bash
npm install --no-save quickjs-emscripten
node tools/quickjs-check.mjs dist/magis.js tt2380307 movie
```

Last verified run (all pass):
  hackstore 2 · magis 1 · sololatino 3 · cinecalidad 2 · esencial-test 1
