import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PendingCameraContextSchema } from "../src/core/contracts/schemas";
import { ActasRepository } from "../src/core/db/repositories/actasRepo";
import { InvoicesRepository } from "../src/core/db/repositories/invoicesRepo";
import { QuotesRepository } from "../src/core/db/repositories/quotesRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import { DocumentOpenerService } from "../src/core/files/documentOpener";
import { MemoryFileBridge } from "../src/core/files/memoryFileBridge";
import { LocalMemoryCoordinator } from "../src/core/memory/memoryCoordinator";
import { PdfMakeAdapter } from "../src/features/pdf/pdfMakeAdapter";

const VALID_1X1_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const VALID_1X1_PNG_DATA_URL = `data:image/png;base64,${VALID_1X1_PNG_B64}`;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

describe("Fase 3 Actas — Fotos (Process Death), Firma Táctil y PDF A4", () => {
  let executor: NodeBetterSqliteExecutor;
  let fileBridge: MemoryFileBridge;
  let memoryCoordinator: LocalMemoryCoordinator;
  let actasRepo: ActasRepository;
  let pdfPort: PdfMakeAdapter;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    fileBridge = new MemoryFileBridge();
    memoryCoordinator = new LocalMemoryCoordinator();
    actasRepo = new ActasRepository(executor, memoryCoordinator);
    pdfPort = new PdfMakeAdapter(memoryCoordinator);

    await new SettingsRepository(executor).updateInstallerActaProfile({
      emitter_name: "Instalaciones Pro SL",
      emitter_nif: "12345678Z",
      emitter_fiscal_address: "C/ Mayor 22, Madrid",
      emitter_phone: "600112233",
      emitter_email: "tecnico@pro.es",
      emitter_registry_number: "REIE-28-00441",
      emitter_tech_name: "Carlos Gómez",
      emitter_tech_dni: "00000000T",
      emitter_installer_card: "CI-BT-5510",
      emitter_signature_data_url: VALID_1X1_PNG_DATA_URL,
      default_acta_warranty_months: 24,
    });
  });

  afterEach(async () => {
    await executor.close();
  });

  it("compromete fotos en carpeta 'actas/' y valida PendingCameraContext con source 'acta_photo'", async () => {
    const tempUri = await fileBridge.saveTempMedia(base64ToBytes(VALID_1X1_PNG_B64), "png");
    const committedUri = await fileBridge.commitMedia(tempUri, "actas");
    expect(committedUri).toMatch(/^mem:\/\/actas\//);
    expect(fileBridge.has(tempUri)).toBe(false);
    expect(fileBridge.has(committedUri!)).toBe(true);

    const ctx = PendingCameraContextSchema.parse({
      source: "acta_photo",
      thread_id: null,
      active_job_id: "job_1",
      acta_id: "act_1",
      started_at_ms: Date.now(),
    });
    expect(ctx.source).toBe("acta_photo");
    expect(ctx.acta_id).toBe("act_1");
  });

  it("exige firma del cliente para marcar firmada y genera PDF A4 válido para electricidad, fontanería y mixta", async () => {
    const tempPhoto = await fileBridge.saveTempMedia(base64ToBytes(VALID_1X1_PNG_B64), "png");
    const photoUri = (await fileBridge.commitMedia(tempPhoto, "actas"))!;

    for (const esp of ["electricidad", "fontaneria", "mixta"] as const) {
      const created = await actasRepo.createDraftFromContext({
        especialidad: esp,
        fechaEmisionIso: "2026-11-25",
      });

      await expect(
        actasRepo.markSigned(created.row.id, {
          firmaClienteBase64: "   ",
        })
      ).rejects.toThrow(/SCHEMA_VALIDATION_ERROR/);

      const signed = await actasRepo.markSigned(created.row.id, {
        firmaClienteBase64: VALID_1X1_PNG_DATA_URL,
        data: {
          ...created.data,
          alcance_ubicacion: `Prueba integral ${esp} en vivienda 2º B`,
          cliente: {
            nombre_razon_social: "Elena Ruiz",
            nif_cif: "11111111H",
            direccion_emplazamiento: "C/ Velázquez 18, Madrid",
            telefono: "611223344",
          },
          ...(created.data.memoria_electricidad
            ? {
                memoria_electricidad: {
                  ...created.data.memoria_electricidad,
                  circuitos: [{ nombre: "C1 Iluminación", calibre_a: 10, seccion_mm2: 1.5 }],
                },
              }
            : {}),
          ...(created.data.pruebas_fontaneria
            ? {
                pruebas_fontaneria: {
                  ...created.data.pruebas_fontaneria,
                  presion_prueba_bar: 6,
                  duracion_prueba_min: 30,
                  presion_servicio_bar: 3.2,
                  temperatura_consigna_acs_c: 60,
                },
              }
            : {}),
          fotos: [
            {
              id: "foto_1",
              uri: photoUri,
              pie_foto: "Cuadro y llaves de corte",
              timestamp: "2026-11-25T10:30:00Z",
            },
          ],
        },
      });
      expect(signed.row.estado).toBe("firmada");

      const pdfUri = await actasRepo.regeneratePdfOnDemand(created.row.id, pdfPort, fileBridge);
      expect(pdfUri).toContain(`${created.row.codigo_acta}.pdf`);
      const pdfFile = await fileBridge.readAsFile(
        pdfUri,
        `${created.row.codigo_acta}.pdf`,
        "application/pdf"
      );
      const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
      const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
      expect(header).toBe("%PDF-");
      expect(pdfBytes.byteLength).toBeGreaterThan(1500);
    }
  }, 15000);

  it("DocumentOpenerService regenera PDF de acta bajo demanda con forceRegenerate", async () => {
    const created = await actasRepo.createDraftFromContext({
      especialidad: "fontaneria",
      fechaEmisionIso: "2026-11-25",
    });
    const opener = new DocumentOpenerService(
      fileBridge,
      new QuotesRepository(executor, memoryCoordinator),
      new InvoicesRepository(executor, memoryCoordinator),
      actasRepo
    );

    const uri = await opener.openPdf(null, "acta", created.row.id, pdfPort, {
      forceRegenerate: true,
    });
    expect(uri).toContain(`${created.row.codigo_acta}.pdf`);
    const reloaded = await actasRepo.getById(created.row.id);
    expect(reloaded?.row.pdf_uri).toBe(uri);
  }, 15000);
});
