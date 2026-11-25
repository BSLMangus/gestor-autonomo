import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import type {
  ActaPuestaEnMarchaData,
  InferenceEngine,
} from "../../core/contracts/types";
import {
  detectGuidedIntent,
  extractActaFieldsDeterministically,
  getStepExamples,
  GuidedTurnLlmResponseSchema,
  type GuidedExtractedFields,
  type GuidedIntent,
  type GuidedStep,
} from "./actaDeterministicParser";
import {
  createDefaultMemoriaElectricidad,
  createDefaultMemoriaFontaneria,
  createDefaultPruebasElectricidad,
  createDefaultPruebasFontaneria,
  getActaMantenimientoTemplate,
  isDefaultMantenimientoText,
} from "./actaTemplates";

export const ORDERED_GUIDED_STEPS: readonly GuidedStep[] = [
  "STEP_1_IDENTIFICACION",
  "STEP_2_INTERVINIENTES",
  "STEP_3_MEMORIA_TECNICA",
  "STEP_4_PRUEBAS_OBRA",
  "STEP_5_FOTOS_Y_FIRMA",
] as const;

export const STEP_META: Record<
  GuidedStep,
  { index: number; label: string; shortTitle: string }
> = {
  STEP_1_IDENTIFICACION: {
    index: 1,
    label: "Identificación y alcance",
    shortTitle: "Identificación",
  },
  STEP_2_INTERVINIENTES: {
    index: 2,
    label: "Instalador y cliente",
    shortTitle: "Intervinientes",
  },
  STEP_3_MEMORIA_TECNICA: {
    index: 3,
    label: "Memoria técnica",
    shortTitle: "Memoria",
  },
  STEP_4_PRUEBAS_OBRA: {
    index: 4,
    label: "Pruebas en obra",
    shortTitle: "Pruebas",
  },
  STEP_5_FOTOS_Y_FIRMA: {
    index: 5,
    label: "Fotos y firma táctil",
    shortTitle: "Fotos/Firma",
  },
};

export interface GuidedTurnResult {
  nextStep: GuidedStep;
  step2Confirmed: boolean;
  nextData: ActaPuestaEnMarchaData;
  intent: GuidedIntent;
  assistantReply: string;
  appliedLabels: string[];
  missingFields: string[];
  engineUsed: InferenceEngine;
}

export function computeMissingFieldsForStep(
  step: GuidedStep,
  data: ActaPuestaEnMarchaData
): string[] {
  const missing: string[] = [];
  if (step === "STEP_1_IDENTIFICACION") {
    if (!data.alcance_ubicacion.trim()) {
      missing.push("alcance_ubicacion");
    }
    return missing;
  }

  if (step === "STEP_2_INTERVINIENTES") {
    if (!data.instalador.nombre_razon_social.trim()) missing.push("instalador_nombre");
    if (!data.instalador.tecnico_nombre.trim()) missing.push("tecnico_nombre");
    if (!data.cliente.nombre_razon_social.trim()) missing.push("cliente_nombre");
    if (!data.cliente.direccion_emplazamiento.trim()) missing.push("cliente_direccion");
    return missing;
  }

  const needsElec = data.especialidad === "electricidad" || data.especialidad === "mixta";
  const needsFont = data.especialidad === "fontaneria" || data.especialidad === "mixta";

  if (step === "STEP_3_MEMORIA_TECNICA") {
    if (needsElec) {
      const me = data.memoria_electricidad;
      if (!me || (!me.circuitos.length && !me.receptores_conectados.trim())) {
        missing.push("circuitos_o_receptores");
      }
      if (!me?.diferencial_calibre.trim()) {
        missing.push("diferencial_calibre");
      }
    }
    if (needsFont) {
      const mf = data.memoria_fontaneria;
      if (!mf?.material_tuberias.trim()) {
        missing.push("material_tuberias");
      }
      if (!mf?.equipos_sanitarios.trim() && !mf?.diametros_mm.trim()) {
        missing.push("diametros_o_equipos_sanitarios");
      }
    }
    return missing;
  }

  if (step === "STEP_4_PRUEBAS_OBRA") {
    if (needsElec) {
      const pe = data.pruebas_electricidad;
      if (
        !pe ||
        (pe.resistencia_aislamiento_mohm === null &&
          pe.resistencia_tierra_ohm === null &&
          pe.disparo_diferencial_ms === null)
      ) {
        missing.push("mediciones_electricas");
      }
    }
    if (needsFont) {
      const pf = data.pruebas_fontaneria;
      if (
        !pf ||
        pf.presion_prueba_bar === null ||
        pf.duracion_prueba_min === null
      ) {
        missing.push("presion_y_duracion_prueba");
      }
    }
    return missing;
  }

  if (step === "STEP_5_FOTOS_Y_FIRMA") {
    if (data.fotos.length < 2) missing.push("fotos_min_2");
  }
  return missing;
}

export function resolveInitialGuidedStep(
  data: ActaPuestaEnMarchaData,
  step2Confirmed = false
): GuidedStep {
  if (computeMissingFieldsForStep("STEP_1_IDENTIFICACION", data).length > 0) {
    return "STEP_1_IDENTIFICACION";
  }
  if (!step2Confirmed || computeMissingFieldsForStep("STEP_2_INTERVINIENTES", data).length > 0) {
    return "STEP_2_INTERVINIENTES";
  }
  if (computeMissingFieldsForStep("STEP_3_MEMORIA_TECNICA", data).length > 0) {
    return "STEP_3_MEMORIA_TECNICA";
  }
  if (computeMissingFieldsForStep("STEP_4_PRUEBAS_OBRA", data).length > 0) {
    return "STEP_4_PRUEBAS_OBRA";
  }
  return "STEP_5_FOTOS_Y_FIRMA";
}

export function buildStepOpeningPrompt(
  step: GuidedStep,
  data: ActaPuestaEnMarchaData
): string {
  switch (step) {
    case "STEP_1_IDENTIFICACION":
      return `Empezamos con el acta ${data.codigo_acta}. Dime la especialidad (electricidad, fontanería o mixta), el tipo de actuación y la zona exacta de la obra.`;
    case "STEP_2_INTERVINIENTES": {
      const inst = data.instalador.nombre_razon_social || "Sin nombre de instalador";
      const tech = data.instalador.tecnico_nombre || "Técnico sin asignar";
      const cli = data.cliente.nombre_razon_social || "Cliente pendiente";
      const dir = data.cliente.direccion_emplazamiento || "Sin dirección";
      const missing = computeMissingFieldsForStep("STEP_2_INTERVINIENTES", data);
      if (missing.length > 0) {
        return `Tengo precargado Instalador: ${inst} (${tech}) y Cliente: ${cli} (${dir}). Faltan datos obligatorios: dime el nombre del técnico/instalador o del cliente que falte para completar este paso.`;
      }
      return `Tengo precargado Instalador: ${inst} (${tech}) y Cliente: ${cli} en ${dir}. ¿Confirmas estos datos o quieres corregir alguno?`;
    }
    case "STEP_3_MEMORIA_TECNICA":
      if (data.especialidad === "fontaneria") {
        return "Paso 3 · Memoria de fontanería: indícame el material de las tuberías, diámetros, ubicación de llaves de corte y los equipos sanitarios instalados.";
      }
      if (data.especialidad === "mixta") {
        return "Paso 3 · Memoria técnica mixta: indícame protecciones/circuitos eléctricos y material, diámetros y equipos de fontanería instalados.";
      }
      return "Paso 3 · Memoria eléctrica: dime la tensión (230V/400V), IGA, diferencial, circuitos (C1, C2...) o los receptores conectados.";
    case "STEP_4_PRUEBAS_OBRA":
      if (data.especialidad === "fontaneria") {
        return "Paso 4 · Pruebas de obra: dime la presión de prueba en bares, duración en minutos y si la estanqueidad es sin fugas.";
      }
      if (data.especialidad === "mixta") {
        return "Paso 4 · Pruebas en obra: indícame las mediciones eléctricas (aislamiento MΩ, tierra Ω, disparo ms) y la prueba hidráulica (bares y minutos sin fugas).";
      }
      return "Paso 4 · Pruebas eléctricas: indícame los valores medidos (aislamiento en MΩ, tierra en Ω, disparo diferencial en ms o tensión en V) y si es apto.";
    case "STEP_5_FOTOS_Y_FIRMA":
      return "Datos técnicos completados. Adjunta de 2 a 4 fotos de la instalación, recoge la firma táctil del cliente abajo y pulsa «Generar y Compartir PDF».";
  }
}

export function applyExtractedFieldsToActa(
  data: ActaPuestaEnMarchaData,
  extracted: GuidedExtractedFields
): { nextData: ActaPuestaEnMarchaData; appliedLabels: string[] } {
  const appliedLabels: string[] = [];
  let next: ActaPuestaEnMarchaData = {
    ...data,
    instalador: { ...data.instalador },
    cliente: { ...data.cliente },
  };

  if (extracted.especialidad && extracted.especialidad !== next.especialidad) {
    const esp = extracted.especialidad;
    next.especialidad = esp;
    if (esp === "electricidad" || esp === "mixta") {
      next.memoria_electricidad =
        next.memoria_electricidad ?? createDefaultMemoriaElectricidad();
      next.pruebas_electricidad =
        next.pruebas_electricidad ?? createDefaultPruebasElectricidad();
    }
    if (esp === "fontaneria" || esp === "mixta") {
      next.memoria_fontaneria =
        next.memoria_fontaneria ?? createDefaultMemoriaFontaneria();
      next.pruebas_fontaneria =
        next.pruebas_fontaneria ?? createDefaultPruebasFontaneria();
    }
    if (isDefaultMantenimientoText(next.instrucciones_mantenimiento)) {
      next.instrucciones_mantenimiento = getActaMantenimientoTemplate(esp);
    }
    appliedLabels.push(`Especialidad: ${esp}`);
  }

  if (extracted.tipo_actuacion) {
    next.tipo_actuacion = extracted.tipo_actuacion;
    appliedLabels.push(`Actuación: ${extracted.tipo_actuacion.replace("_", " ")}`);
  }

  if (extracted.alcance_ubicacion?.trim()) {
    next.alcance_ubicacion = extracted.alcance_ubicacion.trim();
    appliedLabels.push("Alcance en obra");
  }

  if (extracted.instalador_nombre?.trim()) {
    next.instalador.nombre_razon_social = extracted.instalador_nombre.trim();
    appliedLabels.push("Instalador");
  }
  if (extracted.instalador_nif?.trim()) {
    next.instalador.nif_cif = extracted.instalador_nif.trim().toUpperCase();
    appliedLabels.push("NIF instalador");
  }
  if (extracted.tecnico_nombre?.trim()) {
    next.instalador.tecnico_nombre = extracted.tecnico_nombre.trim();
    appliedLabels.push("Técnico");
  }
  if (extracted.tecnico_dni?.trim()) {
    next.instalador.tecnico_dni = extracted.tecnico_dni.trim().toUpperCase();
    appliedLabels.push("DNI técnico");
  }
  if (extracted.num_registro_empresa?.trim()) {
    next.instalador.num_registro_empresa = extracted.num_registro_empresa.trim();
    appliedLabels.push("Reg. REIE/RII");
  }
  if (extracted.cliente_nombre?.trim()) {
    next.cliente.nombre_razon_social = extracted.cliente_nombre.trim();
    appliedLabels.push("Cliente");
  }
  if (extracted.cliente_nif?.trim()) {
    next.cliente.nif_cif = extracted.cliente_nif.trim().toUpperCase();
    appliedLabels.push("NIF cliente");
  }
  if (extracted.cliente_direccion?.trim()) {
    next.cliente.direccion_emplazamiento = extracted.cliente_direccion.trim();
    appliedLabels.push("Dirección emplazamiento");
  }

  const needsElec = next.especialidad === "electricidad" || next.especialidad === "mixta";
  const needsFont = next.especialidad === "fontaneria" || next.especialidad === "mixta";

  if (needsElec) {
    const me = { ...(next.memoria_electricidad ?? createDefaultMemoriaElectricidad()) };
    let meChanged = false;
    if (extracted.tension_nominal) {
      me.tension_nominal = extracted.tension_nominal;
      meChanged = true;
      appliedLabels.push(extracted.tension_nominal);
    }
    if (extracted.iga_amperios !== undefined) {
      me.iga_amperios = Math.max(0, extracted.iga_amperios);
      meChanged = true;
      appliedLabels.push(`IGA ${me.iga_amperios}A`);
    }
    if (extracted.protector_sobretensiones !== undefined) {
      me.protector_sobretensiones = extracted.protector_sobretensiones;
      meChanged = true;
      appliedLabels.push(
        extracted.protector_sobretensiones ? "Con sobretensiones" : "Sin sobretensiones"
      );
    }
    if (extracted.diferencial_calibre?.trim()) {
      me.diferencial_calibre = extracted.diferencial_calibre.trim();
      meChanged = true;
      appliedLabels.push(`Diferencial ${me.diferencial_calibre}`);
    }
    if (extracted.circuitos && extracted.circuitos.length > 0) {
      me.circuitos = [...me.circuitos, ...extracted.circuitos];
      meChanged = true;
      appliedLabels.push(`${extracted.circuitos.length} circuito(s)`);
    }
    if (extracted.receptores_conectados?.trim()) {
      me.receptores_conectados = extracted.receptores_conectados.trim();
      meChanged = true;
      appliedLabels.push("Receptores");
    }
    if (meChanged) {
      next = { ...next, memoria_electricidad: me };
    }

    const pe = { ...(next.pruebas_electricidad ?? createDefaultPruebasElectricidad()) };
    let peChanged = false;
    if (extracted.resistencia_aislamiento_mohm !== undefined) {
      pe.resistencia_aislamiento_mohm = extracted.resistencia_aislamiento_mohm;
      peChanged = true;
      if (pe.resistencia_aislamiento_mohm !== null) {
        appliedLabels.push(`Aislamiento ${pe.resistencia_aislamiento_mohm} MΩ`);
      }
    }
    if (extracted.resistencia_tierra_ohm !== undefined) {
      pe.resistencia_tierra_ohm = extracted.resistencia_tierra_ohm;
      peChanged = true;
      if (pe.resistencia_tierra_ohm !== null) {
        appliedLabels.push(`Tierra ${pe.resistencia_tierra_ohm} Ω`);
      }
    }
    if (extracted.disparo_diferencial_ms !== undefined) {
      pe.disparo_diferencial_ms = extracted.disparo_diferencial_ms;
      peChanged = true;
      if (pe.disparo_diferencial_ms !== null) {
        appliedLabels.push(`Disparo ${pe.disparo_diferencial_ms} ms`);
      }
    }
    if (extracted.tension_comprobada_v !== undefined) {
      pe.tension_comprobada_v = extracted.tension_comprobada_v;
      peChanged = true;
      if (pe.tension_comprobada_v !== null) {
        appliedLabels.push(`${pe.tension_comprobada_v} V`);
      }
    }
    if (extracted.resultado_apto !== undefined) {
      pe.resultado_apto = extracted.resultado_apto;
      peChanged = true;
    }
    if (peChanged) {
      next = { ...next, pruebas_electricidad: pe };
    }
  }

  if (needsFont) {
    const mf = { ...(next.memoria_fontaneria ?? createDefaultMemoriaFontaneria()) };
    let mfChanged = false;
    if (extracted.redes_intervenidas && extracted.redes_intervenidas.length > 0) {
      mf.redes_intervenidas = extracted.redes_intervenidas;
      mfChanged = true;
      appliedLabels.push(extracted.redes_intervenidas.join("/"));
    }
    if (extracted.material_tuberias?.trim()) {
      mf.material_tuberias = extracted.material_tuberias.trim();
      mfChanged = true;
      appliedLabels.push(mf.material_tuberias);
    }
    if (extracted.diametros_mm?.trim()) {
      mf.diametros_mm = extracted.diametros_mm.trim();
      mfChanged = true;
      appliedLabels.push(`Diámetros ${mf.diametros_mm}`);
    }
    if (extracted.ubicacion_llaves_corte?.trim()) {
      mf.ubicacion_llaves_corte = extracted.ubicacion_llaves_corte.trim();
      mfChanged = true;
      appliedLabels.push("Llaves de corte");
    }
    if (extracted.equipos_sanitarios?.trim()) {
      mf.equipos_sanitarios = extracted.equipos_sanitarios.trim();
      mfChanged = true;
      appliedLabels.push("Equipos sanitarios");
    }
    if (mfChanged) {
      next = { ...next, memoria_fontaneria: mf };
    }

    const pf = { ...(next.pruebas_fontaneria ?? createDefaultPruebasFontaneria()) };
    let pfChanged = false;
    if (extracted.presion_prueba_bar !== undefined) {
      pf.presion_prueba_bar = extracted.presion_prueba_bar;
      pfChanged = true;
      if (pf.presion_prueba_bar !== null) {
        appliedLabels.push(`${pf.presion_prueba_bar} bar`);
      }
    }
    if (extracted.duracion_prueba_min !== undefined) {
      pf.duracion_prueba_min = extracted.duracion_prueba_min;
      pfChanged = true;
      if (pf.duracion_prueba_min !== null) {
        appliedLabels.push(`${pf.duracion_prueba_min} min`);
      }
    }
    if (extracted.estanqueidad_sin_fugas !== undefined) {
      pf.estanqueidad_sin_fugas = extracted.estanqueidad_sin_fugas;
      pfChanged = true;
      appliedLabels.push(
        extracted.estanqueidad_sin_fugas ? "Sin fugas" : "Con fuga detectada"
      );
    }
    if (extracted.presion_servicio_bar !== undefined) {
      pf.presion_servicio_bar = extracted.presion_servicio_bar;
      pfChanged = true;
      if (pf.presion_servicio_bar !== null) {
        appliedLabels.push(`Servicio ${pf.presion_servicio_bar} bar`);
      }
    }
    if (extracted.temperatura_consigna_acs_c !== undefined) {
      pf.temperatura_consigna_acs_c = extracted.temperatura_consigna_acs_c;
      pfChanged = true;
      if (pf.temperatura_consigna_acs_c !== null) {
        appliedLabels.push(`ACS ${pf.temperatura_consigna_acs_c} °C`);
      }
    }
    if (extracted.resultado_apto !== undefined) {
      pf.resultado_apto = extracted.resultado_apto;
      pfChanged = true;
    }
    if (pfChanged) {
      next = { ...next, pruebas_fontaneria: pf };
    }
  }

  return {
    nextData: next,
    appliedLabels: Array.from(new Set(appliedLabels)),
  };
}

export function buildGuidedSystemPrompt(params: {
  currentStep: GuidedStep;
  data: ActaPuestaEnMarchaData;
  missingFields: string[];
  userText: string;
}): string {
  return [
    "Eres el asistente técnico en obra de Gestor Autónomo (España) para rellenar un Acta de Puesta en Marcha.",
    "Devuelve EXCLUSIVAMENTE un JSON válido sin texto extra ni markdown con la forma:",
    '{"intent":"answer_data|ask_help_example|confirm|go_back","extracted_fields":{},"assistant_reply":"..."}',
    "Reglas:",
    "- Si intent == ask_help_example, da 2 ejemplos reales de obra en España y repite la pregunta del paso actual.",
    "- Si el usuario dicta jerga española de electricidad o fontanería, extrae los valores exactos en extracted_fields.",
    "Ejemplos few-shot:",
    'Usuario (STEP_3, fontaneria): "Tubería multicapa de 20 y 16, llaves en falso techo y termo de 80 litros" -> {"intent":"answer_data","extracted_fields":{"material_tuberias":"Multicapa PEX-Al-PEX","diametros_mm":"20mm, 16mm","ubicacion_llaves_corte":"falso techo","equipos_sanitarios":"termo de 80 litros"},"assistant_reply":"Anotada la memoria de fontanería."}',
    'Usuario (STEP_4, electricidad): "Aislamiento 250 megaohmios, tierra 14 ohmios y diferencial salta en 18 ms" -> {"intent":"answer_data","extracted_fields":{"resistencia_aislamiento_mohm":250,"resistencia_tierra_ohm":14,"disparo_diferencial_ms":18,"resultado_apto":true},"assistant_reply":"Mediciones eléctricas guardadas como aptas."}',
    `Paso actual: ${params.currentStep} | Especialidad: ${params.data.especialidad}`,
    `Campos pendientes del paso: ${params.missingFields.join(", ") || "ninguno"}`,
    `Mensaje usuario: ${JSON.stringify(params.userText)}`,
  ].join("\n");
}

function stepBack(current: GuidedStep): GuidedStep {
  const idx = ORDERED_GUIDED_STEPS.indexOf(current);
  if (idx <= 0) return "STEP_1_IDENTIFICACION";
  return ORDERED_GUIDED_STEPS[idx - 1] ?? "STEP_1_IDENTIFICACION";
}

function stepForward(current: GuidedStep): GuidedStep {
  const idx = ORDERED_GUIDED_STEPS.indexOf(current);
  if (idx < 0 || idx >= ORDERED_GUIDED_STEPS.length - 1) return "STEP_5_FOTOS_Y_FIRMA";
  return ORDERED_GUIDED_STEPS[idx + 1] ?? "STEP_5_FOTOS_Y_FIRMA";
}

export async function processActaGuidedTurn(params: {
  currentStep: GuidedStep;
  data: ActaPuestaEnMarchaData;
  userText: string;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  step2Confirmed?: boolean;
}): Promise<GuidedTurnResult> {
  const { currentStep, data, userText, inferenceAdapter } = params;
  let step2Confirmed = Boolean(params.step2Confirmed);

  const missingBefore = computeMissingFieldsForStep(currentStep, data);
  const detIntent = detectGuidedIntent(userText);
  const detFields = extractActaFieldsDeterministically(currentStep, userText, data);

  let engineUsed: InferenceEngine = "deterministic_rule_engine";
  let intent: GuidedIntent = detIntent;
  let mergedFields: GuidedExtractedFields = detFields;
  let llmReply: string | null = null;

  if (inferenceAdapter?.hasLlmRunner()) {
    const prompt = buildGuidedSystemPrompt({
      currentStep,
      data,
      missingFields: missingBefore,
      userText,
    });
    const llmRes = await inferenceAdapter.runStructuredJsonPrompt({
      prompt,
      schema: GuidedTurnLlmResponseSchema,
      timeoutMs: 10_000,
    });
    if (llmRes) {
      engineUsed = llmRes.engine_used;
      intent = llmRes.data.intent;
      mergedFields = { ...detFields, ...llmRes.data.extracted_fields };
      llmReply = llmRes.data.assistant_reply.trim();
    } else {
      engineUsed = "mediapipe_fallback_deterministic";
    }
  }

  if (intent === "go_back") {
    const prevStep = stepBack(currentStep);
    return {
      nextStep: prevStep,
      step2Confirmed,
      nextData: data,
      intent,
      assistantReply: `Volvemos al ${STEP_META[prevStep].label}. ${buildStepOpeningPrompt(prevStep, data)}`,
      appliedLabels: [],
      missingFields: computeMissingFieldsForStep(prevStep, data),
      engineUsed,
    };
  }

  if (intent === "ask_help_example") {
    const [ex1, ex2] = getStepExamples(currentStep, data.especialidad);
    return {
      nextStep: currentStep,
      step2Confirmed,
      nextData: data,
      intent,
      assistantReply: `Por ejemplo, puedes decirme:\n• "${ex1}"\n• "${ex2}"\n\n${buildStepOpeningPrompt(currentStep, data)}`,
      appliedLabels: [],
      missingFields: missingBefore,
      engineUsed,
    };
  }

  const { nextData, appliedLabels } = applyExtractedFieldsToActa(data, mergedFields);

  if (intent === "confirm") {
    if (currentStep === "STEP_2_INTERVINIENTES") {
      step2Confirmed = true;
    }
    const nextStep = stepForward(currentStep);
    return {
      nextStep,
      step2Confirmed,
      nextData,
      intent,
      assistantReply: `Confirmado. ${buildStepOpeningPrompt(nextStep, nextData)}`,
      appliedLabels,
      missingFields: computeMissingFieldsForStep(nextStep, nextData),
      engineUsed,
    };
  }

  const remainingMissing = computeMissingFieldsForStep(currentStep, nextData);

  if (currentStep === "STEP_2_INTERVINIENTES" && appliedLabels.length > 0 && remainingMissing.length === 0) {
    step2Confirmed = true;
  }

  if (remainingMissing.length === 0) {
    const nextStep = stepForward(currentStep);
    const savedPrefix =
      appliedLabels.length > 0 ? `Guardado (${appliedLabels.join(", ")}). ` : "";
    return {
      nextStep,
      step2Confirmed,
      nextData,
      intent,
      assistantReply: `${savedPrefix}${buildStepOpeningPrompt(nextStep, nextData)}`,
      appliedLabels,
      missingFields: computeMissingFieldsForStep(nextStep, nextData),
      engineUsed,
    };
  }

  const fallbackPrompt =
    appliedLabels.length > 0
      ? `Guardado (${appliedLabels.join(", ")}). Todavía falta: ${remainingMissing.join(", ").replace(/_/g, " ")}.`
      : llmReply || `Necesito estos datos para completar este paso: ${remainingMissing.join(", ").replace(/_/g, " ")}.`;

  return {
    nextStep: currentStep,
    step2Confirmed,
    nextData,
    intent,
    assistantReply: fallbackPrompt,
    appliedLabels,
    missingFields: remainingMissing,
    engineUsed,
  };
}
