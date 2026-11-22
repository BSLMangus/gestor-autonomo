import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  ActivityEntry,
  AppRoute,
  BusinessSettings,
  ChatActionCard,
  ChatConversation,
  Client,
  ExpenseCategory,
  ExpenseTicket,
  FiscalQuarter,
  GenerativeOverlayState,
  Invoice,
  Job,
  JobDiaryEntry,
  JobPhoto,
  JobStatus,
  PricingCatalogItem,
  PricingUnit,
  PrintableDocumentState,
  Quote,
  QuoteLine,
  QuoteStatus,
  ScheduleEntry,
  ScheduleStatus,
  TradeCategory,
  WorkScheduleDefaults,
} from '../types/domain';
import {
  calculateDailyHoursFromDefaults,
  computeQuoteTotals,
  dateToQuarter,
  formatEuros,
  formatShortDayLabel,
  formatSignedEuros,
  formatSignedHours,
  getIsoWeekday,
  listDatesInRange,
  minutesToHHMM,
  parseTimeToMinutes,
} from '../utils/format';

export const IMG_PLUMBING_PIPE = '/src/assets/images/obra_tuberia_desague_1795278523323.jpg';
export const IMG_SHOWER_TILING = '/src/assets/images/obra_alicatado_ducha_1795278523576.jpg';
export const IMG_TICKET_RECEIPT = '/src/assets/images/ticket_ferreteria_obra_1795278524464.jpg';

const STORAGE_KEY = 'obralocal_ai_state_v1';
export const TODAY_ISO = '2026-11-23';

export interface AppStateData {
  clients: Client[];
  jobs: Job[];
  scheduleEntries: ScheduleEntry[];
  workScheduleDefaults: WorkScheduleDefaults;
  quotes: Quote[];
  invoices: Invoice[];
  expenseTickets: ExpenseTicket[];
  jobPhotos: JobPhoto[];
  jobDiaryEntries: JobDiaryEntry[];
  pricingCatalog: PricingCatalogItem[];
  conversations: ChatConversation[];
  activeConversationId: string;
  activities: ActivityEntry[];
  settings: BusinessSettings;
}

export interface FiscalQuarterSummary {
  quarter: FiscalQuarter;
  invoicedCents: number;
  collectedCents: number;
  pendingCents: number;
  expensesTotalCents: number;
  vatCollectedCents: number;
  vatDeductibleCents: number;
  vatToPayCents: number;
  irpfToPayCents: number;
  taxReserveCents: number;
  freeRealCents: number;
  freePct: number;
  expensesPct: number;
  taxPct: number;
  tickets: ExpenseTicket[];
  invoices: Invoice[];
  jobProfitability: Array<{
    jobId: string;
    jobCode: string;
    title: string;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
  }>;
}

export interface ToastItem {
  id: string;
  message: string;
  tone: 'success' | 'info' | 'warning';
}

function createInitialState(): AppStateData {
  const settings: BusinessSettings = {
    owner_name: 'Carlos Mendoza',
    business_name: 'Reformas y Fontanería Mendoza',
    nif: '50918273L',
    fiscal_address: 'C/ Bravo Murillo 214, 28020 Madrid',
    phone: '622 418 905',
    email: 'carlos@reformasmendoza.es',
    iban: 'ES76 2100 0418 4502 0005 1332',
    hourly_rate_cents: 3800,
    default_vat_rate: 10,
    default_irpf_rate: 20,
    next_job_seq: 16,
    next_quote_seq: 16,
    next_invoice_seq: 23,
    next_anticipo_seq: 6,
  };

  const workScheduleDefaults: WorkScheduleDefaults = {
    work_days: [1, 2, 3, 4, 5],
    morning_start: '08:00',
    morning_end: '14:00',
    afternoon_start: '15:00',
    afternoon_end: '17:00',
    auto_apply_to_jobs: true,
  };

  const clients: Client[] = [
    {
      id: 'cli-elena',
      name: 'Elena Navarro',
      nif: '47892134K',
      fiscal_address: 'C/ Alcalá 148, 3º B · 28009 Madrid',
      phone: '619 482 310',
      email: 'elena.navarro@correo.es',
      notes: 'Particular. Vivienda habitual con derecho a IVA reducido del 10%.',
    },
    {
      id: 'cli-marta',
      name: 'Marta Ruiz',
      nif: '51908412R',
      fiscal_address: 'C/ Goya 82, 2º D · 28009 Madrid',
      phone: '635 190 482',
      email: 'marta.ruiz@correo.es',
      notes: 'Portería abre a las 08:00. Dejar llaves en conserjería al terminar.',
    },
    {
      id: 'cli-velazquez',
      name: 'Comunidad Velázquez 42',
      nif: 'H82341902',
      fiscal_address: 'C/ Velázquez 42 · 28001 Madrid',
      phone: '914 205 811',
      email: 'administracion@velazquez42.es',
      notes: 'Contacto: Antonio (presidente). Facturas al 21% con vencimiento 15 días.',
    },
    {
      id: 'cli-patio',
      name: 'Restaurante El Patio',
      nif: 'B89120455',
      fiscal_address: 'C/ Ponzano 54, Local · 28003 Madrid',
      phone: '915 782 104',
      email: 'gerencia@restauranteelpatio.es',
      notes: 'Trabajos preferiblemente antes de las 12:00 para no coincidir con servicio.',
    },
  ];

  const jobs: Job[] = [
    {
      id: 'job-001',
      job_code: 'OBR-2026-001',
      client_id: 'cli-marta',
      title: 'Reforma baño Marta Ruiz',
      address: 'C/ Goya 82, 2º D · Madrid',
      status: 'en_curso',
      start_date_iso: '2026-11-22',
      end_date_iso: '2026-11-30',
      estimated_hours: 56,
    },
    {
      id: 'job-014',
      job_code: 'OBR-2026-014',
      client_id: 'cli-elena',
      title: 'Reforma baño Calle Alcalá',
      address: 'C/ Alcalá 148, 3º B · Madrid',
      status: 'en_curso',
      start_date_iso: '2026-11-16',
      end_date_iso: '2026-11-18',
      estimated_hours: 24,
    },
    {
      id: 'job-011',
      job_code: 'OBR-2026-011',
      client_id: 'cli-velazquez',
      title: 'Bajante patio interior',
      address: 'C/ Velázquez 42 · Madrid',
      status: 'en_curso',
      start_date_iso: '2026-11-18',
      end_date_iso: '2026-11-20',
      estimated_hours: 24,
    },
    {
      id: 'job-008',
      job_code: 'OBR-2026-008',
      client_id: 'cli-elena',
      title: 'Sustitución caldera condensación',
      address: 'C/ Alcalá 148, 3º B · Madrid',
      status: 'finalizado',
      start_date_iso: '2026-10-12',
      end_date_iso: '2026-10-14',
      estimated_hours: 16,
    },
    {
      id: 'job-006',
      job_code: 'OBR-2026-006',
      client_id: 'cli-patio',
      title: 'Impermeabilización terraza',
      address: 'C/ Ponzano 54, Local · Madrid',
      status: 'finalizado',
      start_date_iso: '2026-10-20',
      end_date_iso: '2026-10-22',
      estimated_hours: 16,
    },
  ];

  const scheduleEntries: ScheduleEntry[] = [
    // Semana 16–20 nov (Alcalá y Velázquez)
    {
      id: 'sch-1116',
      job_id: 'job-014',
      date_iso: '2026-11-16',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '17:00',
      actual_hours: 8,
      status: 'en_hora',
      notes: 'Demolición de revestimiento y desescombro limpio.',
    },
    {
      id: 'sch-1117',
      job_id: 'job-014',
      date_iso: '2026-11-17',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '17:00',
      actual_hours: 8,
      status: 'en_hora',
      notes: 'Tendido de tubería multicapa y pruebas de presión.',
    },
    {
      id: 'sch-1118',
      job_id: 'job-011',
      date_iso: '2026-11-18',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '19:30',
      actual_hours: 10.5,
      status: 'alargado',
      deviation_reason: 'Imprevisto en instalación',
      notes: 'Manguetón de fibrocemento adherido; requirió corte especial.',
    },
    {
      id: 'sch-1119',
      job_id: 'job-011',
      date_iso: '2026-11-19',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '16:00',
      actual_hours: 7,
      status: 'antes',
      deviation_reason: 'Más rápido de lo previsto',
      notes: 'Anclaje de abrazaderas y bajante PVC 110 terminado sin cortes.',
    },
    {
      id: 'sch-1120',
      job_id: 'job-011',
      date_iso: '2026-11-20',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '20:00',
      actual_hours: 11,
      status: 'alargado',
      deviation_reason: 'Ampliación del cliente',
      notes: 'Comunidad pidió revisar también arqueta del patio y sellado.',
    },
    // Obra 001: Marta Ruiz (22 nov – 30 nov)
    {
      id: 'sch-1122',
      job_id: 'job-001',
      date_iso: '2026-11-22',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '17:00',
      actual_hours: 8,
      status: 'en_hora',
      notes: 'Picado de azulejo antiguo, retirada de escombro y replanteo.',
    },
    {
      id: 'sch-1123',
      job_id: 'job-001',
      date_iso: '2026-11-23',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      status: 'previsto',
      notes: 'Alicatado ducha e instalación de desagüe principal.',
    },
    {
      id: 'sch-1124',
      job_id: 'job-001',
      date_iso: '2026-11-24',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '17:00',
      actual_hours: 8,
      status: 'en_hora',
      notes: 'Colocación de plato de resina y nivelado de paredes.',
    },
    {
      id: 'sch-1125',
      job_id: 'job-001',
      date_iso: '2026-11-25',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '17:00',
      actual_hours: 8,
      status: 'en_hora',
      notes: 'Lechada porcelánica y sellado perimetral.',
    },
    {
      id: 'sch-1126',
      job_id: 'job-001',
      date_iso: '2026-11-26',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      actual_start: '08:00',
      actual_end: '17:00',
      actual_hours: 8,
      status: 'en_hora',
      notes: 'Montaje mueble lavabo y espejo retroiluminado.',
    },
    {
      id: 'sch-1127',
      job_id: 'job-001',
      date_iso: '2026-11-27',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      status: 'previsto',
      notes: 'Instalación grifería termostática e inodoro.',
    },
    {
      id: 'sch-1130',
      job_id: 'job-001',
      date_iso: '2026-11-30',
      planned_start: '08:00',
      planned_end: '17:00',
      planned_hours: 8,
      status: 'previsto',
      notes: 'Limpieza final, revisión con Marta y entrega de obra.',
    },
  ];

  const quote14Lines: QuoteLine[] = [
    {
      id: 'ql-1',
      description: 'Alicatado pared porcelánico',
      quantity: 18,
      unit: 'm2',
      unit_price_cents: 4200,
      save_to_catalog: true,
      trade_category: 'Albañilería',
    },
    {
      id: 'ql-2',
      description: 'Plato de ducha resina instalado',
      quantity: 1,
      unit: 'ud',
      unit_price_cents: 68000,
      save_to_catalog: false,
      trade_category: 'Fontanería',
    },
    {
      id: 'ql-3',
      description: 'Fontanería y desagües',
      quantity: 12,
      unit: 'h',
      unit_price_cents: 3800,
      save_to_catalog: true,
      trade_category: 'Fontanería',
    },
  ];
  const q14Totals = computeQuoteTotals(quote14Lines, 10);

  const quote12Lines: QuoteLine[] = [
    {
      id: 'ql-4',
      description: 'Picado y retirada de escombro baño completo',
      quantity: 1,
      unit: 'pa',
      unit_price_cents: 45000,
      trade_category: 'Albañilería',
    },
    {
      id: 'ql-5',
      description: 'Alicatado porcelánico gran formato',
      quantity: 22,
      unit: 'm2',
      unit_price_cents: 4200,
      trade_category: 'Albañilería',
    },
    {
      id: 'ql-6',
      description: 'Renovación completa fontanería y sanitarios',
      quantity: 22.45,
      unit: 'h',
      unit_price_cents: 3800,
      trade_category: 'Fontanería',
    },
  ];
  const q12Totals = computeQuoteTotals(quote12Lines, 10);

  const quote15Lines: QuoteLine[] = [
    {
      id: 'ql-7',
      description: 'Mampara ducha cristal templado 120 cm',
      quantity: 1,
      unit: 'ud',
      unit_price_cents: 42600,
      save_to_catalog: true,
      trade_category: 'Fontanería',
    },
    {
      id: 'ql-8',
      description: 'Montaje y sellado estanco',
      quantity: 3,
      unit: 'h',
      unit_price_cents: 3800,
      save_to_catalog: false,
      trade_category: 'Fontanería',
    },
  ];
  const q15Totals = computeQuoteTotals(quote15Lines, 10);

  const quotes: Quote[] = [
    {
      id: 'quo-014',
      quote_code: 'PRE-2026-014',
      job_id: 'job-014',
      client_id: 'cli-elena',
      title: 'Reforma baño principal — Calle Alcalá',
      vat_rate: 10,
      ...q14Totals,
      status: 'borrador',
      created_at_iso: '2026-11-22',
      voice_note: 'Presupuesto para Elena Navarro, baño completo en Calle Alcalá, 18 m² de alicatado y plato de ducha.',
      lines: quote14Lines,
    },
    {
      id: 'quo-012',
      quote_code: 'PRE-2026-012',
      job_id: 'job-001',
      client_id: 'cli-marta',
      title: 'Reforma baño C/ Goya 82',
      vat_rate: 10,
      ...q12Totals,
      status: 'aceptado',
      created_at_iso: '2026-11-14',
      lines: quote12Lines,
    },
    {
      id: 'quo-015',
      quote_code: 'PRE-2026-015',
      job_id: 'job-014',
      client_id: 'cli-elena',
      title: 'Mampara ducha · Elena Navarro',
      vat_rate: 10,
      ...q15Totals,
      status: 'borrador',
      created_at_iso: '2026-11-23',
      voice_note: 'Mampara templada 120 cm + 3 h de montaje (38 €/h) con IVA 10% vivienda.',
      lines: quote15Lines,
    },
  ];

  const invoices: Invoice[] = [
    {
      id: 'inv-018',
      invoice_number: 'FAC-2026-018',
      series_type: 'FAC',
      kind: 'completa',
      job_id: 'job-006',
      client_id: 'cli-patio',
      concept: 'Impermeabilización terraza',
      vat_rate: 21,
      issued_at_iso: '2026-10-25',
      due_at_iso: '2026-11-17',
      quarter: '2026-T4',
      base_cents: 60331,
      vat_cents: 12669,
      total_cents: 73000,
      status: 'vencido',
    },
    {
      id: 'inv-021',
      invoice_number: 'FAC-2026-021',
      series_type: 'FAC',
      kind: 'completa',
      job_id: 'job-011',
      client_id: 'cli-velazquez',
      concept: 'Bajante patio interior',
      vat_rate: 21,
      issued_at_iso: '2026-11-19',
      due_at_iso: '2026-12-04',
      quarter: '2026-T4',
      base_cents: 158678,
      vat_cents: 33322,
      total_cents: 192000,
      status: 'pagado',
    },
    {
      id: 'inv-019',
      invoice_number: 'FAC-2026-019',
      series_type: 'FAC',
      kind: 'completa',
      job_id: 'job-008',
      client_id: 'cli-elena',
      concept: 'Sustitución caldera condensación',
      vat_rate: 10,
      issued_at_iso: '2026-10-14',
      due_at_iso: '2026-10-29',
      quarter: '2026-T4',
      base_cents: 218182,
      vat_cents: 21818,
      total_cents: 240000,
      status: 'pagado',
    },
    {
      id: 'inv-020',
      invoice_number: 'ANT-2026-005',
      series_type: 'ANT',
      kind: 'anticipo',
      job_id: 'job-001',
      client_id: 'cli-marta',
      quote_id: 'quo-012',
      concept: 'Anticipo 40% reforma baño C/ Goya 82',
      vat_rate: 10,
      issued_at_iso: '2026-11-15',
      due_at_iso: '2026-11-22',
      quarter: '2026-T4',
      base_cents: 327273,
      vat_cents: 32727,
      total_cents: 360000,
      status: 'pagado',
    },
    {
      id: 'inv-022',
      invoice_number: 'ANT-2026-004',
      series_type: 'ANT',
      kind: 'anticipo',
      job_id: 'job-014',
      client_id: 'cli-elena',
      concept: 'Anticipo acopio material Calle Alcalá',
      vat_rate: 10,
      issued_at_iso: '2026-11-16',
      due_at_iso: '2026-11-30',
      quarter: '2026-T4',
      base_cents: 72727,
      vat_cents: 7273,
      total_cents: 80000,
      status: 'pendiente_cobro',
    },
    // Facturas de 2026-T3 para que el selector de trimestre funcione con datos reales
    {
      id: 'inv-012',
      invoice_number: 'FAC-2026-012',
      series_type: 'FAC',
      kind: 'completa',
      job_id: 'job-008',
      client_id: 'cli-velazquez',
      concept: 'Reparación grupo de presión portal',
      vat_rate: 21,
      issued_at_iso: '2026-08-18',
      due_at_iso: '2026-09-02',
      quarter: '2026-T3',
      base_cents: 245000,
      vat_cents: 51450,
      total_cents: 296450,
      status: 'pagado',
    },
    {
      id: 'inv-014',
      invoice_number: 'FAC-2026-014',
      series_type: 'FAC',
      kind: 'completa',
      job_id: 'job-006',
      client_id: 'cli-patio',
      concept: 'Instalación extractor cocina industrial',
      vat_rate: 21,
      issued_at_iso: '2026-09-12',
      due_at_iso: '2026-09-27',
      quarter: '2026-T3',
      base_cents: 198000,
      vat_cents: 41580,
      total_cents: 239580,
      status: 'pagado',
    },
  ];

  const expenseTickets: ExpenseTicket[] = [
    {
      id: 'tkt-001',
      job_id: 'job-001',
      supplier_name: 'Saneamientos García S.L.',
      issue_date_iso: '2026-11-18',
      quarter: '2026-T4',
      category: 'Material',
      vat_rate: 21,
      base_cents: 53083,
      vat_cents: 11147,
      total_cents: 64230,
      image_url: IMG_TICKET_RECEIPT,
      notes: 'Tubería PVC 110, codos, válvulas y grifería empotrada.',
    },
    {
      id: 'tkt-002',
      job_id: '',
      supplier_name: 'E.S. Repsol M-30',
      issue_date_iso: '2026-11-15',
      quarter: '2026-T4',
      category: 'Gasoil furgoneta',
      vat_rate: 21,
      base_cents: 7810,
      vat_cents: 1640,
      total_cents: 9450,
      notes: 'Repostaje furgoneta reparto de obra.',
    },
    {
      id: 'tkt-003',
      job_id: 'job-014',
      supplier_name: 'Leroy Merlin Norte',
      issue_date_iso: '2026-11-11',
      quarter: '2026-T4',
      category: 'Herramienta',
      vat_rate: 21,
      base_cents: 15620,
      vat_cents: 3280,
      total_cents: 18900,
      notes: 'Disco diamante porcelánico y crucetas niveladoras.',
    },
    {
      id: 'tkt-004',
      job_id: 'job-011',
      supplier_name: 'Almacenes BigMat Madrid',
      issue_date_iso: '2026-11-08',
      quarter: '2026-T4',
      category: 'Material',
      vat_rate: 21,
      base_cents: 29421,
      vat_cents: 6179,
      total_cents: 35600,
      notes: 'Bajante insonorizada, abrazaderas metálicas y cemento cola.',
    },
    {
      id: 'tkt-005',
      job_id: 'job-008',
      supplier_name: 'Suministros Roca Centro',
      issue_date_iso: '2026-08-22',
      quarter: '2026-T3',
      category: 'Material',
      vat_rate: 21,
      base_cents: 62000,
      vat_cents: 13020,
      total_cents: 75020,
      notes: 'Vaso de expansión, llaves de corte y kits evacuación.',
    },
  ];

  const jobPhotos: JobPhoto[] = [
    {
      id: 'pho-001',
      job_id: 'job-001',
      caption: 'Cambio codo desagüe',
      captured_at_iso: '2026-11-23T18:45:00',
      image_url: IMG_PLUMBING_PIPE,
      location_label: 'C/ Goya 82 · Madrid',
    },
    {
      id: 'pho-002',
      job_id: 'job-001',
      caption: 'Inicio alicatado ducha',
      captured_at_iso: '2026-11-22T16:50:00',
      image_url: IMG_SHOWER_TILING,
      location_label: 'C/ Goya 82 · Madrid',
    },
  ];

  const jobDiaryEntries: JobDiaryEntry[] = [
    {
      id: 'dia-001',
      job_id: 'job-001',
      date_iso: '2026-11-22',
      time_range: '08:00–17:00',
      summary: 'Picado de azulejo antiguo, retirada de escombro a sacas y replanteo de toma de ducha.',
      tag: 'Parte diario guardado · 1 foto sellada',
      delta_hours: 0,
      delta_cents: 0,
      linked_schedule_id: 'sch-1122',
    },
    {
      id: 'dia-002',
      job_id: 'job-011',
      date_iso: '2026-11-18',
      time_range: '08:00–19:30',
      summary: 'Manguetón antiguo adherido a la bajante; corte limpio y sustitución completa.',
      tag: 'Vinculado desde Parte de Jornada · Imprevisto',
      delta_hours: 2.5,
      delta_cents: 9500,
      linked_schedule_id: 'sch-1118',
    },
  ];

  const pricingCatalog: PricingCatalogItem[] = [
    {
      id: 'cat-1',
      name: 'Alicatado pared porcelánico',
      category: 'Albañilería',
      unit: 'm2',
      unit_price_cents: 4200,
      usage_count: 6,
      learned_from: 'PRE-2026-014',
      updated_at_iso: '2026-11-22',
    },
    {
      id: 'cat-2',
      name: 'Plato de ducha resina instalado',
      category: 'Fontanería',
      unit: 'ud',
      unit_price_cents: 68000,
      usage_count: 8,
      updated_at_iso: '2026-11-18',
    },
    {
      id: 'cat-3',
      name: 'Sustitución codo PVC 110 mm',
      category: 'Fontanería',
      unit: 'ud',
      unit_price_cents: 6500,
      usage_count: 14,
      updated_at_iso: '2026-11-15',
    },
    {
      id: 'cat-4',
      name: 'Punto de luz con mecanismo',
      category: 'Electricidad',
      unit: 'ud',
      unit_price_cents: 4800,
      usage_count: 5,
      updated_at_iso: '2026-11-10',
    },
    {
      id: 'cat-5',
      name: 'Desmontaje y retirada de sanitario',
      category: 'Fontanería',
      unit: 'ud',
      unit_price_cents: 7500,
      usage_count: 11,
      updated_at_iso: '2026-11-05',
    },
    {
      id: 'cat-6',
      name: 'Pintura plástica lisa 2 manos',
      category: 'Pintura',
      unit: 'm2',
      unit_price_cents: 1250,
      usage_count: 9,
      updated_at_iso: '2026-10-28',
    },
  ];

  const conversations: ChatConversation[] = [
    {
      id: 'conv-1',
      title: 'Baño Marta Ruiz y Elena',
      subtitle: 'Esperando confirmación',
      updated_label: 'Hoy · 19:02',
      pending_confirmation: true,
      messages: [
        {
          id: 'msg-1',
          sender: 'user',
          timestamp_label: 'Dictado por voz · 19:02',
          via_voice: true,
          text: '«Apunta dos horas extra hoy en el baño de Marta Ruiz por el codo de desagüe y prepara presupuesto de mampara para Elena Navarro.»',
        },
        {
          id: 'msg-2',
          sender: 'assistant',
          timestamp_label: 'Ahora',
          text: 'He preparado estas 2 propuestas para que las revises:',
          action_cards: [
            {
              id: 'card-schedule-1',
              type: 'schedule',
              code: 'OBR-2026-001',
              badge_label: '+2,0 h (+76,00 €)',
              badge_tone: 'warning',
              title: 'Parte del día · Baño Marta Ruiz',
              description: 'Salida a las 19:00 por imprevisto en codo de desagüe. Listo para guardar en el diario.',
              cta_label: 'Revisar parte del día',
              cta_variant: 'primary',
              resolved: false,
              payload_id: 'sch-1123',
              draft_data: {
                jobId: 'job-001',
                dateIso: '2026-11-23',
                deltaHours: 2,
                reason: 'Imprevisto en instalación',
                notes: 'Tuvimos que sustituir el codo de desagüe antiguo tras abrir la roza.',
              },
            },
            {
              id: 'card-quote-1',
              type: 'quote',
              code: 'PRE-2026-015',
              badge_label: 'Borrador IA',
              badge_tone: 'terracotta',
              title: 'Mampara ducha · Elena Navarro',
              description: 'Mampara templada 120 cm + 3 h de montaje (38 €/h) con IVA 10% vivienda.',
              cta_label: 'Abrir borrador (594,00 €)',
              cta_variant: 'secondary',
              resolved: false,
              payload_id: 'quo-015',
            },
          ],
        },
      ],
    },
    {
      id: 'conv-2',
      title: 'Ticket Saneamientos García',
      subtitle: 'Guardado en 2026-T4',
      updated_label: 'Ayer',
      pending_confirmation: false,
      messages: [
        {
          id: 'msg-3',
          sender: 'user',
          timestamp_label: 'Cámara · Ayer',
          text: 'Foto de ticket de Saneamientos García por 642,30 € para la obra de Marta Ruiz.',
        },
        {
          id: 'msg-4',
          sender: 'assistant',
          timestamp_label: 'Ayer',
          text: 'Ticket registrado correctamente en tu Hucha Fiscal 2026-T4 con 111,47 € de IVA deducible.',
        },
      ],
    },
    {
      id: 'conv-3',
      title: 'Subir tarifa hora fontanería',
      subtitle: 'Aplicado (38 €/h)',
      updated_label: '14 nov',
      pending_confirmation: false,
      messages: [
        {
          id: 'msg-5',
          sender: 'user',
          timestamp_label: 'Dictado por voz · 14 nov',
          via_voice: true,
          text: '«Sube mi tarifa base de mano de obra a 38 euros la hora para los nuevos presupuestos.»',
        },
        {
          id: 'msg-6',
          sender: 'assistant',
          timestamp_label: '14 nov',
          text: 'Hecho. Tu tarifa base ya está fijada en 38,00 €/h y se aplicará a nuevos presupuestos y cálculos de desviación.',
        },
      ],
    },
  ];

  const activities: ActivityEntry[] = [
    {
      id: 'act-1',
      category: 'Tarifario actualizado',
      tone: 'success',
      timestamp_label: 'Hace 2 h',
      title: 'Alicatado pared porcelánico',
      description: 'Guardado tras preparar el presupuesto PRE-2026-014.',
      highlight_value: '42,00 €/m2',
      action_route: '#/tarifario',
      action_label: 'Editar precio',
    },
    {
      id: 'act-2',
      category: 'Control de tiempos',
      tone: 'warning',
      timestamp_label: '18 nov · 19:35',
      title: 'Desviación en bajante de Velázquez',
      description: 'Anotadas en OBR-2026-011 para afinar futuros presupuestos de comunidad.',
      highlight_value: '+2,5 h (+95,00 €)',
      action_route: '#/calendario',
      action_label: 'Ver calendario',
    },
    {
      id: 'act-3',
      category: 'IVA habitual',
      tone: 'neutral',
      timestamp_label: '14 nov',
      title: 'Reformas de vivienda al 10%',
      description: 'Aplico automáticamente IVA reducido del 10% cuando el cliente es particular.',
      action_route: '#/ajustes',
      action_label: 'Revisar ajuste',
    },
  ];

  return {
    clients,
    jobs,
    scheduleEntries,
    workScheduleDefaults,
    quotes,
    invoices,
    expenseTickets,
    jobPhotos,
    jobDiaryEntries,
    pricingCatalog,
    conversations,
    activeConversationId: 'conv-1',
    activities,
    settings,
  };
}

function loadStateFromStorage(): AppStateData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as Partial<AppStateData>;
    const initial = createInitialState();
    return {
      ...initial,
      ...parsed,
      settings: { ...initial.settings, ...(parsed.settings ?? {}) },
      workScheduleDefaults: {
        ...initial.workScheduleDefaults,
        ...(parsed.workScheduleDefaults ?? {}),
      },
    };
  } catch {
    return createInitialState();
  }
}

export interface CreateJobInput {
  client_id: string;
  title: string;
  address: string;
  status: JobStatus;
  start_date_iso?: string;
  end_date_iso?: string;
}

export interface SaveScheduleLogInput {
  entryId?: string;
  jobId: string;
  dateIso: string;
  actualHours: number;
  actualEnd: string;
  deviationReason?: string;
  notes?: string;
  linkToDiary: boolean;
  chatCardRef?: { conversationId: string; cardId: string };
}

export interface SaveQuoteInput {
  id?: string;
  client_id: string;
  job_id?: string;
  title: string;
  vat_rate: number;
  lines: QuoteLine[];
  status: QuoteStatus;
  voice_note?: string;
  chatCardRef?: { conversationId: string; cardId: string };
}

export interface AddExpenseTicketInput {
  job_id: string;
  supplier_name: string;
  issue_date_iso: string;
  category: ExpenseCategory;
  vat_rate: number;
  total_cents: number;
  image_url?: string;
  notes?: string;
  chatCardRef?: { conversationId: string; cardId: string };
}

export interface AddJobPhotoInput {
  job_id: string;
  caption: string;
  image_url: string;
  location_label?: string;
}

export interface StoreContextValue {
  state: AppStateData;
  route: AppRoute;
  navigate: (nextRoute: AppRoute) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  voiceOpen: boolean;
  setVoiceOpen: (open: boolean) => void;
  cameraSheetOpen: boolean;
  setCameraSheetOpen: (open: boolean) => void;
  overlay: GenerativeOverlayState | null;
  openOverlay: (next: GenerativeOverlayState) => void;
  closeOverlay: () => void;
  printableDoc: PrintableDocumentState | null;
  openPrintableDoc: (doc: PrintableDocumentState) => void;
  closePrintableDoc: () => void;
  toasts: ToastItem[];
  pushToast: (message: string, tone?: ToastItem['tone']) => void;
  // Computed helpers
  getFiscalSummary: (quarter: FiscalQuarter) => FiscalQuarterSummary;
  getClientById: (id: string) => Client | undefined;
  getJobById: (id: string) => Job | undefined;
  getPendingProposalCount: () => number;
  // Mutations
  createClient: (input: Omit<Client, 'id'>) => Client;
  createJob: (input: CreateJobInput) => { job: Job; generatedDays: number };
  updateJobStatus: (jobId: string, status: JobStatus) => void;
  addManualDiaryNote: (jobId: string, summary: string) => void;
  saveScheduleLog: (input: SaveScheduleLogInput) => ScheduleEntry;
  addScheduleAppointment: (jobId: string, dateIso: string, start: string, end: string, notes?: string) => ScheduleEntry;
  saveQuote: (input: SaveQuoteInput) => Quote;
  updateQuoteStatus: (quoteId: string, status: QuoteStatus) => void;
  emitInvoiceFromQuote: (quoteId: string, mode: 'anticipo' | 'completa', customConcept?: string) => Invoice | null;
  markInvoicePaid: (invoiceId: string) => void;
  addExpenseTicket: (input: AddExpenseTicketInput) => ExpenseTicket;
  addJobPhoto: (input: AddJobPhotoInput) => JobPhoto;
  upsertCatalogItem: (input: { id?: string; name: string; category: TradeCategory; unit: PricingUnit; unit_price_cents: number }) => PricingCatalogItem;
  deleteCatalogItem: (id: string) => void;
  updateWorkScheduleDefaults: (next: WorkScheduleDefaults) => void;
  updateSettings: (partial: Partial<BusinessSettings>) => void;
  setActiveConversationId: (id: string) => void;
  startNewConversation: () => string;
  submitVoiceOrChatPrompt: (text: string, viaVoice: boolean) => void;
  markChatCardResolved: (conversationId: string, cardId: string) => void;
  resetDemoData: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

function normalizeHashRoute(rawHash: string): AppRoute {
  if (!rawHash || rawHash === '#' || rawHash === '#/' || rawHash === '#inicio') return '#/';
  if (rawHash.startsWith('#/clientes/')) return rawHash as AppRoute;
  const validStatic: AppRoute[] = [
    '#/',
    '#/asistente',
    '#/calendario',
    '#/obras',
    '#/presupuestos',
    '#/clientes',
    '#/hucha',
    '#/actividad',
    '#/tarifario',
    '#/ajustes',
  ];
  if (validStatic.includes(rawHash as AppRoute)) return rawHash as AppRoute;
  return '#/';
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppStateData>(() => loadStateFromStorage());
  const [route, setRoute] = useState<AppRoute>(() => normalizeHashRoute(window.location.hash));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [cameraSheetOpen, setCameraSheetOpen] = useState(false);
  const [overlay, setOverlay] = useState<GenerativeOverlayState | null>(null);
  const [printableDoc, setPrintableDoc] = useState<PrintableDocumentState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota issues in private browsing
    }
  }, [state]);

  useEffect(() => {
    const onHashChange = () => {
      setRoute(normalizeHashRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute) => {
    if (window.location.hash !== nextRoute) {
      window.location.hash = nextRoute;
    }
    setRoute(nextRoute);
    setDrawerOpen(false);
  }, []);

  const openOverlay = useCallback((next: GenerativeOverlayState) => {
    setOverlay(next);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
  }, []);

  const openPrintableDoc = useCallback((doc: PrintableDocumentState) => {
    setPrintableDoc(doc);
  }, []);

  const closePrintableDoc = useCallback(() => {
    setPrintableDoc(null);
  }, []);

  const getClientById = useCallback(
    (id: string) => state.clients.find((c) => c.id === id),
    [state.clients],
  );

  const getJobById = useCallback(
    (id: string) => state.jobs.find((j) => j.id === id),
    [state.jobs],
  );

  const getPendingProposalCount = useCallback(() => {
    return state.conversations.reduce((acc, conv) => {
      const unresolved = conv.messages.reduce((mAcc, msg) => {
        const cards = msg.action_cards ?? [];
        return mAcc + cards.filter((c) => !c.resolved).length;
      }, 0);
      return acc + unresolved;
    }, 0);
  }, [state.conversations]);

  const getFiscalSummary = useCallback(
    (quarter: FiscalQuarter): FiscalQuarterSummary => {
      const qInvoices = state.invoices.filter((inv) => inv.quarter === quarter);
      const qTickets = state.expenseTickets.filter((t) => t.quarter === quarter);

      const invoicedCents = qInvoices.reduce((s, inv) => s + inv.total_cents, 0);
      const paidInvoices = qInvoices.filter((inv) => inv.status === 'pagado');
      const collectedCents = paidInvoices.reduce((s, inv) => s + inv.total_cents, 0);
      const pendingCents = qInvoices
        .filter((inv) => inv.status !== 'pagado')
        .reduce((s, inv) => s + inv.total_cents, 0);

      const collectedBaseCents = paidInvoices.reduce((s, inv) => s + inv.base_cents, 0);
      const vatCollectedCents = paidInvoices.reduce((s, inv) => s + inv.vat_cents, 0);

      const expensesTotalCents = qTickets.reduce((s, t) => s + t.total_cents, 0);
      const expensesBaseCents = qTickets.reduce((s, t) => s + t.base_cents, 0);
      const vatDeductibleCents = qTickets.reduce((s, t) => s + t.vat_cents, 0);

      const vatToPayCents = Math.max(0, vatCollectedCents - vatDeductibleCents);
      const operatingNetBaseCents = Math.max(0, collectedBaseCents - expensesBaseCents);
      const irpfToPayCents = Math.round(
        (operatingNetBaseCents * state.settings.default_irpf_rate) / 100,
      );
      const taxReserveCents = vatToPayCents + irpfToPayCents;
      const freeRealCents = Math.max(0, collectedCents - expensesTotalCents - taxReserveCents);

      const totalPie = Math.max(1, freeRealCents + expensesTotalCents + taxReserveCents);
      const freePct = Math.round((freeRealCents / totalPie) * 100);
      const expensesPct = Math.round((expensesTotalCents / totalPie) * 100);
      const taxPct = Math.max(0, 100 - freePct - expensesPct);

      // Rentabilidad neta por obra en el trimestre
      const jobMap = new Map<string, { incomeCents: number; expenseCents: number }>();
      for (const inv of paidInvoices) {
        const entry = jobMap.get(inv.job_id) ?? { incomeCents: 0, expenseCents: 0 };
        entry.incomeCents += inv.base_cents;
        jobMap.set(inv.job_id, entry);
      }
      for (const tkt of qTickets) {
        if (!tkt.job_id) continue;
        const entry = jobMap.get(tkt.job_id) ?? { incomeCents: 0, expenseCents: 0 };
        entry.expenseCents += tkt.base_cents;
        jobMap.set(tkt.job_id, entry);
      }

      const jobProfitability = Array.from(jobMap.entries())
        .map(([jobId, totals]) => {
          const job = state.jobs.find((j) => j.id === jobId);
          return {
            jobId,
            jobCode: job?.job_code ?? 'OBRA',
            title: job?.title ?? 'Obra general',
            incomeCents: totals.incomeCents,
            expenseCents: totals.expenseCents,
            netCents: Math.max(0, totals.incomeCents - totals.expenseCents),
          };
        })
        .sort((a, b) => b.netCents - a.netCents);

      return {
        quarter,
        invoicedCents,
        collectedCents,
        pendingCents,
        expensesTotalCents,
        vatCollectedCents,
        vatDeductibleCents,
        vatToPayCents,
        irpfToPayCents,
        taxReserveCents,
        freeRealCents,
        freePct,
        expensesPct,
        taxPct,
        tickets: qTickets,
        invoices: qInvoices,
        jobProfitability,
      };
    },
    [state.invoices, state.expenseTickets, state.jobs, state.settings.default_irpf_rate],
  );

  const markChatCardResolved = useCallback((conversationId: string, cardId: string) => {
    setState((prev) => ({
      ...prev,
      conversations: prev.conversations.map((conv) => {
        if (conv.id !== conversationId) return conv;
        const nextMessages = conv.messages.map((msg) => ({
          ...msg,
          action_cards: msg.action_cards?.map((card) =>
            card.id === cardId ? { ...card, resolved: true } : card,
          ),
        }));
        const stillPending = nextMessages.some((m) =>
          (m.action_cards ?? []).some((c) => !c.resolved),
        );
        return {
          ...conv,
          pending_confirmation: stillPending,
          subtitle: stillPending ? 'Esperando confirmación' : 'Propuestas revisadas',
          messages: nextMessages,
        };
      }),
    }));
  }, []);

  const createClient = useCallback(
    (input: Omit<Client, 'id'>): Client => {
      const client: Client = {
        ...input,
        id: `cli-${Date.now()}`,
      };
      setState((prev) => ({
        ...prev,
        clients: [client, ...prev.clients],
      }));
      pushToast(`Cliente ${client.name} añadido`);
      return client;
    },
    [pushToast],
  );

  const createJob = useCallback(
    (input: CreateJobInput): { job: Job; generatedDays: number } => {
      const seq = state.settings.next_job_seq;
      const jobCode = `OBR-2026-${String(seq).padStart(3, '0')}`;
      const jobId = `job-${Date.now()}`;

      const daily = calculateDailyHoursFromDefaults(state.workScheduleDefaults);
      const newEntries: ScheduleEntry[] = [];

      if (
        input.start_date_iso &&
        input.end_date_iso &&
        state.workScheduleDefaults.auto_apply_to_jobs
      ) {
        const dates = listDatesInRange(input.start_date_iso, input.end_date_iso);
        for (const dateIso of dates) {
          const weekday = getIsoWeekday(dateIso);
          if (state.workScheduleDefaults.work_days.includes(weekday)) {
            newEntries.push({
              id: `sch-${jobId}-${dateIso}`,
              job_id: jobId,
              date_iso: dateIso,
              planned_start: state.workScheduleDefaults.morning_start,
              planned_end: state.workScheduleDefaults.afternoon_end,
              planned_hours: daily.totalHours || 8,
              status: 'previsto',
              notes: `Jornada generada automáticamente para ${input.title}.`,
            });
          }
        }
      }

      const estimatedHours =
        newEntries.length > 0
          ? Math.round(newEntries.reduce((s, e) => s + e.planned_hours, 0) * 10) / 10
          : undefined;

      const job: Job = {
        id: jobId,
        job_code: jobCode,
        client_id: input.client_id,
        title: input.title,
        address: input.address,
        status: input.status,
        start_date_iso: input.start_date_iso || undefined,
        end_date_iso: input.end_date_iso || undefined,
        estimated_hours: estimatedHours,
      };

      setState((prev) => ({
        ...prev,
        jobs: [job, ...prev.jobs],
        scheduleEntries: [...prev.scheduleEntries, ...newEntries],
        settings: {
          ...prev.settings,
          next_job_seq: prev.settings.next_job_seq + 1,
        },
        activities:
          newEntries.length > 0
            ? [
                {
                  id: `act-${Date.now()}`,
                  category: 'Control de tiempos',
                  tone: 'success',
                  timestamp_label: 'Ahora',
                  title: `Calendario planificado · ${job.title}`,
                  description: `${newEntries.length} jornadas creadas automáticamente según tu horario habitual.`,
                  highlight_value: `${estimatedHours ?? 0} h previstas`,
                  action_route: '#/calendario',
                  action_label: 'Abrir agenda',
                },
                ...prev.activities,
              ]
            : prev.activities,
      }));

      pushToast(
        newEntries.length > 0
          ? `${jobCode} creada con ${newEntries.length} jornadas en tu Calendario`
          : `Obra ${jobCode} creada`,
      );
      return { job, generatedDays: newEntries.length };
    },
    [state.settings.next_job_seq, state.workScheduleDefaults, pushToast],
  );

  const updateJobStatus = useCallback(
    (jobId: string, status: JobStatus) => {
      setState((prev) => ({
        ...prev,
        jobs: prev.jobs.map((j) => (j.id === jobId ? { ...j, status } : j)),
      }));
      pushToast('Estado de la obra actualizado');
    },
    [pushToast],
  );

  const addManualDiaryNote = useCallback(
    (jobId: string, summary: string) => {
      const entry: JobDiaryEntry = {
        id: `dia-${Date.now()}`,
        job_id: jobId,
        date_iso: TODAY_ISO,
        time_range: 'Nota de obra',
        summary,
        tag: 'Nota manual guardada en local',
      };
      setState((prev) => ({
        ...prev,
        jobDiaryEntries: [entry, ...prev.jobDiaryEntries],
      }));
      pushToast('Nota añadida al Diario de Obra');
    },
    [pushToast],
  );

  const saveScheduleLog = useCallback(
    (input: SaveScheduleLogInput): ScheduleEntry => {
      const existing = state.scheduleEntries.find(
        (e) =>
          (input.entryId && e.id === input.entryId) ||
          (e.job_id === input.jobId && e.date_iso === input.dateIso),
      );
      const daily = calculateDailyHoursFromDefaults(state.workScheduleDefaults);
      const plannedHours = existing?.planned_hours ?? (daily.totalHours || 8);
      const plannedStart = existing?.planned_start ?? state.workScheduleDefaults.morning_start;
      const plannedEnd = existing?.planned_end ?? state.workScheduleDefaults.afternoon_end;
      const deltaHours = Math.round((input.actualHours - plannedHours) * 10) / 10;

      let status: ScheduleStatus = 'en_hora';
      if (deltaHours > 0.05) status = 'alargado';
      else if (deltaHours < -0.05) status = 'antes';

      const updated: ScheduleEntry = {
        id: existing?.id ?? `sch-${Date.now()}`,
        job_id: input.jobId,
        date_iso: input.dateIso,
        planned_start: plannedStart,
        planned_end: plannedEnd,
        planned_hours: plannedHours,
        actual_start: plannedStart,
        actual_end: input.actualEnd,
        actual_hours: input.actualHours,
        status,
        deviation_reason: input.deviationReason,
        notes: input.notes,
      };

      const job = state.jobs.find((j) => j.id === input.jobId);
      const deltaCents = Math.round(deltaHours * state.settings.hourly_rate_cents);

      setState((prev) => {
        const nextEntries = existing
          ? prev.scheduleEntries.map((e) => (e.id === existing.id ? updated : e))
          : [...prev.scheduleEntries, updated];

        const nextDiary = input.linkToDiary
          ? [
              {
                id: `dia-${Date.now()}`,
                job_id: input.jobId,
                date_iso: input.dateIso,
                time_range: `${plannedStart}–${input.actualEnd}`,
                summary:
                  input.notes?.trim() ||
                  (deltaHours === 0
                    ? 'Jornada completada según horario habitual.'
                    : `Ajuste de jornada (${formatSignedHours(deltaHours)}): ${input.deviationReason ?? 'Sin motivo detallado'}.`),
                tag: input.deviationReason
                  ? `Vinculado desde Parte de Jornada · ${input.deviationReason}`
                  : 'Parte diario guardado',
                delta_hours: deltaHours,
                delta_cents: deltaCents,
                linked_schedule_id: updated.id,
              },
              ...prev.jobDiaryEntries.filter((d) => d.linked_schedule_id !== updated.id),
            ]
          : prev.jobDiaryEntries;

        const nextActivities: ActivityEntry[] =
          deltaHours !== 0
            ? [
                {
                  id: `act-${Date.now()}`,
                  category: 'Control de tiempos',
                  tone: deltaHours > 0 ? 'warning' : 'success',
                  timestamp_label: `Hoy · ${input.actualEnd}`,
                  title: input.deviationReason || `Ajuste en ${job?.title ?? 'obra'}`,
                  description: `Registrado en ${job?.job_code ?? 'obra'} (${formatShortDayLabel(input.dateIso)}) para afinar futuros presupuestos.`,
                  highlight_value: `${formatSignedHours(deltaHours)} (${formatSignedEuros(deltaCents)})`,
                  action_route: '#/calendario',
                  action_label: 'Ver calendario',
                },
                ...prev.activities,
              ]
            : prev.activities;

        const nextConversations = input.chatCardRef
          ? prev.conversations.map((conv) => {
              if (conv.id !== input.chatCardRef?.conversationId) return conv;
              const msgs = conv.messages.map((m) => ({
                ...m,
                action_cards: m.action_cards?.map((c) =>
                  c.id === input.chatCardRef?.cardId ? { ...c, resolved: true } : c,
                ),
              }));
              const stillPending = msgs.some((m) => (m.action_cards ?? []).some((c) => !c.resolved));
              return {
                ...conv,
                pending_confirmation: stillPending,
                subtitle: stillPending ? 'Esperando confirmación' : 'Propuestas revisadas',
                messages: msgs,
              };
            })
          : prev.conversations;

        return {
          ...prev,
          scheduleEntries: nextEntries,
          jobDiaryEntries: nextDiary,
          activities: nextActivities,
          conversations: nextConversations,
        };
      });

      pushToast(
        deltaHours === 0
          ? 'Parte guardado: jornada en hora'
          : `Parte guardado (${formatSignedHours(deltaHours)} · ${formatSignedEuros(deltaCents)})`,
      );
      return updated;
    },
    [state.scheduleEntries, state.workScheduleDefaults, state.jobs, state.settings.hourly_rate_cents, pushToast],
  );

  const addScheduleAppointment = useCallback(
    (jobId: string, dateIso: string, start: string, end: string, notes?: string): ScheduleEntry => {
      const diffMin = Math.max(60, parseTimeToMinutes(end) - parseTimeToMinutes(start));
      const plannedHours = Math.round((diffMin / 60) * 10) / 10;
      const entry: ScheduleEntry = {
        id: `sch-${Date.now()}`,
        job_id: jobId,
        date_iso: dateIso,
        planned_start: start,
        planned_end: end,
        planned_hours: plannedHours,
        status: 'previsto',
        notes: notes || 'Cita programada en agenda.',
      };
      setState((prev) => ({
        ...prev,
        scheduleEntries: [...prev.scheduleEntries, entry],
      }));
      pushToast(`Cita añadida para el ${formatShortDayLabel(dateIso)}`);
      return entry;
    },
    [pushToast],
  );

  const saveQuote = useCallback(
    (input: SaveQuoteInput): Quote => {
      const totals = computeQuoteTotals(input.lines, input.vat_rate);
      const existing = input.id ? state.quotes.find((q) => q.id === input.id) : undefined;
      const quoteCode =
        existing?.quote_code ?? `PRE-2026-${String(state.settings.next_quote_seq).padStart(3, '0')}`;

      const linkedJobId =
        input.job_id ||
        existing?.job_id ||
        state.jobs.find((j) => j.client_id === input.client_id)?.id ||
        state.jobs[0]?.id ||
        'job-001';

      const quote: Quote = {
        id: existing?.id ?? `quo-${Date.now()}`,
        quote_code: quoteCode,
        job_id: linkedJobId,
        client_id: input.client_id,
        title: input.title.trim() || 'Presupuesto de reforma',
        vat_rate: input.vat_rate,
        ...totals,
        status: input.status,
        created_at_iso: existing?.created_at_iso ?? TODAY_ISO,
        voice_note: input.voice_note ?? existing?.voice_note,
        lines: input.lines,
      };

      setState((prev) => {
        const nextQuotes = existing
          ? prev.quotes.map((q) => (q.id === existing.id ? quote : q))
          : [quote, ...prev.quotes];

        // Save checked lines into pricing catalog
        let nextCatalog = [...prev.pricingCatalog];
        const newActivities: ActivityEntry[] = [];
        for (const line of input.lines) {
          if (!line.save_to_catalog || !line.description.trim()) continue;
          const idx = nextCatalog.findIndex(
            (item) => item.name.toLowerCase() === line.description.trim().toLowerCase(),
          );
          if (idx >= 0) {
            nextCatalog[idx] = {
              ...nextCatalog[idx],
              unit: line.unit,
              unit_price_cents: line.unit_price_cents,
              usage_count: nextCatalog[idx].usage_count + 1,
              learned_from: quoteCode,
              updated_at_iso: TODAY_ISO,
            };
          } else {
            nextCatalog = [
              {
                id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                name: line.description.trim(),
                category: line.trade_category ?? 'General',
                unit: line.unit,
                unit_price_cents: line.unit_price_cents,
                usage_count: 1,
                learned_from: quoteCode,
                updated_at_iso: TODAY_ISO,
              },
              ...nextCatalog,
            ];
          }
          newActivities.push({
            id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            category: 'Tarifario actualizado',
            tone: 'success',
            timestamp_label: 'Ahora',
            title: line.description.trim(),
            description: `Guardado tras aprobar el presupuesto ${quoteCode}.`,
            highlight_value: `${formatEuros(line.unit_price_cents)}/${line.unit}`,
            action_route: '#/tarifario',
            action_label: 'Editar precio',
          });
        }

        const nextConversations = input.chatCardRef
          ? prev.conversations.map((conv) => {
              if (conv.id !== input.chatCardRef?.conversationId) return conv;
              const msgs = conv.messages.map((m) => ({
                ...m,
                action_cards: m.action_cards?.map((c) =>
                  c.id === input.chatCardRef?.cardId ? { ...c, resolved: true } : c,
                ),
              }));
              const stillPending = msgs.some((m) => (m.action_cards ?? []).some((c) => !c.resolved));
              return {
                ...conv,
                pending_confirmation: stillPending,
                subtitle: stillPending ? 'Esperando confirmación' : 'Propuestas revisadas',
                messages: msgs,
              };
            })
          : prev.conversations;

        return {
          ...prev,
          quotes: nextQuotes,
          pricingCatalog: nextCatalog,
          activities: [...newActivities, ...prev.activities],
          conversations: nextConversations,
          settings: existing
            ? prev.settings
            : { ...prev.settings, next_quote_seq: prev.settings.next_quote_seq + 1 },
        };
      });

      pushToast(
        input.status === 'aceptado'
          ? `Presupuesto ${quoteCode} aprobado y listo en PDF`
          : `Presupuesto ${quoteCode} actualizado`,
      );
      return quote;
    },
    [state.quotes, state.settings.next_quote_seq, state.jobs, pushToast],
  );

  const updateQuoteStatus = useCallback(
    (quoteId: string, status: QuoteStatus) => {
      setState((prev) => ({
        ...prev,
        quotes: prev.quotes.map((q) => (q.id === quoteId ? { ...q, status } : q)),
      }));
      const labels: Record<QuoteStatus, string> = {
        borrador: 'Pasado a borrador',
        enviado: 'Presupuesto marcado como enviado',
        aceptado: 'Presupuesto aceptado por el cliente',
        rechazado: 'Presupuesto rechazado',
        facturado: 'Presupuesto facturado',
      };
      pushToast(labels[status]);
    },
    [pushToast],
  );

  const emitInvoiceFromQuote = useCallback(
    (quoteId: string, mode: 'anticipo' | 'completa', customConcept?: string): Invoice | null => {
      const quote = state.quotes.find((q) => q.id === quoteId);
      if (!quote) return null;

      const isAnticipo = mode === 'anticipo';
      const factor = isAnticipo ? 0.4 : 1;
      const base_cents = Math.round(quote.subtotal_cents * factor);
      const vat_cents = Math.round((base_cents * quote.vat_rate) / 100);
      const total_cents = base_cents + vat_cents;

      const invoice_number = isAnticipo
        ? `ANT-2026-${String(state.settings.next_anticipo_seq).padStart(3, '0')}`
        : `FAC-2026-${String(state.settings.next_invoice_seq).padStart(3, '0')}`;

      const invoice: Invoice = {
        id: `inv-${Date.now()}`,
        invoice_number,
        series_type: isAnticipo ? 'ANT' : 'FAC',
        kind: isAnticipo ? 'anticipo' : 'completa',
        job_id: quote.job_id,
        client_id: quote.client_id,
        quote_id: quote.id,
        concept:
          customConcept?.trim() ||
          (isAnticipo ? `Anticipo 40% · ${quote.title}` : quote.title),
        vat_rate: quote.vat_rate,
        issued_at_iso: TODAY_ISO,
        due_at_iso: '2026-12-08',
        quarter: dateToQuarter(TODAY_ISO),
        base_cents,
        vat_cents,
        total_cents,
        status: 'pendiente_cobro',
      };

      setState((prev) => ({
        ...prev,
        invoices: [invoice, ...prev.invoices],
        quotes: prev.quotes.map((q) =>
          q.id === quoteId && !isAnticipo ? { ...q, status: 'facturado' } : q,
        ),
        settings: {
          ...prev.settings,
          next_anticipo_seq: isAnticipo
            ? prev.settings.next_anticipo_seq + 1
            : prev.settings.next_anticipo_seq,
          next_invoice_seq: !isAnticipo
            ? prev.settings.next_invoice_seq + 1
            : prev.settings.next_invoice_seq,
        },
        activities: [
          {
            id: `act-${Date.now()}`,
            category: 'Facturación',
            tone: 'terracotta',
            timestamp_label: 'Ahora',
            title: `${invoice_number} emitida`,
            description: `${invoice.concept} generada desde ${quote.quote_code}.`,
            highlight_value: formatEuros(total_cents),
            action_route: '#/presupuestos',
            action_label: 'Ver factura',
          },
          ...prev.activities,
        ],
      }));

      pushToast(`${invoice_number} emitida (${formatEuros(total_cents)})`);
      return invoice;
    },
    [state.quotes, state.settings.next_anticipo_seq, state.settings.next_invoice_seq, pushToast],
  );

  const markInvoicePaid = useCallback(
    (invoiceId: string) => {
      const target = state.invoices.find((i) => i.id === invoiceId);
      if (!target || target.status === 'pagado') return;
      setState((prev) => ({
        ...prev,
        invoices: prev.invoices.map((inv) =>
          inv.id === invoiceId ? { ...inv, status: 'pagado' } : inv,
        ),
        activities: [
          {
            id: `act-${Date.now()}`,
            category: 'Hucha fiscal',
            tone: 'success',
            timestamp_label: 'Ahora',
            title: `Cobro registrado · ${target.invoice_number}`,
            description: `Hucha Fiscal ${target.quarter} recalculada con IVA y reserva de IRPF.`,
            highlight_value: formatEuros(target.total_cents),
            action_route: '#/hucha',
            action_label: 'Ver Hucha Fiscal',
          },
          ...prev.activities,
        ],
      }));
      pushToast(`${target.invoice_number} cobrada · Hucha Fiscal actualizada`);
    },
    [state.invoices, pushToast],
  );

  const addExpenseTicket = useCallback(
    (input: AddExpenseTicketInput): ExpenseTicket => {
      const divisor = 1 + input.vat_rate / 100;
      const base_cents = Math.round(input.total_cents / divisor);
      const vat_cents = input.total_cents - base_cents;
      const quarter = dateToQuarter(input.issue_date_iso);

      const ticket: ExpenseTicket = {
        id: `tkt-${Date.now()}`,
        job_id: input.job_id,
        supplier_name: input.supplier_name.trim() || 'Proveedor local',
        issue_date_iso: input.issue_date_iso,
        quarter,
        category: input.category,
        vat_rate: input.vat_rate,
        base_cents,
        vat_cents,
        total_cents: input.total_cents,
        image_url: input.image_url,
        notes: input.notes,
      };

      setState((prev) => {
        const nextConversations = input.chatCardRef
          ? prev.conversations.map((conv) => {
              if (conv.id !== input.chatCardRef?.conversationId) return conv;
              const msgs = conv.messages.map((m) => ({
                ...m,
                action_cards: m.action_cards?.map((c) =>
                  c.id === input.chatCardRef?.cardId ? { ...c, resolved: true } : c,
                ),
              }));
              const stillPending = msgs.some((m) => (m.action_cards ?? []).some((c) => !c.resolved));
              return {
                ...conv,
                pending_confirmation: stillPending,
                subtitle: stillPending ? 'Esperando confirmación' : 'Propuestas revisadas',
                messages: msgs,
              };
            })
          : prev.conversations;

        return {
          ...prev,
          expenseTickets: [ticket, ...prev.expenseTickets],
          conversations: nextConversations,
          activities: [
            {
              id: `act-${Date.now()}`,
              category: 'Hucha fiscal',
              tone: 'success',
              timestamp_label: 'Ahora',
              title: `Ticket deducible · ${ticket.supplier_name}`,
              description: `Sumado a ${quarter} (${ticket.category}). Ahorras ${formatEuros(vat_cents)} en IVA.`,
              highlight_value: formatEuros(ticket.total_cents),
              action_route: '#/hucha',
              action_label: 'Ver Hucha Fiscal',
            },
            ...prev.activities,
          ],
        };
      });

      pushToast(`Ticket guardado · +${formatEuros(vat_cents)} de IVA deducible`);
      return ticket;
    },
    [pushToast],
  );

  const addJobPhoto = useCallback(
    (input: AddJobPhotoInput): JobPhoto => {
      const job = state.jobs.find((j) => j.id === input.job_id);
      const photo: JobPhoto = {
        id: `pho-${Date.now()}`,
        job_id: input.job_id,
        caption: input.caption.trim() || 'Avance de obra',
        captured_at_iso: `${TODAY_ISO}T${new Date().toTimeString().slice(0, 5)}:00`,
        image_url: input.image_url,
        location_label: input.location_label || job?.address || 'Madrid',
      };
      setState((prev) => ({
        ...prev,
        jobPhotos: [photo, ...prev.jobPhotos],
        jobDiaryEntries: [
          {
            id: `dia-${Date.now()}`,
            job_id: input.job_id,
            date_iso: TODAY_ISO,
            time_range: 'Foto sellada',
            summary: photo.caption,
            tag: `Foto sellada en local · ${photo.location_label}`,
          },
          ...prev.jobDiaryEntries,
        ],
      }));
      pushToast(`Foto sellada en ${job?.job_code ?? 'la obra'}`);
      return photo;
    },
    [state.jobs, pushToast],
  );

  const upsertCatalogItem = useCallback(
    (input: {
      id?: string;
      name: string;
      category: TradeCategory;
      unit: PricingUnit;
      unit_price_cents: number;
    }): PricingCatalogItem => {
      const existing = input.id ? state.pricingCatalog.find((c) => c.id === input.id) : undefined;
      const item: PricingCatalogItem = {
        id: existing?.id ?? `cat-${Date.now()}`,
        name: input.name.trim(),
        category: input.category,
        unit: input.unit,
        unit_price_cents: input.unit_price_cents,
        usage_count: existing?.usage_count ?? 1,
        learned_from: existing?.learned_from,
        updated_at_iso: TODAY_ISO,
      };
      setState((prev) => ({
        ...prev,
        pricingCatalog: existing
          ? prev.pricingCatalog.map((c) => (c.id === existing.id ? item : c))
          : [item, ...prev.pricingCatalog],
      }));
      pushToast(existing ? 'Precio actualizado en tarifario' : 'Partida añadida al tarifario');
      return item;
    },
    [state.pricingCatalog, pushToast],
  );

  const deleteCatalogItem = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        pricingCatalog: prev.pricingCatalog.filter((c) => c.id !== id),
      }));
      pushToast('Partida eliminada del tarifario', 'info');
    },
    [pushToast],
  );

  const updateWorkScheduleDefaults = useCallback(
    (next: WorkScheduleDefaults) => {
      setState((prev) => ({
        ...prev,
        workScheduleDefaults: next,
      }));
      pushToast('Horario habitual guardado');
    },
    [pushToast],
  );

  const updateSettings = useCallback(
    (partial: Partial<BusinessSettings>) => {
      setState((prev) => ({
        ...prev,
        settings: { ...prev.settings, ...partial },
      }));
      pushToast('Ajustes guardados en local');
    },
    [pushToast],
  );

  const setActiveConversationId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeConversationId: id }));
  }, []);

  const startNewConversation = useCallback((): string => {
    const id = `conv-${Date.now()}`;
    const newConv: ChatConversation = {
      id,
      title: 'Nueva consulta de obra',
      subtitle: 'Lista para dictar',
      updated_label: 'Ahora',
      pending_confirmation: false,
      messages: [
        {
          id: `msg-${Date.now()}`,
          sender: 'assistant',
          timestamp_label: 'Ahora',
          text: 'Dime qué necesitas apuntar hoy: un presupuesto rápido, horas extra de una jornada o un ticket de material.',
        },
      ],
    };
    setState((prev) => ({
      ...prev,
      conversations: [newConv, ...prev.conversations],
      activeConversationId: id,
    }));
    return id;
  }, []);

  const submitVoiceOrChatPrompt = useCallback(
    (rawText: string, viaVoice: boolean) => {
      const text = rawText.trim();
      if (!text) return;
      const lower = text.toLowerCase();
      const nowLabel = viaVoice ? 'Dictado por voz · Ahora' : 'Escrito · Ahora';
      const userMsgId = `msg-u-${Date.now()}`;
      const assistantMsgId = `msg-a-${Date.now() + 1}`;
      const convId = state.activeConversationId;

      const cards: ChatActionCard[] = [];
      let assistantReply = 'He preparado esta propuesta para que la revises antes de guardar:';

      if (lower.includes('ticket') || lower.includes('gasto') || lower.includes('gasoil') || lower.includes('leroy') || lower.includes('ferreter')) {
        const amountMatch = lower.match(/(\d+(?:[.,]\d+)?)/);
        const euros = amountMatch ? Number.parseFloat(amountMatch[1].replace(',', '.')) : 66;
        const totalCents = Math.round((Number.isFinite(euros) ? euros : 66) * 100);
        const isFuel = lower.includes('gasoil') || lower.includes('repsol') || lower.includes('gasolina');
        const supplier = isFuel ? 'E.S. Repsol M-30' : 'Saneamientos García S.L.';
        const category: ExpenseCategory = isFuel ? 'Gasoil furgoneta' : 'Material';
        cards.push({
          id: `card-tkt-${Date.now()}`,
          type: 'ticket',
          code: '2026-T4',
          badge_label: 'Deducible IVA 21%',
          badge_tone: 'success',
          title: `Ticket · ${supplier}`,
          description: `${category} por ${formatEuros(totalCents)} listo para sumar a tu Hucha Fiscal.`,
          cta_label: `Revisar ticket (${formatEuros(totalCents)})`,
          cta_variant: 'primary',
          draft_data: {
            supplier,
            category,
            totalCents,
            vatRate: 21,
            jobId: isFuel ? '' : 'job-001',
            imageUrl: IMG_TICKET_RECEIPT,
          },
        });
      } else if (lower.includes('hora') || lower.includes('salida') || lower.includes('tarde') || lower.includes('antes') || lower.includes('parte')) {
        const isEarly = lower.includes('antes');
        const numMatch = lower.match(/(\d+(?:[.,]\d+)?)/);
        const hoursVal = numMatch ? Number.parseFloat(numMatch[1].replace(',', '.')) : 1.5;
        const delta = isEarly ? -Math.abs(hoursVal) : Math.abs(hoursVal);
        const impactCents = Math.round(delta * state.settings.hourly_rate_cents);
        cards.push({
          id: `card-sch-${Date.now()}`,
          type: 'schedule',
          code: 'OBR-2026-001',
          badge_label: `${formatSignedHours(delta)} (${formatSignedEuros(impactCents)})`,
          badge_tone: delta > 0 ? 'warning' : 'info',
          title: 'Parte del día · Baño Marta Ruiz',
          description: `Salida ajustada a las ${minutesToHHMM(17 * 60 + delta * 60)} con nota lista para el diario de obra.`,
          cta_label: 'Revisar parte del día',
          cta_variant: 'primary',
          payload_id: 'sch-1123',
          draft_data: {
            jobId: 'job-001',
            dateIso: TODAY_ISO,
            deltaHours: delta,
            reason: delta > 0 ? 'Imprevisto en instalación' : 'Más rápido de lo previsto',
            notes: text,
          },
        });
      } else {
        const nextCode = `PRE-2026-${String(state.settings.next_quote_seq).padStart(3, '0')}`;
        const client =
          state.clients.find((c) => lower.includes(c.name.split(' ')[0].toLowerCase())) ??
          state.clients[0];
        const vatRate = client.nif.startsWith('H') || client.nif.startsWith('B') ? 21 : 10;
        const draftLines: QuoteLine[] = [
          {
            id: `ql-d1-${Date.now()}`,
            description: lower.includes('pint')
              ? 'Pintura plástica lisa 2 manos'
              : lower.includes('enchuf') || lower.includes('luz')
                ? 'Punto de luz con mecanismo'
                : 'Alicatado pared porcelánico',
            quantity: lower.includes('pint') ? 35 : 10,
            unit: lower.includes('enchuf') || lower.includes('luz') ? 'ud' : 'm2',
            unit_price_cents: lower.includes('pint')
              ? 1250
              : lower.includes('enchuf') || lower.includes('luz')
                ? 4800
                : 4200,
            save_to_catalog: true,
            trade_category: 'Albañilería',
          },
          {
            id: `ql-d2-${Date.now()}`,
            description: 'Mano de obra y remates',
            quantity: 6,
            unit: 'h',
            unit_price_cents: state.settings.hourly_rate_cents,
            save_to_catalog: false,
            trade_category: 'Fontanería',
          },
        ];
        const totals = computeQuoteTotals(draftLines, vatRate);
        cards.push({
          id: `card-quo-${Date.now()}`,
          type: 'quote',
          code: nextCode,
          badge_label: 'Borrador IA',
          badge_tone: 'terracotta',
          title: `Presupuesto · ${client.name}`,
          description: `Preparado con tu tarifa de ${formatEuros(state.settings.hourly_rate_cents)}/h e IVA ${vatRate}%.`,
          cta_label: `Abrir borrador (${formatEuros(totals.total_cents)})`,
          cta_variant: 'primary',
          draft_data: {
            clientId: client.id,
            title: text.length > 48 ? `${text.slice(0, 48)}…` : text,
            vatRate,
            voiceNote: text,
            lines: draftLines,
          },
        });
      }

      if (cards.length === 0) {
        assistantReply = 'Anotado. Si quieres, dime cliente, partida o importe y preparo el borrador al instante.';
      }

      setState((prev) => ({
        ...prev,
        conversations: prev.conversations.map((conv) => {
          if (conv.id !== convId) return conv;
          return {
            ...conv,
            title:
              conv.title === 'Nueva consulta de obra'
                ? text.slice(0, 28) + (text.length > 28 ? '…' : '')
                : conv.title,
            subtitle: 'Esperando confirmación',
            updated_label: 'Ahora',
            pending_confirmation: true,
            messages: [
              ...conv.messages,
              {
                id: userMsgId,
                sender: 'user',
                timestamp_label: nowLabel,
                via_voice: viaVoice,
                text: viaVoice ? `«${text}»` : text,
              },
              {
                id: assistantMsgId,
                sender: 'assistant',
                timestamp_label: 'Ahora',
                text: assistantReply,
                action_cards: cards,
              },
            ],
          };
        }),
      }));
    },
    [state.activeConversationId, state.settings.hourly_rate_cents, state.settings.next_quote_seq, state.clients],
  );

  const resetDemoData = useCallback(() => {
    const fresh = createInitialState();
    setState(fresh);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore
    }
    pushToast('Datos de demostración restaurados', 'info');
  }, [pushToast]);

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      route,
      navigate,
      drawerOpen,
      setDrawerOpen,
      voiceOpen,
      setVoiceOpen,
      cameraSheetOpen,
      setCameraSheetOpen,
      overlay,
      openOverlay,
      closeOverlay,
      printableDoc,
      openPrintableDoc,
      closePrintableDoc,
      toasts,
      pushToast,
      getFiscalSummary,
      getClientById,
      getJobById,
      getPendingProposalCount,
      createClient,
      createJob,
      updateJobStatus,
      addManualDiaryNote,
      saveScheduleLog,
      addScheduleAppointment,
      saveQuote,
      updateQuoteStatus,
      emitInvoiceFromQuote,
      markInvoicePaid,
      addExpenseTicket,
      addJobPhoto,
      upsertCatalogItem,
      deleteCatalogItem,
      updateWorkScheduleDefaults,
      updateSettings,
      setActiveConversationId,
      startNewConversation,
      submitVoiceOrChatPrompt,
      markChatCardResolved,
      resetDemoData,
    }),
    [
      state,
      route,
      navigate,
      drawerOpen,
      voiceOpen,
      cameraSheetOpen,
      overlay,
      openOverlay,
      closeOverlay,
      printableDoc,
      openPrintableDoc,
      closePrintableDoc,
      toasts,
      pushToast,
      getFiscalSummary,
      getClientById,
      getJobById,
      getPendingProposalCount,
      createClient,
      createJob,
      updateJobStatus,
      addManualDiaryNote,
      saveScheduleLog,
      addScheduleAppointment,
      saveQuote,
      updateQuoteStatus,
      emitInvoiceFromQuote,
      markInvoicePaid,
      addExpenseTicket,
      addJobPhoto,
      upsertCatalogItem,
      deleteCatalogItem,
      updateWorkScheduleDefaults,
      updateSettings,
      setActiveConversationId,
      startNewConversation,
      submitVoiceOrChatPrompt,
      markChatCardResolved,
      resetDemoData,
    ],
  );

  return React.createElement(StoreContext.Provider, { value }, children);
}

export function useAppStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error('useAppStore debe usarse dentro de AppStoreProvider');
  }
  return ctx;
}
