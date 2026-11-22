# Concept Brief: ObraLocal AI

## 1. Visión y Restricción Crítica (100 % Zero-Cloud)
- **Producto:** App móvil nativa (Android/iOS) y arranque Web inmediato para autónomos de oficios técnicos en España (reformas, fontanería, electricidad, albañilería).
- **Restricción absoluta:** 100 % Local-First y Offline. Cero servidores externos, cero PC encendido, cero API keys de terceros y `cloud_cost_eur = 0.00` verificado en `agent_traces`.
- **Arquitectura Modular y UX A2UI:** Módulos verticales desacoplados con carga diferida (*lazy-loading*) de WASM/PDF sobre núcleo ligero, espacio conversacional multi-turno a una mano con 5 widgets A2UI (`QuoteBuilderWidget`, `FiscalPiggyBankWidget`, `TicketOcrValidatorWidget`, `JobLifecycleActionWidget`, `SiteLogStampWidget`) + Inspector, Feedback Loop y Suite de Evals `:memory:`.

## 2. Topología Multi-Agente Multi-Turno (LangGraph.js)
- **Orquestador:** Único `StateGraph` (`@langchain/langgraph/web`) persistido por `thread_id` mediante `CapacitorSqliteSaver` (`extends BaseCheckpointSaver`), manteniendo contexto conversacional activo (`active_job_id`, `active_quote_id`, `pending_disambiguation`).
- **Nodos Especialistas:** `intent_router` resuelve fast-path, desambiguación dialogada por voz/texto y contexto activo hacia `quote_specialist` (RAG FTS5), `ocr_ticket_specialist` (OCR lazy), `fiscal_piggybank_specialist`, `lifecycle_billing_specialist`, `site_log_specialist`, `assistant_qa_node` (respuestas rápidas en texto sobre SQLite real) o `clarification_node`, convergiendo en `a2ui_dispatcher` y 3 nodos lineales HITL (`quote_commit`, `ocr_commit`, `lifecycle_commit`).
- **Regla Fiscal Inviolable:** Toda aritmética fiscal española (IVA 10 %/21 %, IRPF 20 %, anticipo 40 %, totales) se ejecuta en funciones TypeScript deterministas en céntimos enteros, nunca delegada al LLM.

## 3. Puertas Human-in-the-Loop (`interrupt()` / `Command(resume)`)
El grafo se congela y bloquea el chat libre ante 4 acciones críticas (`approve | edit | reject`):
1. **Gate 1 — Presupuesto y Catálogo:** Confirmar partidas, precios editados (Feedback Loop opt-in a `catalog_items`), tipo de IVA y PDF.
2. **Gate 2 — Ticket OCR Fiscal:** Confirmar proveedor/NIF/fecha/base/IVA/total, vincular a obra o `"Gasto general"` y archivar en `{YYYY}-T{Q}`.
3. **Gate 3 — Emisión Factura/Anticipo:** Confirmar emisión de factura correlativa (`FAC-{YYYY}-XXX`) o anticipo 40 % (`ANT-{YYYY}-XXX`).
4. **Gate 4 — Envío Externo Cliente:** Confirmar disparo por `@capacitor/share` / `navigator.share` o `wa.me` + descarga PDF.

## 4. Stack Técnico Cerrado (TypeScript End-to-End)
- **UI, Módulos y Shell Nativo:** React 19 + TypeScript (`strict: true`) + Tailwind CSS + Vite PWA + `@capacitor/core` (`@capgo/capacitor-speech-recognition` on-device, `camera`, `filesystem`, `share`).
- **Persistencia y RAG:** Adaptador dual SQLite + `FTS5` (`@capacitor-community/sqlite` nativo y `@sqlite.org/sqlite-wasm` Web).
- **Inferencia Dual (`LocalInferenceAdapter`):** Motor determinista/heurístico (<150 ms) siempre activo + conector opcional MediaPipe GenAI (`@capgo/capacitor-llm` / `@mediapipe/tasks-genai` WebGPU) tras importación de paquete local.
- **Lazy Runtimes, Contratos y Tests:** Carga diferida offline de `tesseract.js` WASM y `pdfmake` (`vfs_fonts`), `Zod` y `Vitest`.
