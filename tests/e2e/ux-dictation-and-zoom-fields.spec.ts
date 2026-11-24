import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 360, height: 800 },
});

test.describe("Dictado Continuo Editable y Editor Flotante Ampliado (360px)", () => {
  test("dictado continuo sin auto-envío en pausas, edición manual + reanudación, y editor flotante con confirmar/cancelar/aviso e interruptor en Ajustes", async ({
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

    await page.addInitScript(() => {
      type MockResult = { isFinal: boolean; 0: { transcript: string } };
      type MockRec = {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        maxAlternatives: number;
        onresult: ((ev: { resultIndex: number; results: MockResult[] }) => void) | null;
        onerror: ((ev: { error: string }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
        abort: () => void;
      };

      const win = window as unknown as {
        SpeechRecognition?: new () => MockRec;
        __activeMockRec?: MockRec | null;
        __mockRecCount?: number;
        __emitSpeech?: (text: string, isFinal: boolean) => void;
        __endSpeechCycle?: () => void;
      };

      win.__activeMockRec = null;
      win.__mockRecCount = 0;

      win.SpeechRecognition = class MockSpeechRecognition implements MockRec {
        lang = "es-ES";
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        onresult: ((ev: { resultIndex: number; results: MockResult[] }) => void) | null = null;
        onerror: ((ev: { error: string }) => void) | null = null;
        onend: (() => void) | null = null;

        start() {
          win.__mockRecCount = (win.__mockRecCount ?? 0) + 1;
          win.__activeMockRec = this;
        }

        stop() {
          if (win.__activeMockRec === this) {
            win.__activeMockRec = null;
          }
          this.onend?.();
        }

        abort() {
          if (win.__activeMockRec === this) {
            win.__activeMockRec = null;
          }
        }
      };

      win.__emitSpeech = (text: string, isFinal: boolean) => {
        const rec = win.__activeMockRec;
        if (!rec?.onresult) return;
        rec.onresult({
          resultIndex: 0,
          results: [{ isFinal, 0: { transcript: text } }],
        });
      };

      win.__endSpeechCycle = () => {
        const rec = win.__activeMockRec;
        if (!rec) return;
        win.__activeMockRec = null;
        rec.onend?.();
      };
    });

    const checkNoHorizontalOverflow = async () => {
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    };

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // 1. Alta local + onboarding mínimo
    await expect(page.getByTestId("auth-screen")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("auth-name-input").fill("Reformas UX Demo");
    await page.getByTestId("auth-email-input").fill("ux@obralocal.es");
    await page.getByTestId("auth-password-input").fill("ClaveUx2026");
    await page.getByTestId("auth-password-confirm-input").fill("ClaveUx2026");
    await page.getByTestId("auth-submit-btn").click();

    await expect(page.getByTestId("onboarding-step-1")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("onboarding-emitter-nif").fill("12345678Z");
    await page.getByTestId("onboarding-next-btn").click();
    await expect(page.getByTestId("onboarding-step-2")).toBeVisible();
    await page.getByTestId("onboarding-finish-btn").click();
    await expect(page.getByTestId("home-hub-view")).toBeVisible({ timeout: 15_000 });

    // 2. Dictado continuo en vivo: pausas NO auto-envían, se puede pausar/editar/seguir y enviar manualmente
    await page.getByTestId("global-nav-voice-btn").click();
    await expect(page.getByTestId("global-voice-overlay")).toBeVisible();
    await expect(page.getByTestId("voice-overlay-toggle-mic-btn")).toHaveAttribute(
      "data-state",
      "listening"
    );
    await checkNoHorizontalOverflow();

    // Fragmento parcial + final + fin de ciclo por silencio (simula pausa < 1s)
    await page.evaluate(() => {
      const w = window as unknown as {
        __emitSpeech: (t: string, f: boolean) => void;
        __endSpeechCycle: () => void;
      };
      w.__emitSpeech("Presupuesto", false);
    });
    await expect(page.getByTestId("voice-overlay-manual-input")).toHaveValue("Presupuesto");

    await page.evaluate(() => {
      const w = window as unknown as {
        __emitSpeech: (t: string, f: boolean) => void;
        __endSpeechCycle: () => void;
      };
      w.__emitSpeech("Presupuesto:", true);
      w.__endSpeechCycle();
    });

    // Esperar a que pase el auto-reinicio (180ms) y comprobar que sigue escuchando sin auto-enviar
    await page.waitForTimeout(300);
    await expect(page.getByTestId("global-voice-overlay")).toBeVisible();
    await expect(page.getByTestId("voice-overlay-toggle-mic-btn")).toHaveAttribute(
      "data-state",
      "listening"
    );
    await expect(page.getByTestId("voice-overlay-manual-input")).toHaveValue("Presupuesto:");
    const recCountAfterRestart = await page.evaluate(
      () => (window as unknown as { __mockRecCount?: number }).__mockRecCount ?? 0
    );
    expect(recCountAfterRestart).toBeGreaterThanOrEqual(2);

    // Pausar manualmente, editar texto, reanudar dictado y añadir otro fragmento
    await page.getByTestId("voice-overlay-toggle-mic-btn").click();
    await expect(page.getByTestId("voice-overlay-toggle-mic-btn")).toHaveAttribute(
      "data-state",
      "paused"
    );
    await page
      .getByTestId("voice-overlay-manual-input")
      .fill("Presupuesto: 1 plato de ducha");

    await page.getByTestId("voice-overlay-toggle-mic-btn").click();
    await expect(page.getByTestId("voice-overlay-toggle-mic-btn")).toHaveAttribute(
      "data-state",
      "listening"
    );
    await page.evaluate(() => {
      (window as unknown as { __emitSpeech: (t: string, f: boolean) => void }).__emitSpeech(
        "a 350 euros",
        true
      );
    });
    await expect(page.getByTestId("voice-overlay-manual-input")).toHaveValue(
      "Presupuesto: 1 plato de ducha a 350 euros"
    );
    await expect(page.getByTestId("global-voice-overlay")).toBeVisible();

    // Enviar manualmente
    await page.getByTestId("voice-overlay-submit-btn").click();
    await expect(page.getByTestId("global-voice-overlay")).toBeHidden();
    await expect(page.getByTestId("quote-builder-widget")).toBeVisible({ timeout: 10_000 });

    // 3. Campo ampliado flotante en QuoteBuilderWidget (descripción de partida y notas)
    await page.getByLabel("Descripción partida 1").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeVisible();
    await expect(page.getByTestId("zoom-editor-textarea")).toBeFocused();
    await checkNoHorizontalOverflow();

    await page
      .getByTestId("zoom-editor-textarea")
      .fill("Instalación completa de plato de ducha extraplano");
    await page.getByTestId("zoom-editor-confirm-btn").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeHidden();
    await expect(page.getByLabel("Descripción partida 1")).toHaveValue(
      "Instalación completa de plato de ducha extraplano"
    );

    // Cancelar con X descarta cambios
    await page.locator("#qb-notes").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeVisible();
    await page.getByTestId("zoom-editor-textarea").fill("Texto temporal que se descarta");
    await page.getByTestId("zoom-editor-cancel-btn").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeHidden();
    await expect(page.locator("#qb-notes")).toHaveValue("");

    // Escape sin cambios cierra directamente sin preguntar
    await page.locator("#qb-notes").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("zoom-editor-unsaved-prompt")).toHaveCount(0);
    await expect(page.getByTestId("zoom-editor-dialog")).toBeHidden();

    // Escape / backdrop con cambios pregunta "¿Desea guardar los cambios realizados?"
    await page.locator("#qb-notes").click();
    await page.getByTestId("zoom-editor-textarea").fill("Garantía 3 años");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("zoom-editor-unsaved-prompt")).toBeVisible();
    await expect(page.getByTestId("zoom-editor-unsaved-prompt")).toContainText(
      "¿Desea guardar los cambios realizados?"
    );

    // Segundo Escape vuelve a editar sin perder texto
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("zoom-editor-unsaved-prompt")).toBeHidden();
    await expect(page.getByTestId("zoom-editor-textarea")).toHaveValue("Garantía 3 años");

    // Toque en backdrop -> pregunta -> pulsar "No" descarta
    await page.getByTestId("zoom-editor-dialog").click({ position: { x: 8, y: 760 } });
    await expect(page.getByTestId("zoom-editor-unsaved-prompt")).toBeVisible();
    await page.getByTestId("zoom-editor-discard-btn").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeHidden();
    await expect(page.locator("#qb-notes")).toHaveValue("");

    // Toque en backdrop -> pregunta -> pulsar "Sí" guarda
    await page.locator("#qb-notes").click();
    await page.getByTestId("zoom-editor-textarea").fill("Garantía oficial 5 años");
    await page.getByTestId("zoom-editor-dialog").click({ position: { x: 8, y: 760 } });
    await expect(page.getByTestId("zoom-editor-unsaved-prompt")).toBeVisible();
    await page.getByTestId("zoom-editor-save-btn").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeHidden();
    await expect(page.locator("#qb-notes")).toHaveValue("Garantía oficial 5 años");

    // Campos excluidos (título corto y precio) NO abren tarjeta ampliada
    await page.getByTestId("quote-job-title-input").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toHaveCount(0);
    await page.getByTestId("quote-line-price-0").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toHaveCount(0);

    await page.getByTestId("quote-reject-btn").click();
    await expect(page.getByTestId("generative-widget-overlay")).toBeHidden();

    // 4. Clientes: buscador y nombre NO amplían; campo de dirección SÍ amplía y colapsa saltos de línea
    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-clients").click();
    await expect(page.getByTestId("clients-view")).toBeVisible();
    await page.getByTestId("clients-search-input").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toHaveCount(0);

    await page.getByTestId("clients-new-btn").click();
    await expect(page.getByTestId("client-profile-widget")).toBeVisible();
    await page.getByTestId("client-widget-name-input").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toHaveCount(0);

    await page.getByTestId("client-widget-address-input").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeVisible();
    await expect(page.getByTestId("zoom-editor-dialog")).toContainText("Domicilio fiscal / obra");
    await page.getByTestId("zoom-editor-textarea").fill("C/ Alcalá 120\nMadrid");
    await page.getByTestId("zoom-editor-confirm-btn").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toBeHidden();
    await expect(page.getByTestId("client-widget-address-input")).toHaveValue(
      "C/ Alcalá 120 Madrid"
    );
    await page.getByTestId("client-widget-cancel-btn").click();

    // 5. Interruptor en Ajustes: activado por defecto, desactivar impide ampliación y persiste
    await page.getByTestId("open-threads-drawer-btn").click();
    await page.getByTestId("drawer-nav-settings").click();
    await expect(page.getByTestId("settings-view")).toBeVisible();
    await checkNoHorizontalOverflow();

    const toggle = page.getByTestId("settings-expand-inputs-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await page.getByTestId("global-nav-home-btn").click();
    await page.getByTestId("home-card-clients").click();
    await page.getByTestId("clients-new-btn").click();
    await page.getByTestId("client-widget-address-input").click();
    await expect(page.getByTestId("zoom-editor-dialog")).toHaveCount(0);
    await page.getByTestId("client-widget-cancel-btn").click();

    await page.getByTestId("open-threads-drawer-btn").click();
    await page.getByTestId("drawer-nav-settings").click();
    await expect(page.getByTestId("settings-expand-inputs-toggle")).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await page.getByTestId("settings-expand-inputs-toggle").click();
    await expect(page.getByTestId("settings-expand-inputs-toggle")).toHaveAttribute(
      "aria-checked",
      "true"
    );

    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
