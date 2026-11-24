-- =============================================================================
-- ObraLocal AI — Esquema SQLite + FTS5 + Triggers + Checkpointer LangGraph.js
-- Compatible con: @capacitor-community/sqlite (Android/iOS) y @sqlite.org/sqlite-wasm (Web OPFS / :memory:)
-- Versión de esquema: 1.5.0 (Checkpoint Schema Version: 1.0.0)
-- Regla invariante: cloud_cost_eur = 0.0 | Importes monetarios en céntimos enteros
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. Cuentas Locales y Configuración Única del Emisor / Estado de App
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (length(trim(email)) > 0),
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  password_salt TEXT NOT NULL CHECK (length(password_salt) > 0),
  password_iterations INTEGER NOT NULL DEFAULT 100000 CHECK (password_iterations >= 10000),
  onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  emitter_name TEXT NOT NULL DEFAULT '',
  emitter_nif TEXT NOT NULL DEFAULT '',
  emitter_fiscal_address TEXT NOT NULL DEFAULT '',
  emitter_phone TEXT NOT NULL DEFAULT '',
  emitter_iban TEXT NOT NULL DEFAULT '',
  emitter_logo_data_url TEXT,
  active_account_id TEXT REFERENCES local_accounts(id) ON DELETE SET NULL,
  last_active_thread_id TEXT,
  pending_camera_context_json TEXT,
  llm_enabled INTEGER NOT NULL DEFAULT 1 CHECK (llm_enabled IN (0, 1)),
  llm_model_uri TEXT,
  default_vat_rate REAL NOT NULL DEFAULT 21 CHECK (default_vat_rate >= 0 AND default_vat_rate <= 100),
  irpf_reserve_rate REAL NOT NULL DEFAULT 20 CHECK (irpf_reserve_rate >= 0 AND irpf_reserve_rate <= 100),
  hourly_rate_cents INTEGER NOT NULL DEFAULT 3800 CHECK (hourly_rate_cents > 0),
  boot_mode TEXT NOT NULL DEFAULT 'clean' CHECK (boot_mode IN ('demo', 'clean')),
  expand_long_text_inputs INTEGER NOT NULL DEFAULT 1 CHECK (expand_long_text_inputs IN (0, 1)),
  default_quote_validity_days INTEGER NOT NULL DEFAULT 30 CHECK (default_quote_validity_days BETWEEN 1 AND 365),
  default_payment_methods_json TEXT NOT NULL DEFAULT '["transferencia"]',
  default_payment_schedule_json TEXT NOT NULL DEFAULT '[]',
  active_tax_models_json TEXT NOT NULL DEFAULT '["303","130","390","347","100"]',
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

-- -----------------------------------------------------------------------------
-- 2. Series Correlativas Fiscales y de Expediente Independientes por Año
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequences (
  series_type TEXT NOT NULL CHECK (series_type IN ('PRE', 'ANT', 'FAC', 'OBR')),
  fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2100),
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  PRIMARY KEY (series_type, fiscal_year)
);

-- -----------------------------------------------------------------------------
-- 3. Directorio Maestro: Clientes y Tarifario Personal
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  nif TEXT NOT NULL DEFAULT '',
  fiscal_address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  category TEXT NOT NULL DEFAULT 'General'
    CHECK (category IN ('Fontanería', 'Electricidad', 'Albañilería', 'Pintura', 'General')),
  unit TEXT NOT NULL DEFAULT 'ud' CHECK (length(trim(unit)) > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  pricing_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_mode IN ('fixed', 'hourly_plus_materials')),
  estimated_hours_thousandths INTEGER NOT NULL DEFAULT 0 CHECK (estimated_hours_thousandths >= 0),
  materials_cents INTEGER NOT NULL DEFAULT 0 CHECK (materials_cents >= 0),
  default_vat_rate REAL NOT NULL DEFAULT 21 CHECK (default_vat_rate >= 0 AND default_vat_rate <= 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

-- -----------------------------------------------------------------------------
-- 4. Expedientes de Obra (OBR-YYYY-XXX) y Presupuestos (PRE-YYYY-XXX)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_code TEXT NOT NULL UNIQUE,
  client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'en_curso', 'finalizado', 'cancelado')),
  start_date_iso TEXT CHECK (
    start_date_iso IS NULL OR start_date_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  end_date_iso TEXT CHECK (
    end_date_iso IS NULL OR end_date_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  created_at_iso TEXT NOT NULL CHECK (created_at_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  quote_code TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT,
  client_name_snapshot TEXT NOT NULL DEFAULT '',
  client_nif_snapshot TEXT NOT NULL DEFAULT '',
  client_address_snapshot TEXT NOT NULL DEFAULT '',
  client_phone_snapshot TEXT NOT NULL DEFAULT '',
  vat_rate REAL NOT NULL CHECK (vat_rate >= 0 AND vat_rate <= 100),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0 AND total_cents = subtotal_cents + vat_cents),
  status TEXT NOT NULL DEFAULT 'borrador'
    CHECK (status IN ('borrador', 'enviado', 'aceptado', 'rechazado')),
  validity_days INTEGER CHECK (validity_days IS NULL OR (validity_days BETWEEN 1 AND 365)),
  payment_methods_json TEXT NOT NULL DEFAULT '[]',
  payment_schedule_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  pdf_uri TEXT,
  sent_at_iso TEXT CHECK (
    sent_at_iso IS NULL OR sent_at_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ), -- fecha YYYY-MM-DD de envío (campo lógico sent_at en PRD)
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

-- Invariante: máximo un presupuesto activo (no rechazado) por obra
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_one_active_per_job
  ON quotes(job_id) WHERE status != 'rechazado';

CREATE TABLE IF NOT EXISTS quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  line_order INTEGER NOT NULL CHECK (line_order >= 0),
  catalog_item_id TEXT REFERENCES catalog_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  category TEXT NOT NULL DEFAULT 'General'
    CHECK (category IN ('Fontanería', 'Electricidad', 'Albañilería', 'Pintura', 'General')),
  unit TEXT NOT NULL DEFAULT 'ud' CHECK (length(trim(unit)) > 0),
  quantity_thousandths INTEGER NOT NULL CHECK (quantity_thousandths > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  line_subtotal_cents INTEGER NOT NULL CHECK (line_subtotal_cents >= 0),
  UNIQUE (quote_id, line_order)
);

-- -----------------------------------------------------------------------------
-- 5. Facturas Inmutables (ANT-YYYY-XXX y FAC-YYYY-XXX)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  series_type TEXT NOT NULL CHECK (series_type IN ('ANT', 'FAC')),
  fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2020 AND 2100),
  kind TEXT NOT NULL CHECK (
    (series_type = 'ANT' AND kind = 'advance_40') OR
    (series_type = 'FAC' AND kind IN ('final', 'full'))
  ),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  emitter_nif_snapshot TEXT NOT NULL CHECK (length(trim(emitter_nif_snapshot)) >= 5),
  emitter_name_snapshot TEXT NOT NULL DEFAULT '',
  emitter_address_snapshot TEXT NOT NULL DEFAULT '',
  client_name_snapshot TEXT NOT NULL CHECK (length(trim(client_name_snapshot)) > 0),
  client_nif_snapshot TEXT NOT NULL CHECK (length(trim(client_nif_snapshot)) >= 5),
  client_address_snapshot TEXT NOT NULL CHECK (length(trim(client_address_snapshot)) >= 5),
  client_phone_snapshot TEXT NOT NULL DEFAULT '',
  issued_at_iso TEXT NOT NULL CHECK (issued_at_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_at_iso TEXT NOT NULL CHECK (
    due_at_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND
    due_at_iso >= issued_at_iso
  ),
  quarter TEXT NOT NULL CHECK (quarter GLOB '[0-9][0-9][0-9][0-9]-T[1-4]'),
  paid_at_iso TEXT CHECK (
    paid_at_iso IS NULL OR paid_at_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  paid_quarter TEXT CHECK (
    paid_quarter IS NULL OR paid_quarter GLOB '[0-9][0-9][0-9][0-9]-T[1-4]'
  ),
  sent_at_iso TEXT CHECK (
    sent_at_iso IS NULL OR sent_at_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ), -- fecha YYYY-MM-DD de envío (campo lógico sent_at en PRD)
  vat_rate REAL NOT NULL CHECK (vat_rate >= 0 AND vat_rate <= 100),
  base_cents INTEGER NOT NULL CHECK (base_cents >= 0),
  vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0 AND total_cents = base_cents + vat_cents),
  advance_deducted_base_cents INTEGER NOT NULL DEFAULT 0 CHECK (advance_deducted_base_cents >= 0),
  advance_deducted_vat_cents INTEGER NOT NULL DEFAULT 0 CHECK (advance_deducted_vat_cents >= 0),
  advance_invoice_id TEXT REFERENCES invoices(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  status TEXT NOT NULL DEFAULT 'pendiente_cobro'
    CHECK (
      (status = 'pagado' AND paid_at_iso IS NOT NULL AND paid_quarter IS NOT NULL) OR
      (status IN ('pendiente_cobro', 'vencido') AND paid_at_iso IS NULL AND paid_quarter IS NULL)
    ),
  notes TEXT NOT NULL DEFAULT '',
  pdf_uri TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

-- Invariante: máximo 1 ANT y 1 FAC por presupuesto y por obra
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_per_series_quote
  ON invoices(quote_id, series_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_per_series_job
  ON invoices(job_id, series_type);

-- -----------------------------------------------------------------------------
-- 6. Tickets de Gasto Deducibles (OCR / Manual) y Diario de Obra Sellado
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_tickets (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL DEFAULT 'Proveedor sin identificar' CHECK (length(trim(supplier_name)) > 0),
  supplier_nif TEXT NOT NULL DEFAULT '',
  issue_date_iso TEXT NOT NULL CHECK (issue_date_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  quarter TEXT NOT NULL CHECK (quarter GLOB '[0-9][0-9][0-9][0-9]-T[1-4]'),
  category TEXT NOT NULL DEFAULT 'materiales' CHECK (length(trim(category)) > 0),
  vat_rate_label TEXT NOT NULL DEFAULT '21' CHECK (vat_rate_label IN ('0', '4', '10', '21', 'mixed')),
  base_cents INTEGER NOT NULL CHECK (base_cents >= 0),
  vat_cents INTEGER NOT NULL CHECK (vat_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (
    total_cents > 0 AND abs((base_cents + vat_cents) - total_cents) <= 2
  ),
  ocr_confidence REAL NOT NULL DEFAULT 0 CHECK (ocr_confidence >= 0 AND ocr_confidence <= 100),
  image_uri TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS site_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('antes', 'despues', 'nota')),
  note_text TEXT NOT NULL DEFAULT '',
  photo_uri TEXT,
  stamp_job_code TEXT NOT NULL,
  stamp_client_name TEXT NOT NULL DEFAULT 'Sin cliente asignado',
  created_at_iso TEXT NOT NULL CHECK (created_at_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
);

-- -----------------------------------------------------------------------------
-- 7. Conversaciones Multi-Turno y Checkpointer LangGraph.js (CapacitorSqliteSaver)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_threads (
  thread_id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'interrupted', 'error')),
  active_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  active_quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  pending_gate TEXT CHECK (
    pending_gate IS NULL OR
    pending_gate IN ('gate_1_quote', 'gate_2_ticket', 'gate_3_invoice', 'gate_4_share')
  ),
  last_node TEXT,
  is_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(thread_id) ON DELETE CASCADE,
  client_turn_id TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  widget_json TEXT,
  quick_actions_json TEXT,
  trace_id TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS lg_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  checkpoint_type TEXT NOT NULL,
  checkpoint_data TEXT NOT NULL,
  metadata_type TEXT NOT NULL,
  metadata_data TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  has_pending_interrupt INTEGER NOT NULL DEFAULT 0 CHECK (has_pending_interrupt IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_lg_checkpoints_lookup
  ON lg_checkpoints(thread_id, checkpoint_ns, checkpoint_id DESC);

CREATE TABLE IF NOT EXISTS lg_checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_path TEXT NOT NULL DEFAULT '',
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  write_type TEXT NOT NULL,
  write_data TEXT NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx),
  FOREIGN KEY (thread_id, checkpoint_ns, checkpoint_id)
    REFERENCES lg_checkpoints(thread_id, checkpoint_ns, checkpoint_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recovered_drafts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE,
  original_schema_version TEXT NOT NULL,
  pending_gate TEXT NOT NULL CHECK (pending_gate IN ('gate_1_quote', 'gate_2_ticket')),
  widget_json TEXT NOT NULL,
  active_job_id TEXT,
  active_quote_id TEXT,
  dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1)),
  recovered_at_ms INTEGER NOT NULL CHECK (recovered_at_ms >= 0)
);

-- -----------------------------------------------------------------------------
-- 8. Feedback Loop Real y Trazabilidad On-Device (cloud_cost_eur = 0.0)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_corrections (
  id TEXT PRIMARY KEY,
  catalog_item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  old_unit_price_cents INTEGER NOT NULL CHECK (old_unit_price_cents >= 0),
  new_unit_price_cents INTEGER NOT NULL CHECK (new_unit_price_cents > 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS agent_traces (
  trace_id TEXT PRIMARY KEY,
  parent_trace_id TEXT REFERENCES agent_traces(trace_id) ON DELETE SET NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  turn_phase TEXT NOT NULL CHECK (turn_phase IN ('complete', 'pre_interrupt', 'post_resume')),
  routed_intent TEXT,
  node_sequence_json TEXT NOT NULL,
  inference_engine TEXT NOT NULL
    CHECK (inference_engine IN ('deterministic_rule_engine', 'mediapipe_local_llm', 'mediapipe_fallback_deterministic')),
  latency_ms REAL NOT NULL CHECK (latency_ms >= 0),
  rag_snippets_json TEXT NOT NULL DEFAULT '[]',
  validated_widget_json TEXT,
  hitl_gate_id TEXT CHECK (
    hitl_gate_id IS NULL OR
    hitl_gate_id IN ('gate_1_quote', 'gate_2_ticket', 'gate_3_invoice', 'gate_4_share')
  ),
  hitl_outcome TEXT CHECK (
    hitl_outcome IS NULL OR
    hitl_outcome IN ('pending', 'approved', 'edited', 'rejected')
  ),
  rejection_reason TEXT,
  error_code TEXT CHECK (
    error_code IS NULL OR
    error_code IN (
      'OCR_ENGINE_ERROR',
      'PDF_BUILD_ERROR',
      'SQLITE_QUERY_ERROR',
      'SCHEMA_VALIDATION_ERROR',
      'INVALID_STATE_TRANSITION',
      'LAZY_CHUNK_LOAD_ERROR',
      'STORAGE_QUOTA_EXCEEDED'
    )
  ),
  cloud_cost_eur REAL NOT NULL DEFAULT 0.0 CHECK (cloud_cost_eur = 0.0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
);

-- -----------------------------------------------------------------------------
-- 9. Tablas Virtuales FTS5 (BM25 + Sin Tildes) y Triggers de Sincronización
-- -----------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS catalog_items_fts USING fts5(
  description,
  category,
  unit,
  content='catalog_items',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS trg_catalog_items_ai AFTER INSERT ON catalog_items BEGIN
  INSERT INTO catalog_items_fts(rowid, description, category, unit)
  VALUES (new.rowid, new.description, new.category, new.unit);
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_items_ad AFTER DELETE ON catalog_items BEGIN
  INSERT INTO catalog_items_fts(catalog_items_fts, rowid, description, category, unit)
  VALUES ('delete', old.rowid, old.description, old.category, old.unit);
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_items_au AFTER UPDATE ON catalog_items BEGIN
  INSERT INTO catalog_items_fts(catalog_items_fts, rowid, description, category, unit)
  VALUES ('delete', old.rowid, old.description, old.category, old.unit);
  INSERT INTO catalog_items_fts(rowid, description, category, unit)
  VALUES (new.rowid, new.description, new.category, new.unit);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS clients_fts USING fts5(
  name,
  nif,
  phone,
  fiscal_address,
  content='clients',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS trg_clients_ai AFTER INSERT ON clients BEGIN
  INSERT INTO clients_fts(rowid, name, nif, phone, fiscal_address)
  VALUES (new.rowid, new.name, new.nif, new.phone, new.fiscal_address);
END;

CREATE TRIGGER IF NOT EXISTS trg_clients_ad AFTER DELETE ON clients BEGIN
  INSERT INTO clients_fts(clients_fts, rowid, name, nif, phone, fiscal_address)
  VALUES ('delete', old.rowid, old.name, old.nif, old.phone, old.fiscal_address);
END;

CREATE TRIGGER IF NOT EXISTS trg_clients_au AFTER UPDATE ON clients BEGIN
  INSERT INTO clients_fts(clients_fts, rowid, name, nif, phone, fiscal_address)
  VALUES ('delete', old.rowid, old.name, old.nif, old.phone, old.fiscal_address);
  INSERT INTO clients_fts(rowid, name, nif, phone, fiscal_address)
  VALUES (new.rowid, new.name, new.nif, new.phone, new.fiscal_address);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(
  job_code,
  title,
  address,
  content='jobs',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS trg_jobs_ai AFTER INSERT ON jobs BEGIN
  INSERT INTO jobs_fts(rowid, job_code, title, address)
  VALUES (new.rowid, new.job_code, new.title, new.address);
END;

CREATE TRIGGER IF NOT EXISTS trg_jobs_ad AFTER DELETE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, job_code, title, address)
  VALUES ('delete', old.rowid, old.job_code, old.title, old.address);
END;

CREATE TRIGGER IF NOT EXISTS trg_jobs_au AFTER UPDATE ON jobs BEGIN
  INSERT INTO jobs_fts(jobs_fts, rowid, job_code, title, address)
  VALUES ('delete', old.rowid, old.job_code, old.title, old.address);
  INSERT INTO jobs_fts(rowid, job_code, title, address)
  VALUES (new.rowid, new.job_code, new.title, new.address);
END;

-- -----------------------------------------------------------------------------
-- 10. Índices de Rendimiento para Hucha Fiscal, Directorio, Trazas e Historial
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_quarter_series ON invoices(quarter, series_type, issued_at_iso DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_paid_quarter ON invoices(paid_quarter, status);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id, series_type);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status, due_at_iso);
CREATE INDEX IF NOT EXISTS idx_tickets_quarter ON expense_tickets(quarter, issue_date_iso DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_job ON expense_tickets(job_id);
CREATE INDEX IF NOT EXISTS idx_tickets_dedup ON expense_tickets(issue_date_iso, total_cents, supplier_nif);
CREATE INDEX IF NOT EXISTS idx_site_logs_job ON site_logs(job_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_updated ON chat_threads(updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at_ms ASC);
CREATE INDEX IF NOT EXISTS idx_feedback_item ON feedback_corrections(catalog_item_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_agent_traces_thread ON agent_traces(thread_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_agent_traces_parent ON agent_traces(parent_trace_id);

-- -----------------------------------------------------------------------------
-- 11. Configuración Oculta de Super Admin para LLM Nativo y Estrategias
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_llm_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  strategy_override TEXT NOT NULL DEFAULT 'auto'
    CHECK (strategy_override IN ('auto', 'force_270m', 'force_1b', 'force_apple_intelligence', 'force_webgpu', 'deterministic_only')),
  android_270m_url TEXT NOT NULL DEFAULT '',
  android_270m_companion_url TEXT NOT NULL DEFAULT '',
  android_1b_url TEXT NOT NULL DEFAULT '',
  android_1b_companion_url TEXT NOT NULL DEFAULT '',
  custom_model_uri TEXT NOT NULL DEFAULT '',
  max_tokens INTEGER NOT NULL DEFAULT 512 CHECK (max_tokens BETWEEN 64 AND 4096),
  temperature_thousandths INTEGER NOT NULL DEFAULT 100 CHECK (temperature_thousandths BETWEEN 0 AND 2000),
  topk INTEGER NOT NULL DEFAULT 8 CHECK (topk BETWEEN 1 AND 100),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

-- -----------------------------------------------------------------------------
-- 12. Agenda, Calendario y Horario Habitual de Trabajo
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_schedule_defaults (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  work_days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  morning_start TEXT NOT NULL DEFAULT '08:00',
  morning_end TEXT NOT NULL DEFAULT '14:00',
  afternoon_start TEXT NOT NULL DEFAULT '15:00',
  afternoon_end TEXT NOT NULL DEFAULT '17:00',
  auto_apply_to_jobs INTEGER NOT NULL DEFAULT 1 CHECK (auto_apply_to_jobs IN (0, 1)),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS schedule_entries (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  date_iso TEXT NOT NULL CHECK (date_iso GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  planned_hours_thousandths INTEGER NOT NULL CHECK (planned_hours_thousandths >= 0),
  actual_start TEXT,
  actual_end TEXT,
  actual_hours_thousandths INTEGER CHECK (actual_hours_thousandths IS NULL OR actual_hours_thousandths >= 0),
  status TEXT NOT NULL CHECK (status IN ('previsto', 'en_hora', 'antes', 'alargado')) DEFAULT 'previsto',
  deviation_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_date ON schedule_entries(date_iso);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_job_date ON schedule_entries(job_id, date_iso);

-- -----------------------------------------------------------------------------
-- 13. Calendario Fiscal AEAT y Alertas de Vencimiento
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_obligation_states (
  obligation_key TEXT PRIMARY KEY,
  model_code TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL CHECK (fiscal_year >= 2020 AND fiscal_year <= 2100),
  period_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'presentado', 'no_aplica')) DEFAULT 'pendiente',
  presented_at_iso TEXT,
  notes TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tax_obligation_states_model_year
  ON tax_obligation_states(model_code, fiscal_year);

CREATE TABLE IF NOT EXISTS tax_alert_dismissals (
  alert_key TEXT PRIMARY KEY,
  dismissed_at_ms INTEGER NOT NULL CHECK (dismissed_at_ms >= 0)
);
