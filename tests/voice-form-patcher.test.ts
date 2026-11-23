import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeterministicSpanishParser } from "../src/agent/inference/deterministicSpanishParser";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import {
  extractAddress,
  extractEmail,
  extractFlexibleDateRange,
  extractFlexibleSpanishDateIso,
  extractSpanishPhone,
  extractSpanishTaxId,
  extractSpanishTimeRanges,
  extractSpanishWeekdaysPatch,
} from "../src/agent/inference/spanishFormParsers";
import {
  patchCalendarAppointmentByVoice,
  patchCatalogItemByVoice,
  patchClientProfileByVoice,
  patchInvoiceGate3ByVoice,
  patchNewJobByVoice,
  patchQuoteDraftByVoice,
  patchScheduleWidgetByVoice,
  patchShareGate4ByVoice,
  patchSiteLogByVoice,
  patchTicketDraftByVoice,
  patchWorkScheduleDefaultsByVoice,
  type QuoteBuilderFormState,
} from "../src/agent/voiceFormPatcher";
import { ResetService } from "../src/core/backup/resetService";
import type {
  Gate2TicketDraftPayload,
  Gate3InvoiceDraftPayload,
  Gate4ShareDraftPayload,
  WorkScheduleDefaults,
} from "../src/core/contracts/types";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { ClientsRepository } from "../src/core/db/repositories/clientsRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MockFreezerPort } from "./mocks/ports";

describe("VoiceFormPatcher y Parsers Españoles Incrementales", () => {
  let executor: NodeBetterSqliteExecutor;
  const REF_DATE = "2026-11-23"; // Lunes

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    await new ResetService(executor).restoreDemoData(new MockFreezerPort());
  });

  afterEach(async () => {
    await executor.close();
  });

  it("interpreta fechas, rangos (incluyendo 'de este mes'), franjas horarias y días laborables", () => {
    expect(extractFlexibleSpanishDateIso("hoy", REF_DATE)).toBe("2026-11-23");
    expect(extractFlexibleSpanishDateIso("ayer", REF_DATE)).toBe("2026-11-22");
    expect(extractFlexibleSpanishDateIso("mañana de 9 a 13", REF_DATE)).toBe("2026-11-24");
    expect(extractFlexibleSpanishDateIso("pasado mañana", REF_DATE)).toBe("2026-11-25");
    expect(extractFlexibleSpanishDateIso("el próximo jueves", REF_DATE)).toBe("2026-11-26");
    expect(extractFlexibleSpanishDateIso("a 15 días", REF_DATE)).toBe("2026-12-08");
    expect(extractFlexibleSpanishDateIso("mañanas de 8 a 14 y tardes de 15 a 18", REF_DATE)).toBeNull();

    expect(extractFlexibleDateRange("del 22 al 30 de este mes", REF_DATE)).toEqual({
      start_date_iso: "2026-11-22",
      end_date_iso: "2026-11-30",
    });
    expect(extractFlexibleDateRange("del 22 de noviembre al 5 de diciembre", REF_DATE)).toEqual({
      start_date_iso: "2026-11-22",
      end_date_iso: "2026-12-05",
    });
    expect(extractFlexibleDateRange("del lunes al viernes", REF_DATE)).toEqual({
      start_date_iso: "2026-11-23",
      end_date_iso: "2026-11-27",
    });

    const ranges = extractSpanishTimeRanges("mañanas de 8 a 14 y tardes de 3 a 6");
    expect(ranges.morning).toEqual({ start: "08:00", end: "14:00" });
    expect(ranges.afternoon).toEqual({ start: "15:00", end: "18:00" });

    const cont = extractSpanishTimeRanges("jornada continua de 8 y media a 3");
    expect(cont.continuous).toEqual({ start: "08:30", end: "15:00" });

    expect(extractSpanishWeekdaysPatch("de lunes a viernes", [1])).toEqual([1, 2, 3, 4, 5]);
    expect(extractSpanishWeekdaysPatch("añade los sábados", [1, 2, 3, 4, 5])).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(extractSpanishWeekdaysPatch("quita los viernes", [1, 2, 3, 4, 5, 6])).toEqual([
      1, 2, 3, 4, 6,
    ]);

    expect(extractSpanishTaxId("NIF 12345678 z")).toEqual({ value: "12345678Z", isValid: true });
    expect(extractSpanishPhone("teléfono 611 22 33 44")).toBe("+34611223344");
    expect(extractEmail("correo laura arroba reformas punto es")).toBe("laura@reformas.es");
    expect(extractAddress("domicilio fiscal calle Mayor 12, Madrid")).toBe("calle Mayor 12, Madrid");

    // El parser global también soporta el ejemplo "del 22 al 30 de este mes" y órdenes parciales
    const det = new DeterministicSpanishParser();
    const r = det.parse("Planifica una obra del 22 al 30 de este mes");
    expect(r.intent).toBe("schedule_specialist");
    expect(r.entities.schedule?.mode).toBe("plan_range");
    expect(r.entities.schedule?.start_date_iso).toMatch(/-\d{2}-22$/);
    expect(r.entities.schedule?.end_date_iso).toMatch(/-\d{2}-30$/);

    const partial = det.parse("Planificar una obra");
    expect(partial.intent).toBe("schedule_specialist");
  });

  it("construye y edita un presupuesto en múltiples audios consecutivos preservando campos previos", async () => {
    let state: QuoteBuilderFormState = {
      draft: {
        quote_id: null,
        client_id: null,
        job_id: null,
        job_title: "",
        vat_rate: 21,
        notes: "",
        lines: [],
      },
      useNewClient: false,
    };

    // Audio 1: título y cliente existente (Marta en demo)
    const r1 = await patchQuoteDraftByVoice(
      state,
      "Título de la obra: Reforma baño principal, para Marta",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(r1.changed).toBe(true);
    expect(r1.nextState.draft.job_title).toBe("Reforma baño principal");
    expect(r1.nextState.draft.client_id).toBeTruthy();
    expect(r1.nextState.useNewClient).toBe(false);
    state = r1.nextState;

    // Audio 2: añadir 2 partidas desde el tarifario FTS5 (sin perder cliente ni título)
    const r2 = await patchQuoteDraftByVoice(
      state,
      "Añade 1 plato de ducha y 12 m2 de alicatado",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(r2.changed).toBe(true);
    expect(r2.nextState.draft.client_id).toBe(state.draft.client_id);
    expect(r2.nextState.draft.job_title).toBe("Reforma baño principal");
    expect(r2.nextState.draft.lines).toHaveLength(2);
    expect(r2.nextState.draft.lines[0]!.catalog_item_id).toBeTruthy();
    expect(r2.nextState.draft.lines[1]!.quantity_thousandths).toBe(12000);
    state = r2.nextState;

    // Audio 3: cambiar precio de la primera partida, cambiar IVA al 10% y añadir nota
    const r3 = await patchQuoteDraftByVoice(
      state,
      "Cambia el precio del plato de ducha a 420 euros, IVA al 10 %, añade en notas garantía de 2 años",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(r3.changed).toBe(true);
    expect(r3.nextState.draft.lines[0]!.unit_price_cents).toBe(42000);
    expect(r3.nextState.draft.lines[1]!.quantity_thousandths).toBe(12000);
    expect(r3.nextState.draft.vat_rate).toBe(10);
    expect(r3.nextState.draft.notes).toContain("garantía de 2 años");
    state = r3.nextState;

    // Audio 4: quitar la partida de alicatado preservando todo lo demás
    const r4 = await patchQuoteDraftByVoice(state, "Quita el alicatado", {
      executor,
      referenceDateIso: REF_DATE,
    });
    expect(r4.changed).toBe(true);
    expect(r4.nextState.draft.lines).toHaveLength(1);
    expect(r4.nextState.draft.vat_rate).toBe(10);
    expect(r4.nextState.draft.notes).toContain("garantía de 2 años");
  });

  it("gestiona desambiguación de clientes y alta progresiva de nuevo cliente en presupuesto", async () => {
    const clientsRepo = new ClientsRepository(executor);
    await clientsRepo.create({ name: "Antonio García Pérez", phone: "600111222" });
    await clientsRepo.create({ name: "María García López", phone: "600333444" });

    const baseState: QuoteBuilderFormState = {
      draft: {
        quote_id: null,
        client_id: null,
        job_id: null,
        job_title: "",
        vat_rate: 21,
        notes: "",
        lines: [],
      },
      useNewClient: false,
    };

    const amb = await patchQuoteDraftByVoice(baseState, "Para García", { executor });
    expect(amb.disambiguation?.entityType).toBe("client");
    expect(amb.disambiguation?.options.length).toBeGreaterThanOrEqual(2);

    // Nuevo cliente en 2 audios consecutivos
    const nc1 = await patchQuoteDraftByVoice(baseState, "Nuevo cliente Pepe Serrano", {
      executor,
    });
    expect(nc1.nextState.useNewClient).toBe(true);
    expect(nc1.nextState.draft.new_client?.name).toBe("Pepe Serrano");

    const nc2 = await patchQuoteDraftByVoice(
      nc1.nextState,
      "Teléfono 611223344, NIF 12345678Z, dirección calle Sol 8",
      { executor }
    );
    expect(nc2.nextState.draft.new_client?.name).toBe("Pepe Serrano");
    expect(nc2.nextState.draft.new_client?.phone).toBe("+34611223344");
    expect(nc2.nextState.draft.new_client?.nif).toBe("12345678Z");
    expect(nc2.nextState.draft.new_client?.fiscal_address).toBe("calle Sol 8");
  });

  it("parchea incrementalmente Factura Gate 3 y Compartir Gate 4", async () => {
    const g3: Gate3InvoiceDraftPayload = {
      sub_intent: "final_invoice",
      quote_id: "q_1",
      job_id: "j_1",
      issued_at_iso: "2026-11-23",
      due_at_iso: "2026-12-23",
      emitter_name: "Reformas Demo",
      emitter_nif: "12345678Z",
      emitter_fiscal_address: "C/ Emisor 1, Madrid",
      client_id: "c_1",
      client_nif: "",
      client_fiscal_address: "",
      notes: "",
    };

    const g3r1 = await patchInvoiceGate3ByVoice(
      g3,
      "NIF cliente 45891234R, domicilio fiscal Av. Libertad 4, Madrid",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(g3r1.nextState.client_nif).toBe("45891234R");
    expect(g3r1.nextState.client_fiscal_address).toBe("Av. Libertad 4, Madrid");

    const g3r2 = await patchInvoiceGate3ByVoice(
      g3r1.nextState,
      "Vencimiento a 15 días, notas: pago por transferencia",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(g3r2.nextState.due_at_iso).toBe("2026-12-08");
    expect(g3r2.nextState.notes).toBe("pago por transferencia");
    expect(g3r2.nextState.client_nif).toBe("45891234R");

    const g4: Gate4ShareDraftPayload = {
      document_kind: "invoice",
      document_id: "inv_1",
      channel: "share_sheet",
      recipient_phone: "",
      message_text: "Hola, te adjunto la factura.",
    };
    const g4r1 = await patchShareGate4ByVoice(
      g4,
      "Por WhatsApp al 655 44 33 22, añade al mensaje Un saludo cordial",
      { executor }
    );
    expect(g4r1.nextState.channel).toBe("whatsapp");
    expect(g4r1.nextState.recipient_phone).toBe("+34655443322");
    expect(g4r1.nextState.message_text).toBe("Hola, te adjunto la factura. Un saludo cordial");
  });

  it("parchea Agenda/Parte Diario, Citas y Horario Habitual por múltiples audios", async () => {
    const schedState = {
      mode: "daily_log" as const,
      selectedJobId: "",
      dateIso: REF_DATE,
      startDateIso: REF_DATE,
      endDateIso: REF_DATE,
      deltaThousandths: 0,
      reason: "Imprevisto en instalación",
      notes: "",
      alsoLogInSiteLogs: true,
    };

    // Salida por hora exacta ("salí a las 18:30" frente a 17:00 prevista -> +1.5h = +1500)
    const sr1 = await patchScheduleWidgetByVoice(
      schedState,
      "17:00",
      "Salí a las 18:30 por falta de material",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(sr1.nextState.deltaThousandths).toBe(1500);
    expect(sr1.nextState.reason).toBe("Falta de material");

    // Cambio a planificación de rango
    const sr2 = await patchScheduleWidgetByVoice(
      sr1.nextState,
      "17:00",
      "Planifica del 24 al 30 de este mes",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(sr2.nextState.mode).toBe("plan_range");
    expect(sr2.nextState.startDateIso).toBe("2026-11-24");
    expect(sr2.nextState.endDateIso).toBe("2026-11-30");

    // Modal Añadir Cita
    const appt = await patchCalendarAppointmentByVoice(
      { jobId: "", dateIso: REF_DATE, start: "08:00", end: "17:00", notes: "" },
      "Mañana de 9 a 13:30, nota: visita medición",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(appt.nextState.dateIso).toBe("2026-11-24");
    expect(appt.nextState.start).toBe("09:00");
    expect(appt.nextState.end).toBe("13:30");
    expect(appt.nextState.notes).toBe("visita medición");

    // Horario Habitual de Trabajo
    const defaults: WorkScheduleDefaults = {
      work_days: [1, 2, 3, 4, 5],
      morning_start: "08:00",
      morning_end: "14:00",
      afternoon_start: "15:00",
      afternoon_end: "17:00",
      auto_apply_to_jobs: true,
    };
    const ws1 = await patchWorkScheduleDefaultsByVoice(
      defaults,
      "De lunes a sábado, mañanas de 8 a 14 y tardes de 15 a 18",
      { executor }
    );
    expect(ws1.nextState.work_days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ws1.nextState.afternoon_end).toBe("18:00");

    const ws2 = await patchWorkScheduleDefaultsByVoice(
      ws1.nextState,
      "Jornada continua de 8 a 15",
      { executor }
    );
    expect(ws2.nextState.morning_start).toBe("08:00");
    expect(ws2.nextState.morning_end).toBe("15:00");
    expect(ws2.nextState.afternoon_start).toBe("15:00");
    expect(ws2.nextState.afternoon_end).toBe("15:00");
    expect(ws2.nextState.work_days).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("parchea Tickets (desglose inverso IVA), Clientes, Diario, Nueva Obra y Partida", async () => {
    const tkt: Gate2TicketDraftPayload = {
      supplier_name: "",
      supplier_nif: "",
      issue_date_iso: REF_DATE,
      quarter: "2026-T4",
      base_cents: 0,
      vat_rate: 21,
      vat_cents: 0,
      total_cents: 0,
      ocr_confidence: 0,
      job_id: null,
      category: "materiales",
      media_uri: null,
    };
    const tr1 = await patchTicketDraftByVoice(
      tkt,
      "Proveedor Ferretería El Martillo, total 121 euros, categoría herramientas",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(tr1.nextState.supplier_name).toBe("Ferretería El Martillo");
    expect(tr1.nextState.total_cents).toBe(12100);
    expect(tr1.nextState.base_cents).toBe(10000);
    expect(tr1.nextState.vat_cents).toBe(2100);
    expect(tr1.nextState.category).toBe("herramientas");

    const tr2 = await patchTicketDraftByVoice(tr1.nextState, "IVA al 10%", {
      executor,
      referenceDateIso: REF_DATE,
    });
    expect(tr2.nextState.vat_rate).toBe(10);
    expect(tr2.nextState.base_cents + tr2.nextState.vat_cents).toBe(12100);

    // Cliente
    const clRes = await patchClientProfileByVoice(
      { name: "Laura", phone: "", nif: "", fiscalAddress: "", email: "", notes: "" },
      "Teléfono 600112233, NIF 99999999A, correo laura arroba obra punto es",
      { executor }
    );
    expect(clRes.nextState.name).toBe("Laura");
    expect(clRes.nextState.phone).toBe("+34600112233");
    expect(clRes.nextState.email).toBe("laura@obra.es");
    expect(clRes.warnings.length).toBe(1); // NIF inválido detectado

    // Diario de obra
    const slRes = await patchSiteLogByVoice(
      {
        selectedJobId: "",
        createNewJob: false,
        newJobTitle: "",
        newJobAddress: "",
        category: "nota",
        noteText: "",
      },
      "Categoría después, alicatado completado",
      { executor }
    );
    expect(slRes.nextState.category).toBe("despues");
    expect(slRes.nextState.noteText).toContain("alicatado completado");

    // Nueva obra
    const jobRes = await patchNewJobByVoice(
      { title: "", address: "", clientId: "", startDate: "", endDate: "" },
      "Título de la obra: Reforma terraza, dirección calle Velázquez 18, del 24 al 29 de este mes",
      { executor, referenceDateIso: REF_DATE }
    );
    expect(jobRes.nextState.title).toBe("Reforma terraza");
    expect(jobRes.nextState.address).toBe("calle Velázquez 18");
    expect(jobRes.nextState.startDate).toBe("2026-11-24");
    expect(jobRes.nextState.endDate).toBe("2026-11-29");

    // Partida tarifario
    const catRes = await patchCatalogItemByVoice(
      {
        desc: "",
        cat: "General",
        unit: "ud",
        mode: "hourly_plus_materials",
        hoursInput: "1",
        materialsInput: "0.00",
        fixedPriceInput: "38.00",
        vatInput: "21",
      },
      "Descripción Pintura plástica, categoría pintura, en m2, precio fijo 14 euros, IVA 10%",
      { executor }
    );
    expect(catRes.nextState.desc).toBe("Pintura plástica");
    expect(catRes.nextState.cat).toBe("Pintura");
    expect(catRes.nextState.unit).toBe("m2");
    expect(catRes.nextState.mode).toBe("fixed");
    expect(catRes.nextState.fixedPriceInput).toBe("14.00");
    expect(catRes.nextState.vatInput).toBe("10");
  });

  it("usa fallback LLM local opcional cuando determinista no detecta cambios e ignora JSON inválido", async () => {
    const adapterOk = new LocalInferenceAdapterImpl(async () =>
      JSON.stringify({ job_title: "Reforma integral cocina", vat_rate: 10 })
    );
    const resOk = await patchQuoteDraftByVoice(
      {
        draft: {
          quote_id: null,
          client_id: null,
          job_id: null,
          job_title: "",
          vat_rate: 21,
          notes: "",
          lines: [],
        },
        useNewClient: false,
      },
      "esto es para una cocina completa con impuesto reducido",
      { executor, inferenceAdapter: adapterOk }
    );
    expect(resOk.engineUsed).toBe("mediapipe_local_llm");
    expect(resOk.nextState.draft.job_title).toBe("Reforma integral cocina");
    expect(resOk.nextState.draft.vat_rate).toBe(10);

    const adapterBad = new LocalInferenceAdapterImpl(async () => "no es json valido");
    const resBad = await patchQuoteDraftByVoice(
      {
        draft: {
          quote_id: null,
          client_id: null,
          job_id: null,
          job_title: "Original",
          vat_rate: 21,
          notes: "",
          lines: [],
        },
        useNewClient: false,
      },
      "frase ambigua sin campos",
      { executor, inferenceAdapter: adapterBad }
    );
    expect(resBad.changed).toBe(false);
    expect(resBad.nextState.draft.job_title).toBe("Original");
  });
});
