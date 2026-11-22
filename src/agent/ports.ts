export type {
  LocalInferenceAdapter,
  OcrPort,
  PdfBuildInput,
  PdfInvoiceDocumentInput,
  PdfPort,
  PdfQuoteDocumentInput,
  SeedOverrides,
  TraceRecorder,
  WatermarkPort,
} from "../core/ports/mediaPorts";

import type { LocalFileBridge, MemoryCoordinator, SqliteExecutor } from "../core/contracts/types";
import type {
  LocalInferenceAdapter,
  OcrPort,
  PdfPort,
  SeedOverrides,
  TraceRecorder,
} from "../core/ports/mediaPorts";

export interface GraphDependencies {
  executor: SqliteExecutor;
  fileBridge: LocalFileBridge;
  memoryCoordinator: MemoryCoordinator;
  inference: LocalInferenceAdapter;
  ocrPort: OcrPort;
  pdfPort: PdfPort;
  traceRecorder: TraceRecorder;
}

export interface GraphConfigurable {
  thread_id?: string;
  checkpoint_ns?: string;
  checkpoint_id?: string;
  seed_override?: SeedOverrides;
}

export function getSeedOverride(
  config?: { configurable?: Record<string, unknown> }
): SeedOverrides | undefined {
  return (config?.configurable as GraphConfigurable | undefined)?.seed_override;
}

export function getThreadIdFromConfig(
  config?: { configurable?: Record<string, unknown> }
): string {
  const tid = (config?.configurable as GraphConfigurable | undefined)?.thread_id;
  return typeof tid === "string" && tid.length > 0 ? tid : "unknown_thread";
}
