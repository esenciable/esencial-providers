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
- [ ] **S1 — hackstore-plain: PORT FALLIDO, revertido** (ver abajo). Los filtros SÍ están aplicados a
      cinemitas, seriesmetro y embed69.

## hackstore-plain: el port rompió el proveedor (evidencia)
El port `flat/hackstore-plain.js` (prelude + cuerpo) **devuelve 0 streams**; el standalone
`providers/hackstore-plain.js` (el probado en TV) **devuelve 2** con los mismos títulos, ahora mismo:

| implementación | Coco | Breaking Bad S1E1 |
|---|---|---|
| `providers/hackstore-plain.js` (origen) | **2 streams en 3.0s** (Latino - Vimeos HD) | **2 streams en 1.7s** |
| `flat/hackstore-plain.js` (port) | **0 streams en 13.4s** | **0 streams en 2.0s** |

**Causa**: no son las llamadas a la API (son idénticas: `/api/rest/single?post_name=`, 
`/api/rest/player?post_id=`, mismos headers). Es el **resolve**: el original resuelve Vimeos con
`Referer: https://vimeos.net/` + `Accept: text/html` y reintentos propios (Vimeos devuelve `i=0.0`),
mientras el prelude resuelve Vimeos con `Referer: https://lamovie.org/` **hardcodeado para LaMovie**.
Con ese referer Vimeos no contesta y el port cae en `[]` (peor: `flatJson` **traga el error y devuelve
`null`**, así que el fallo es silencioso).

**Cómo se cerró**: el manifest volvió a apuntar al standalone probado (nada roto en producción) y el
port queda pendiente de esta tarea. **Fix correcto**: hacer configurable el referer del resolver de
Vimeos (parámetro opcional con el default actual de LaMovie, para no cambiar el comportamiento de
lamovie/cinemitas/seriesmetro) y que hackstore pase el suyo. **Criterio de aceptación = el A/B de la
tabla de arriba**, no el reporte de un agente: el port tiene que dar ≥ los mismos streams que el origen.

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
