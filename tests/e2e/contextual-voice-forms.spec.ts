import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 360, height: 800 },
});

test.describe("Dictado por Voz Incremental y Contextual en Formularios (360px)", () => {
  test("permite completar presupuestos, facturas Gate 3, citas de calendario y horario habitual en múltiples audios con Deshacer y 0 overflow", async ({
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

    const checkNoHorizontalOverflow = async () => {
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    };

    await page.clock.install({ time: new Date("2026-11-23T10:00:00") });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // 1. Alta local y onboarding mínimo
    await expect(page.getByTestId("auth-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("auth-name-input").fill("Reformas Voz Demo");
    await page.getByTestId("auth-email-input").fill("voz@obralocal.es");
    await page.getByTestId("auth-password-input").fill("ClaveVoz2026");
    await page.getByTestId("auth-password-confirm-input").fill("ClaveVoz2026");
    await page.getByTestId("auth-submit-btn").click();

    await expect(page.getByTestId("onboarding-step-1")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("onboarding-emitter-nif").fill("12345678Z");
    await page.getByTestId("onboarding-emitter-phone").fill("+34600112233");
    await page.getByTestId("onboarding-emitter-address").fill("C/ Mayor 10, 28013 Madrid");
    await page.getByTestId("onboarding-next-btn").click();

    await expect(page.getByTestId("onboarding-step-2")).toBeVisible();
    await page.getByTestId("onboarding-finish-btn").click();
    await expect(page.getByTestId("home-hub-view")).toBeVisible({ timeout: 15_000 });

    // 2. Crear cliente incompleto (sin NIF ni domicilio fiscal, para completarlo luego por audio en Gate 3)
    await page.getByTestId("home-card-clients").click();
    await expect(page.getByTestId("clients-view")).toBeVisible();
    await page.getByTestId("clients-new-btn").click();
    await expect(page.getByTestId("client-profile-widget")).toBeVisible();
    await page.getByTestId("client-widget-name-input").fill("Elena Martín");
    await page.getByTestId("client-widget-phone-input").fill("655443322");
    await page.getByTestId("client-widget-save-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    // 3. Presupuestos -> + Nuevo (vacío) -> Dictar en 3 turnos + Deshacer
    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-quotes").click();
    await expect(page.getByTestId("quotes-view")).toBeVisible();
    await page.getByTestId("quotes-new-btn").click();

    await expect(page.getByTestId("quote-builder-widget")).toBeVisible();
    await expect(page.getByTestId("contextual-voice-dock")).toBeVisible();
    await checkNoHorizontalOverflow();

    // Turno 1: Título y cliente
    await page.getByTestId("overlay-voice-trigger-btn").click();
    await expect(page.getByTestId("contextual-voice-overlay")).toBeVisible();
    await page
      .getByTestId("contextual-voice-overlay-manual-input")
      .fill("Título de la obra: Reforma baño, para Elena Martín");
    await page.getByTestId("contextual-voice-overlay-submit-btn").click();
    await expect(page.getByTestId("contextual-voice-overlay")).toBeHidden();
    await expect(page.getByTestId("quote-job-title-input")).toHaveValue("Reforma baño");

    // Turno 2: Añadir 2 partidas con precios explícitos (mantiene título y cliente)
    await page.getByTestId("overlay-voice-trigger-btn").click();
    await page
      .getByTestId("contextual-voice-overlay-manual-input")
      .fill("Añade 1 plato de ducha a 380 euros y 2 grifos a 92 euros");
    await page.getByTestId("contextual-voice-overlay-submit-btn").click();
    await expect(page.getByTestId("quote-line-0")).toBeVisible();
    await expect(page.getByTestId("quote-line-1")).toBeVisible();

    // Turno 3: Cambiar IVA al 10% y añadir notas -> probar Deshacer -> volver a aplicar
    await page.getByTestId("overlay-voice-trigger-btn").click();
    await page
      .getByTestId("contextual-voice-overlay-manual-input")
      .fill("IVA al 10 %, añade en notas garantía de 2 años");
    await page.getByTestId("contextual-voice-overlay-submit-btn").click();
    await expect(page.locator("#qb-notes")).toHaveValue(/garantía de 2 años/);
    // Base = 380 + 184 = 564 -> +10% IVA = 620,40 €
    await expect(page.getByTestId("quote-total-display")).toContainText("620,40");

    await page.getByTestId("contextual-voice-undo-btn").click();
    await expect(page.locator("#qb-notes")).toHaveValue("");
    await expect(page.getByTestId("quote-total-display")).not.toContainText("620,40");

    // Volver a dictar IVA 10% y aprobar presupuesto
    await page.getByTestId("overlay-voice-trigger-btn").click();
    await page
      .getByTestId("contextual-voice-overlay-manual-input")
      .fill("IVA al 10 %, añade en notas garantía de 2 años");
    await page.getByTestId("contextual-voice-overlay-submit-btn").click();
    await expect(page.getByTestId("quote-total-display")).toContainText("620,40");
    await checkNoHorizontalOverflow();

    await page.getByTestId("quote-approve-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    // 4. Abrir presupuesto -> Facturar (Gate 3) -> completar NIF y dirección del cliente por voz
    const quoteCard = page.locator('[data-testid^="quote-card-"]', { hasText: "PRE-2026-001" });
    await expect(quoteCard).toBeVisible();
    await quoteCard.click();
    await expect(page.getByTestId("quote-detail-view")).toBeVisible();
    await page.getByTestId("quote-detail-invoice-btn").click();

    await expect(page.getByTestId("job-lifecycle-widget")).toBeVisible();
    await expect(page.getByTestId("overlay-voice-trigger-btn")).toBeVisible();
    await checkNoHorizontalOverflow();

    await page.getByTestId("overlay-voice-trigger-btn").click();
    await page
      .getByTestId("contextual-voice-overlay-manual-input")
      .fill("NIF cliente 45891234R, domicilio fiscal Av. Libertad 4, Madrid");
    await page.getByTestId("contextual-voice-overlay-submit-btn").click();
    await expect(page.getByTestId("gate3-client-nif-input")).toHaveValue("45891234R");
    await expect(page.getByTestId("gate3-client-address-input")).toHaveValue(
      "Av. Libertad 4, Madrid"
    );

    await page.getByTestId("gate3-approve-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();
    await expect(page.getByTestId("quote-detail-view")).toContainText("FAC-2026-001");

    // 5. Agenda y Calendario -> Añadir cita por voz inline
    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-calendar").click();
    await expect(page.getByTestId("calendar-schedule-view")).toBeVisible();

    await page.getByTestId("calendar-add-appointment-btn").click();
    await expect(page.getByTestId("calendar-modal-voice-btn")).toBeVisible();
    await page.getByTestId("calendar-modal-voice-btn").click();
    await page
      .getByTestId("calendar-modal-voice-btn-sheet-manual-input")
      .fill("Mañana de 9 a 13:30, nota: visita medición");
    await page.getByTestId("calendar-modal-voice-btn-sheet-submit-btn").click();

    await page.getByRole("button", { name: "Guardar en calendario" }).click();
    await expect(page.getByTestId("calendar-schedule-view")).toContainText("09:00 – 13:30");
    await expect(page.getByTestId("calendar-schedule-view")).toContainText("visita medición");

    // 6. Personalización y Tarifario -> Mi Horario Habitual por voz + Deshacer
    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-pricing").click();
    await expect(page.getByTestId("pricing-catalog-view")).toBeVisible();
    await expect(page.getByTestId("pricing-schedule-daily-hours")).toContainText("8 h/día");

    await page.getByTestId("work-schedule-voice-btn").click();
    await page
      .getByTestId("work-schedule-voice-btn-sheet-manual-input")
      .fill("De lunes a sábado, mañanas de 8 a 14 y tardes de 15 a 18");
    await page.getByTestId("work-schedule-voice-btn-sheet-submit-btn").click();

    await expect(page.getByTestId("pricing-schedule-daily-hours")).toContainText("9 h/día");
    await checkNoHorizontalOverflow();

    await page.getByTestId("work-schedule-voice-btn-undo-btn").click();
    await expect(page.getByTestId("pricing-schedule-daily-hours")).toContainText("8 h/día");

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
