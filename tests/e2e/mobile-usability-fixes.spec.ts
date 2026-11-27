import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 360, height: 800 },
});

test.describe("Usabilidad móvil 360px — Clientes, Precio en partidas y Obras canceladas", () => {
  test("Clientes sin overflow horizontal a 360px, input Precio fluido y ocultación de '+ Presupuesto en chat' en obra cancelada", async ({
    page,
    context,
  }) => {
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

    // 1. Alta local y onboarding mínimo con IVA 10%
    await expect(page.getByTestId("auth-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("auth-name-input").fill("Instalaciones Demo");
    await page.getByTestId("auth-email-input").fill("demo@obralocal.es");
    await page.getByTestId("auth-password-input").fill("ClaveSegura2026");
    await page.getByTestId("auth-password-confirm-input").fill("ClaveSegura2026");
    await page.getByTestId("auth-submit-btn").click();

    await expect(page.getByTestId("onboarding-step-1")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("onboarding-emitter-nif").fill("12345678Z");
    await page.getByTestId("onboarding-next-btn").click();

    await expect(page.getByTestId("onboarding-step-2")).toBeVisible();
    await page.getByTestId("onboarding-vat-input").fill("10");
    await page.getByTestId("onboarding-finish-btn").click();

    await expect(page.getByTestId("home-hub-view")).toBeVisible({ timeout: 15_000 });

    // 2. Sección Clientes a 360px: sin scroll horizontal y botón '+ Nuevo cliente' dentro del viewport
    await page.getByTestId("home-card-clients").click();
    await expect(page.getByTestId("clients-view")).toBeVisible();

    const checkNoHorizontalOverflow = async () => {
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    };

    const assertInsideViewport = async (locator: ReturnType<typeof page.locator>) => {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360.5);
    };

    await checkNoHorizontalOverflow();
    const newClientBtn = page.getByTestId("clients-new-btn");
    await expect(newClientBtn).toBeVisible();
    await assertInsideViewport(newClientBtn);

    // Crear un cliente con nombre y dirección largos para verificar que tampoco desborda
    await newClientBtn.click();
    await expect(page.getByTestId("client-profile-widget")).toBeVisible();
    await checkNoHorizontalOverflow();
    await page
      .getByTestId("client-widget-name-input")
      .fill("ConstruccionesYReformasIntegralesDelMediterraneoSur2026");
    await page.getByTestId("client-widget-phone-input").fill("611223344");
    await page
      .getByTestId("client-widget-address-input")
      .fill("AvenidaDeLaConstitucionNumero142EscaleraBPiso4PuertaIzquierdaMadrid");
    await page.getByTestId("client-widget-save-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    await checkNoHorizontalOverflow();
    await assertInsideViewport(newClientBtn);
    const createdClientCard = page.locator('[data-testid^="client-card-"]').first();
    await expect(createdClientCard).toBeVisible();
    await assertInsideViewport(createdClientCard);

    // 3. Campo Precio en 'Añadir partida': escritura fluida, borrado completo, coma decimal y cálculo
    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-quotes").click();
    await expect(page.getByTestId("quotes-view")).toBeVisible();
    await page.getByTestId("quotes-new-btn").click();
    await expect(page.getByTestId("quote-builder-widget")).toBeVisible();

    await page.getByTestId("quote-add-line").click();
    const priceInput = page.getByTestId("quote-line-price-0");
    await expect(priceInput).toBeVisible();
    await expect(priceInput).toHaveAttribute("type", "text");
    await expect(priceInput).toHaveAttribute("inputmode", "decimal");
    await expect(priceInput).toHaveAttribute("placeholder", "0.00");
    await expect(priceInput).toHaveValue("");

    // Teclear entero "45" carácter a carácter y comprobar formato al salir del campo
    await priceInput.click();
    await priceInput.pressSequentially("45");
    await expect(priceInput).toHaveValue("45");
    await expect(page.getByTestId("quote-total-display")).toContainText("49,50");
    await priceInput.blur();
    await expect(priceInput).toHaveValue("45.00");

    // Borrar con retroceso sin bloqueos desde el final del valor
    await priceInput.click();
    await priceInput.press("End");
    for (let i = 0; i < 5; i += 1) {
      await priceInput.press("Backspace");
    }
    await expect(priceInput).toHaveValue("");
    await expect(page.getByTestId("quote-total-display")).toContainText("0,00");

    // Verificar también que "0" -> blur ("0.00") -> onFocus limpia a ""
    await priceInput.pressSequentially("0");
    await priceInput.blur();
    await expect(priceInput).toHaveValue("0.00");
    await priceInput.click();
    await expect(priceInput).toHaveValue("");

    // Comprobar que dígitos 5-9 no redondean a 0.01 mientras se escribe
    await priceInput.pressSequentially("5");
    await expect(priceInput).toHaveValue("5");
    await priceInput.press("Backspace");
    await expect(priceInput).toHaveValue("");

    // Teclear decimal con coma "120,75" y comprobar normalización + subtotal/total (120,75 + 10% = 132,83 €)
    await priceInput.pressSequentially("120,75");
    await expect(priceInput).toHaveValue("120.75");
    await expect(page.getByTestId("quote-total-display")).toContainText("132,83");
    await priceInput.blur();
    await expect(priceInput).toHaveValue("120.75");

    // Cerrar presupuesto descartando borrador
    await page.getByTestId("quote-reject-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    // 4. Ocultar '+ Presupuesto en chat' cuando el estado es 'cancelado'
    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-jobs").click();
    await expect(page.getByTestId("jobs-view")).toBeVisible();

    await page.getByTestId("jobs-new-btn").click();
    await page.getByPlaceholder("Título de la obra *").fill("Obra de prueba para cancelación");
    const clientSelect = page.locator('[data-testid="jobs-view"] form select');
    await clientSelect.selectOption({ index: 1 });

    // Verificar selector "Modalidad de presupuesto / cobro" en creación de obra
    const billingSelector = page.getByTestId("billing-mode-selector");
    await expect(billingSelector).toBeVisible();
    await expect(billingSelector).toContainText("Modalidad de presupuesto / cobro");
    await page.getByTestId("billing-mode-option-solo_mano_obra").click();
    await expect(page.getByTestId("billing-submode-por_horas")).toBeVisible();
    await expect(page.getByTestId("billing-submode-precio_cerrado")).toBeVisible();
    await page.getByTestId("billing-mode-option-partidas_mas_horas").click();
    await page.getByTestId("billing-hours-input").fill("4");

    await page.getByRole("button", { name: "Crear obra" }).click();

    await expect(page.getByTestId("job-detail-drawer")).toBeVisible();
    await expect(page.locator('[data-testid^="job-detail-billing-badge-"]')).toContainText(
      "Partidas + Horas"
    );
    await expect(page.getByTestId("job-detail-start-quote-btn")).toBeVisible();

    await page.getByRole("button", { name: "Pasar a cancelado" }).click();
    await expect(page.getByTestId("job-detail-drawer")).toContainText("cancelado");
    await expect(page.getByTestId("job-detail-start-quote-btn")).toHaveCount(0);

    // También comprobar en ficha de cliente que no aparece '+ Presupuesto' para esa obra cancelada
    await page.getByTestId("job-detail-open-client-btn").click();
    await expect(page.getByTestId("client-profile-view")).toBeVisible();
    await checkNoHorizontalOverflow();
    await expect(page.getByRole("button", { name: "+ Presupuesto" })).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
