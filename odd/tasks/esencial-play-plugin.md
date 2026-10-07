# Feature: esencial-play plugin — todas las fuentes VOD en el plugin Nuvio (sin server)

## Contexto (2026-10-07)
- Vehículo: este repo (`esencial-providers`), plugin Nuvio client-side. Worktree `../esencial-play-providers`, branch `feat/esencial-play`.
- Decisión del dueño: **sin server para nada**; el addon server-side deja de ser el camino. EPG: no importa (se retoma después, quizá serverless).
- **TV+ (iptv-org M3U) EXCLUÍDO** por decisión del dueño. PremiumTV (M3U live) también queda fuera del plugin: los plugins de Nuvio no hacen canales en vivo (solo `getStreams` movie/tv — verificado en `PluginRuntime.kt` del fork).
- Investigación base: teardowns de los 4 plugins de Kino en `kino-light-addon` worktree `esencial-play` (`docs/client-side-model-xuper.md`, `docs/plugins-remaining-teardown.md`).

## Estado de partida (verificado)
- Providers existentes: areshd, cinecalidad, cinemitas, entre, hackstore, hackstore-plain, lamovie, magis (+diag/test), megadede, sololatino.
- Lib compartido: http.js (fetch+retry), embeds.js, resolvers.js (10 familias), titles.js, pow.js, crypto.js, vidurl.js, flat-magis-core.js.
- Formato flat (concatenación, NO esbuild): el runtime de Nuvio rechaza output de bundler y archivos >~50 KB.
- Restricciones runtime: sin Buffer, sin node:crypto, sin URL.searchParams; crypto-js disponible en el runtime del app.
- Magis: core client-side ya portado; diagnóstico v4 en curso (transport ladder de headers por el bridge).

## Tareas
- [x] P1 — **seriesmetro** (commit `cfdf5c9`): trembed iframes + admin-ajax episode flow. Live: Coco 1, BB S1E1 3 (fastream).
- [x] P2 — **seriesflix** (commit `cfdf5c9`): data-url base64 + iframe unwrap + cadenas nuevas nupload (int-array) y voe.sx (JS-redirect). Live: BB S1E1 3 (VOE); Coco 0 — el sitio es series-only hoy (verificado curl), código movie defensivo.
- [x] P3 — **cu3v4n4** (commit `cfdf5c9`): XOR dinámico + token protocol (Hyper/Filemoon/Nebula/Doodstream) + packer; nota: el sitio ahora usa SLUGS (no el esquema numérico-TMDB del bundle viejo). Live: Coco 3, BB S1E1 2 (acek-cdn).
- [ ] P4 — **zoowomaniacos + peliserieshoy** (opcionales; peliserieshoy off por defecto como en latino).
- [x] P5 — Ranking + copias (`268e266`): `flatRankStreams` en el prelude (additivo, puente de test protegido) — lat>esp>sub>cast>otro, 1080>720>480 con 4K al final, familias confiables primero, cap 10; aplicado a seriesmetro/seriesflix/cu3v4n4; test sintético 17 checks + harness vivo sin regresiones. Magis client-side ya resuelve (Coco + BB vía buec.kyalbhxgw.com).
- [ ] P5 — Copias alternativas (`alternatives` con refs perezosas ≤8), ranking por idioma (lat > esp > sub) y calidad (1080 primero, 4K al final salvo preferencia).
- [x] P6 — **Verificación en dispositivo (Kino_Tester, 2026-10-07)**: APK del fork con el parche `5f5ac1ec5` (canRunLocalPlugins acepta tt) instalado vía adb. Logcat del device: getStreams corrió en el QuickJS real — seriesmetro 2, megadede 6, entre 6, cinemitas 6, areshd 3, hackstore-plain 2, lamovie 1, cinecalidad 2 (Avatar 2009). Selector con filtros por repo (Cuevana3, etc.), labels idioma/servidor/calidad, y **playback real del stream MegaDede/vidhide** con subtítulos. Diag del runtime: fetch ✓, AbortController ✓, atob ✓, TMDB http 200 (el app SÍ resolvió tmdb 19995 — con TMDB key el id llega numérico; sin key el parche pasa el tt crudo). Inteligencia del diag: `setTimeout` NO existe en el bridge QuickJS (los retries de flatGet no disparan en device) — mejora pendiente.
- [ ] P6 — Verificación en dispositivo (Coco tt2380307 + Breaking Bad S1E1 + 1 título por source nuevo) y bump de versiones cache-bust.

## Fuera de alcance (explícito)
- TV+/PremiumTV/M3U en vivo: los plugins de Nuvio no soportan live; el live Magis va por el addon server-side hasta que haya desarrollo nativo en el fork (NuvioES). EPG: no.
- Magis VOD client-side: ya está en el repo (magis.js) con su diagnóstico — no se duplica acá.

## Evidencia
(commits por tarea se registran acá)
