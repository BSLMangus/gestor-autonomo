# ObraLocal AI — Arquitectura Modular, Stack Cerrado, Interfaz A2UI Móvil y Plan de Verificación

**Versión:** 1.1.0  
**Estado:** Veredicto `egm-implementation-readiness` Ronda 3: **GO** (`0 Blockers · 0 Majors · 4 Nits aplicados`) · Pendiente de aprobación del usuario  
**Documentos ancla:** [00_CONCEPT_BRIEF.md](file:///c:/Users/Facu/Desktop/AutonomosApp/docs/00_CONCEPT_BRIEF.md) · [01_PRD_AGENTICO_Y_HITL.md](file:///c:/Users/Facu/Desktop/AutonomosApp/docs/01_PRD_AGENTICO_Y_HITL.md) · [02_GRAFO_LANGGRAPH_Y_ESTADO.md](file:///c:/Users/Facu/Desktop/AutonomosApp/docs/02_GRAFO_LANGGRAPH_Y_ESTADO.md) · [schema.sql](file:///c:/Users/Facu/Desktop/AutonomosApp/docs/schema.sql) · [03_CONTRATOS_API_Y_SEED.json](file:///c:/Users/Facu/Desktop/AutonomosApp/docs/03_CONTRATOS_API_Y_SEED.json)

---

## 1. Stack Técnico Cerrado, Dependencias y Configuración Exacta de Build

### 1.1 Dependencias de Producción y Desarrollo (Cero Alternativas Abiertas)

- **Runtime UI & Lenguaje:** `react` (`^19.1.0`), `react-dom` (`^19.1.0`), `typescript` (`^5.8.0`, **`strict: true`**, `noUncheckedIndexedAccess: true`), `tailwindcss` (`^4.1.0`), `@tailwindcss/vite` (`^4.1.0`), `lucide-react` (`^0.511.0`), `@fontsource/inter`, `@fontsource/jetbrains-mono` *(fuentes 100 % locales; prohibido CDN de Google Fonts)*; `devDependencies`: `@types/react` (`^19.1.0`), `@types/react-dom` (`^19.1.0`), `@types/node` (`^22.15.0`).
- **Orquestación Multi-Agente y Validación:** `@langchain/langgraph` (`^0.2.74`, importando siempre desde **`@langchain/langgraph/web`**), `@langchain/langgraph-checkpoint` (`^0.0.18`), `@langchain/core` (`^0.3.50`, incl. `@langchain/core/singletons`), `zod` (`^3.24.0`).
- **Base de Datos Dual y Test :memory::** `@capacitor-community/sqlite` (`^7.0.0`), `@sqlite.org/sqlite-wasm` (`^3.49.1` en Dedicated Worker `opfs-sahpool` y Worker efímero Evals), `better-sqlite3` (`^11.9.0`, devDependency para `Vitest` en Node) + `@types/better-sqlite3` (`^7.6.13`).
- **Shell Nativo Capacitor & Hardware:** `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/app` (`appRestoredResult`), `@capacitor/camera`, `@capacitor/filesystem`, `@capacitor/share`, `@capgo/capacitor-speech-recognition` (on-device `es-ES`).
- **Módulos Diferidos (Lazy-Loading & Activos Locales 0 CDN):** `tesseract.js` (`^6.0.1`), **`@tesseract.js-data/spa` (`^1.0.0`, contiene `spa.traineddata.gz`)**, `pdfmake` (`^0.2.18`) + **`@types/pdfmake` (`^0.2.9`, devDependency obligatorio bajo `strict: true`)**, `@capgo/capacitor-llm` (nativo opcional) y `@mediapipe/tasks-genai` (WebGPU opcional).
- **Empaquetado, Offline Web & QA:** `vite` (`^6.3.0`), `@vitejs/plugin-react` (`^4.4.0`), `vite-plugin-pwa` (`^1.0.0`, activado solo cuando `mode !== "capacitor" && mode !== "test"`), `vitest` (`^3.1.0`), `@playwright/test` (`^1.52.0`), `eslint` (`^9.25.0`).

### 1.2 Configuración Crítica (`vite.config.ts`, Copiado de Activos 0 CDN, CSP, Nativo y Scripts Windows-Safe)

1. **`scripts/sync-assets.mjs` (ejecutado en `postinstall` y `prebuild` / `dev`):**
   - Copia de forma determinista y sin red:
     - `node_modules/tesseract.js/dist/worker.min.js` -> `public/assets/ocr/worker.min.js`
     - `node_modules/tesseract.js-core/tesseract-core*.{wasm.js,wasm}` -> `public/assets/ocr/`
     - `spa.traineddata.gz` localizado bajo `node_modules/@tesseract.js-data/spa/` -> `public/assets/ocr/spa.traineddata.gz`
     - `node_modules/@mediapipe/tasks-genai/wasm/*` -> `public/assets/mediapipe/wasm/`
2. **`vite.config.ts` (`defineConfig(({ mode }) => ...)`):**
   - `plugins: [react(), tailwindcss(), ...(mode !== "capacitor" && mode !== "test" ? [VitePWA({ registerType: "autoUpdate", manifest: false, workbox: { maximumFileSizeToCacheInBytes: 25 * 1024 * 1024, globPatterns: ["**/*.{js,css,html,wasm,gz,svg,woff2,json}"], navigateFallback: "index.html" } })] : [])]` *(usar `manifest: false` evita duplicidad respecto a `public/manifest.webmanifest`)*.
   - `optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] }` y **sin cabeceras `COOP`/`COEP`** (`opfs-sahpool` no usa `SharedArrayBuffer`).
   - `resolve.alias`: mapea `"async_hooks"` y `"node:async_hooks"` hacia `src/agent/asyncLocalStoragePolyfill.ts` **únicamente cuando `mode !== "test"`** (en `Vitest` corre `node:async_hooks` nativo).
   - `worker: { format: "es" }`, `build.rollupOptions.output.manualChunks` aislando `chunk-ocr` (`tesseract.js`), `chunk-pdf` (`pdfmake/build/pdfmake`, `pdfmake/build/vfs_fonts`) y `chunk-llm-web` (`@mediapipe/tasks-genai`), y `test: { exclude: ["node_modules/**", "dist/**", "tests/e2e/**"] }` *(evita que `Vitest` intente ejecutar las specs de Playwright)*.
3. **Polyfill `AsyncLocalStorage` y Contratos `pdfmake` / `MediaPipe`:**
   - **LangGraph en navegador (`src/agent/asyncLocalStoragePolyfill.ts`):** implementa `AsyncLocalStorage<T>` con pila en memoria (`push` en `run()`, espera de retorno síncrono/promesa, `pop` en `finally`, `getStore()` devolviendo el tope de pila) y registra `AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new BrowserAsyncLocalStorage())` desde `@langchain/core/singletons` al arranque de `src/main.tsx` (y workers/tests browser) antes de compilar el grafo. `GraphRunner` serializa toda ejecución activa de `compiledGraph.invoke()` en una cola FIFO única para impedir solapamientos de pila durante `interrupt()`.
   - **`pdfmake@^0.2.18` (`src/features/pdf/pdfMakeAdapter.ts`):** usa imports dinámicos ESM de navegador `import("pdfmake/build/pdfmake")` e `import("pdfmake/build/vfs_fonts")`, desenvuelve **`const pdfMake = (pdfMakeMod as { default?: PdfMakeStatic }).default ?? pdfMakeMod`** (para compatibilidad UMD/CJS en Vite), asigna `pdfMake.vfs = vfsMod.pdfMake?.vfs ?? vfsMod.default?.pdfMake?.vfs ?? vfsMod.vfs ?? vfsMod` y envuelve el callback en `new Promise<Uint8Array>((resolve) => pdfMake.createPdf(docDef).getBuffer((buf: Uint8Array) => resolve(new Uint8Array(buf))))`.
   - **MediaPipe WebGPU (`src/features/llm/mediaPipeAdapter.ts`):** inicializa `FilesetResolver.forGenAiTasks(`${import.meta.env.BASE_URL}assets/mediapipe/wasm`)` (0 CDN); en Web lee el `.task`/`.litertlm` de `<input type="file">` vía stream en sesión (limpiando `llm_enabled=0` en recarga si no existe handle persistido en OPFS opt-in); `unloadLocalLlm()` cierra `llmInference.close()` en Web o descarta sesión activa e inhibe LLM en Nativo (`@capgo/capacitor-llm`) antes de OCR/PDF.
4. **CSP Estricta (`index.html`), Permisos y `FileProvider`:**
   - `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:; img-src 'self' blob: data: capacitor://localhost http://localhost; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self';" />`
   - **Android (`AndroidManifest.xml` + `res/xml/file_paths.xml`):** permisos `CAMERA`, `RECORD_AUDIO`; `<files-path name="obralocal_data" path="." />` y `<cache-path name="obralocal_cache" path="." />` para `FileProvider` de `@capacitor/share`. **iOS (`Info.plist`):** `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`.
5. **Scripts `package.json` Cross-Platform (Windows CMD/PowerShell + Unix, sin env inline):**
   - `sync:assets` -> `node scripts/sync-assets.mjs`
   - `dev` -> `npm run sync:assets && vite --mode web`
   - `build` -> `tsc --noEmit && npm run sync:assets && vite build --mode web`
   - `build:capacitor` -> `tsc --noEmit && npm run sync:assets && vite build --mode capacitor && npx cap sync`
   - `test` -> `vitest run`
   - `test:e2e` -> `playwright test`

---

## 2. Árbol Exacto de Directorios y Fronteras Modulares (`Zero-Decision Rule`)

Regla de dependencias estricta: **`src/features/*` y `src/ui/*` -> `src/agent/*` y `src/core/*`**; **`src/agent/*` -> `src/core/*`**; **`src/core/*` nunca importa desde `src/agent/` ni `src/features/`** (desacoplado mediante `checkpointsRepo`, `SeedGraphFreezerPort` y `MemoryCoordinator.registerLlmReleaser`).

```text
AutonomosApp/
├── index.html                                    # Meta viewport mobile-first + CSP estricta offline
├── package.json                                  # Dependencias cerradas y scripts vite --mode (Windows safe)
├── tsconfig.json                                 # strict: true, noUncheckedIndexedAccess: true
├── vite.config.ts                                # react(), tailwindcss(), VitePWA condicional, alias async_hooks, exclude sqlite-wasm, test.exclude
├── playwright.config.ts                          # testDir: "./tests/e2e", webServer localhost preview offline
├── capacitor.config.ts                           # appId: 'es.obralocal.app', appName: 'ObraLocal AI'
├── scripts/
│   └── sync-assets.mjs                           # Copia worker/wasm/spa.traineddata.gz y mediapipe/wasm a public/assets/
├── public/
│   ├── manifest.webmanifest                      # Icono apuntando a /icons/icon.svg (precache Workbox **/*.svg)
│   ├── icons/
│   │   └── icon.svg                              # Icono vectorial PWA 100% local-first
│   └── assets/
│       ├── ocr/                                  # worker.min.js, tesseract-core*.{wasm.js,wasm}, spa.traineddata.gz
│       └── mediapipe/wasm/                       # Binarios locales @mediapipe/tasks-genai/wasm/* (0 CDN)
├── docs/                                         # Especificación congelada (00..04 + schema.sql + PROMPT_MAESTRO)
├── src/
│   ├── vite-env.d.ts                             # vite/client, *.sql?raw, Navigator.deviceMemory y Navigator.gpu
│   ├── main.tsx                                  # Inicializa BrowserAsyncLocalStorage + appReadyPromise + App.addListener('appRestoredResult')
│   ├── index.css                                 # @import "tailwindcss" + tokens alto contraste obra + @fontsource
│   ├── App.tsx                                   # BootstrapStorage + registra releaser LLM + SeedGraphFreezerPort + Shell A2UI
│   ├── core/
│   │   ├── db/
│   │   │   ├── sqliteExecutor.ts                 # Importa ../../../docs/schema.sql?raw (fuente única), SqliteExecutor, factory y sanitizeFts5Query
│   │   │   ├── nativeCapacitorExecutor.ts        # @capacitor-community/sqlite WAL + cola FIFO + transaction:false + isInTx guard
│   │   │   ├── webWorkerSqliteExecutor.ts        # RPC hacia sqlite.worker.ts + navigator.locks sesión completa
│   │   │   ├── memorySqliteExecutor.ts           # InMemorySqliteExecutor (:memory:) + NodeBetterSqliteExecutor (con guardia isInTx!)
│   │   │   └── repositories/
│   │   │       ├── settingsRepo.ts               # app_settings, emitter_profile, sequences, recovered_drafts, last_active_thread_id
│   │   │       ├── checkpointsRepo.ts            # deleteThreadCheckpoints, purgeAllCheckpoints(tx), migrateIncompatibleCheckpoints (0 core->agent)
│   │   │       ├── clientsRepo.ts                # listPaginated + clients_fts + bloqueo borrado con dependencias
│   │   │       ├── catalogRepo.ts                # listPaginated + catalog_items_fts + feedback_corrections
│   │   │       ├── jobsRepo.ts                   # listPaginated + Serie OBR + jobs_fts + máquina pendiente->en_curso->finalizado|cancelado
│   │   │       ├── quotesRepo.ts                 # Serie PRE + borrador editable vs enviado/aceptado inmutable + regeneratePdfOnDemand(pdfPort)
│   │   │       ├── invoicesRepo.ts               # syncOverdueOnRead(getLocalTodayIso) + series ANT/FAC + cobro reversible + regeneratePdfOnDemand(pdfPort)
│   │   │       ├── ticketsRepo.ts                # listByQuarterOrJob + CRUD ±2cts + fileBridge.deleteCommittedMedia en delete + checkDuplicate
│   │   │       ├── siteLogsRepo.ts               # Persistencia site_logs con creación atómica opcional new_job (XOR)
│   │   │       ├── chatRepo.ts                   # chat_threads (reconcilia running->error) + chat_messages + deleteClosedThread (vía checkpointsRepo)
│   │   │       └── tracesRepo.ts                 # Write/List de agent_traces (cloud_cost_eur = 0.0)
│   │   ├── ports/
│   │   │   ├── mediaPorts.ts                     # OcrPort, PdfPort, PdfBuildInput, WatermarkPort, LocalInferenceAdapter, TraceRecorder (0 core->agent/features)
│   │   │   └── seedFreezerPort.ts                # Interfaz SeedGraphFreezerPort (freezeDemoGates()) para resetService Fase 2 sin importar agent/
│   │   ├── fiscal/
│   │   │   ├── fiscalEngine.ts                   # roundHalfUpDiv, IVA 10/21, desglose inv. 21%, ANT 40%, FAC diff y Hucha Fiscal
│   │   │   ├── taxIdValidator.ts                 # validateSpanishTaxId (NIF/NIE/CIF dígito de control)
│   │   │   └── dateQuarter.ts                    # getLocalTodayIso(), isValidIsoDate(), deriveFiscalQuarter()
│   │   ├── contracts/
│   │   │   ├── schemas.ts                        # Todos los Zod schemas (Draft vs Commit, HumanDecision, Widgets, SiteLogInput, TraceState)
│   │   │   └── types.ts                          # Tipos TS inferidos + bridgeRecordSchemas + CameraCaptureResult
│   │   ├── files/
│   │   │   ├── fileBridge.ts                     # Interfaz LocalFileBridge (incl. resolveDisplayUrl, deleteCommittedMedia, regla 'seed://')
│   │   │   ├── nativeFileBridge.ts               # @capacitor/filesystem + Capacitor.convertFileSrc + toShareableNativeUri (FileProvider)
│   │   │   ├── webOpfsFileBridge.ts              # Cliente RPC hacia opfsFile.worker.ts (blob: URL con revoke(), createSyncAccessHandle)
│   │   │   ├── memoryFileBridge.ts               # Implementación en memoria para Vitest / EvalRunner
│   │   │   └── documentOpener.ts                 # openPdf(pdfUri, docKind, docId, pdfPort): Web URL.createObjectURL/descarga vs Nativo Share sin sent_at_iso
│   │   ├── memory/
│   │   │   └── memoryCoordinator.ts              # registerLlmReleaser(fn), acquireHeavyTask(), releaseLlmIfLoaded() (0 imports hacia features/)
│   │   ├── backup/
│   │   │   ├── backupService.ts                  # Export/Import JSON simétrico + WebCrypto AES-256-GCM PBKDF2-SHA256 (tx vía checkpointsRepo)
│   │   │   └── resetService.ts                   # restoreDemoData(freezer): Fase 1 tx (seedData JSON + tr_seed_03..05) -> Fase 2 freezer.freezeDemoGates(); y startFromScratch()
│   │   └── hardware/
│   │       ├── voiceAdapter.ts                   # CapacitorVoiceInputAdapter (on-device es-ES) y WebVoiceInputAdapter (always false)
│   │       └── cameraAdapter.ts                  # CameraCaptureResult, @capacitor/camera + fallback <input type="file"> Web + ingestRestoredPhoto()
│   ├── workers/
│   │   ├── sqlite.worker.ts                      # @sqlite.org/sqlite-wasm opfs-sahpool (initialCapacity: 12) + FIFO
│   │   ├── opfsFile.worker.ts                    # createSyncAccessHandle() para leer/escribir PDFs e imágenes en Web
│   │   └── evals.worker.ts                       # Worker efímero SQLite :memory: para EvalRunner
│   ├── agent/
│   │   ├── asyncLocalStoragePolyfill.ts          # BrowserAsyncLocalStorage stack-backed + shim node:async_hooks
│   │   ├── state.ts                              # ObraLocalAnnotation + boundedMessagesReducer(20) + turnTraceReducer
│   │   ├── checkpointer.ts                       # CapacitorSqliteSaver (delegando delete/purge a checkpointsRepo, WRITES_IDX_MAP, Base64 simétrico)
│   │   ├── demoSeeder.ts                         # Implementa SeedGraphFreezerPort.freezeDemoGates() (Fase 2: thr-seed-01/02 vía compiledGraph.invoke + traceIdOverride)
│   │   ├── inference/
│   │   │   ├── localInferenceAdapter.ts          # Router determinista vs llmRunner?: (prompt: string) => Promise<string> inyectado desde App.tsx (Fase 4 -> mediaPipeAdapter.ts; Fase 2 mantiene 0 imports de features/) + timeout 3000ms + Zod + fallback
│   │   │   └── deterministicSpanishParser.ts     # Normalizador español, numerales, unidades, IVA 10/21, extracción entidades <150ms
│   │   ├── ports.ts                              # Re-exporta src/core/ports/mediaPorts.ts y define GraphDependencies + SeedOverrides
│   │   ├── nodes/
│   │   │   ├── intentRouter.ts                   # Prioridades 1..4, resolución 'cancelar', chip huérfano, context sync
│   │   │   ├── quoteSpecialist.ts                # seed_override, 0 presupuestos/borrador/enviado, RAG FTS5, save_to_catalog defaults
│   │   │   ├── ocrTicketSpecialist.ts            # seed_override antes de effectiveMediaUri != null, lazy OcrPort o manual_ticket_entry -> Gate 2
│   │   │   ├── fiscalPiggybankSpecialist.ts      # Solo lectura invoices/expense_tickets/jobs -> FiscalPiggyBankWidget
│   │   │   ├── lifecycleBillingSpecialist.ts     # Elegibilidad ANT/FAC, prioridad Share FAC>ANT>PRE, emitter_profile, overview o Gate 3/4
│   │   │   ├── siteLogSpecialist.ts              # Clasifica antes/despues/nota + SiteLogStampWidget
│   │   │   ├── assistantQaNode.ts                # Solo lectura SQL + disambiguation_exhausted guard
│   │   │   ├── clarificationNode.ts              # Pregunta breve + chips quick_actions resolve_disambiguation
│   │   │   ├── a2uiDispatcher.ts                 # validateGateWidgetMatch + traceIdOverride + traza #1 pre_interrupt/complete
│   │   │   └── commitNodes.ts                    # quote_commit, ocr_commit (guard media_uri!==null), lifecycle_commit (1x interrupt + Sec 3.2 + traza #2)
│   │   ├── graph.ts                              # buildObraLocalGraph(deps) -> StateGraph compilado DAG <= 5 supersteps
│   │   └── graphRunner.ts                        # Cola única FIFO invocación activa, runTurn, resumeGate, reopenRecoveredDraft, rehydrateActiveThread
│   ├── features/
│   │   ├── ocr/
│   │   │   └── tesseractOcrAdapter.ts            # Dynamic import('tesseract.js'), Blob input, workerBlobURL:false, local assets, terminate()
│   │   ├── pdf/
│   │   │   └── pdfMakeAdapter.ts                 # Dynamic import('pdfmake/build/pdfmake' + 'vfs_fonts'), Promise getBuffer() -> Uint8Array
│   │   ├── sitelog/
│   │   │   ├── canvasWatermark.ts                # Estampado fecha/hora/OBR/cliente + compresión JPEG Canvas
│   │   │   └── siteLogService.ts                 # stampAndSave(SiteLogInput): creación atómica new_job XOR job_id + site_logs
│   │   ├── llm/
│   │   │   └── mediaPipeAdapter.ts               # FilesetResolver.forGenAiTasks(BASE_URL + 'assets/mediapipe/wasm'), releaseLlmIfLoaded(), @capgo/capacitor-llm
│   │   ├── chat/
│   │   │   ├── ChatTimelineView.tsx              # Timeline multi-turno, contexto activo chip, compositor bloqueado en HITL
│   │   │   └── widgets/
│   │   │       ├── WidgetDispatcher.tsx          # Switch cerrado sobre los 5 ui_widget_type
│   │   │       ├── QuoteBuilderWidget.tsx        # Gate 1: +/-, precio táctil, toggle catálogo opt-in, IVA 10%/21%, Commit validator
│   │   │       ├── FiscalPiggyBankWidget.tsx     # Tarjeta Hucha Fiscal: Intocable vs Disponible, Cobros T ant., Beneficio por obra
│   │   │       ├── TicketOcrValidatorWidget.tsx  # Gate 2: campos OCR, botón Desglose inv. 21%, ±2cts, duplicado warning, obra/Gasto general
│   │   │       ├── JobLifecycleActionWidget.tsx  # Gate 3/4/Overview: emitter_* + client_* inline, openPdf, ready_to_share síncrono
│   │   │       └── SiteLogStampWidget.tsx        # Selector obra / new_job cancelable, antes/despues/nota, resolveDisplayUrl, confirmación idempotente en Chat
│   │   ├── directory/
│   │   │   ├── DirectoryView.tsx                 # Pestañas Obras / Clientes / Catálogo / Gastos con búsqueda FTS5 paginada y openPdf
│   │   │   └── JobDetailDrawer.tsx               # Estado obra, start_job_quote, ANT/FAC, PDF bajo demanda, SiteLogs con resolveDisplayUrl
│   │   ├── fiscal/
│   │   │   └── FiscalDashboardView.tsx           # Pestaña Hucha Fiscal dedicada por trimestre {YYYY}-T{Q}
│   │   ├── settings/
│   │   │   └── SettingsSheet.tsx                 # Perfil Emisor, Series PRE/ANT/FAC/OBR, Backup AES-GCM, Demo/Clean, LLM local
│   │   └── inspector/
│   │       ├── InspectorView.tsx                 # Trazas agent_traces (cloud_cost_eur = 0.00), parent_trace_id y feedback_corrections
│   │       └── evalRunnerClient.ts               # Lanza evals.worker.ts (:memory:) sobre onDeviceEvalFixtures
│   └── ui/
│       ├── MobileShell.tsx                       # Cabecera contexto + 3 pestañas + barra inferior a una mano + vista tablet split
│       ├── ThreadsDrawer.tsx                     # Hilos con badge En pausa HITL / Activo / Error / Cerrado + recovered_drafts (Reabrir/Descartar)
│       ├── BottomQuickBar.tsx                    # Micrófono (móvil offline), Nuevo Chat, Nuevo Presupuesto (chip start_empty_quote), Escanear Ticket, Foto Diario
│       └── GuardBanners.tsx                      # Alertas: pestaña OPFS duplicada, Safari no-PWA, cuota disco, permisos cámara/voz
└── tests/
    ├── mocks/
    │   └── ports.ts                              # MockOcrPort, MockPdfPort, MockFreezerPort compartidos para Fases 1 y 2
    ├── fiscal.test.ts                            # Vitest Fase 1: roundHalfUpDiv, IVA 10/21, inv. 21%, 40% ANT + FAC, Hucha Fiscal, NIF/CIF
    ├── fts5.test.ts                              # Vitest Fase 1: schema.sql, triggers, sanitizeFts5Query, sin tildes, DEFERRABLE
    ├── backup.test.ts                            # Vitest Fase 1: export/import AES-GCM, purge checkpoints vía checkpointsRepo, startFromScratch (stub freezer)
    ├── ocr-parser.test.ts                        # Vitest Fase 2: DeterministicSpanishParser (<150ms), numerales, ±2cts tickets
    ├── graph.hitl.test.ts                        # Vitest Fase 2: StateGraph real + SqliteSaver (:memory:) + MockOcrPort/PdfPort en 4 Gates, QA, loop-free
    ├── demo-seeder.test.ts                       # Vitest Fase 3: DemoSeeder real (2 fases) + restoreDemoData() end-to-end sin WASM
    └── e2e/
        └── offline-flows.spec.ts                 # Playwright Fase 4: clock congelado 2026-11-18, bloqueo red externa, 4 Gates, Evals :memory:
```

---

## 3. Diseño de Interfaz A2UI Móvil a Una Mano y Transiciones de Pantalla

### 3.1 Sistema Visual y Ergonomía de Obra (Alto Contraste)

- **Paleta Industrial:** Arena `#F8FAFC` / tarjetas `#FFFFFF` / borde `#CBD5E1` / tinta `#0F172A`; primario `#D97706`; Caja Disponible `#047857`; Dinero Intocable Hacienda `#B91C1C` / `#FFFBEB`; HITL `#1D4ED8`.
- **Tipografía y Zonas Táctiles:** `Inter` + `JetBrains Mono` (`tabular-nums`) empaquetadas en local; controles primarios `min-h-[48px]`.

### 3.2 Geometría de Shell, Desambiguación de Barras y Bloqueo HITL

1. **Cabecera Compacta (`56px`) + Hilos Recuperados:** muestra selector de hilos (badge si hay pausa HITL pendiente), chip permanente **`100 % Offline · 0,00 € Nube`** y botón **Ajustes / Inspector**. Si `recovered_drafts` contiene filas no descartadas (`dismissed = 0`), `ThreadsDrawer` y `ChatTimelineView` muestran banner con botones **"Reabrir borrador"** (`graphRunner.reopenRecoveredDraft(draft.id)` creando hilo nuevo pausado en Gate 1/2) y **"Descartar"** (`settingsService.dismissRecoveredDraft(draft.id)`).
2. **Selector Superior de 3 Áreas:** **`Chat`** · **`Directorio`** · **`Hucha Fiscal`** (en >= 1024px vista split con lista de hilos + área principal + Inspector vivo).
3. **Banner de Contexto Activo (`Chat`):** `Obra activa: OBR-2026-003 · C.P. Alcalá 142` con selector para sincronizar `session_context` o desvincular (`null`).
4. **Regla de Bloqueo en `interrupted`:** bloquea el compositor de texto y **Micrófono** dentro del hilo pausado con tarjeta destacada HITL.
5. **Barra Inferior de Pulgar (Handlers Exactos):**
   - **Micrófono:** solo visible en móvil nativo si `isOnDeviceRecognitionAvailable({ language: "es-ES" })` es verdadero; ante `permissionDenied` muestra guía inline sin cerrar chat.
   - **Nuevo Chat:** abre nuevo hilo limpio en Chat con compositor enfocado.
   - **Nuevo Presupuesto:** abre nuevo hilo limpio en Chat con foco en el compositor y chip rápido inmediato **`Abrir constructor vacío` (`start_empty_quote`)** (manteniendo libre el compositor para dictar al instante sin bloquearlo de entrada).
   - **Escanear Ticket:** invoca `cameraAdapter.captureOrPick()` (`CameraCaptureResult`). En `"ok"`, abre nuevo hilo y dispara `runTurn({ action_type: "scan_ticket", raw_media_uri })`; en `"cancelled"`, no crea hilo; en `"permission_denied"`, muestra aviso inline + botón directo a nuevo hilo con `manual_ticket_entry` (en Web usa fallback `<input type="file" accept="image/*" capture="environment">` + acceso a `manual_ticket_entry`).
   - **Foto Diario:** abre `SiteLogStampWidget` directamente mediante `src/core/` (usable incluso con hilos de chat en `interrupted`).

### 3.3 Flujo Operativo Exacto de los 5 Widgets y Vistas

1. **`QuoteBuilderWidget` (Gate 1):** `+`/`-` cantidad, edición táctil de precio, toggle opt-in `Guardar en tarifario` (pre-marcado a `true` solo en líneas nuevas no catalogadas), IVA `10 %` vs `21 %`, alta rápida cliente, validando `Gate1QuoteCommitPayloadSchema` antes de enviar `approve` o `edit` (o `reject`).
2. **`TicketOcrValidatorWidget` (Gate 2):** confianza `0..100`, botón **"Desglosar IVA 21 % desde Total"** (`base_cents = roundHalfUpDiv(total_cents * 100, 121)`), tolerancia `± 2 céntimos`, alerta en vivo de posible duplicado, miniatura vía `fileBridge.resolveDisplayUrl()` (con limpieza `revoke()` al desmontar), selector obra o `"Gasto general"` y trimestre sincronizado.
3. **`JobLifecycleActionWidget` (Overview · Gate 3 · Gate 4 · `ready_to_share`):**
   - `overview`: botón abrir PDF (`documentOpener.openPdf`), lanzar Gate 3 (`advance_40` / `final_invoice`) o Gate 4 (`share`).
   - `preview_gate_3`: muestra próximo correlativo estimado, fecha emisión/vencimiento, deducción `40 %`, **`emitter_name`**, **`emitter_nif`**, **`emitter_fiscal_address`**, `client_nif` y `client_fiscal_address` editables inline (exigiendo `action: "edit"` si alguno faltaba o venía vacío en modo *"Empezar de cero"*).
   - `preview_gate_4`: teléfono editable (`E164PhoneSchema`) + canal (`whatsapp` / `share_sheet`) + mensaje plantilla.
   - `ready_to_share`: en Web PWA precarga `File` en `useEffect` y dispara `navigator.canShare` + `navigator.share({ files })` síncronamente en el primer paso del `onClick` (o descarga PDF + `wa.me` con prefijo `34`, o solo descarga si falta teléfono); en Nativo intenta `@capacitor/share` al entrar conservando botón de reintento; actualiza `sent_at_iso` solo tras confirmación sin `AbortError`.
4. **`FiscalPiggyBankWidget` y `FiscalDashboardView`:** `Cobrado mismo trimestre`, `Dinero Intocable Hacienda` (`IVA neto` / `"X € IVA a compensar"` + `IRPF 20 %`), `Saldo Disponible Real` (alerta déficit `< 0`), `Cobros de T anteriores`, `Pendiente de cobro` (actual + previos) y `Beneficio neto por obra`.
5. **`SiteLogStampWidget`:** selección paginada de obra o creación exprés `new_job` (no crea `OBR` en SQLite hasta pulsar Confirmar; cancelar no deja obras huérfanas), categoría `antes | despues | nota` + texto o foto reescalada (`<= 1600px`) vista vía `resolveDisplayUrl()`. Cuando se confirma desde un mensaje en Chat (`thr-seed-05-site-log`), marca la entrada como confirmada en UI para evitar envíos duplicados.
6. **Directorio, Ajustes (`SettingsSheet`) e Inspector (`InspectorView`):**
   - Directorio paginado (`limit/offset`) con búsqueda `FTS5`, `openPdf()`, borrado seguro de tickets (`deleteCommittedMedia`), reversión `pagado <-> pendiente_cobro`, `sent_at_iso` manual y paso de estado de obra.
   - Ajustes separa utilidades de usuario (**Perfil emisor**, contadores iniciales `PRE/ANT/FAC/OBR`, **Backup JSON AES-GCM**, **Restaurar Datos Demo**, **Empezar de cero**, gestor LLM opcional con botón **Liberar de memoria**) de la Auditoría Técnica (`agent_traces` con `cloud_cost_eur = 0.00`, `feedback_corrections` y Suite de Evals en `evals.worker.ts`).

---

## 4. Plan de Implementación Incremental en 4 Fases Verificables

| Fase | Alcance y Archivos | Criterio de Verificación Objetiva (Gate de Fase) |
|---|---|---|
| **Fase 1: Núcleo SQLite, FiscalEngine y Contratos Zod** | `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `capacitor.config.ts`, `public/manifest.webmanifest`, `public/icons/icon.svg`, `src/index.css`, `src/vite-env.d.ts`, `scripts/sync-assets.mjs`, `src/core/*`, `src/workers/sqlite.worker.ts`, `src/workers/opfsFile.worker.ts`, `tests/mocks/ports.ts` | `npm run sync:assets && npx tsc --noEmit` (`0` errores); `vitest run tests/fiscal.test.ts tests/fts5.test.ts tests/backup.test.ts` 100 % PASS (`backup.test.ts` usa `MockFreezerPort`, verifica `checkpointsRepo`, `AES-GCM`, `startFromScratch` y guardia `isInTx`). |
| **Fase 2: Motor LangGraph, Polyfill ALS e Inferencia** | `src/agent/*` (`asyncLocalStoragePolyfill.ts`, `state.ts`, `checkpointer.ts`, `deterministicSpanishParser.ts`, `localInferenceAdapter.ts`, `ports.ts`, `nodes/*` x12, `graph.ts`, `graphRunner.ts`) | `npx tsc --noEmit` (`0` errores); `vitest run tests/graph.hitl.test.ts tests/ocr-parser.test.ts` 100 % PASS ejecutando `StateGraph` real sobre `:memory:` + `MockOcrPort`/`MockPdfPort` (`approve/edit/reject` en 4 Gates, `assistant_qa_node`, desambiguación sin bucles, `recovered_drafts` reopen, doble traza `agent_traces`). |
| **Fase 3: Módulos Verticales A2UI, Lazy WASM/PDF y DemoSeeder** | `src/agent/demoSeeder.ts`, `public/assets/*`, `src/features/ocr/*`, `src/features/pdf/*`, `src/features/sitelog/*`, `src/features/llm/*`, `src/features/chat/*` | `npx tsc --noEmit` (`0` errores) + ausencia de imports estáticos de `tesseract.js`/`pdfmake`/`@mediapipe/tasks-genai` fuera de `src/features/{ocr,pdf,llm}`; `vitest run tests/demo-seeder.test.ts` 100 % PASS verificando congelación real en 2 fases de los 5 escenarios semilla sin red ni OCR WASM. |
| **Fase 4: Shell Móvil, Entrypoint Vite, Directorio, Hucha, Inspector, Evals y E2E** | `src/main.tsx`, `src/App.tsx`, `src/ui/*`, `src/features/directory/*`, `src/features/fiscal/*`, `src/features/settings/*`, `src/features/inspector/*`, `src/workers/evals.worker.ts`, `playwright.config.ts`, `tests/e2e/offline-flows.spec.ts` | `npm run build` (emitiendo chunks separados `chunk-ocr`, `chunk-pdf` y `chunk-llm-web` fuera del chunk inicial) + `npm run test && npm run test:e2e` 100 % PASS (`page.clock.install` fijo en `2026-11-18T10:00:00`, bloqueo de red externa garantizando `cloud_cost_eur = 0.00`, arranque `thr-seed-01-gate1`, 4 Gates, `openPdf`, Hucha Fiscal, Foto Diario, Inspector y Suite Evals `:memory:`). |
