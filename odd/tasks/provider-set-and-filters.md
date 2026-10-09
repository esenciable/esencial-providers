# Feature: Set de proveedores, filtros de calidad/idioma, Embed69 y velocidad de Magis

## Objetivo
Ajustar el repo de plugins a lo que el dueño realmente usa: **pocos resultados que funcionen bien**.

## Decisiones del dueño (2026-10-08)
- Proveedores que quedan: **Magis VOD, Cinemitas, SeriesMetro, HackStore, Embed69 (nuevo)**.
- **Filtro de servidores**: solo **Uqload**, **Vimeo** (`vimeos`) y **"Online HD"**.
  Ojo: "Online HD" **no es una etiqueta literal** en el repo: sale de `flatServerLabel` (que devuelve
  `"Online"` para familia desconocida) + la calidad. Interpretación implementada: familia `uqload`,
  familia `vimeos`, o servidor genérico `Online` con calidad HD/720p/1080p.
- **Filtro de idioma**: descartar **Castellano (ESP)** y **Subtitulado (SUB)**; conservar **Latino
  (LAT)** y los streams **sin etiqueta** (decisión explícita del dueño).
- **Pocos resultados**: bajar el `limit` del ranking compartido (hoy 10 por defecto).

## Fases
- [x] **S1 — Filtros compartidos (prelude)**: un único filtro aplicado por los proveedores, para que
      la regla viva en un solo lugar:
      idioma (fuera ESP/SUB, quedan LAT y sin etiqueta) + servidores permitidos + `limit` corto.
      Los `flatRankStreams` ya extraen `langLabel` (`stream.lang` o el primer tramo del título) y
      tienen `limit`, así que el filtro se apoya en eso en vez de duplicar parsing.
      IMPLEMENTADO: `flatOwnerLangOk` / `flatOwnerServerOk` / `flatOwnerRankOptions` en el prelude;
      `flatRankStreams` acepta `opts.filter` (corre antes del sort y del limit). `limit: 4`.
- [x] **S2 — Embed69 como scraper propio**: nuevo `flat/embed69.js` + entrada en `manifest.json`.
      Es **por IMDB id, sin búsqueda por nombre**: `https://embed69.org/f/<imdbId>` (película) y
      `/f/<imdbId>-<s>x<ee>` (serie). Requiere `Referer: https://sololatino.net/`.
      Los links vienen en AES-256-CBC con clave derivada de un proof-of-work; **el prelude ya tiene
      `flatDeriveKey`, `flatDecryptLink` y `flatCollectEmbeds`** (etiqueta LAT/ESP/SUB y descarta
      servidores de descarga) → reusar, no reimplementar. Descartar si `difficulty > 4`.
- [x] **S3 — Set de proveedores (manifest)**: quedan habilitados magis, cinemitas, seriesmetro,
      hackstore-plain, embed69 (corrección del dueño: el HackStore que funciona es `hackstore-plain`,
      portado a flat como `flat/hackstore-plain.js` -> `dist/hackstore-plain-v4.js`; `hackstore` y
      `hackstore-es2020` siguen en `enabled: false`, sus dist nunca existieron). El resto con
      `enabled: false`.
      **Límite conocido**: el refresh NO pisa el `enabled` de un scraper ya instalado
      (`enabled = existingScraper?.enabled ?: defaultEnabled`), así que en instalaciones vivas el
      dueño tiene que apagarlos una vez en la pantalla de plugins; el manifest arregla las nuevas.
- [x] **S4 — Velocidad de Magis (lo que el runtime permite)**: el runtime crea un contexto QuickJS
      **nuevo por llamada** y **no expone storage** a los plugins, así que cachear la sesión entre
      consultas es imposible. Queda: (a) **paralelizar el mint con el lookup de TMDB** (TMDB no
      depende de la sesión; medido: ahorra ~180 ms local, ~350 ms en el Mi Box) y (b) **recortar el
      payload de `searchByName`** (menos resultados = menos 3DES y menos JSON).
- [x] **S5 — Verificación**: `node test.mjs` verde para los proveedores que quedan, con el conteo de
      streams por título ANTES y DESPUÉS de los filtros (para probar que no se perdió todo).
      Hecho 2026-10-08: selftest offline del filtro al inicio de `test.mjs` + casos en vivo verdes;
      magis Coco 1.5s -> 1.0s (mint y TMDB en paralelo, `pageSize` 20 -> 10); dists 27.4-40KB (< 50KB).

## Evidencia
- Verificación 2026-10-08 (sin commits aún; commits por fase pendientes):
  - ANTES/DESPUÉS por título — magis Coco 1->1 (1.5s->1.0s), magis BB S1E1 1->1 (2.0s->1.1s),
    cinemitas Coco 3->1 (caen 2 CASTELLANO/SUBTITULADO; la página lista 2×LATINO, 2×CAST, 2×SUB),
    seriesmetro Coco 1->1, seriesmetro BB S1E1 3->1 (caen Castellano y VOSE),
    hackstore-plain Coco 2->1 (caen GoodStream; queda Vimeos), hackstore-plain BB S1E1 -> 1 (Vimeos).
  - Embed69 (nuevo): Coco 1 stream, BB S1E1 1 stream; POW_DIFFICULTY observado = 3 (<= 4, se procesa);
    idiomas en la página Coco = LAT/ESP/SUB (el filtro deja solo LAT); sin búsqueda por nombre.
  - Embed69 no tiene "antes": es un scraper nuevo.

## Fuera de alcance
- VOD de Magis nativo en Kotlin (la solución de fondo a la lentitud: sesión persistida + crypto
  nativo). Decisión aparte, necesita release del fork.
- Cambiar el orden de la lista de streams: eso es del fork (feature `stream-order-plugin-first.md`).

- [x] **S2 — Embed69 como scraper propio**: `flat/embed69.js` + entrada en el manifest. Por IMDB id
      (`/f/<imdb>` y `/f/<imdb>-<s>x<ee>`), `Referer: sololatino.net`, reusa `flatResolveEmbed69Page` y
      el crypto del prelude. Verificado en vivo: **1 stream LAT por título** (Coco y Breaking Bad,
      `POW_DIFFICULTY = 3` ≤ 4).
- [x] **S3 — Set de proveedores (manifest)**: habilitados `magis`, `hackstore-plain`, `cinemitas`,
      `seriesmetro`, `embed69`. Corregido antes de ejecutar: el HackStore que funciona es
      **`hackstore-plain`** (su archivo existe y está probado en TV); `hackstore` y
      `hackstore-es2020` apuntan a `dist/hackstore-*.js` que **NO EXISTEN** → quedan apagados.
- [x] **S4 — Velocidad de Magis**: `Promise.all([magisActivate(), flatTmdbInfo(...)])` (TMDB no depende
      de la sesión) + `pageSize` 20→10. Medido: Coco 1.5s → **1.0s**, Breaking Bad 2.0s → **1.1s**.
      La semántica de error se conservó (si cualquiera falla, el catch devuelve `[]`).
- [x] **S1 — hackstore-plain: port reparado y vuelto a activar** (ver abajo). Los filtros SÍ están
      aplicados a cinemitas, seriesmetro y embed69 (y a hackstore-plain: el GoodStream que el
      standalone devolvía se cae por el allowlist del dueño, como estaba decidido).

## hackstore-plain: el port rompió el proveedor (evidencia)
El port `flat/hackstore-plain.js` (prelude + cuerpo) **devuelve 0 streams**; el standalone
`providers/hackstore-plain.js` (el probado en TV) **devuelve 2** con los mismos títulos, ahora mismo:

| implementación | Coco | Breaking Bad S1E1 |
|---|---|---|
| `providers/hackstore-plain.js` (origen) | **2 streams en 3.0s** (Latino - Vimeos HD) | **2 streams en 1.7s** |
| `flat/hackstore-plain.js` (port) | **0 streams en 13.4s** | **0 streams en 2.0s** |

**Causa**: no eran solo las llamadas a la API (esas son idénticas). Eran DOS cosas en el resolve:
1. **Referer**: el original resuelve Vimeos con `Referer: https://vimeos.net/` + `Accept: text/html`;
   el prelude usaba `Referer: https://lamovie.org/` hardcodeado para LaMovie. Con el referer
   equivocado Vimeos a veces no contesta.
2. **El parámetro `i` del master m3u8 (la mitad silenciosa)**: Vimeos hoy responde `i=0.3`. El
   original se queda con el PRIMER master m3u8 que encuentra; el bucle de reintento del prelude
   (pensado para LaMovie, que sirve `i=0.0`) descartaba el master `i=0.3` tras 3 rondas y devolvía
   `null` — y `flatJson`/el catch tragaban el error, así que el fallo no dejaba rastro.

**Cómo se arregló (2026-10-08)**:
- `flatResolveVimeos(embedUrl, opts)` ahora acepta `opts.referer` (default `https://lamovie.org/`),
  `opts.accept` (default: Accept-Language es-MX como hoy) y `opts.firstMatch` (default false:
  sin opts el bucle de reintento de LaMovie queda intacto, verificado offline con fetch stub).
- `flatResolveEmbed(embedUrl, opts)` reenvía opts (hoy solo lo honra la familia vimeos) y REGISTRA
  todo fallo de resolve por consola (`[flat] resolve sin resultado (...)`): se acabó el `[]` mudo.
- `flat/hackstore-plain.js` pasa `{ referer: 'https://vimeos.net/', accept: 'text/html', firstMatch: true }`,
  espejo exacto del standalone.

**A/B tras el fix** (mismo día, mismos títulos; URLs iguales salvo el token fresco de cada petición):

| implementación | Coco | Breaking Bad S1E1 |
|---|---|---|
| `providers/hackstore-plain.js` (origen) | 2 en 3.3s (Vimeos + GoodStream) | 2 en 1.5s (Vimeos + GoodStream) |
| port reparado | **1 en 2.7s (Vimeos, misma URL master)** | **1 en 1.9s (Vimeos, misma URL master)** |

El port da exactamente el stream Vimeos del origen (mismo master `_,n,h,.urlset/master.m3u8`).
La diferencia 2 vs 1 es el **GoodStream, que el allowlist del dueño (S1) descarta a propósito**:
`flatResolveGoodstream` del prelude sí lo resuelve (verificado), pero `flatOwnerServerOk` solo deja
pasar uqload/vimeos/Online-HD. Etiqueta: el port dice `Latino - Vimeos 720p` (calidad real leída del
ladder de la URL) donde el origen dice `Vimeos HD` (su `qualityFromUrl` no lee el ladder); mismo
stream, etiqueta más precisa.

`hackstore-plain` vuelve a apuntar a `dist/hackstore-plain-v4.js` (28.7KB) y `node test.mjs` queda
verde (selftest offline del resolver incluido).

## Nota sobre el `limit`
`limit: 4` en el ranking compartido (antes 10). Con 5 proveedores el peor caso son ≤20 entradas, y en
la práctica queda 1-2 por proveedor: alcanza para sobrevivir 1-2 enlaces muertos sin llenar la lista.

## Evidencia
- Filtros verificados en vivo por caída de conteos: cinemitas Coco 3→1 (2× Castellano/Sub),
  seriesmetro BB S1E1 3→1 (Castellano + VOSE). Nada quedó en cero en el set que queda (salvo el port
  fallido de hackstore-plain, que no se commiteó).
- `node test.mjs` verde; `dist/*` todos por debajo del techo de ~50KB del runtime de Nuvio.
- Magis NO pasa por el allowlist de servidores a propósito: su stream es un CDN directo del portal y el
  filtro lo mataría.

## Nota (2026-10-08): por qué `magis` queda ENCENDIDO

Se apagó un rato para evitar la fila duplicada en el fork (la fuente nativa resuelve la MISMA URL), y
se volvió a encender al detectar el problema real: **el scraper es la capa portátil**. Sin él, cualquier
Nuvio que no sea el fork —incluido stock— **se queda sin Magis**. La nativa sólo existe en NuvioES.

La duplicación en el fork **no se resuelve apagando el proveedor**, se resuelve en la app: se descarta
un stream cuya URL ya vino de un grupo anterior, y como la fuente nativa va primero en `pluginOrder`,
sobrevive la nativa (rápida) y la del scraper desaparece de la vista. El respaldo queda **invisible
pero real**: si la vía nativa falla, la del scraper es la única y Magis igual funciona.

Regla general que queda de esto: **un proveedor del repo no se apaga para arreglar un problema de la
app.** El manifest no es dónde se tapan los síntomas.

## Fix 2026-10-08: aceptación de candidatos de Magis (el bug de la película equivocada)

**Síntoma reproducido**: Dune 1984 (tt0087182) → TMDB da el título español "Dunas" → el portal
.devuelve UN candidato ("Tuaregs, los guerreros de las dunas", 2013, score 5) → se aceptaba a ciegas
→ se servía OTRA película (`/vod/947BBBB6BDC24DA6B5D6405C9399BC78_media.ts`) y además se mataba la
cadena de fallback de `flat/magis.js` (`tryTitle(index + 1)` solo corre si el título anterior no
devolvió nada, así que nunca se buscaba "Dune").

**Regla nueva** (vive en `lib/flat-magis-core.js`, `magisSelectCandidate`, documentada junto al
incidente; el caller `flat/magis.js` ahora le pasa el año de TMDB):
1. **Cobertura**: proporción de tokens del título pedido presentes en el nombre del candidato
   (antes: conteo — compartir una palabra bastaba).
2. **Cobertura mínima 0.6**: un candidato débil se RECHAZA (null) y el caller cae al título
   siguiente. Devolver nada es mejor que otra película.
3. **Año**: si el año pedido es conocido y el candidato trae `releaseTime` (ISO completo), el año
   debe coincidir con tolerancia ±1. Un candidato de otro año no gana NI SIQUIERA siendo el único.
4. **Ranking** entre candidatos que pasan: cobertura → año EXACTO → score del portal como desempate
   final. El año exacto va antes del score porque el portal lista cada temporada como entrada
   propia (Breaking Bad T1 2008 vs T2 2009) y el score solo decía 9.5 vs 8.8 — sin esto S1E1 caía
   en la entrada de la T2.
5. Se conserva: filtro `programType` (serie vs película) y exigencia de `contentId`.

Nota honesta: con un título de un solo token la cobertura es 1.0 por construcción ("Dunas" cubre
"…guerreros de las dunas"), así que el caso Dune lo resuelve la regla de AÑO; la cobertura mata los
solapamientos parciales de títulos de varias palabras.

**Verificación** (dist con dump temporal de candidatos, borrado después; BEFORE = dist de git HEAD):

| título | BEFORE | AFTER |
|---|---|---|
| Dune 1984 tt0087182 | **Tuareg 2013** `947BBBB6…media.ts` (película equivocada) | **Dune** (releaseTime 1985-03-04, estreno internacional de la de 1984) `EBFEC721…media.ts` — rechaza al Tuareg por año y cae al fallback "Dune" |
| Dune 2021 tt1160419 | `2753F184…media.ts` | igual (gana "Duna" 2021-10-22 score 8.2 por desempate de portal sobre la otra "Duna" 2021-05-25 score 7.1) |
| Coco tt2380307 | `8D5CCDD3…media.ts` | igual ("Coco" 2017-11-22; "El Gran Coco Legrand" 2025 cae por año) |
| Breaking Bad S1E1 | entrada T5 (score-count empatado, orden del portal) → episodio de la temporada equivocada `3DF407C5…` | **T1** (2008-01-20) `0BC32337…media.ts` |
| The Office S1E1 (ambiguo) | "La Oficina T1" de 2026 (OTRA serie) `1D724049…` | **The Office T1** (2005-03-24, la original) `2BC1F4A4…media.ts` |

Selftest offline nuevo en `test.mjs` (carga el núcleo real vía puente de pruebas, sin red): 12 checks
verdes — incluidos los de regreso: año exacto gana al score, sin releaseTime queda al final,
programType y contentId siguen mandando. `node test.mjs` completo verde (exit 0); dists ≤ 41.5KB
(techo ~50KB).

**Pendiente fuera de superficie permitida**: bump de `version` de `magis` en `manifest.json` (el
nombre del dist lleva cache-busting; sin bump el CDN puede servir el v4 viejo) y rebuild de
`dist/diag-magis-v4.js` (build.cjs lo salta por estar disabled en el manifest; su dist queda con el
núcleo viejo, pero diag no usa la selección de candidatos).

## Fix 2026-10-08 (parte 2): temporadas de Magis — Ted Lasso S2E1 reproducía S1E1

**Síntoma reportado por el dueño**: las series se rompían POR TEMPORADA — S1E1 bien, pero S2E1
también reproducía S1E1. La temporada se ignoraba: todo capítulo resolvía dentro de la temporada
del contentId que salió de la búsqueda (la T1 por el ranking por año).

**Referencia replicada, no inventada**: `kino-light-addon/src/magis/provider.ts` (`episodeFor` con
`seasonAware`, `seasonOfDetail`, `contentIdForSeason`, `episodeFrom`). El propio addon lo documenta:
"al pedir el video hay que decirle al portal ESTA temporada como `seriesContentId`, porque si no
resuelve dentro de la que le pasemos y la temporada 2 terminaba reproduciendo el capítulo de la 1".

**Qué vive dónde**:
- `lib/flat-magis-core.js` (helpers, probados offline por el puente de tests): `magisAssetData`,
  `magisSeasonOfDetail` (lista de temporadas del portal; VACÍA = "es la 1", lista sin la entrada
  propia = "no sé" -> null), `magisContentIdForSeason` (contentId de la temporada pedida) y
  `magisSeasonStep` (la decisión: refetch al contentId de la pedida / seguir / SIN resultado).
- `flat/magis.js` (rama de series): tras el primer `getItemData`, `magisSeasonStep` decide; si hay
  refetch, el capítulo sale del detalle de ESA temporada y el contentId de LA TEMPORADA (no el de
  la serie) viaja como `seriesContentId` a `v10/startPlayVOD`. Sin temporada pedida (0) o temporada
  que ya es el detalle: igual que antes, sin llamada extra.

**Verificación** (dist `magis-v6.js`, manifest bump 5.0.0 -> 6.0.0 por cache-busting):

| título | antes | después |
|---|---|---|
| Ted Lasso S1E1 | correcto | `A1E931A8…` (E1 de T1) -> mediaId `47C947B3…`, `seriesContentId=0622324C…` (T1) |
| Ted Lasso S2E1 | **reproducía S1E1** | refetch a T2 `58817895…` -> `DB668CE7…` (E1 de T2) -> mediaId `93E32A73…`, `seriesContentId=58817895…` (T2) — DISTINTOS |
| Chernobyl S1E1 (una sola temporada) | correcto | igual, `9223EB70…`, sin refetch |
| Chernobyl S2E1 (no existe) | **servía un capítulo de la 1** | **SIN streams** (ni startPlayVOD) |
| Coco tt2380307 (control) | `8D5CCDD3…` | igual |

Listas crudas del portal (descifradas del getItemData): Ted Lasso trae `sameSeasonSeriesList`
1:0622324C… 2:58817895… 3:9ED67D4F… 4:773D5184…, y los `simpleProgramList` de T1 (E1=A1E931A8…)
y T2 (E1=DB668CE7…) NO comparten capítulos. Chernobyl lista solo a sí misma (1:970ADDC1…).

Selftest offline nuevo en `test.mjs`: 15 checks verdes de la lógica de temporadas (refetch,
sin refetch, temporada inexistente, lista vacía con S1 ok y S2 sin resultado, lista sin entrada
propia, seasonOfDetail/contentIdForSeason). `node test.mjs` completo verde (exit 0), casos en vivo
de los 5 proveedores intactos; dists ≤ 42.6KB (techo ~50KB).

Nota: `dist/magis-v5.js` queda huérfano en el repo (el manifest ahora apunta a `magis-v6.js`);
eliminado aparte si procede — esta pasada no borra archivos.
