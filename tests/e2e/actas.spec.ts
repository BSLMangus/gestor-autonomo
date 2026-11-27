import { expect, test, type Page } from "@playwright/test";

test.use({
  viewport: { width: 360, height: 800 },
});

async function checkNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

async function drawSignatureOnCanvas(page: Page) {
  const canvas = page.getByTestId("signature-pad-canvas");
  await expect(canvas).toBeVisible();
  // SignaturePadModal resets canvas inside setTimeout(..., 30) on open
  await page.waitForTimeout(100);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const startX = box!.x + box!.width * 0.2;
  const startY = box!.y + box!.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.35, { steps: 6 });
  await page.mouse.move(box!.x + box!.width * 0.72, box!.y + box!.height * 0.65, { steps: 6 });
  await page.mouse.move(box!.x + box!.width * 0.82, box!.y + box!.height * 0.4, { steps: 4 });
  await page.mouse.up();
}

test.describe("Actas de Puesta en Marcha — Flujo completo offline móvil, modo guiado, libre, firma y PDF", () => {
  test("alta inline instalador+cliente, modo guiado 5 pasos, bidireccionalidad libre, firma táctil, descarga PDF, recarga y auto-precarga 2ª acta", async ({
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

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // 1. Alta local + onboarding mínimo (sin ficha técnica previa)
    await expect(page.getByTestId("auth-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("auth-name-input").fill("Reformas Solís S.L.");
    await page.getByTestId("auth-email-input").fill("solis@obralocal.es");
    await page.getByTestId("auth-password-input").fill("ClaveSolis2026");
    await page.getByTestId("auth-password-confirm-input").fill("ClaveSolis2026");
    await page.getByTestId("auth-submit-btn").click();

    await expect(page.getByTestId("onboarding-step-1")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("onboarding-emitter-nif").fill("12345678Z");
    await page.getByTestId("onboarding-emitter-phone").fill("600112233");
    await page.getByTestId("onboarding-emitter-address").fill("C/ Serrano 20, Madrid");
    await page.getByTestId("onboarding-next-btn").click();

    await expect(page.getByTestId("onboarding-step-2")).toBeVisible();
    await page.getByTestId("onboarding-vat-input").fill("10");
    await page.getByTestId("onboarding-finish-btn").click();
    await expect(page.getByTestId("home-hub-view")).toBeVisible({ timeout: 15_000 });

    // 2. Navegar a Actas técnicas y crear primera acta (ACT-YYYY-001)
    await page.getByTestId("open-threads-drawer-btn").click();
    await expect(page.getByTestId("app-navigation-drawer")).toBeVisible();
    await page.getByTestId("drawer-nav-actas").click();

    await expect(page.getByTestId("actas-view")).toBeVisible();
    await checkNoHorizontalOverflow(page);

    await page.getByTestId("actas-new-btn").click();
    await expect(page.getByTestId("actas-create-panel")).toBeVisible();
    await page.getByTestId("actas-confirm-create-btn").click();

    await expect(page.getByTestId("acta-editor-view")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("acta-header-code")).toHaveText(/^ACT-\d{4}-001$/);
    await checkNoHorizontalOverflow(page);

    // 3. Crear inline ficha de instalador + crear inline cliente
    await expect(page.getByTestId("acta-inline-installer-banner")).toBeVisible();
    await page.getByTestId("acta-installer-tech-name-input").fill("Carlos Solís Pérez");
    await page.getByTestId("acta-installer-tech-dni-input").fill("00000000T");
    await page.getByTestId("acta-save-installer-profile-btn").click();
    await expect(page.getByTestId("acta-inline-installer-banner")).toBeHidden();

    await page.getByTestId("acta-client-name-input").fill("Laura Torres Ruiz");
    await page.getByTestId("acta-client-nif-input").fill("45891234R");
    await page.getByTestId("acta-client-address-input").fill("C/ Alcalá 50, Madrid");
    await page.getByTestId("acta-create-inline-client-btn").click();
    await expect(page.getByTestId("acta-block-2")).toContainText("Vinculado a cliente");

    // 4. Cambiar a Modo Guiado (Asistente) y recorrer Pasos 1 -> 5
    await page.getByTestId("acta-mode-guided-btn").click();
    await expect(page.getByTestId("acta-guided-chat-panel")).toBeVisible();
    await expect(page.getByTestId("acta-guided-step-label")).toContainText("Paso 1 de 5");
    await checkNoHorizontalOverflow(page);

    await page.getByTestId("acta-guided-input").fill("Fontanería reforma parcial del baño principal");
    await page.getByTestId("acta-guided-send-btn").click();
    await expect(page.getByTestId("acta-guided-step-label")).toContainText("Paso 2 de 5");

    await page.getByTestId("acta-guided-input").fill("Confirmar datos");
    await page.getByTestId("acta-guided-send-btn").click();
    await expect(page.getByTestId("acta-guided-step-label")).toContainText("Paso 3 de 5");

    await page
      .getByTestId("acta-guided-input")
      .fill("AFCH y ACS en multicapa PEX 20mm y 16mm con termo eléctrico de 80 litros");
    await page.getByTestId("acta-guided-send-btn").click();
    await expect(page.getByTestId("acta-guided-step-label")).toContainText("Paso 4 de 5");

    await page
      .getByTestId("acta-guided-input")
      .fill("6 bares durante 30 minutos sin fugas, desagües bien y todo apto");
    await page.getByTestId("acta-guided-send-btn").click();
    await expect(page.getByTestId("acta-guided-step-label")).toContainText("Paso 5 de 5");
    await expect(page.getByTestId("acta-guided-closure-panel")).toBeVisible();

    // 5. Cambiar a Rellenar Libremente y verificar bidireccionalidad sin pérdida de datos
    await page.getByTestId("acta-mode-free-btn").click();
    await expect(page.getByTestId("acta-block-3")).toBeVisible();
    await expect(page.getByTestId("acta-material-tuberias-input")).toHaveValue(/Multicapa|PEX/i);

    await page.getByTestId("acta-block-4").locator("button").first().click();
    await expect(page.getByTestId("acta-presion-prueba-input")).toHaveValue("6");
    await expect(page.getByTestId("acta-duracion-prueba-input")).toHaveValue("30");

    // 6. Firmas táctiles (instalador habitual + cliente) y descarga de PDF A4
    await page.getByTestId("acta-block-7").locator("button").first().click();

    await page.getByTestId("acta-open-installer-signature-btn").click();
    await expect(page.getByTestId("signature-pad-modal")).toBeVisible();
    await expect(page.getByTestId("signature-save-default-checkbox")).toBeChecked();
    await drawSignatureOnCanvas(page);
    await page.getByTestId("signature-pad-confirm-btn").click();
    await expect(page.getByTestId("signature-pad-modal")).toBeHidden();

    await page.getByTestId("acta-open-client-signature-btn").click();
    await expect(page.getByTestId("signature-pad-modal")).toBeVisible();
    await drawSignatureOnCanvas(page);
    await page.getByTestId("signature-pad-confirm-btn").click();
    await expect(page.getByTestId("signature-pad-modal")).toBeHidden();

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("acta-generate-share-pdf-btn").click();
    const downloadedPdf = await downloadPromise;
    expect(downloadedPdf.suggestedFilename()).toMatch(/^ACT-\d{4}-001\.pdf$/);
    await expect(page.getByTestId("acta-editor-view")).toContainText("Firmada");

    // 7. Recargar la app y verificar persistencia + auto-precarga en 2.ª acta
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("acta-editor-view")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("acta-header-code")).toHaveText(/^ACT-\d{4}-001$/);
    await expect(page.getByTestId("acta-editor-view")).toContainText("Firmada");
    await expect(page.getByTestId("acta-block-2")).toContainText("Laura Torres Ruiz");
    await page.getByTestId("acta-block-2").locator("button").first().click();
    await expect(page.getByTestId("acta-client-name-input")).toHaveValue("Laura Torres Ruiz");

    await page.getByTestId("acta-back-btn").click();
    await expect(page.getByTestId("actas-view")).toBeVisible();
    const firstActaCard = page.locator('[data-testid^="acta-list-item-"]', { hasText: "001" }).first();
    await expect(firstActaCard).toBeVisible();
    await expect(firstActaCard).toContainText("Firmada");

    // Al pulsar un acta firmada se abre primero DocumentPreviewModal y "Ver / Editar ficha" navega al editor
    await firstActaCard.click();
    await expect(page.getByTestId("document-preview-modal")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("doc-preview-detail-btn")).toContainText("Ver / Editar ficha");
    await expect(page.getByTestId("doc-preview-page-1")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("doc-preview-detail-btn").click();
    await expect(page.getByTestId("document-preview-modal")).toBeHidden();
    await expect(page.getByTestId("acta-editor-view")).toBeVisible();
    await page.getByTestId("acta-back-btn").click();
    await expect(page.getByTestId("actas-view")).toBeVisible();

    // Crear 2ª acta y verificar que la ficha y firma habituales ya vienen cargadas sin banner
    await page.getByTestId("actas-new-btn").click();
    await expect(page.getByTestId("actas-create-panel")).toBeVisible();
    await page.getByTestId("actas-confirm-create-btn").click();

    await expect(page.getByTestId("acta-editor-view")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("acta-header-code")).toHaveText(/^ACT-\d{4}-002$/);
    await expect(page.getByTestId("acta-inline-installer-banner")).toHaveCount(0);
    await expect(page.getByTestId("acta-block-2")).toContainText("Ficha habitual cargada");
    await expect(page.getByTestId("acta-installer-tech-name-input")).toHaveValue("Carlos Solís Pérez");

    await page.getByTestId("acta-block-7").locator("button").first().click();
    await expect(page.getByTestId("acta-block-7")).toContainText("Lista");

    // Verificar botón "Vista previa" en borrador de acta
    await expect(page.getByTestId("acta-draft-preview-btn")).toBeVisible();
    await page.getByTestId("acta-draft-preview-btn").click();
    await expect(page.getByTestId("document-preview-modal")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("doc-preview-draft-badge")).toContainText("BORRADOR");
    await expect(page.getByTestId("doc-preview-page-1")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("doc-preview-close-btn").click();
    await expect(page.getByTestId("document-preview-modal")).toBeHidden();

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
