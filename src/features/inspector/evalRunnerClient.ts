import type { EvalSuiteReport } from "../../core/contracts/types";

export function runOnDeviceEvalsSuite(): Promise<EvalSuiteReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../workers/evals.worker.ts", import.meta.url), {
      type: "module",
    });
    const reqId = Date.now();

    worker.onmessage = (
      ev: MessageEvent<{ id: number; ok: boolean; report?: EvalSuiteReport; message?: string }>
    ) => {
      if (ev.data?.id !== reqId) return;
      worker.terminate();
      if (ev.data.ok && ev.data.report) {
        resolve(ev.data.report);
      } else {
        reject(new Error(ev.data.message ?? "Error ejecutando Suite de Evals offline"));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "Fallo en evals.worker.ts"));
    };

    worker.postMessage({ id: reqId, op: "run" });
  });
}
