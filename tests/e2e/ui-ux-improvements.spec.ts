import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 360, height: 800 },
});

test.describe("Mejoras UI/UX móvil 360x800 — Horario, Modal de Activación, Cámara Soft-Blue y Borrado de Chats", () => {
  test("verifica las 4 mejoras UI/UX sin errores ni overflow horizontal y captura evidencia visual", async ({
    page,
    context,
  }, testInfo) => {
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
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // 0. Alta local + Onboarding 2 pasos
    await expect(page.getByTestId("auth-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("auth-name-input").fill("Reformas Prueba UX");
    await page.getByTestId("auth-email-input").fill("ux@obralocal.es");
    await page.getByTestId("auth-password-input").fill("ClaveUx2026");
    await page.getByTestId("auth-password-confirm-input").fill("ClaveUx2026");
    await page.getByTestId("auth-submit-btn").click();

    await expect(page.getByTestId("onboarding-step-1")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("onboarding-emitter-nif").fill("12345678Z");
    await page.getByTestId("onboarding-next-btn").click();

    await expect(page.getByTestId("onboarding-step-2")).toBeVisible();
    // Verificar también que el horario en Onboarding Step 2 no produce overflow horizontal a 360px
    const onboardingMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(onboardingMetrics.scrollWidth).toBeLessThanOrEqual(onboardingMetrics.innerWidth);
    await page.getByTestId("onboarding-finish-btn").click();

    // 1. Bottom nav Camera button (soft-blue balanced with Home and Voice)
    await expect(page.getByTestId("home-hub-view")).toBeVisible({ timeout: 15_000 });
    const bottomNav = page.getByTestId("global-bottom-nav");
    const homeBtn = page.getByTestId("global-nav-home-btn");
    const voiceBtn = page.getByTestId("global-nav-voice-btn");
    const cameraBtn = page.getByTestId("global-nav-camera-btn");

    await expect(bottomNav).toBeVisible();
    await expect(homeBtn).toBeVisible();
    await expect(voiceBtn).toBeVisible();
    await expect(cameraBtn).toBeVisible();

    const cameraBg = await cameraBtn.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(cameraBg).toMatch(/^rgba?\(203,\s*228,\s*249/);

    const homeBox = await homeBtn.boundingBox();
    const voiceBox = await voiceBtn.boundingBox();
    const cameraBox = await cameraBtn.boundingBox();
    expect(homeBox).not.toBeNull();
    expect(voiceBox).not.toBeNull();
    expect(cameraBox).not.toBeNull();
    expect(homeBox!.x).toBeGreaterThanOrEqual(0);
    expect(cameraBox!.x + cameraBox!.width).toBeLessThanOrEqual(360.5);
    expect(homeBox!.x).toBeLessThan(voiceBox!.x);
    expect(voiceBox!.x).toBeLessThan(cameraBox!.x);
    expect(homeBox!.width).toBeGreaterThanOrEqual(64);
    expect(cameraBox!.width).toBeGreaterThanOrEqual(64);
    expect(Math.abs(homeBox!.width - cameraBox!.width)).toBeLessThanOrEqual(8);
    expect(Math.abs(homeBox!.height - cameraBox!.height)).toBeLessThanOrEqual(4);

    await page.screenshot({
      path: testInfo.outputPath("e2e-bottom-nav-camera.png"),
      fullPage: false,
    });

    // 2. Navegar a Personalización y Tarifario -> Horario habitual (0 overflow + cajas simétricas dentro de la tarjeta)
    await page.getByTestId("open-threads-drawer-btn").click();
    await expect(page.getByTestId("app-navigation-drawer")).toBeVisible();
    await page.getByTestId("drawer-nav-pricing").click();
    await expect(page.getByTestId("pricing-catalog-panel")).toBeVisible();

    const scheduleSection = page.getByTestId("pricing-work-schedule-section");
    await scheduleSection.scrollIntoViewIfNeeded();
    await expect(scheduleSection).toBeVisible();

    const schedulePageMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(schedulePageMetrics.scrollWidth).toBeLessThanOrEqual(
      schedulePageMetrics.innerWidth
    );

    const cardBox = await scheduleSection.boundingBox();
    expect(cardBox).not.toBeNull();

    const timeInputs = [
      scheduleSection.getByLabel("Inicio mañana"),
      scheduleSection.getByLabel("Fin mañana"),
      scheduleSection.getByLabel("Inicio tarde"),
      scheduleSection.getByLabel("Fin tarde"),
    ];
    const timeBoxes = [];
    for (const input of timeInputs) {
      await expect(input).toBeVisible();
      const box = await input.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x - 0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5);
      expect(box!.y).toBeGreaterThanOrEqual(cardBox!.y - 0.5);
      expect(box!.y + box!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 0.5);
      timeBoxes.push(box!);
    }
    const widths = timeBoxes.map((b) => b.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: testInfo.outputPath("e2e-schedule-card.png"),
      fullPage: false,
    });

    // 3. Modal de precio personalizado al activar partida predefinida
    const activateGrifoBtn = page.getByTestId("activate-tpl-tpl_cambio_grifo");
    await activateGrifoBtn.scrollIntoViewIfNeeded();
    await activateGrifoBtn.click();

    const activateModal = page.getByTestId("activate-catalog-item-modal");
    await expect(activateModal).toBeVisible();
    await expect(activateModal).toContainText("Precio por defecto:");
    await expect(activateModal).toContainText("89,00 €");
    const modalPriceInput = page.getByTestId("activate-modal-price-input");
    await expect(modalPriceInput).toHaveValue("89.00");

    await page.screenshot({
      path: testInfo.outputPath("e2e-activate-modal.png"),
      fullPage: false,
    });

    // Cancelar deja la partida inactiva
    await page.getByTestId("activate-modal-cancel-btn").click();
    await expect(activateModal).toBeHidden();
    await expect(activateGrifoBtn).toBeVisible();

    // Activar con precio personalizado 105.50
    await activateGrifoBtn.click();
    await expect(activateModal).toBeVisible();
    await modalPriceInput.fill("105.50");
    await page.getByTestId("activate-modal-confirm-btn").click();
    await expect(activateModal).toBeHidden();

    const deactivateGrifoBtn = page.getByTestId("deactivate-tpl-tpl_cambio_grifo");
    await expect(deactivateGrifoBtn).toBeVisible();
    await expect(deactivateGrifoBtn).toHaveText("Activa");
    await expect(page.getByTestId("predefined-tpl-tpl_cambio_grifo")).toContainText("105,50 €");

    // Recargar y comprobar persistencia de 105,50 € en SQLite (mantiene ruta #/tarifario)
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("pricing-catalog-panel")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("deactivate-tpl-tpl_cambio_grifo")).toBeVisible();
    await expect(page.getByTestId("predefined-tpl-tpl_cambio_grifo")).toContainText("105,50 €");

    // Pulsar 'Activa' desactiva directamente sin abrir modal
    await page.getByTestId("deactivate-tpl-tpl_cambio_grifo").click();
    await expect(page.getByTestId("activate-catalog-item-modal")).toHaveCount(0);
    await expect(page.getByTestId("activate-tpl-tpl_cambio_grifo")).toBeVisible();

    // 4. Borrado individual de conversaciones (drawer + interrupted warning + header de chat abierto)
    // 4a. Crear conversación en pausa HITL (interrupted) mediante Voz
    await page.getByTestId("global-nav-voice-btn").click();
    await expect(page.getByTestId("global-voice-overlay")).toBeVisible();
    await page
      .getByTestId("voice-overlay-manual-input")
      .fill("Presupuesto: 2 puntos de luz a 45 euros");
    await page.getByTestId("voice-overlay-submit-btn").click();
    await expect(page.getByTestId("quote-builder-widget")).toBeVisible({ timeout: 10_000 });

    // Recargar dejando la conversación HITL en estado 'interrupted'
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("open-threads-drawer-btn")).toBeVisible({ timeout: 15_000 });

    // 4b. Crear una segunda conversación (idle) desde el drawer para probar también el borrado desde la cabecera
    await page.getByTestId("open-threads-drawer-btn").click();
    await expect(page.getByTestId("app-navigation-drawer")).toBeVisible();
    await expect(page.locator('[data-testid^="thread-item-"]')).toHaveCount(1);
    await page.getByTestId("drawer-new-thread-btn").click();
    await expect(page.getByTestId("chat-timeline")).toBeVisible();
    await expect(page.getByTestId("chat-header-delete-thread-btn")).toBeVisible();

    // Volver a abrir el drawer: ahora hay 2 hilos (uno idle y uno interrupted)
    await page.getByTestId("open-threads-drawer-btn").click();
    await expect(page.getByTestId("app-navigation-drawer")).toBeVisible();
    await expect(page.locator('[data-testid^="thread-item-"]')).toHaveCount(2);

    // Localizar el hilo interrupted ("Por confirmar" / "Pendiente") y pulsar su papelera roja en el drawer
    const interruptedThreadBtn = page.locator('[data-testid^="thread-item-"]', {
      hasText: "Por confirmar",
    });
    await expect(interruptedThreadBtn).toBeVisible();
    const interruptedTestId = await interruptedThreadBtn.getAttribute("data-testid");
    expect(interruptedTestId).toBeTruthy();
    const interruptedThreadId = interruptedTestId!.replace("thread-item-", "");

    await page.getByTestId(`drawer-delete-thread-${interruptedThreadId}`).click();
    const deleteDialog = page.getByTestId("confirm-delete-thread-dialog");
    await expect(deleteDialog).toBeVisible();
    await expect(deleteDialog).toContainText(
      "Esta conversación tiene una acción pendiente de confirmar; al eliminarla se descartará el borrador pendiente."
    );

    await page.screenshot({
      path: testInfo.outputPath("e2e-delete-interrupted-dialog.png"),
      fullPage: false,
    });

    await page.getByTestId("confirm-delete-thread-btn").click();
    await expect(deleteDialog).toBeHidden();
    await expect(page.getByTestId(`thread-item-${interruptedThreadId}`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="thread-item-"]')).toHaveCount(1);

    // Recargar y confirmar que la eliminación del hilo interrupted persistió
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("open-threads-drawer-btn")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("open-threads-drawer-btn").click();
    await expect(page.getByTestId(`thread-item-${interruptedThreadId}`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="thread-item-"]')).toHaveCount(1);

    // Abrir la conversación restante y borrarla desde la cabecera del chat
    const remainingThreadBtn = page.locator('[data-testid^="thread-item-"]').first();
    const remainingTestId = await remainingThreadBtn.getAttribute("data-testid");
    const remainingThreadId = remainingTestId!.replace("thread-item-", "");
    await remainingThreadBtn.click();

    await expect(page.getByTestId("chat-timeline")).toBeVisible();
    const headerDeleteBtn = page.getByTestId("chat-header-delete-thread-btn");
    await expect(headerDeleteBtn).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("e2e-chat-header-delete.png"),
      fullPage: false,
    });

    await headerDeleteBtn.click();
    await expect(deleteDialog).toBeVisible();
    await page.getByTestId("confirm-delete-thread-btn").click();
    await expect(deleteDialog).toBeHidden();

    // Tras borrar la conversación abierta desde la cabecera, vuelve a Home y muestra toast
    await expect(page.getByTestId("home-hub-view")).toBeVisible();
    await expect(page.getByTestId("app-confirmation-toast")).toContainText(
      "Conversación eliminada."
    );

    // Confirmar en drawer que ya no quedan conversaciones
    await page.getByTestId("open-threads-drawer-btn").click();
    await expect(page.getByTestId(`thread-item-${remainingThreadId}`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="thread-item-"]')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
