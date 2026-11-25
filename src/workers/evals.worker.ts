import contractsAndSeed from "../../docs/03_CONTRATOS_API_Y_SEED.json";
import { ensureBrowserAsyncLocalStorageInitialized } from "../agent/asyncLocalStoragePolyfill";
import { GraphRunner } from "../agent/graphRunner";
import { LocalInferenceAdapterImpl } from "../agent/inference/localInferenceAdapter";
import { ResetService } from "../core/backup/resetService";
import {
  Gate1QuoteCommitPayloadSchema,
  Gate3InvoiceCommitPayloadSchema,
} from "../core/contracts/schemas";
import type { EvalCaseResult, EvalSuiteReport } from "../core/contracts/types";
import { InMemorySqliteExecutor } from "../core/db/memorySqliteExecutor";
import { CatalogRepository } from "../core/db/repositories/catalogRepo";
import { JobsRepository } from "../core/db/repositories/jobsRepo";
import { TracesRepository } from "../core/db/repositories/tracesRepo";
import { initializeSchema, sanitizeFts5Query } from "../core/db/sqliteExecutor";
import { MemoryFileBridge } from "../core/files/memoryFileBridge";
import {
  computeAdvance40,
  computeFinalInvoiceFromQuoteAndAdvance,
  computeLineSubtotalCents,
  computeQuoteTotals,
  isTicketWithinTolerance,
  roundHalfUpDiv,
} from "../core/fiscal/fiscalEngine";
import { LocalMemoryCoordinator } from "../core/memory/memoryCoordinator";
import type { OcrPort, PdfPort } from "../core/ports/mediaPorts";

ensureBrowserAsyncLocalStorageInitialized();

const workerOcrMock: OcrPort = {
  async extractTicketText() {
    return {
      rawText: "OBRAMAT SL\nNIF B85296341\nBASE 100,00\nIVA 21%: 21,00\nTOTAL 121,00",
      parsed: {
        supplierName: "Obramat Worker Eval",
        supplierNif: "B85296341",
        issueDateIso: "2026-11-18",
        vatRate: 21,
        baseCents: 10000,
        vatCents: 2100,
        totalCents: 12100,
      },
      confidence: 90,
    };
  },
  async extractRawTextBatch(images) {
    return images.map(() => ({
      rawText: "OBRAMAT SL\nNIF B85296341\nBASE 100,00\nIVA 21%: 21,00\nTOTAL 121,00",
      confidence: 90,
    }));
  },
};

const workerPdfMock: PdfPort = {
  async buildDocumentPdf(input) {
    const label =
      input.kind === "quote"
        ? input.quoteCode
        : input.kind === "invoice"
          ? input.invoiceNumber
          : input.kind === "work_order"
            ? input.documentCode
            : input.codigoActa;
    return {
      pdfBytes: new TextEncoder().encode(`%PDF-1.4\n%EVAL ${label}\n%%EOF`),
      fileName: `${label}.pdf`,
    };
  },
};

async function runEvalSuite(): Promise<EvalSuiteReport> {
  const startedAt = Date.now();
  const results: EvalCaseResult[] = [];
  const executor = await InMemorySqliteExecutor.create();

  try {
    await initializeSchema(executor);
    const resetService = new ResetService(executor);
    await resetService.restoreDemoData({ freezeDemoGates: async () => {} });

    const fixtures = contractsAndSeed.onDeviceEvalFixtures;

    // 1. Casos fiscales deterministas
    for (const fc of fixtures.fiscalCases) {
      if (fc.id === "eval_fiscal_adv_40_10") {
        const inp = fc.input as { base_cents: number; vat_rate: 10 | 21 };
        const exp = fc.expected as {
          advance_base_cents: number;
          advance_vat_cents: number;
          final_base_cents: number;
          final_vat_cents: number;
          total_sum_cents: number;
        };
        const quoteVat = roundHalfUpDiv(inp.base_cents * inp.vat_rate, 100);
        const adv = computeAdvance40(inp.base_cents, inp.vat_rate);
        const fin = computeFinalInvoiceFromQuoteAndAdvance(
          inp.base_cents,
          quoteVat,
          adv.baseCents,
          adv.vatCents
        );
        const ok =
          adv.baseCents === exp.advance_base_cents &&
          adv.vatCents === exp.advance_vat_cents &&
          fin.baseCents === exp.final_base_cents &&
          fin.vatCents === exp.final_vat_cents &&
          adv.totalCents + fin.totalCents === exp.total_sum_cents;
        results.push({
          id: fc.id,
          category: "fiscal",
          passed: ok,
          details: ok
            ? `ANT ${adv.totalCents}c + FAC ${fin.totalCents}c = ${exp.total_sum_cents}c`
            : `Desajuste ANT/FAC`,
        });
      } else if (fc.id === "eval_fiscal_half_up") {
        const inp = fc.input as {
          qty_thousandths: number;
          unit_price_cents: number;
          vat_rate: 10 | 21;
        };
        const exp = fc.expected as {
          line_base_cents: number;
          vat_cents: number;
          total_cents: number;
        };
        const lineBase = computeLineSubtotalCents(inp.qty_thousandths, inp.unit_price_cents);
        const totals = computeQuoteTotals(
          [{ quantity_thousandths: inp.qty_thousandths, unit_price_cents: inp.unit_price_cents }],
          inp.vat_rate
        );
        const ok =
          lineBase === exp.line_base_cents &&
          totals.vatCents === exp.vat_cents &&
          totals.totalCents === exp.total_cents;
        results.push({
          id: fc.id,
          category: "fiscal",
          passed: ok,
          details: `Base ${lineBase}c · IVA ${totals.vatCents}c · Total ${totals.totalCents}c`,
        });
      } else if (fc.id === "eval_fiscal_iva_compensar") {
        const inp = fc.input as {
          iva_repercutido_cents: number;
          iva_soportado_cents: number;
          base_facturada_q: number;
          base_gastos_q: number;
        };
        const exp = fc.expected as {
          iva_to_reserve_cents: number;
          iva_to_compensate_cents: number;
          irpf_20_cents: number;
          untouchable_tax_cents: number;
        };
        const ivaReserve = Math.max(0, inp.iva_repercutido_cents - inp.iva_soportado_cents);
        const ivaComp = Math.max(0, inp.iva_soportado_cents - inp.iva_repercutido_cents);
        const netYield = Math.max(0, inp.base_facturada_q - inp.base_gastos_q);
        const irpf = roundHalfUpDiv(netYield * 20, 100);
        const untouchable = ivaReserve + irpf;
        const ok =
          ivaReserve === exp.iva_to_reserve_cents &&
          ivaComp === exp.iva_to_compensate_cents &&
          irpf === exp.irpf_20_cents &&
          untouchable === exp.untouchable_tax_cents;
        results.push({
          id: fc.id,
          category: "fiscal",
          passed: ok,
          details: `Compensar ${ivaComp}c · Reserva intocable ${untouchable}c`,
        });
      } else if (fc.id === "eval_ocr_tolerance_2_cents") {
        const inp = fc.input as { base_cents: number; vat_cents: number; total_cents: number };
        const exp = fc.expected as { valid: boolean; diff_cents: number };
        const diff = Math.abs(inp.base_cents + inp.vat_cents - inp.total_cents);
        const ok = isTicketWithinTolerance(inp.base_cents, inp.vat_cents, inp.total_cents) === exp.valid && diff === exp.diff_cents;
        results.push({
          id: fc.id,
          category: "fiscal",
          passed: ok,
          details: `Diferencia ${diff}c <= 2c (${ok ? "válida" : "inválida"})`,
        });
      }
    }

    // 2. Casos RAG FTS5 y Parser/Graph
    const jobsRepo = new JobsRepository(executor);
    const catalogRepo = new CatalogRepository(executor);
    const runner = new GraphRunner(
      {
        executor,
        fileBridge: new MemoryFileBridge(),
        memoryCoordinator: new LocalMemoryCoordinator(),
        inference: new LocalInferenceAdapterImpl(),
        ocrPort: workerOcrMock,
        pdfPort: workerPdfMock,
        traceRecorder: new TracesRepository(executor),
      },
      "memory"
    );

    for (const pr of fixtures.parserAndRagCases) {
      if (pr.id === "eval_rag_sanitized_code") {
        const c = pr as {
          id: string;
          rawQuery: string;
          expectedSanitizedQuery: string;
          expectedTopJobId: string;
        };
        const sanitized = sanitizeFts5Query(c.rawQuery);
        const hits = await jobsRepo.searchFts5WithScore(c.rawQuery, 5);
        const ok = sanitized === c.expectedSanitizedQuery && hits[0]?.id === c.expectedTopJobId;
        results.push({
          id: c.id,
          category: "rag",
          passed: ok,
          details: `Sanitizado '${sanitized}' -> top '${hits[0]?.id ?? "none"}'`,
        });
      } else if (
        pr.id === "eval_rag_diacritics_termo" ||
        pr.id === "eval_rag_diacritics_alicatado"
      ) {
        const c = pr as { id: string; rawQuery: string; expectedMatchedIds: string[] };
        const hits = await catalogRepo.searchFts5WithScore(c.rawQuery, 5);
        const ids = hits.map((h) => h.id);
        const ok = c.expectedMatchedIds.every((id) => ids.includes(id));
        results.push({
          id: c.id,
          category: "rag",
          passed: ok,
          details: `Hits para '${c.rawQuery}': [${ids.join(", ")}]`,
        });
      } else if (pr.id === "eval_parser_disambiguate_garcia") {
        const c = pr as { id: string; text: string; expectedRoute: string; minCandidates: number };
        const thr = await runner.createThread({ title: "Eval disambiguate" });
        const turn = await runner.runTurn(thr.thread_id, {
          client_turn_id: `eval_${c.id}`,
          text: c.text,
          action_type: "free_text_or_voice",
        });
        const snap = await runner.compiledGraph.getState({
          configurable: { thread_id: thr.thread_id },
        });
        const pd = (snap.values as { pending_disambiguation?: { candidates?: unknown[] } | null })
          .pending_disambiguation;
        const ok =
          turn.checkpoint_status === "idle" &&
          (pd?.candidates?.length ?? 0) >= c.minCandidates;
        results.push({
          id: c.id,
          category: "graph",
          passed: ok,
          details: `Candidatos García: ${pd?.candidates?.length ?? 0}`,
        });
      } else if (pr.id === "eval_multiturn_qa_context") {
        const c = pr as {
          id: string;
          active_job_id: string;
          text: string;
          mustContainTextFragments: string[];
        };
        const thr = await runner.createThread({
          title: "Eval QA",
          active_job_id: c.active_job_id,
        });
        const turn = await runner.runTurn(thr.thread_id, {
          client_turn_id: `eval_${c.id}`,
          text: c.text,
          action_type: "free_text_or_voice",
          session_context: { active_job_id: c.active_job_id, active_quote_id: null },
        });
        const answer = turn.assistant_message?.content ?? "";
        const ok = c.mustContainTextFragments.every((frag) => answer.includes(frag));
        results.push({
          id: c.id,
          category: "rag",
          passed: ok,
          details: `Respuesta QA: ${answer.slice(0, 90)}`,
        });
      }
    }

    // 3. Contratos Zod estrictos
    const badNifRes = Gate3InvoiceCommitPayloadSchema.safeParse({
      sub_intent: "advance_40",
      quote_id: "quote_01",
      job_id: "job_01",
      issued_at_iso: "2026-11-18",
      due_at_iso: "2026-11-28",
      emitter_name: "Carlos Morales",
      emitter_nif: "99999999A",
      emitter_fiscal_address: "C/ Mayor 1, Madrid",
      client_id: "cli_marta_ruiz",
      client_nif: "39481205A",
      client_fiscal_address: "C/ López de Hoyos 88, Madrid",
      notes: "",
    });
    const badQuoteRes = Gate1QuoteCommitPayloadSchema.safeParse({
      quote_id: null,
      client_id: "cli_javier_garcia",
      new_client: { name: "Duplicado XOR" },
      job_id: null,
      job_title: "Test XOR",
      vat_rate: 10,
      notes: "",
      lines: [],
    });
    const zodOk = !badNifRes.success && !badQuoteRes.success;
    results.push({
      id: "eval_zod_strict_commit_guards",
      category: "zod",
      passed: zodOk,
      details: zodOk
        ? "Rechaza dígito control NIF inválido y violación XOR/líneas vacías"
        : "Fallo validando Zod estricto",
    });

    // 4. Ciclo HITL completo en :memory: (Gate 1 interrupt + resume approve)
    const hitlThr = await runner.createThread({ title: "Eval HITL Cycle" });
    const pre = await runner.runTurn(hitlThr.thread_id, {
      client_turn_id: "eval_hitl_1",
      text: "Presupuesto para Marta Ruiz: 1 termo eléctrico 80L IVA 10%",
      action_type: "free_text_or_voice",
    });
    let hitlOk = pre.checkpoint_status === "interrupted" && pre.active_interrupt?.gate_id === "gate_1_quote";
    if (hitlOk) {
      const post = await runner.resumeGate(hitlThr.thread_id, {
        gate_id: "gate_1_quote",
        action: "approve",
        client_validated_at_ms: Date.now(),
      });
      hitlOk = post.checkpoint_status === "idle" && post.error_code === null;
    }
    results.push({
      id: "eval_graph_hitl_interrupt_resume",
      category: "graph",
      passed: hitlOk,
      details: hitlOk ? "Gate 1 pause -> resume approve en :memory: OK" : "Fallo en ciclo HITL",
    });
  } finally {
    await executor.close();
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return {
    executed_at_ms: Date.now(),
    total_cases: results.length,
    passed,
    failed,
    duration_ms: Math.max(1, Date.now() - startedAt),
    cloud_cost_eur: 0,
    results,
  };
}

self.onmessage = async (ev: MessageEvent<{ id: number; op: "run" }>) => {
  if (ev.data?.op !== "run") return;
  try {
    const report = await runEvalSuite();
    self.postMessage({ id: ev.data.id, ok: true, report });
  } catch (err) {
    self.postMessage({
      id: ev.data.id,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
