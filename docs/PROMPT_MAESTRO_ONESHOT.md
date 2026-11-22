# Prompt Maestro One-Shot — ObraLocal AI (`AGENT-GRAPH-HITL-UI-VERIFY`)

> Copia el bloque completo delimitado por las líneas `=== INICIO PROMPT ===` y `=== FIN PROMPT ===` y pégalo en una **nueva sesión limpia** de Antigravity.

=== INICIO PROMPT ===
Actúa como **Principal AI Systems Architect** y **Senior Mobile/Web Full-Stack TypeScript Engineer** especialista en **`@langchain/langgraph/web`**, sistemas **Local-First / Offline-First** sobre **Capacitor + Vite PWA** y **Generative UI (A2UI)**.

Construye de extremo a extremo la aplicación **ObraLocal AI** —100 % autónoma en dispositivo, Zero-Cloud, Zero-PC y cero claves API (`cloud_cost_eur = 0.0`)— siguiendo **sin desviaciones, sin simplificaciones y en 4 fases incrementales verificables** la especificación técnica congelada del repositorio.

---

### 1. Fuente Única de Verdad (Lectura Obligatoria Antes de Escribir Código)
Lee íntegramente todos estos contratos desde disco antes de crear el primer archivo de configuración o código fuente:
1. Visión, alcance y arquitectura resumida: `@docs/00_CONCEPT_BRIEF.md`
2. PRD agéntico, glosario, fórmulas fiscales, 4 Gates HITL y casos borde de los 5 widgets A2UI: `@docs/01_PRD_AGENTICO_Y_HITL.md`
3. Topología `StateGraph` (12 nodos), contratos Zod (`Draft` vs `Commit`), `CapacitorSqliteSaver`, polyfill `BrowserAsyncLocalStorage` + cola FIFO, puertos e interfaces: `@docs/02_GRAFO_LANGGRAPH_Y_ESTADO.md`
4. DDL completo SQLite + `FTS5` (`unicode61 remove_diacritics 2`) + triggers + `lg_checkpoints` + `agent_traces`: `@docs/schema.sql`
5. Contratos en proceso, `bridgeRecordSchemas`, mapeos de columnas, 5 escenarios semilla (`seedThreads`), trazas semilla y `onDeviceEvalFixtures`: `@docs/03_CONTRATOS_API_Y_SEED.json`
6. Stack cerrado, scripts Windows-safe, árbol de carpetas, fronteras unidireccionales (`core` / `agent` / `features` / `ui`), diseño A2UI móvil a una mano y gates por fase: `@docs/04_ARQUITECTURA_Y_UI_HITL.md`

---

### 2. Arquitectura `AGENT-GRAPH-HITL-UI-VERIFY` y Plan de Construcción en 4 Fases Verificables

Ejecuta estrictamente las **4 fases en orden**, pasando el Gate objetivo de cada fase en terminal **antes** de comenzar la siguiente (respetando la regla unidireccional de dependencias: **`src/features/*` y `src/ui/*` -> `src/agent/*` y `src/core/*`**; **`src/agent/*` -> `src/core/*`**; **`src/core/*` nunca importa desde `src/agent/` ni `src/features/`**):

#### Fase 1 — Núcleo SQLite, FiscalEngine, Puertos, FileBridge y Contratos Zod
- **Archivos:** `package.json`, `vite.config.ts`, `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`), `index.html` (CSP estricta offline), `capacitor.config.ts`, `public/manifest.webmanifest`, `public/icons/icon.svg`, `src/index.css`, `src/vite-env.d.ts`, `scripts/sync-assets.mjs`, `src/core/*` (`db/`, `ports/`, `fiscal/`, `contracts/`, `files/`, `memory/`, `backup/`, `hardware/`), `src/workers/sqlite.worker.ts`, `src/workers/opfsFile.worker.ts`, `tests/mocks/ports.ts`, `tests/fiscal.test.ts`, `tests/fts5.test.ts`, `tests/backup.test.ts`.
- **Requisitos clave:**
  - `sqliteExecutor.ts` importa `../../../docs/schema.sql?raw` como fuente única DDL y ejecuta `PRAGMA foreign_keys = ON;` en toda conexión (`NativeCapacitorSqliteExecutor` con WAL + FIFO + `transaction: false` + guardia `isInTx`; `WebWorkerSqliteExecutor` con `@sqlite.org/sqlite-wasm` `opfs-sahpool` en `sqlite.worker.ts` y `navigator.locks` de sesión completa sin `COOP`/`COEP`; `NodeBetterSqliteExecutor` con la misma guardia `isInTx`).
  - `FiscalEngine` en céntimos enteros con `roundHalfUpDiv` (IVA `10 %` / `21 %`, desglose inverso `21 %`, `ANT` `40 %`, `FAC` por diferencia exacta, Hucha Fiscal trimestral aislada `{YYYY}-T{Q}` y beneficio por obra), `validateSpanishTaxId` (dígito de control NIF/NIE/CIF) y `getLocalTodayIso()` en fecha local del dispositivo.
  - Desacoplamiento puro en `src/core/`: `checkpointsRepo.ts`, `src/core/ports/mediaPorts.ts`, `src/core/ports/seedFreezerPort.ts`, `MemoryCoordinator.registerLlmReleaser(fn)`, `resetService.ts` (Fase 1 en `inTransaction` vía `tx` -> Fase 2 vía `SeedGraphFreezerPort` tras `COMMIT`) y `backupService.ts` (`WebCrypto AES-256-GCM` `PBKDF2-SHA256` + purga FK inversa).
- **Gate Fase 1:** `npm run sync:assets && npx tsc --noEmit` (`0` errores) y `npx vitest run tests/fiscal.test.ts tests/fts5.test.ts tests/backup.test.ts` 100 % PASS.

#### Fase 2 — Motor LangGraph, Polyfill `AsyncLocalStorage` e Inferencia Local Dual
- **Archivos:** `src/agent/asyncLocalStoragePolyfill.ts`, `src/agent/state.ts`, `src/agent/checkpointer.ts`, `src/agent/inference/deterministicSpanishParser.ts`, `src/agent/inference/localInferenceAdapter.ts`, `src/agent/ports.ts`, los 12 nodos en `src/agent/nodes/*`, `src/agent/graph.ts`, `src/agent/graphRunner.ts`, `tests/ocr-parser.test.ts`, `tests/graph.hitl.test.ts`.
- **Requisitos clave:**
  - `BrowserAsyncLocalStorage` (pila en memoria) + `AsyncLocalStorageProviderSingleton.initializeGlobalInstance(...)` de `@langchain/core/singletons`, combinado con la cola FIFO única en `GraphRunner` para garantizar que `interrupt()` nunca pierda `getStore()` en navegador/WebView.
  - `CapacitorSqliteSaver` con `WRITES_IDX_MAP`, orden `checkpoint_id DESC, rowid DESC`, simetría UTF-8/Base64 (`b64:`), retención `50` + preservación `has_pending_interrupt = 1`, `getTuple`/`list` 100 % solo lectura y `migrateIncompatibleCheckpoints()` único en bootstrap (rescate Gate 1/2 a `recovered_drafts` + reset `chat_threads.status = 'idle', pending_gate = NULL`).
  - `StateGraph` real en `@langchain/langgraph/web` (DAG `<= 5` supersteps): `intent_router` (prioridades `1..4`, desambiguación encadenable con `preserved_target` y `disambiguation_exhausted`, limpieza `deleteIfTemp`), especialistas + `assistant_qa_node` (solo SQLite real) + `clarification_node`, `a2ui_dispatcher` (`validateGateWidgetMatch` + traza #1) y 3 nodos lineales HITL (`quote_commit`, `ocr_commit`, `lifecycle_commit` con `interrupt()` en las primeras líneas fuera de `try/catch`, pre-generación PDF en memoria antes de `inTransaction`, `parent_trace_id` y traza #2 `post_resume`).
  - `localInferenceAdapter.ts` funciona al 100 % en minuto cero con `DeterministicSpanishParser` (`< 150 ms`) y acepta `llmRunner?: (prompt: string) => Promise<string>` opcional inyectado externamente (manteniendo `0` imports desde `src/features/`).
- **Gate Fase 2:** `npx tsc --noEmit` (`0` errores) y `npx vitest run tests/graph.hitl.test.ts tests/ocr-parser.test.ts` 100 % PASS sobre `:memory:` + `MockOcrPort`/`MockPdfPort` cubriendo `approve`/`edit`/`reject` en los 4 Gates, `assistant_qa_node`, desambiguación sin bucles, `reopenRecoveredDraft` y doble traza `agent_traces`.

#### Fase 3 — Módulos Verticales A2UI, Carga Diferida WASM/PDF y `DemoSeeder`
- **Archivos:** `src/agent/demoSeeder.ts`, `public/assets/*`, `src/features/ocr/tesseractOcrAdapter.ts`, `src/features/pdf/pdfMakeAdapter.ts`, `src/features/sitelog/*`, `src/features/llm/mediaPipeAdapter.ts`, `src/features/chat/*` (incl. `WidgetDispatcher.tsx` y los 5 widgets A2UI), `tests/demo-seeder.test.ts`.
- **Requisitos clave:**
  - Carga diferida estricta mediante `import()` dinámico: **cero imports estáticos** de `tesseract.js`, `pdfmake` o `@mediapipe/tasks-genai` fuera de `src/features/{ocr,pdf,llm}`.
  - `tesseractOcrAdapter.ts` usa activos locales en `assets/ocr/` (`workerBlobURL: false`, `cacheMethod: "none"`), entrada `Blob` (`<= 1600px`), clamp `0..100` y `terminate()` en `finally`. `pdfMakeAdapter.ts` desenvuelve `.default` para Vite y envuelve `createPdf(...).getBuffer(...)` en `Promise<Uint8Array>`. `mediaPipeAdapter.ts` usa `assets/mediapipe/wasm` (`0` CDN) y registra su `unloadLocalLlm()` en `MemoryCoordinator`.
  - Los 5 widgets A2UI implementan todos los casos borde del PRD y contratos (validación `CommitPayloadSchema` en cliente antes de `Command({ resume })`, Feedback Loop opt-in en `QuoteBuilderWidget`, desglose inverso `21 %` y detección de duplicados en `TicketOcrValidatorWidget`, perfil emisor RD 1619/2012 y Share síncrono Web `navigator.share` vs `@capacitor/share` sin `sent_at` falso en `JobLifecycleActionWidget`, `new_job` atómico cancelable sin huérfanos en `SiteLogStampWidget`).
  - `DemoSeeder.freezeDemoGates()` congela `thr-seed-01-gate1` y `thr-seed-02-gate2` vía `compiledGraph.invoke` + `seed_override` (`quoteFixtureOverride` / `ocrFixtureOverride` / `traceIdOverride`) en la Fase 2 del bootstrap sin red ni OCR WASM.
- **Gate Fase 3:** `npx tsc --noEmit` (`0` errores), comprobación de cero imports estáticos de runtimes pesados fuera de `src/features/{ocr,pdf,llm}`, y `npx vitest run tests/demo-seeder.test.ts` 100 % PASS.

#### Fase 4 — Shell Móvil a Una Mano, Entrypoint Vite, Vistas Directas, Inspector, Evals y E2E
- **Archivos:** `src/main.tsx`, `src/App.tsx`, `src/ui/*` (`MobileShell.tsx`, `ThreadsDrawer.tsx`, `BottomQuickBar.tsx`, `GuardBanners.tsx`), `src/features/directory/*`, `src/features/fiscal/*`, `src/features/settings/*`, `src/features/inspector/*`, `src/workers/evals.worker.ts`, `playwright.config.ts`, `tests/e2e/offline-flows.spec.ts`.
- **Requisitos clave:**
  - `main.tsx` inicializa `BrowserAsyncLocalStorage` antes de compilar el grafo, resuelve `appReadyPromise` y registra `App.addListener("appRestoredResult", ...)`. `App.tsx` conecta `mediaPipeAdapter` con `localInferenceAdapter` (`llmRunner`) y `MemoryCoordinator.registerLlmReleaser`.
  - Shell mobile-first a una mano: cabecera de `56px` con chip **`100 % Offline · 0,00 € Nube`**, banners de `recovered_drafts` (`Reabrir borrador` / `Descartar`), bloqueo de compositor y micrófono en estado `interrupted` dentro del hilo pausado, barra inferior rápida funcional (micrófono visible solo si el reconocimiento on-device `es-ES` nativo está disponible; `Nuevo Presupuesto` sin bloquear compositor libre; `Foto Diario` directo por `core`).
  - Directorio paginado `FTS5` (incl. `start_job_quote`, cobro reversible `pagado <-> pendiente_cobro`, `sent_at_iso` manual, `openPdf`), `FiscalDashboardView`, `SettingsSheet` (emisor, series, Backup AES-GCM, Demo/Clean, LLM opcional + liberar RAM), `InspectorView` (`agent_traces` + `feedback_corrections`) y Suite de Evals on-device ejecutada en `evals.worker.ts` (`:memory:`) sobre `onDeviceEvalFixtures`.
- **Gate Fase 4:** `npm run build` (`tsc --noEmit && sync:assets && vite build --mode web` emitiendo chunks separados `chunk-ocr`, `chunk-pdf` y `chunk-llm-web` fuera del bundle inicial) + `npm run test && npm run test:e2e` 100 % PASS (con `page.clock.install` fijo en `2026-11-18T10:00:00`, bloqueo estricto de toda petición externa garantizando `cloud_cost_eur = 0.00`, arranque directo en `thr-seed-01-gate1`, recorrido completo de los 4 Gates HITL, `openPdf`, Hucha Fiscal, Foto Diario, Inspector y Suite de Evals `:memory:`).

---

### 3. Reglas Innegociables de Calidad e Integridad
1. **LangGraph Real e Inviolable:** Prohibido simular transiciones con `if/else` fuera del grafo en flujos conversacionales o HITL; toda pausa y reanudación pasa por `StateGraph` (`@langchain/langgraph/web`) + `CapacitorSqliteSaver` + `interrupt()` + `Command({ resume })`.
2. **Aritmética Fiscal 100 % Determinista:** Todas las cifras monetarias operan en céntimos enteros en `FiscalEngine`; ningún parser o LLM opcional calcula importes, bases, cuotas de IVA ni reservas de IRPF.
3. **Zero-Cloud y Offline Estricto (`0` CDN):** Prohibido usar fuentes remotas, CDN de Tesseract/MediaPipe, llamadas HTTP a LLMs o telemetría externa. Verifica el build offline real bloqueando tráfico externo en Playwright (`route.abort()`).
4. **Cero Placeholders y Cero Botones Muertos:** Prohibido dejar `// TODO`, `FIXME`, implementaciones stub en `src/`, o botones sin handler funcional real. Si un botón depende de hardware no disponible (p. ej. micrófono en navegador), no se renderiza.
5. **Compatibilidad Windows + PWA + Capacitor:** Usa scripts `vite --mode web` / `vite build --mode capacitor` (nunca variables inline tipo `VAR=val`), sin cabeceras `COOP`/`COEP`, `vite-plugin-pwa` con `manifest: false` solo fuera de `capacitor`/`test`, y `test.exclude` en `vite.config.ts` para `tests/e2e/**`.

---

### 4. Verificación Final Antes de Entregar (Definition of Done)
No des por terminado el proyecto hasta ejecutar y confirmar **PASS real en terminal** de la batería completa tras tu última edición:
1. `npm run sync:assets && npx tsc --noEmit` (`0` errores de TypeScript estricto).
2. Comprobación de frontera modular y chunking: `npm run build` emitiendo los chunks diferidos `chunk-ocr`, `chunk-pdf` y `chunk-llm-web` separados del bundle inicial, sin imports estáticos hacia ellos desde `src/core/` ni `src/ui/`/`src/App.tsx`.
3. `npm run test` (todas las suites `Vitest` en `:memory:` 100 % verdes, `0` skipped).
4. `npm run test:e2e` (`Playwright` offline 100 % verde con red externa bloqueada, fecha fija `2026-11-18T10:00:00` y `cloud_cost_eur = 0.00`).
5. Comprobación `eslint` sobre `src/` y `tests/` sin errores.
6. Al finalizar, indícame el resumen exacto de verificaciones ejecutadas, los archivos/chunks verificados y el comando exacto para arrancar la app en local (`npm run dev`).
=== FIN PROMPT ===
