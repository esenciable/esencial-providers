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
- [ ] P1 — **seriesmetro** (nuevo): HTML/API admin-ajax `trembed=` → embeds; reusar titles.js + resolvers.
- [ ] P2 — **seriesflix** (nuevo): `data-url` base64 + unwrap `iframe?url=`.
- [ ] P3 — **cu3v4n4 / Cuevana** (nuevo): clave XOR dinámica (UUID del HTML) + token protocol (char[0] = server: Hyper/Filemoon/Nebula/Doodstream) + fetch iframe (Referer = página, 8 s) + regex m3u8/mp4/packer. Headers finales: Referer=iframeUrl, Origin, UA, Accept.
- [ ] P4 — **zoowomaniacos + peliserieshoy** (opcionales; peliserieshoy off por defecto como en latino).
- [ ] P5 — Copias alternativas (`alternatives` con refs perezosas ≤8), ranking por idioma (lat > esp > sub) y calidad (1080 primero, 4K al final salvo preferencia).
- [ ] P6 — Verificación en dispositivo (Coco tt2380307 + Breaking Bad S1E1 + 1 título por source nuevo) y bump de versiones cache-bust.

## Fuera de alcance (explícito)
- TV+/PremiumTV/M3U en vivo: los plugins de Nuvio no soportan live; el live Magis va por el addon server-side hasta que haya desarrollo nativo en el fork (NuvioES). EPG: no.
- Magis VOD client-side: ya está en el repo (magis.js) con su diagnóstico — no se duplica acá.

## Evidencia
(commits por tarea se registran acá)
