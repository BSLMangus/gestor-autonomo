export type JobStatus = 'pendiente' | 'en_curso' | 'finalizado' | 'cancelado';

export type ScheduleStatus = 'previsto' | 'en_hora' | 'antes' | 'alargado';

export type QuoteStatus = 'borrador' | 'enviado' | 'aceptado' | 'rechazado' | 'facturado';

export type InvoiceSeriesType = 'ANT' | 'FAC';

export type InvoiceKind = 'anticipo' | 'final' | 'completa';

export type InvoiceStatus = 'pendiente_cobro' | 'pagado' | 'vencido';

export type ExpenseCategory = 'Material' | 'Herramienta' | 'Gasoil furgoneta' | 'Subcontrata' | 'Otros';

export type PricingUnit = 'm2' | 'ud' | 'h' | 'ml' | 'pa';

export type TradeCategory = 'Fontanería' | 'Albañilería' | 'Electricidad' | 'Pintura' | 'General';

export type FiscalQuarter = '2026-T3' | '2026-T4';

export interface Client {
  id: string;
  name: string;
  nif: string;
  fiscal_address: string;
  phone: string;
  email: string;
  notes: string;
}

export interface Job {
  id: string;
  job_code: string;
  client_id: string;
  title: string;
  address: string;
  status: JobStatus;
  start_date_iso?: string;
  end_date_iso?: string;
  estimated_hours?: number;
}

export interface ScheduleEntry {
  id: string;
  job_id: string;
  date_iso: string;
  planned_start: string;
  planned_end: string;
  planned_hours: number;
  actual_start?: string;
  actual_end?: string;
  actual_hours?: number;
  status: ScheduleStatus;
  deviation_reason?: string;
  notes?: string;
}

export interface WorkScheduleDefaults {
  work_days: number[]; // 1=Lunes ... 7=Domingo
  morning_start: string;
  morning_end: string;
  afternoon_start: string;
  afternoon_end: string;
  auto_apply_to_jobs: boolean;
}

export interface QuoteLine {
  id: string;
  description: string;
  quantity: number;
  unit: PricingUnit;
  unit_price_cents: number;
  save_to_catalog?: boolean;
  trade_category?: TradeCategory;
}

export interface Quote {
  id: string;
  quote_code: string;
  job_id: string;
  client_id: string;
  title: string;
  vat_rate: number; // e.g. 10, 21, or custom
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  status: QuoteStatus;
  created_at_iso: string;
  voice_note?: string;
  lines: QuoteLine[];
}

export interface Invoice {
  id: string;
  invoice_number: string;
  series_type: InvoiceSeriesType;
  kind: InvoiceKind;
  job_id: string;
  client_id: string;
  quote_id?: string;
  concept: string;
  vat_rate: number;
  issued_at_iso: string;
  due_at_iso: string;
  quarter: FiscalQuarter;
  base_cents: number;
  vat_cents: number;
  total_cents: number;
  status: InvoiceStatus;
}

export interface ExpenseTicket {
  id: string;
  job_id: string; // '' if general business expense
  supplier_name: string;
  issue_date_iso: string;
  quarter: FiscalQuarter;
  category: ExpenseCategory;
  vat_rate: number;
  base_cents: number;
  vat_cents: number;
  total_cents: number;
  image_url?: string;
  notes?: string;
}

export interface JobPhoto {
  id: string;
  job_id: string;
  caption: string;
  captured_at_iso: string;
  image_url: string;
  location_label: string;
}

export interface JobDiaryEntry {
  id: string;
  job_id: string;
  date_iso: string;
  time_range: string;
  summary: string;
  tag: string;
  delta_hours?: number;
  delta_cents?: number;
  linked_schedule_id?: string;
}

export interface PricingCatalogItem {
  id: string;
  name: string;
  category: TradeCategory;
  unit: PricingUnit;
  unit_price_cents: number;
  usage_count: number;
  learned_from?: string;
  updated_at_iso: string;
}

export interface ChatActionCard {
  id: string;
  type: 'schedule' | 'quote' | 'ticket' | 'photo' | 'invoice';
  code: string;
  badge_label: string;
  badge_tone: 'warning' | 'terracotta' | 'success' | 'info';
  title: string;
  description: string;
  cta_label: string;
  cta_variant: 'primary' | 'secondary';
  resolved?: boolean;
  payload_id?: string;
  draft_data?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp_label: string;
  via_voice?: boolean;
  text: string;
  action_cards?: ChatActionCard[];
}

export interface ChatConversation {
  id: string;
  title: string;
  subtitle: string;
  updated_label: string;
  pending_confirmation: boolean;
  messages: ChatMessage[];
}

export interface ActivityEntry {
  id: string;
  category: 'Tarifario actualizado' | 'Control de tiempos' | 'IVA habitual' | 'Hucha fiscal' | 'Facturación';
  tone: 'success' | 'warning' | 'neutral' | 'terracotta';
  timestamp_label: string;
  title: string;
  description: string;
  highlight_value?: string;
  action_route?: AppRoute;
  action_label?: string;
}

export interface BusinessSettings {
  owner_name: string;
  business_name: string;
  nif: string;
  fiscal_address: string;
  phone: string;
  email: string;
  iban: string;
  hourly_rate_cents: number;
  default_vat_rate: number;
  default_irpf_rate: number;
  next_job_seq: number;
  next_quote_seq: number;
  next_invoice_seq: number;
  next_anticipo_seq: number;
}

export type AppRoute =
  | '#/'
  | '#/asistente'
  | '#/calendario'
  | '#/obras'
  | '#/presupuestos'
  | '#/clientes'
  | `#/clientes/${string}`
  | '#/hucha'
  | '#/actividad'
  | '#/tarifario'
  | '#/ajustes';

export type GenerativeOverlayState =
  | { kind: 'quote'; quoteId?: string; initialClientId?: string; initialJobId?: string; initialTitle?: string; voiceNote?: string; initialLines?: QuoteLine[]; chatCardRef?: { conversationId: string; cardId: string } }
  | { kind: 'invoice'; quoteId: string; mode: 'anticipo' | 'completa' }
  | { kind: 'ticket'; initialJobId?: string; initialSupplier?: string; initialCategory?: ExpenseCategory; initialTotalCents?: number; initialVatRate?: number; initialImageUrl?: string; chatCardRef?: { conversationId: string; cardId: string } }
  | { kind: 'photo'; initialJobId?: string; initialCaption?: string; initialImageUrl?: string }
  | { kind: 'schedule'; entryId?: string; jobId: string; dateIso: string; initialDeltaHours?: number; initialReason?: string; initialNotes?: string; chatCardRef?: { conversationId: string; cardId: string } };

export type PrintableDocumentState =
  | { kind: 'quote'; id: string }
  | { kind: 'invoice'; id: string };
