import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphRunner } from "../src/agent/graphRunner";
import {
  DeterministicSpanishParser,
  extractClientFieldsFromText,
  parseQuoteLinesAndMeta,
} from "../src/agent/inference/deterministicSpanishParser";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { TracesRepository } from "../src/core/db/repositories/tracesRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { MemoryCoordinatorNoop } from "../src/core/memory/memoryCoordinator";
import { MockFreezerPort, MockOcrPort, MockPdfPort } from "./mocks/ports";

describe("Asistente Conversacional Offline y Completado Guiado (Slot-Filling)", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let tracesRepo: TracesRepository;
  let runner: GraphRunner;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    await new ResetService(executor).restoreDemoData(new MockFreezerPort());
    fileBridge = new MemoryFileBridge();
    tracesRepo = new TracesRepository(executor);

    runner = new GraphRunner(
      {
        executor,
        fileBridge,
        memoryCoordinator: new MemoryCoordinatorNoop(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: new MockOcrPort(),
        pdfPort: new MockPdfPort(),
        traceRecorder: tracesRepo,
      },
      "memory"
    );
  });

  afterEach(async () => {
    await executor.close();
  });

  it("limpia saludos y frases de intención en el parser para no generar líneas ni clientes basura", () => {
    const parser = new DeterministicSpanishParser();

    const emptyQuoteIntent = parser.parse("Hola, quiero generar un presupuesto");
    expect(emptyQuoteIntent.intent).toBe("quote_specialist");
    expect(emptyQuoteIntent.entities.client_query).toBeNull();
    expect(emptyQuoteIntent.entities.quote_lines).toEqual([]);

    const parsedMeta = parseQuoteLinesAndMeta("Hola, quiero generar un presupuesto, por favor");
    expect(parsedMeta.client_query).toBeNull();
    expect(parsedMeta.lines).toEqual([]);

    const falseClient = parseQuoteLinesAndMeta("Presupuesto para una reforma de baño: 1 plato de ducha");
    expect(falseClient.client_query).toBeNull();
    expect(falseClient.job_title_hint).toBe("Reforma de baño");
    expect(falseClient.lines).toHaveLength(1);
    expect(falseClient.lines[0]?.description).toBe("plato de ducha");

    const emptyClient = extractClientFieldsFromText("Hola, quiero dar de alta un cliente");
    expect(emptyClient.name).toBeNull();
    expect(emptyClient.phone).toBeNull();
  });

  it("responde a preguntas sobre capacidades de la app, saludos y agradecimientos sin abrir widgets", async () => {
    const thr = await runner.createThread({ title: "Ayuda y charla" });

    const helpTurn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_help_1",
      text: "¿Qué puedes hacer con la app?",
      action_type: "free_text_or_voice",
    });
    expect(helpTurn.checkpoint_status).toBe("idle");
    expect(helpTurn.active_widget).toBeNull();
    expect(helpTurn.assistant_message?.content).toContain("Presupuestos");
    expect(helpTurn.assistant_message?.content).toContain("Hucha Fiscal");
    expect(helpTurn.assistant_message?.content).toContain("faltan datos");

    const quoteHelpTurn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_help_2",
      text: "¿Cómo hago un presupuesto?",
      action_type: "free_text_or_voice",
    });
    expect(quoteHelpTurn.checkpoint_status).toBe("idle");
    expect(quoteHelpTurn.active_widget).toBeNull();
    expect(quoteHelpTurn.assistant_message?.content).toContain("cliente");
    expect(quoteHelpTurn.assistant_message?.content).toContain("partidas");

    const greetTurn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_greet_1",
      text: "Hola, buenos días",
      action_type: "free_text_or_voice",
    });
    expect(greetTurn.checkpoint_status).toBe("idle");
    expect(greetTurn.active_widget).toBeNull();
    expect(greetTurn.quick_actions).toBeNull();
    expect(greetTurn.assistant_message?.content).toContain("Gestor Autónomo");

    const thanksTurn = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_thanks_1",
      text: "Muchas gracias",
      action_type: "free_text_or_voice",
    });
    expect(thanksTurn.checkpoint_status).toBe("idle");
    expect(thanksTurn.assistant_message?.content).toContain("De nada");
  });

  it("en 'Hola, quiero generar un presupuesto' pide datos faltantes en vez de abrir borrador literal, y completa en el turno 2", async () => {
    const thr = await runner.createThread({ title: "Presupuesto guiado 2 turnos" });

    const t1 = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_q_missing_1",
      text: "Hola, quiero generar un presupuesto",
      action_type: "free_text_or_voice",
    });
    expect(t1.checkpoint_status).toBe("idle");
    expect(t1.active_interrupt).toBeNull();
    expect(t1.active_widget).toBeNull();
    expect(t1.assistant_message?.content).toContain("faltan");
    expect(t1.assistant_message?.content).toContain("cliente");
    expect(t1.quick_actions?.some((qa) => qa.action_type === "start_empty_quote")).toBe(true);

    const t2 = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_q_missing_2",
      text: "Para Elena García: 1 termo eléctrico 80L",
      action_type: "free_text_or_voice",
    });
    expect(t2.checkpoint_status).toBe("interrupted");
    expect(t2.active_interrupt?.gate_id).toBe("gate_1_quote");
    if (t2.active_interrupt?.gate_id === "gate_1_quote") {
      expect(t2.active_interrupt.proposed_payload.client_id).toBe("cli_elena_garcia");
      expect(t2.active_interrupt.proposed_payload.job_title).toBe(
        "Presupuesto trabajos Elena García Martín"
      );
      expect(t2.active_interrupt.proposed_payload.lines).toHaveLength(1);
      expect(t2.active_interrupt.proposed_payload.lines[0]?.description).toContain("Termo");
    }
  });

  it("completa presupuesto incrementalmente en 3 turnos (intención -> cliente -> partidas) y soporta desambiguación + slot-fill", async () => {
    const thr = await runner.createThread({ title: "Presupuesto guiado 3 turnos" });

    const t1 = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_3step_1",
      text: "Quiero hacer un presupuesto",
      action_type: "free_text_or_voice",
    });
    expect(t1.checkpoint_status).toBe("idle");
    expect(t1.active_widget).toBeNull();

    const t2 = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_3step_2",
      text: "Elena García",
      action_type: "free_text_or_voice",
    });
    expect(t2.checkpoint_status).toBe("idle");
    expect(t2.active_widget).toBeNull();
    expect(t2.assistant_message?.content).toContain("Elena García");
    expect(t2.assistant_message?.content).toContain("partidas");

    const t3 = await runner.runTurn(thr.thread_id, {
      client_turn_id: "t_3step_3",
      text: "2 puntos de luz a 45 euros",
      action_type: "free_text_or_voice",
    });
    expect(t3.checkpoint_status).toBe("interrupted");
    expect(t3.active_interrupt?.gate_id).toBe("gate_1_quote");
    if (t3.active_interrupt?.gate_id === "gate_1_quote") {
      expect(t3.active_interrupt.proposed_payload.client_id).toBe("cli_elena_garcia");
      expect(t3.active_interrupt.proposed_payload.lines).toHaveLength(1);
      expect(t3.active_interrupt.proposed_payload.lines[0]?.quantity_thousandths).toBe(2000);
      expect(t3.active_interrupt.proposed_payload.lines[0]?.unit_price_cents).toBe(4500);
    }

    // Caso con desambiguación previa: "Presupuesto para García" -> "Javier" -> "1 termo eléctrico 80L"
    const thrDis = await runner.createThread({ title: "Desambiguación + slot-fill" });
    const d1 = await runner.runTurn(thrDis.thread_id, {
      client_turn_id: "t_dis_slot_1",
      text: "Presupuesto para García",
      action_type: "free_text_or_voice",
    });
    expect(d1.checkpoint_status).toBe("idle");
    expect(d1.quick_actions?.some((qa) => qa.action_type === "resolve_disambiguation")).toBe(true);

    const d2 = await runner.runTurn(thrDis.thread_id, {
      client_turn_id: "t_dis_slot_2",
      text: "Javier",
      action_type: "free_text_or_voice",
    });
    expect(d2.checkpoint_status).toBe("idle");
    expect(d2.active_widget).toBeNull();
    expect(d2.assistant_message?.content).toContain("Javier García");

    const d3 = await runner.runTurn(thrDis.thread_id, {
      client_turn_id: "t_dis_slot_3",
      text: "1 termo eléctrico 80L",
      action_type: "free_text_or_voice",
    });
    expect(d3.checkpoint_status).toBe("interrupted");
    expect(d3.active_interrupt?.gate_id).toBe("gate_1_quote");
    if (d3.active_interrupt?.gate_id === "gate_1_quote") {
      expect(d3.active_interrupt.proposed_payload.client_id).toBe("cli_javier_garcia");
      expect(d3.active_interrupt.proposed_payload.lines).toHaveLength(1);
    }
  });

  it("Opción A: abre QuoteBuilderWidget si ya trae partidas reales sin cliente, y evita falsos clientes en reforma", async () => {
    const thr1 = await runner.createThread({ title: "Opción A sin cliente" });
    const q1 = await runner.runTurn(thr1.thread_id, {
      client_turn_id: "t_opta_1",
      text: "Presupuesto: 2 puntos de luz a 45 euros",
      action_type: "free_text_or_voice",
    });
    expect(q1.checkpoint_status).toBe("interrupted");
    expect(q1.active_interrupt?.gate_id).toBe("gate_1_quote");
    expect(q1.assistant_message?.content).toContain("falta seleccionar o crear el cliente");
    if (q1.active_interrupt?.gate_id === "gate_1_quote") {
      expect(q1.active_interrupt.proposed_payload.client_id).toBeNull();
      expect(q1.active_interrupt.proposed_payload.job_title).toBe("Nuevo presupuesto de obra");
      expect(q1.active_interrupt.proposed_payload.lines).toHaveLength(1);
    }

    const thr2 = await runner.createThread({ title: "Reforma sin falso cliente" });
    const q2 = await runner.runTurn(thr2.thread_id, {
      client_turn_id: "t_opta_2",
      text: "Presupuesto para una reforma de baño: 1 plato de ducha",
      action_type: "free_text_or_voice",
    });
    expect(q2.checkpoint_status).toBe("interrupted");
    if (q2.active_interrupt?.gate_id === "gate_1_quote") {
      expect(q2.active_interrupt.proposed_payload.client_id).toBeNull();
      expect(q2.active_interrupt.proposed_payload.new_client).toBeUndefined();
      expect(q2.active_interrupt.proposed_payload.job_title).toBe("Reforma de baño");
      expect(q2.active_interrupt.proposed_payload.lines).toHaveLength(1);
    }
  });

  it("permite cancelar, cambiar de tema o abrir presupuesto vacío durante slot-fill pendiente", async () => {
    const thrCancel = await runner.createThread({ title: "Cancelar slot-fill" });
    await runner.runTurn(thrCancel.thread_id, {
      client_turn_id: "t_sc_1",
      text: "Hola, quiero generar un presupuesto",
      action_type: "free_text_or_voice",
    });
    const cancelled = await runner.runTurn(thrCancel.thread_id, {
      client_turn_id: "t_sc_2",
      text: "déjalo",
      action_type: "free_text_or_voice",
    });
    expect(cancelled.checkpoint_status).toBe("idle");
    expect(cancelled.assistant_message?.content).toContain("cancelada");

    const thrSwitch = await runner.createThread({ title: "Cambio tema slot-fill" });
    const s1 = await runner.runTurn(thrSwitch.thread_id, {
      client_turn_id: "t_sw_1",
      text: "Quiero hacer un presupuesto",
      action_type: "free_text_or_voice",
    });
    const emptyAction = s1.quick_actions?.find((q) => q.action_type === "start_empty_quote");
    expect(emptyAction).toBeTruthy();

    const switched = await runner.runTurn(thrSwitch.thread_id, {
      client_turn_id: "t_sw_2",
      text: "Enséñame la hucha fiscal",
      action_type: "free_text_or_voice",
    });
    expect(switched.active_widget?.ui_widget_type).toBe("FiscalPiggyBankWidget");

    const thrBtn = await runner.createThread({ title: "Botón abrir vacío" });
    await runner.runTurn(thrBtn.thread_id, {
      client_turn_id: "t_btn_1",
      text: "Quiero hacer un presupuesto",
      action_type: "free_text_or_voice",
    });
    const openedEmpty = await runner.runTurn(thrBtn.thread_id, {
      client_turn_id: "t_btn_2",
      text: "",
      action_type: "start_empty_quote",
    });
    expect(openedEmpty.checkpoint_status).toBe("interrupted");
    expect(openedEmpty.active_interrupt?.gate_id).toBe("gate_1_quote");
  });

  it("gestiona datos faltantes en tickets, alta de clientes y diario de obra sin texto basura", async () => {
    // 1. Ticket multi-turno
    const thrTicket = await runner.createThread({ title: "Ticket slot-fill" });
    const tk1 = await runner.runTurn(thrTicket.thread_id, {
      client_turn_id: "t_tk_1",
      text: "Quiero apuntar un gasto",
      action_type: "free_text_or_voice",
    });
    expect(tk1.checkpoint_status).toBe("idle");
    expect(tk1.active_widget).toBeNull();
    expect(tk1.assistant_message?.content).toContain("proveedor");
    expect(tk1.quick_actions?.some((q) => q.action_type === "manual_ticket_entry")).toBe(true);

    const tk2 = await runner.runTurn(thrTicket.thread_id, {
      client_turn_id: "t_tk_2",
      text: "Obramat, 60 euros",
      action_type: "free_text_or_voice",
    });
    expect(tk2.checkpoint_status).toBe("interrupted");
    expect(tk2.active_interrupt?.gate_id).toBe("gate_2_ticket");
    if (tk2.active_interrupt?.gate_id === "gate_2_ticket") {
      expect(tk2.active_interrupt.proposed_payload.supplier_name).toBe("Obramat");
      expect(tk2.active_interrupt.proposed_payload.total_cents).toBe(6000);
    }

    // 2. Alta cliente multi-turno
    const thrCli = await runner.createThread({ title: "Cliente slot-fill" });
    const cl1 = await runner.runTurn(thrCli.thread_id, {
      client_turn_id: "t_cl_1",
      text: "Hola, quiero dar de alta un cliente",
      action_type: "free_text_or_voice",
    });
    expect(cl1.checkpoint_status).toBe("idle");
    expect(cl1.active_widget).toBeNull();
    expect(cl1.assistant_message?.content).toContain("nombre");
    expect(cl1.quick_actions?.some((q) => q.action_type === "start_empty_client")).toBe(true);

    const cl2 = await runner.runTurn(thrCli.thread_id, {
      client_turn_id: "t_cl_2",
      text: "Laura Méndez, teléfono 611223344",
      action_type: "free_text_or_voice",
    });
    expect(cl2.active_widget?.ui_widget_type).toBe("ClientProfileWidget");
    if (cl2.active_widget?.ui_widget_type === "ClientProfileWidget") {
      expect(cl2.active_widget.widget_payload.name).toBe("Laura Méndez");
      expect(cl2.active_widget.widget_payload.phone).toBe("+34611223344");
    }

    // 3. Diario de obra sin contenido -> pide nota real
    const thrLog = await runner.createThread({ title: "Diario slot-fill" });
    const sl1 = await runner.runTurn(thrLog.thread_id, {
      client_turn_id: "t_sl_1",
      text: "Quiero añadir algo al diario de obra",
      action_type: "free_text_or_voice",
    });
    expect(sl1.active_widget).toBeNull();
    expect(sl1.assistant_message?.content).toContain("nota");

    const sl2 = await runner.runTurn(thrLog.thread_id, {
      client_turn_id: "t_sl_2",
      text: "Fontanería empotrada terminada",
      action_type: "free_text_or_voice",
    });
    expect(sl2.active_widget?.ui_widget_type).toBe("SiteLogStampWidget");
    if (sl2.active_widget?.ui_widget_type === "SiteLogStampWidget") {
      expect(sl2.active_widget.widget_payload.note_text).toBe("Fontanería empotrada terminada");
    }
  });
});
