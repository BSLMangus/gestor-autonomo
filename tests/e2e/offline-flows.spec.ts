import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 360, height: 780 },
});

const CSV_TARIFF_SAMPLE = Buffer.from(
  [
    "TARIFA OFICIAL REFORMAS",
    "Tarifa base hora oficial: 45,00 €/h",
    "IVA por defecto vivienda: 10 %",
    "Cambio de grifo monomando cocina;ud;92,00 €",
    "Instalacion de punto de luz conmutado;ud;58,00 €",
  ].join("\n"),
  "utf-8"
);

const LONG_JOB_TITLE =
  "ReformaIntegralBanoCocina_PresupuestoDetalladoSinEspaciosLargosParaComprobarSaltoDeLineaAutomaticoEnPantallaMovil_2026";
const LONG_LINE_DESC =
  "InstalacionCompletaDeTuberiaMulticapaYGriferiaTermostaticaConMaterialesHomologadosParaVerQueNoDesbordaLaCajaEnMovil_9876543210";

test.describe("ObraLocal AI — Auth Local, Onboarding 2 Paneles, Presupuestos Sin Overflow, Voz Limpia y Detalle Completo", () => {
  test("arranca limpio en AuthScreen, completa onboarding, gestiona presupuestos sin botones/overflow, abre detalles de docs, usa voz limpia y cierra/reabre sesión (0 red)", async ({
    page,
    context,
  }) => {
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(`PAGEERROR: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        pageErrors.push(`CONSOLE_ERR: ${msg.text()}`);
      }
    });

    await context.route("**/*", async (route) => {
      const url = route.request().url();
      const allowed =
        url.startsWith("http://127.0.0.1:4273/") ||
        url.startsWith("http://localhost:4273/") ||
        url.startsWith("blob:") ||
        url.startsWith("data:");
      if (!allowed) {
        externalRequests.push(url);
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.clock.install({ time: new Date("2026-11-22T10:00:00") });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // 1. Arranque limpio -> AuthScreen (sin demos) -> Crear cuenta nueva
    await expect(page.getByTestId("auth-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("auth-name-input").fill("Reformas Carmen López");
    await page.getByTestId("auth-email-input").fill("carmen@obralocal.es");
    await page.getByTestId("auth-password-input").fill("ClaveCarmen2026");
    await page.getByTestId("auth-password-confirm-input").fill("ClaveCarmen2026");
    await page.getByTestId("auth-submit-btn").click();

    // 2. Onboarding Paso 1 (Datos fiscales + IBAN) -> Paso 2 (Tarifa, IVA/IRPF, Importador CSV, Plantillas)
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("onboarding-step-1")).toBeVisible();
    await page.getByTestId("onboarding-emitter-nif").fill("12345678Z");
    await page.getByTestId("onboarding-emitter-phone").fill("+34600112233");
    await page.getByTestId("onboarding-emitter-address").fill("C/ Mayor 10, 28013 Madrid");
    await page.getByTestId("onboarding-emitter-iban").fill("ES9121000418450200051332");
    await page.getByTestId("onboarding-next-btn").click();

    await expect(page.getByTestId("onboarding-step-2")).toBeVisible();
    await page.getByTestId("onboarding-hourly-rate-input").fill("42.00");
    await page.getByTestId("onboarding-vat-input").fill("10");
    await page.getByTestId("onboarding-irpf-input").fill("15");

    await page.getByTestId("onboarding-import-file-input").setInputFiles({
      name: "tarifario_anterior.csv",
      mimeType: "text/csv",
      buffer: CSV_TARIFF_SAMPLE,
    });
    await expect(page.getByTestId("document-import-review-widget")).toBeVisible();
    await page.getByTestId("import-widget-save-btn").click();
    await expect(page.getByTestId("document-import-review-widget")).toBeHidden();

    const firstTemplateBtn = page.locator('[data-testid^="onboarding-activate-tpl-"]').first();
    if ((await firstTemplateBtn.count()) > 0) {
      await firstTemplateBtn.click();
    }

    await page.getByTestId("onboarding-finish-btn").click();

    // 3. Home Hub sin datos demo (0 obras, 0 presupuestos, 0 clientes)
    await expect(page.getByTestId("home-hub-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("home-card-jobs")).toContainText("0 activas · 0 total");
    await expect(page.getByTestId("home-card-quotes")).toContainText("0 abiertos · 0 total");
    await expect(page.getByTestId("home-card-clients")).toContainText("0 fichas y obras");

    // 4. Crear cliente completo desde Clientes (con NIF y domicilio para poder facturar luego)
    await page.getByTestId("home-card-clients").click();
    await expect(page.getByTestId("clients-view")).toBeVisible();
    await page.getByTestId("clients-new-btn").click();
    await expect(page.getByTestId("client-profile-widget")).toBeVisible();
    await page.getByTestId("client-widget-name-input").fill("Elena Martín García");
    await page.getByTestId("client-widget-phone-input").fill("655443322");
    await page.getByTestId("client-widget-nif-input").fill("45891234R");
    await page.getByTestId("client-widget-address-input").fill("Av. de la Libertad 4, Madrid");
    await page.getByTestId("client-widget-save-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    // 5. Crear presupuesto con título muy largo y partida muy larga
    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-quotes").click();
    await expect(page.getByTestId("quotes-view")).toBeVisible();
    await page.getByTestId("quotes-new-btn").click();
    await expect(page.getByTestId("quote-builder-widget")).toBeVisible();

    await page.getByTestId("quote-job-title-input").fill(LONG_JOB_TITLE);
    await page.getByTestId("quote-client-select").selectOption({ index: 1 });
    await page.getByTestId("quote-add-line").click();
    await page.getByLabel("Descripción partida 1").fill(LONG_LINE_DESC);
    await page.getByTestId("quote-line-price-0").fill("250.00");
    await page.locator("#qb-notes").fill("Incluye materiales, desplazamiento y garantía de 2 años.");
    await page.getByTestId("quote-approve-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    // 6. Verificar tarjeta limpia en Presupuestos: 0 botones dentro y 0 overflow horizontal en 360px
    const quoteCard = page.locator('[data-testid^="quote-card-"]', { hasText: "PRE-2026-001" });
    await expect(quoteCard).toBeVisible();
    await expect(quoteCard.locator("button")).toHaveCount(0);

    const listMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(listMetrics.scrollWidth).toBeLessThanOrEqual(listMetrics.innerWidth);

    const cardBox = await quoteCard.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.x).toBeGreaterThanOrEqual(0);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(360.5);

    // 7. Tocar tarjeta -> QuoteDetailView con todos los datos completos + 0 overflow horizontal
    await quoteCard.click();
    await expect(page.getByTestId("quote-detail-view")).toBeVisible();
    await expect(page.getByTestId("quote-detail-view")).toContainText("PRE-2026-001");
    await expect(page.getByTestId("quote-detail-view")).toContainText(LONG_JOB_TITLE);
    await expect(page.getByTestId("quote-detail-view")).toContainText(LONG_LINE_DESC);
    await expect(page.getByTestId("quote-detail-view")).toContainText("Elena Martín García");
    await expect(page.getByTestId("quote-detail-view")).toContainText("45891234R");
    await expect(page.getByTestId("quote-detail-view")).toContainText("Av. de la Libertad 4, Madrid");
    await expect(page.getByTestId("quote-detail-view")).toContainText("Incluye materiales");

    const detailMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(detailMetrics.scrollWidth).toBeLessThanOrEqual(detailMetrics.innerWidth);

    // Editar presupuesto desde dentro del detalle
    await page.getByTestId("quote-detail-edit-btn").click();
    await expect(page.getByTestId("quote-builder-widget")).toBeVisible();
    await page.getByTestId("quote-line-price-0").fill("300.00");
    await page.getByTestId("quote-approve-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();
    await expect(page.getByTestId("quote-detail-view")).toContainText("330,00 €");

    // Aceptar, pedir Anticipo 40 %, Compartir y descargar PDF desde dentro
    await page.getByTestId("quote-detail-accept-btn").click();
    await expect(page.getByTestId("quote-detail-view")).toContainText("Aceptado");

    await page.getByTestId("quote-detail-advance-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeVisible();
    await page.getByTestId("gate3-approve-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    const quoteDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("quote-detail-open-pdf-btn").click();
    const quotePdf = await quoteDownloadPromise;
    expect(quotePdf.suggestedFilename()).toMatch(/^PRE-2026-001\.pdf$/);

    await page.getByTestId("quote-detail-share-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeVisible();
    await page.getByTestId("gate4-approve-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    // 8. Abrir factura ANT-2026-001 vinculada -> InvoiceDetailView con todos los datos (incluido IBAN)
    const linkedInvoiceCard = page.locator('[data-testid^="quote-detail-invoice-"]').first();
    await expect(linkedInvoiceCard).toBeVisible();
    await linkedInvoiceCard.click();
    await expect(page.getByTestId("invoice-detail-view")).toBeVisible();
    await expect(page.getByTestId("invoice-detail-view")).toContainText("ANT-2026-001");
    await expect(page.getByTestId("invoice-detail-view")).toContainText("ES9121000418450200051332");
    await expect(page.getByTestId("invoice-detail-view")).toContainText(LONG_LINE_DESC);
    await page.getByTestId("invoice-detail-toggle-paid-btn").click();
    await expect(page.getByTestId("invoice-detail-view")).toContainText("Cobrada");

    // 9. Botón global de Voz -> abre chat NUEVO limpio sin conflicto con el presupuesto anterior
    await page.getByTestId("global-nav-voice-btn").click();
    await expect(page.getByTestId("global-voice-overlay")).toBeVisible();
    await page.getByTestId("voice-overlay-manual-input").fill("Presupuesto: 2 puntos de luz a 45 euros");
    await page.getByTestId("voice-overlay-submit-btn").click();

    await expect(page.getByTestId("generative-widget-overlay")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("quote-builder-widget")).toBeVisible();
    await expect(page.getByTestId("quote-builder-widget")).toContainText("Nuevo presupuesto de obra");
    await page.getByTestId("quote-reject-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    // Verificar que el historial lateral conserva múltiples hilos
    await page.getByTestId("open-threads-drawer-btn").click();
    await expect(page.getByTestId("app-navigation-drawer")).toBeVisible();
    expect(await page.locator('[data-testid^="thread-item-"]').count()).toBeGreaterThanOrEqual(2);
    await page.getByTestId("drawer-close-btn").click();

    // 10. Ticket manual -> Hucha Fiscal -> TicketDetailView completo + edición
    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-fiscal").click();
    await expect(page.getByTestId("fiscal-dashboard-view")).toBeVisible();
    await page.getByRole("button", { name: "Añadir ticket" }).click();
    await expect(page.getByTestId("ticket-ocr-validator-widget")).toBeVisible();
    await page.getByTestId("ticket-supplier-input").fill("Ferretería El Martillo");
    await page.getByTestId("ticket-base-input").fill("100.00");
    await page.getByTestId("ticket-vat-input").fill("21.00");
    await page.getByTestId("ticket-total-input").fill("121.00");
    await page.getByTestId("ticket-approve-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    const fiscalTicketRow = page.locator('[data-testid^="fiscal-ticket-"]').first();
    await expect(fiscalTicketRow).toBeVisible();
    await fiscalTicketRow.click();
    await expect(page.getByTestId("ticket-detail-view")).toBeVisible();
    await expect(page.getByTestId("ticket-detail-view")).toContainText("Ferretería El Martillo");
    await page.getByTestId("ticket-detail-edit-btn").click();
    await page.getByTestId("ticket-detail-supplier-input").fill("Ferretería El Martillo S.L.");
    await page.getByTestId("ticket-detail-save-btn").click();
    await expect(page.getByTestId("ticket-detail-view")).toContainText("Ferretería El Martillo S.L.");

    // 11. Ajustes: verificar 0 botones demo -> Cerrar sesión -> Volver a iniciar sesión directo a Home
    await page.getByTestId("open-threads-drawer-btn").click();
    await page.getByTestId("drawer-nav-settings").click();
    await expect(page.getByTestId("settings-view")).toBeVisible();
    await expect(page.getByTestId("restore-demo-btn")).toHaveCount(0);
    await page.getByTestId("settings-logout-btn").click();

    await expect(page.getByTestId("auth-screen")).toBeVisible();
    await page.getByTestId("auth-email-input").fill("carmen@obralocal.es");
    await page.getByTestId("auth-password-input").fill("ClaveCarmen2026");
    await page.getByTestId("auth-submit-btn").click();

    await expect(page.getByTestId("home-hub-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("onboarding-wizard")).toHaveCount(0);
    await expect(page.getByTestId("home-card-quotes")).toContainText("1 total");

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
