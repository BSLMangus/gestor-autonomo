import { describe, expect, it } from "vitest";
import { LocalInferenceAdapterImpl } from "../src/agent/inference/localInferenceAdapter";
import {
  processActaGuidedTurn,
  resolveInitialGuidedStep,
} from "../src/features/actas/actaGuidedOrchestrator";
import { buildDefaultActaData } from "../src/features/actas/actaTemplates";

describe("Fase 4 Actas — Modo Guiado (Máquina de Estados, Parser Español e Inferencia Híbrida)", () => {
  it("completa flujo guiado de fontanería de 5 pasos en español de obra", async () => {
    let data = buildDefaultActaData({
      codigoActa: "ACT-2026-001",
      fechaEmisionIso: "2026-11-25",
      especialidad: "electricidad",
      instalador: {
        nombre_razon_social: "Fontanería Sol SL",
        nif_cif: "12345678Z",
        tecnico_nombre: "Pedro López",
        tecnico_dni: "00000000T",
      },
      cliente: {
        nombre_razon_social: "Marta Gómez",
        nif_cif: "11111111H",
        direccion_emplazamiento: "C/ Mayor 10, 3º 2ª",
      },
    });

    // Paso 1: Identificación (cambia especialidad a fontanería y guarda alcance)
    const t1 = await processActaGuidedTurn({
      currentStep: "STEP_1_IDENTIFICACION",
      data,
      userText: "Reforma parcial de fontanería en baño principal",
    });
    expect(t1.nextData.especialidad).toBe("fontaneria");
    expect(t1.nextData.tipo_actuacion).toBe("modificacion_parcial");
    expect(t1.nextData.alcance_ubicacion).toContain("baño principal");
    expect(t1.nextStep).toBe("STEP_2_INTERVINIENTES");
    data = t1.nextData;

    // Paso 2: Confirmación rápida de intervinientes
    const t2 = await processActaGuidedTurn({
      currentStep: t1.nextStep,
      data,
      userText: "Confirmado",
    });
    expect(t2.step2Confirmed).toBe(true);
    expect(t2.nextStep).toBe("STEP_3_MEMORIA_TECNICA");
    data = t2.nextData;

    // Paso 3: Memoria de fontanería
    const t3 = await processActaGuidedTurn({
      currentStep: t2.nextStep,
      data,
      userText:
        "AFCH y ACS con tubería multicapa PEX de 20mm y 16mm, llaves en falso techo y termo 80L",
    });
    expect(t3.nextData.memoria_fontaneria?.material_tuberias).toBe("Multicapa PEX-Al-PEX");
    expect(t3.nextData.memoria_fontaneria?.diametros_mm).toContain("20mm");
    expect(t3.nextData.memoria_fontaneria?.equipos_sanitarios).toContain("termo 80L");
    expect(t3.nextStep).toBe("STEP_4_PRUEBAS_OBRA");
    data = t3.nextData;

    // Paso 4: Pruebas en obra
    const t4 = await processActaGuidedTurn({
      currentStep: t3.nextStep,
      data,
      userText: "6 bares durante 30 minutos sin fugas, presión de servicio 3 bares",
    });
    expect(t4.nextData.pruebas_fontaneria?.presion_prueba_bar).toBe(6);
    expect(t4.nextData.pruebas_fontaneria?.duracion_prueba_min).toBe(30);
    expect(t4.nextData.pruebas_fontaneria?.estanqueidad_sin_fugas).toBe(true);
    expect(t4.nextData.pruebas_fontaneria?.presion_servicio_bar).toBe(3);
    expect(t4.nextStep).toBe("STEP_5_FOTOS_Y_FIRMA");
  });

  it("completa flujo guiado de electricidad con circuitos y mediciones", async () => {
    let data = buildDefaultActaData({
      codigoActa: "ACT-2026-002",
      fechaEmisionIso: "2026-11-25",
      especialidad: "electricidad",
      alcanceUbicacion: "Cuadro eléctrico vivienda 1º A",
      instalador: {
        nombre_razon_social: "Electro Norte",
        nif_cif: "12345678Z",
        tecnico_nombre: "Luis Ruiz",
        tecnico_dni: "00000000T",
      },
      cliente: {
        nombre_razon_social: "Juan Torres",
        nif_cif: "11111111H",
        direccion_emplazamiento: "C/ Alcalá 5",
      },
    });

    const t3 = await processActaGuidedTurn({
      currentStep: "STEP_3_MEMORIA_TECNICA",
      data,
      step2Confirmed: true,
      userText:
        "230V monofásica, IGA 25A con sobretensiones, diferencial 40A/30mA, C1 10A 1,5mm2 y C2 16A 2,5mm2",
    });
    expect(t3.nextData.memoria_electricidad?.tension_nominal).toBe("230V Monofásica");
    expect(t3.nextData.memoria_electricidad?.iga_amperios).toBe(25);
    expect(t3.nextData.memoria_electricidad?.circuitos.length).toBe(2);
    expect(t3.nextStep).toBe("STEP_4_PRUEBAS_OBRA");
    data = t3.nextData;

    const t4 = await processActaGuidedTurn({
      currentStep: t3.nextStep,
      data,
      step2Confirmed: true,
      userText: "Aislamiento 250 MΩ, tierra 14 ohmios, disparo 18 ms y 230V apto",
    });
    expect(t4.nextData.pruebas_electricidad?.resistencia_aislamiento_mohm).toBe(250);
    expect(t4.nextData.pruebas_electricidad?.resistencia_tierra_ohm).toBe(14);
    expect(t4.nextData.pruebas_electricidad?.disparo_diferencial_ms).toBe(18);
    expect(t4.nextStep).toBe("STEP_5_FOTOS_Y_FIRMA");
  });

  it("maneja ask_help_example con 2 ejemplos reales y go_back sin perder datos", async () => {
    const data = buildDefaultActaData({
      codigoActa: "ACT-2026-003",
      fechaEmisionIso: "2026-11-25",
      especialidad: "fontaneria",
      alcanceUbicacion: "Reforma baño",
    });

    const helpTurn = await processActaGuidedTurn({
      currentStep: "STEP_4_PRUEBAS_OBRA",
      data,
      userText: "Dame un ejemplo, no sé qué poner",
    });
    expect(helpTurn.intent).toBe("ask_help_example");
    expect(helpTurn.nextStep).toBe("STEP_4_PRUEBAS_OBRA");
    expect(helpTurn.assistantReply).toContain("bares");

    const backTurn = await processActaGuidedTurn({
      currentStep: "STEP_4_PRUEBAS_OBRA",
      data,
      userText: "Volver atrás",
    });
    expect(backTurn.intent).toBe("go_back");
    expect(backTurn.nextStep).toBe("STEP_3_MEMORIA_TECNICA");
    expect(backTurn.nextData.alcance_ubicacion).toBe("Reforma baño");
  });

  it("usa JSON estricto del LLM local cuando es válido y degrada limpiamente a determinista si falla", async () => {
    const data = buildDefaultActaData({
      codigoActa: "ACT-2026-004",
      fechaEmisionIso: "2026-11-25",
      especialidad: "fontaneria",
      alcanceUbicacion: "Baño planta baja",
    });

    const validLlm = new LocalInferenceAdapterImpl(async () =>
      JSON.stringify({
        intent: "answer_data",
        extracted_fields: {
          material_tuberias: "Cobre",
          diametros_mm: "18mm y 15mm",
          equipos_sanitarios: "Caldera mural y plato ducha",
        },
        assistant_reply: "Memoria de cobre guardada.",
      })
    );

    const okRes = await processActaGuidedTurn({
      currentStep: "STEP_3_MEMORIA_TECNICA",
      data,
      userText: "Todo en cobre de 18 y 15 con caldera mural",
      inferenceAdapter: validLlm,
    });
    expect(okRes.engineUsed).toBe("mediapipe_local_llm");
    expect(okRes.nextData.memoria_fontaneria?.material_tuberias).toBe("Cobre");
    expect(okRes.nextStep).toBe("STEP_4_PRUEBAS_OBRA");

    const brokenLlm = new LocalInferenceAdapterImpl(async () => "RESPUESTA NO JSON INVALIDA");
    const fallbackRes = await processActaGuidedTurn({
      currentStep: "STEP_4_PRUEBAS_OBRA",
      data: okRes.nextData,
      userText: "6 bares durante 30 minutos sin fugas",
      inferenceAdapter: brokenLlm,
    });
    expect(fallbackRes.engineUsed).toBe("mediapipe_fallback_deterministic");
    expect(fallbackRes.nextData.pruebas_fontaneria?.presion_prueba_bar).toBe(6);
    expect(fallbackRes.nextData.pruebas_fontaneria?.duracion_prueba_min).toBe(30);
    expect(fallbackRes.nextStep).toBe("STEP_5_FOTOS_Y_FIRMA");
  });

  it("sincroniza el paso inicial cuando el usuario ya rellenó bloques en Modo Libre", () => {
    const data = buildDefaultActaData({
      codigoActa: "ACT-2026-005",
      fechaEmisionIso: "2026-11-25",
      especialidad: "fontaneria",
      alcanceUbicacion: "Cocina y lavadero",
      instalador: {
        nombre_razon_social: "Instalador SL",
        tecnico_nombre: "Ana",
      },
      cliente: {
        nombre_razon_social: "Carlos",
        direccion_emplazamiento: "C/ Sol 3",
      },
      equiposSanitariosSugeridos: "Fregadero y termo",
    });
    data.memoria_fontaneria!.material_tuberias = "Multicapa PEX-Al-PEX";

    expect(resolveInitialGuidedStep(data, false)).toBe("STEP_2_INTERVINIENTES");
    expect(resolveInitialGuidedStep(data, true)).toBe("STEP_4_PRUEBAS_OBRA");
  });
});
