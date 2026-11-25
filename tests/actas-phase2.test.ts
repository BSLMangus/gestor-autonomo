import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActasRepository } from "../src/core/db/repositories/actasRepo";
import { ClientsRepository } from "../src/core/db/repositories/clientsRepo";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import {
  getRouteTitle,
  isSameRoute,
  parseHashToRoute,
  routeToHash,
} from "../src/core/navigation/routes";
import {
  ACTA_MANTENIMIENTO_ELECTRICIDAD,
  ACTA_MANTENIMIENTO_FONTANERIA,
  buildActaRecepcionTemplate,
  getActaMantenimientoTemplate,
  isDefaultMantenimientoText,
  isDefaultRecepcionText,
  isInstallerActaProfileComplete,
} from "../src/features/actas/actaTemplates";

describe("Fase 2 Actas — Rutas, Creación Inline (Instalador/Cliente) y Plantillas", () => {
  let executor: NodeBetterSqliteExecutor;
  let actasRepo: ActasRepository;
  let settingsRepo: SettingsRepository;
  let clientsRepo: ClientsRepository;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    actasRepo = new ActasRepository(executor);
    settingsRepo = new SettingsRepository(executor);
    clientsRepo = new ClientsRepository(executor);
  });

  afterEach(async () => {
    await executor.close();
  });

  it("parsea y serializa rutas #/actas y #/actas/:id con modo opcional", () => {
    expect(parseHashToRoute("#/actas")).toEqual({ name: "actas" });
    expect(routeToHash({ name: "actas" })).toBe("#/actas");
    expect(getRouteTitle({ name: "actas" })).toBe("Actas técnicas");

    const parsedFree = parseHashToRoute("#/actas/act_123?mode=free");
    expect(parsedFree).toEqual({ name: "acta_detail", actaId: "act_123", initialMode: "free" });
    expect(routeToHash(parsedFree)).toBe("#/actas/act_123?mode=free");

    const parsedGuided = parseHashToRoute("#/actas/act_123?mode=guided");
    expect(parsedGuided).toEqual({
      name: "acta_detail",
      actaId: "act_123",
      initialMode: "guided",
    });
    expect(isSameRoute(parsedFree, parsedGuided)).toBe(false);
    expect(isSameRoute(parsedFree, { name: "acta_detail", actaId: "act_123", initialMode: "free" })).toBe(
      true
    );
    expect(getRouteTitle(parsedFree)).toBe("Acta de Puesta en Marcha");
    expect(parseHashToRoute("#/actas/")).toEqual({ name: "actas" });
  });

  it("permite crear la ficha técnica del instalador inline desde el acta y pre-rellena la siguiente", async () => {
    const initialSettings = await settingsRepo.getAppSettings();
    expect(isInstallerActaProfileComplete(initialSettings)).toBe(false);

    const draft1 = await actasRepo.createDraftFromContext({
      especialidad: "electricidad",
      fechaEmisionIso: "2026-11-25",
    });
    expect(draft1.data.instalador.nombre_razon_social).toBe("");
    expect(draft1.data.instalador.tecnico_nombre).toBe("");

    // Guardado inline desde el bloque 2 del acta (datos fiscales + técnicos)
    const updatedSettings = await settingsRepo.updateInstallerActaProfile({
      emitter_name: "Electricidad Levante SL",
      emitter_nif: "12345678Z",
      emitter_fiscal_address: "C/ Colón 12, Valencia",
      emitter_phone: "622334455",
      emitter_email: "info@levante.es",
      emitter_registry_number: "REIE-46-01928",
      emitter_tech_name: "Javier Soler",
      emitter_tech_dni: "00000000T",
      emitter_installer_card: "CI-BT-9001",
      default_acta_warranty_months: 24,
    });
    expect(isInstallerActaProfileComplete(updatedSettings)).toBe(true);

    // La segunda acta ya nace completamente pre-rellenada
    const draft2 = await actasRepo.createDraftFromContext({
      especialidad: "electricidad",
      fechaEmisionIso: "2026-11-25",
    });
    expect(draft2.data.instalador.nombre_razon_social).toBe("Electricidad Levante SL");
    expect(draft2.data.instalador.nif_cif).toBe("12345678Z");
    expect(draft2.data.instalador.tecnico_nombre).toBe("Javier Soler");
    expect(draft2.data.instalador.num_registro_empresa).toBe("REIE-46-01928");
  });

  it("permite crear y vincular un cliente inline desde un acta creada sin cliente", async () => {
    const draft = await actasRepo.createDraftFromContext({
      especialidad: "fontaneria",
      fechaEmisionIso: "2026-11-25",
    });
    expect(draft.row.client_id).toBeNull();

    const createdClient = await clientsRepo.create({
      name: "Lucía Navarro",
      nif: "11111111H",
      fiscal_address: "Avda. América 44",
      phone: "655443322",
      email: "lucia@navarro.es",
    });

    const saved = await actasRepo.saveDraft(draft.row.id, {
      clientId: createdClient.id,
      estado: "completada",
      data: {
        ...draft.data,
        cliente: {
          nombre_razon_social: createdClient.name,
          nif_cif: createdClient.nif,
          direccion_emplazamiento: createdClient.fiscal_address,
          telefono: createdClient.phone,
          email: createdClient.email,
        },
      },
    });

    expect(saved.row.client_id).toBe(createdClient.id);
    expect(saved.row.estado).toBe("completada");
    const byClient = await actasRepo.listByClientId(createdClient.id);
    expect(byClient.length).toBe(1);
    expect(byClient[0]?.id).toBe(draft.row.id);
  });

  it("detecta textos por defecto frente a personalizados al cambiar especialidad o garantía", () => {
    expect(isDefaultMantenimientoText(ACTA_MANTENIMIENTO_ELECTRICIDAD)).toBe(true);
    expect(isDefaultMantenimientoText(ACTA_MANTENIMIENTO_FONTANERIA)).toBe(true);
    expect(isDefaultMantenimientoText(getActaMantenimientoTemplate("mixta"))).toBe(true);
    expect(isDefaultMantenimientoText("Mantenimiento personalizado por el técnico.")).toBe(false);

    expect(isDefaultRecepcionText(buildActaRecepcionTemplate(12))).toBe(true);
    expect(isDefaultRecepcionText(buildActaRecepcionTemplate(24))).toBe(true);
    expect(isDefaultRecepcionText("Cláusula redactada a medida para comunidad.")).toBe(false);
  });
});
