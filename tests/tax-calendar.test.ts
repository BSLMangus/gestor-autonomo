import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackupService } from "../src/core/backup/backupService";
import { ResetService } from "../src/core/backup/resetService";
import { NodeBetterSqliteExecutor } from "../src/core/db/nodeSqliteExecutor";
import { SettingsRepository } from "../src/core/db/repositories/settingsRepo";
import { TaxCalendarRepository } from "../src/core/db/repositories/taxCalendarRepo";
import { initializeSchema } from "../src/core/db/sqliteExecutor";
import {
  DEFAULT_ACTIVE_TAX_MODELS,
  computeEasterSundayIso,
  computeTaxAlertsForDate,
  computeUpcomingGroupedAlerts,
  generateTaxObligationsForYear,
  getSpanishNationalHolidays,
  shiftToNextBusinessDay,
} from "../src/core/fiscal/taxCalendarEngine";
import { isSameRoute, parseHashToRoute, routeToHash } from "../src/core/navigation/routes";
import { MockFreezerPort } from "./mocks/ports";

describe("Calendario fiscal AEAT autónomos, festivos, alertas y rutas", () => {
  let executor: NodeBetterSqliteExecutor;

  beforeEach(async () => {
    executor = new NodeBetterSqliteExecutor(":memory:");
    await initializeSchema(executor);
    await new ResetService(executor).restoreDemoData(new MockFreezerPort());
  });

  afterEach(async () => {
    await executor.close();
  });

  it("calcula Viernes Santo (Computus), festivos nacionales y traslada vencimientos a día hábil", () => {
    expect(computeEasterSundayIso(2026)).toBe("2026-04-05");
    expect(computeEasterSundayIso(2027)).toBe("2027-03-28");

    const holidays2026 = getSpanishNationalHolidays(2026);
    const holidays2027 = getSpanishNationalHolidays(2027);
    expect(holidays2026.has("2026-04-03")).toBe(true); // Viernes Santo 2026
    expect(holidays2027.has("2027-03-26")).toBe(true); // Viernes Santo 2027
    expect(holidays2027.has("2027-01-01")).toBe(true);
    expect(holidays2027.has("2027-12-25")).toBe(true);

    // 2027-01-30 es sábado y 2027-01-31 es domingo -> traslada al lunes 2027-02-01
    expect(shiftToNextBusinessDay("2027-01-30")).toBe("2027-02-01");
    expect(shiftToNextBusinessDay("2027-01-31")).toBe("2027-02-01");

    const obs2026All = generateTaxObligationsForYear(2026, [
      "303",
      "130",
      "111",
      "115",
      "390",
      "190",
      "100",
    ]);
    const mod303Q4 = obs2026All.find((o) => o.obligationKey === "303_2026_T4")!;
    const mod130Q4 = obs2026All.find((o) => o.obligationKey === "130_2026_T4")!;
    const mod111Q4 = obs2026All.find((o) => o.obligationKey === "111_2026_T4")!;
    const mod115Q4 = obs2026All.find((o) => o.obligationKey === "115_2026_T4")!;
    const mod190 = obs2026All.find((o) => o.obligationKey === "190_2026_ANUAL")!;

    expect(mod303Q4.nominalEndDateIso).toBe("2027-01-30");
    expect(mod303Q4.endDateIso).toBe("2027-02-01");
    expect(mod130Q4.endDateIso).toBe("2027-02-01");
    expect(mod111Q4.endDateIso).toBe("2027-01-20");
    expect(mod115Q4.endDateIso).toBe("2027-01-20");
    expect(mod190.nominalEndDateIso).toBe("2027-01-31");
    expect(mod190.endDateIso).toBe("2027-02-01");

    // Año bisiesto: 347 de ejercicio 2027 vence en febrero 2028 -> 2028-02-29 (martes)
    const obs2027 = generateTaxObligationsForYear(2027, ["347"]);
    const mod347 = obs2027.find((o) => o.obligationKey === "347_2027_ANUAL")!;
    expect(mod347.endDateIso).toBe("2028-02-29");
  });

  it("emite avisos exactos (-14/-7/0 apertura y -14/-7/-3/-2/-1/0 cierre + vencido + cruce de año)", () => {
    // Cruce de año: 2026-12-18 está 14 días antes de 2027-01-01 (apertura 4T 2026 y 390)
    const decAlerts = computeTaxAlertsForDate("2026-12-18", DEFAULT_ACTIVE_TAX_MODELS);
    expect(
      decAlerts.some(
        (a) => a.obligation.obligationKey === "303_2026_T4" && a.kind === "start_upcoming" && a.daysUntilTarget === 14
      )
    ).toBe(true);
    expect(
      decAlerts.some(
        (a) => a.obligation.obligationKey === "390_2026_ANUAL" && a.kind === "start_upcoming" && a.daysUntilTarget === 14
      )
    ).toBe(true);

    // Cadencia exacta para Modelo 303 1T 2026 (2026-04-01 -> 2026-04-20)
    const activeOnly303 = ["303"] as const;
    const expectedAlerts: Array<[string, string, number]> = [
      ["2026-03-18", "start_upcoming", 14],
      ["2026-03-25", "start_upcoming", 7],
      ["2026-04-01", "start_today", 0],
      ["2026-04-06", "end_upcoming", 14],
      ["2026-04-13", "end_upcoming", 7],
      ["2026-04-17", "end_upcoming", 3],
      ["2026-04-18", "end_upcoming", 2],
      ["2026-04-19", "end_upcoming", 1],
      ["2026-04-20", "end_today", 0],
      ["2026-04-25", "overdue", -5],
    ];

    for (const [dateIso, expectedKind, expectedOffset] of expectedAlerts) {
      const alerts = computeTaxAlertsForDate(dateIso, activeOnly303);
      const match = alerts.find((a) => a.obligation.obligationKey === "303_2026_T1");
      expect(match, `Debe existir aviso el ${dateIso}`).toBeTruthy();
      expect(match!.kind).toBe(expectedKind);
      expect(match!.daysUntilTarget).toBe(expectedOffset);
    }

    // Días silenciosos intermedios
    expect(
      computeTaxAlertsForDate("2026-03-20", activeOnly303).some(
        (a) => a.obligation.obligationKey === "303_2026_T1"
      )
    ).toBe(false);
    expect(
      computeTaxAlertsForDate("2026-04-10", activeOnly303).some(
        (a) => a.obligation.obligationKey === "303_2026_T1"
      )
    ).toBe(false);
  });

  it("persiste estados, suprime avisos por presentado/no_aplica/descartar, agrupa días y sobrevive backup", async () => {
    const settingsRepo = new SettingsRepository(executor);
    const taxRepo = new TaxCalendarRepository(executor);

    await settingsRepo.updateActiveTaxModels(["303", "130", "111"]);
    const updatedSettings = await settingsRepo.getAppSettings();
    expect(updatedSettings.active_tax_models).toEqual(["303", "130", "111"]);

    // En 2026-04-17 faltan 3 días para 303_2026_T1, 130_2026_T1 y 111_2026_T1
    const grouped = computeUpcomingGroupedAlerts(
      "2026-04-15",
      10,
      updatedSettings.active_tax_models
    );
    const dayApr17 = grouped.find((d) => d.triggerDateIso === "2026-04-17")!;
    expect(dayApr17).toBeTruthy();
    expect(dayApr17.alerts.length).toBeGreaterThanOrEqual(3);
    expect(dayApr17.title).toContain("3 avisos fiscales Hacienda");
    expect(dayApr17.urgency).toBe("critical");

    // Marcar 303 presentado y 111 no_aplica -> deben desaparecer de avisos
    await taxRepo.setObligationStatus({
      obligation_key: "303_2026_T1",
      model_code: "303",
      fiscal_year: 2026,
      period_code: "T1",
      status: "presentado",
      presented_at_iso: "2026-04-15",
    });
    await taxRepo.setObligationStatus({
      obligation_key: "111_2026_T1",
      model_code: "111",
      fiscal_year: 2026,
      period_code: "T1",
      status: "no_aplica",
    });
    await taxRepo.dismissAlert("130_2026_T1_end_3");

    const states = await taxRepo.listAllStates();
    const dismissals = await taxRepo.listDismissedAlertKeys();
    const alertsApr17After = computeTaxAlertsForDate(
      "2026-04-17",
      updatedSettings.active_tax_models,
      states,
      dismissals
    );
    expect(alertsApr17After).toHaveLength(0);

    // Backup round-trip conserva active_tax_models_json, tax_obligation_states y tax_alert_dismissals
    const backup = new BackupService(executor);
    const exportedJson = await backup.exportBackupJson();
    await new ResetService(executor).startFromScratch();
    await backup.importBackupJson(exportedJson);

    const restoredSettings = await settingsRepo.getAppSettings();
    const restoredStates = await taxRepo.listAllStates();
    const restoredDismissals = await taxRepo.listDismissedAlertKeys();
    expect(restoredSettings.active_tax_models).toEqual(["303", "130", "111"]);
    expect(restoredStates.get("303_2026_T1")?.status).toBe("presentado");
    expect(restoredStates.get("111_2026_T1")?.status).toBe("no_aplica");
    expect(restoredDismissals.has("130_2026_T1_end_3")).toBe(true);
  });

  it("resuelve rutas de calendario Hacienda manteniendo retrocompatibilidad con #/calendario", () => {
    expect(parseHashToRoute("#/calendario")).toEqual({ name: "calendar" });
    expect(routeToHash({ name: "calendar" })).toBe("#/calendario");

    expect(parseHashToRoute("#/calendario?date=2026-04-20")).toEqual({
      name: "calendar",
      focusDateIso: "2026-04-20",
    });
    expect(routeToHash({ name: "calendar", focusDateIso: "2026-04-20" })).toBe(
      "#/calendario?date=2026-04-20"
    );

    expect(parseHashToRoute("#/calendario?tab=hacienda")).toEqual({
      name: "calendar",
      tab: "hacienda",
    });
    expect(routeToHash({ name: "calendar", tab: "hacienda" })).toBe("#/calendario?tab=hacienda");

    expect(parseHashToRoute("#/calendario?date=2026-04-20&tab=hacienda")).toEqual({
      name: "calendar",
      focusDateIso: "2026-04-20",
      tab: "hacienda",
    });
    expect(
      isSameRoute(
        { name: "calendar", focusDateIso: "2026-04-20", tab: "hacienda" },
        { name: "calendar", focusDateIso: "2026-04-20" }
      )
    ).toBe(false);
    expect(
      isSameRoute(
        { name: "calendar", focusDateIso: "2026-04-20", tab: "hacienda" },
        { name: "calendar", focusDateIso: "2026-04-20", tab: "hacienda" }
      )
    ).toBe(true);
  });
});
