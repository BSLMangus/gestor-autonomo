import { z } from "zod";
import {
  CircuitoElectricoSchema,
  EspecialidadActaSchema,
  RedFontaneriaSchema,
  TipoActuacionActaSchema,
} from "../../core/contracts/schemas";
import type {
  ActaPuestaEnMarchaData,
  CircuitoElectrico,
  EspecialidadActa,
  RedFontaneria,
} from "../../core/contracts/types";
import { normalizeSpanishText } from "../../core/text/spanishText";

export type GuidedStep =
  | "STEP_1_IDENTIFICACION"
  | "STEP_2_INTERVINIENTES"
  | "STEP_3_MEMORIA_TECNICA"
  | "STEP_4_PRUEBAS_OBRA"
  | "STEP_5_FOTOS_Y_FIRMA";

export type GuidedIntent = "answer_data" | "ask_help_example" | "confirm" | "go_back";

export const GuidedExtractedFieldsSchema = z.object({
  especialidad: EspecialidadActaSchema.optional(),
  tipo_actuacion: TipoActuacionActaSchema.optional(),
  alcance_ubicacion: z.string().optional(),
  instalador_nombre: z.string().optional(),
  instalador_nif: z.string().optional(),
  tecnico_nombre: z.string().optional(),
  tecnico_dni: z.string().optional(),
  num_registro_empresa: z.string().optional(),
  cliente_nombre: z.string().optional(),
  cliente_nif: z.string().optional(),
  cliente_direccion: z.string().optional(),
  tension_nominal: z.enum(["230V Monofásica", "400V Trifásica"]).optional(),
  iga_amperios: z.number().nonnegative().optional(),
  protector_sobretensiones: z.boolean().optional(),
  diferencial_calibre: z.string().optional(),
  circuitos: z.array(CircuitoElectricoSchema).optional(),
  receptores_conectados: z.string().optional(),
  redes_intervenidas: z.array(RedFontaneriaSchema).optional(),
  material_tuberias: z.string().optional(),
  diametros_mm: z.string().optional(),
  ubicacion_llaves_corte: z.string().optional(),
  equipos_sanitarios: z.string().optional(),
  resistencia_aislamiento_mohm: z.number().nonnegative().nullable().optional(),
  resistencia_tierra_ohm: z.number().nonnegative().nullable().optional(),
  disparo_diferencial_ms: z.number().nonnegative().nullable().optional(),
  tension_comprobada_v: z.number().nonnegative().nullable().optional(),
  presion_prueba_bar: z.number().nonnegative().nullable().optional(),
  duracion_prueba_min: z.number().nonnegative().nullable().optional(),
  estanqueidad_sin_fugas: z.boolean().optional(),
  presion_servicio_bar: z.number().nonnegative().nullable().optional(),
  temperatura_consigna_acs_c: z.number().nonnegative().nullable().optional(),
  resultado_apto: z.boolean().optional(),
});

export type GuidedExtractedFields = z.infer<typeof GuidedExtractedFieldsSchema>;

export const GuidedTurnLlmResponseSchema = z.object({
  intent: z.enum(["answer_data", "ask_help_example", "confirm", "go_back"]),
  extracted_fields: GuidedExtractedFieldsSchema.default({}),
  assistant_reply: z.string().min(1),
});

function parseDecimal(raw: string): number | null {
  const num = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function detectGuidedIntent(text: string): GuidedIntent {
  const norm = normalizeSpanishText(text).trim();
  if (!norm) return "answer_data";

  if (
    /\b(ejemplo|ejemplos|dame un ejemplo|ponme un ejemplo|ayuda|no se que poner|que pongo|como se rellena|duda)\b/.test(
      norm
    )
  ) {
    return "ask_help_example";
  }

  if (
    /^(?:volver|atras|volver atras|paso anterior|anterior|ir atras)\b/.test(norm) ||
    /\b(paso anterior|volver atras)\b/.test(norm)
  ) {
    return "go_back";
  }

  if (
    /^(?:confirmado|confirmo|confirmar|confirmar datos|correcto|todo correcto|todo bien|ok|vale|si|esta bien|perfecto|siguiente|continuar|adelante)\b/.test(
      norm
    ) &&
    norm.split(/\s+/).length <= 5
  ) {
    return "confirm";
  }

  return "answer_data";
}

function extractElectricCircuits(text: string): CircuitoElectrico[] {
  const out: CircuitoElectrico[] = [];
  const regex =
    /\b(C\d+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]+)?)\s*[:-]?\s*(\d+(?:[.,]\d+)?)\s*A\b(?:\s*[/,]?\s*(\d+(?:[.,]\d+)?)\s*mm(?:2|²)?)?/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const nombre = match[1]?.trim() ?? "";
    const calibre = parseDecimal(match[2] ?? "");
    const seccion = match[3] ? parseDecimal(match[3]) : null;
    if (nombre && calibre !== null) {
      out.push({
        nombre,
        calibre_a: calibre,
        seccion_mm2: seccion ?? (calibre <= 10 ? 1.5 : calibre <= 16 ? 2.5 : calibre <= 20 ? 4 : 6),
      });
    }
  }
  return out;
}

export function extractActaFieldsDeterministically(
  step: GuidedStep,
  text: string,
  currentData: ActaPuestaEnMarchaData
): GuidedExtractedFields {
  const trimmed = text.trim();
  const norm = normalizeSpanishText(trimmed);
  if (!trimmed) return {};

  const out: GuidedExtractedFields = {};

  if (step === "STEP_1_IDENTIFICACION") {
    const hasElec = /\b(electric\w*|cuadro|magnetotermic\w*|diferencial|iga|luz|iluminacion|enchufe\w*)\b/.test(
      norm
    );
    const hasFont = /\b(fontaner\w*|agua|bano|ducha|termo|tuberia\w*|multicapa|acs|afch|desague\w*|saneamiento)\b/.test(
      norm
    );

    if (/\bmixt[ao]\b/.test(norm) || (hasElec && hasFont)) {
      out.especialidad = "mixta";
    } else if (hasFont) {
      out.especialidad = "fontaneria";
    } else if (hasElec) {
      out.especialidad = "electricidad";
    }

    if (/\bobra nueva\b/.test(norm)) {
      out.tipo_actuacion = "obra_nueva";
    } else if (/\breforma integral\b/.test(norm)) {
      out.tipo_actuacion = "reforma_integral";
    } else if (/\b(?:reparacion|sustitucion|cambio|averia)\b/.test(norm)) {
      out.tipo_actuacion = "reparacion_sustitucion";
    } else if (/\b(?:reforma parcial|modificacion parcial|parcial|ampliacion)\b/.test(norm)) {
      out.tipo_actuacion = "modificacion_parcial";
    }

    const isSingleKeyword =
      /^(?:electricidad|fontaneria|mixta|obra nueva|reforma integral|modificacion parcial|reparacion|sustitucion)$/.test(
        norm
      );
    if (!isSingleKeyword && trimmed.length >= 6) {
      out.alcance_ubicacion = trimmed;
    }
    return out;
  }

  if (step === "STEP_2_INTERVINIENTES") {
    const dniMatch = /\b([0-9XYZ]\d{7}[A-Z])\b/i.exec(trimmed);
    if (dniMatch?.[1]) {
      const idVal = dniMatch[1].toUpperCase();
      if (/\bcliente\b|\btitular\b/.test(norm)) {
        out.cliente_nif = idVal;
      } else {
        out.tecnico_dni = idVal;
      }
    }
    const regMatch = /\b((?:REIE|RII)[-\s]?[A-Z0-9-]+)\b/i.exec(trimmed);
    if (regMatch?.[1]) {
      out.num_registro_empresa = regMatch[1].toUpperCase().replace(/\s+/g, "-");
    }
    const techMatch = /(?:tecnico|instalador)\s*(?:es|:)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i.exec(
      trimmed
    );
    if (techMatch?.[1]) {
      out.tecnico_nombre = techMatch[1].trim();
    }
    const clientMatch = /(?:cliente|titular)\s*(?:es|:)?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})/i.exec(
      trimmed
    );
    if (clientMatch?.[1]) {
      out.cliente_nombre = clientMatch[1].trim();
    }
    const addrMatch = /(?:direccion|emplazamiento|calle|c\/|avda\.?)\s*[:.]?\s*([^\n,;]+)/i.exec(
      trimmed
    );
    if (addrMatch?.[1]) {
      out.cliente_direccion = addrMatch[1].trim();
    }
    return out;
  }

  if (step === "STEP_3_MEMORIA_TECNICA") {
    const needsElec =
      currentData.especialidad === "electricidad" || currentData.especialidad === "mixta";
    const needsFont =
      currentData.especialidad === "fontaneria" || currentData.especialidad === "mixta";

    if (needsElec) {
      if (/\b400\s*v\b|\btrifasic[ao]\b/.test(norm)) {
        out.tension_nominal = "400V Trifásica";
      } else if (/\b230\s*v\b|\bmonofasic[ao]\b/.test(norm)) {
        out.tension_nominal = "230V Monofásica";
      }

      const igaMatch = /\biga\s*(?:de\s*)?(\d+)\s*(?:a|amperios?)?\b/i.exec(norm);
      if (igaMatch?.[1]) {
        const igaVal = parseDecimal(igaMatch[1]);
        if (igaVal !== null) out.iga_amperios = igaVal;
      }

      if (/\bsin sobretension(?:es)?\b|\bno lleva sobretension(?:es)?\b/.test(norm)) {
        out.protector_sobretensiones = false;
      } else if (/\bsobretension(?:es)?\b|\bprotector\b/.test(norm)) {
        out.protector_sobretensiones = true;
      }

      const difMatch =
        /diferencial\s*(?:de\s*)?(\d+\s*A\s*[/ ]\s*\d+\s*mA(?:\s*clase\s*[A-Z]+)?)/i.exec(trimmed) ??
        /(\d+\s*A\s*\/\s*\d+\s*mA(?:\s*clase\s*[A-Z]+)?)/i.exec(trimmed);
      if (difMatch?.[1]) {
        out.diferencial_calibre = difMatch[1].trim();
      }

      const parsedCircuits = extractElectricCircuits(trimmed);
      if (parsedCircuits.length > 0) {
        out.circuitos = parsedCircuits;
      }

      const recMatch = /(?:receptores|equipos|conectado[s]?)\s*[:.]?\s*([^\n]+)/i.exec(trimmed);
      if (recMatch?.[1]) {
        out.receptores_conectados = recMatch[1].trim();
      } else if (
        !needsFont &&
        parsedCircuits.length === 0 &&
        !out.diferencial_calibre &&
        !out.iga_amperios &&
        trimmed.length >= 8
      ) {
        out.receptores_conectados = trimmed;
      }
    }

    if (needsFont) {
      const redes: RedFontaneria[] = [];
      if (/\bafch\b|\bagua fria\b/.test(norm)) redes.push("AFCH");
      if (/\bacs\b|\bagua caliente\b/.test(norm)) redes.push("ACS");
      if (/\bretorno\b/.test(norm)) redes.push("Retorno");
      if (/\bsaneamiento\b|\bdesague\w*\b/.test(norm)) redes.push("Saneamiento");
      if (redes.length > 0) out.redes_intervenidas = redes;

      if (/\bmulticapa\b|\bpex\b/.test(norm)) {
        out.material_tuberias = "Multicapa PEX-Al-PEX";
      } else if (/\bcobre\b/.test(norm)) {
        out.material_tuberias = "Cobre";
      } else if (/\bpvc\b/.test(norm)) {
        out.material_tuberias = "PVC";
      } else if (/\bppr\b/.test(norm)) {
        out.material_tuberias = "PPR";
      }

      const diamMatches = trimmed.match(/\b\d+(?:[.,]\d+)?\s*mm\b/gi);
      if (diamMatches && diamMatches.length > 0) {
        out.diametros_mm = Array.from(new Set(diamMatches.map((d) => d.replace(/\s+/g, "")))).join(
          ", "
        );
      }

      const llavesMatch =
        /(?:llaves?(?:\s+de\s+corte)?\s+(?:en\s+)?)([^,.;\n]+)/i.exec(trimmed);
      if (llavesMatch?.[1]) {
        out.ubicacion_llaves_corte = llavesMatch[1].trim();
      }

      const equiposMatch =
        /(?:termo|caldera|plato\s+de\s+ducha|lavabo|inodoro|griferia|fregadero)[^.\n]*/i.exec(
          trimmed
        );
      if (equiposMatch?.[0]) {
        out.equipos_sanitarios = equiposMatch[0].trim();
      }
    }
    return out;
  }

  if (step === "STEP_4_PRUEBAS_OBRA") {
    const needsElec =
      currentData.especialidad === "electricidad" || currentData.especialidad === "mixta";
    const needsFont =
      currentData.especialidad === "fontaneria" || currentData.especialidad === "mixta";

    if (needsElec) {
      const aislMatch =
        /(?:aislamiento[^0-9]*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:mohm|megaohmios?|mΩ))/i.exec(
          trimmed
        );
      if (aislMatch) {
        const val = parseDecimal(aislMatch[1] ?? aislMatch[2] ?? "");
        if (val !== null) out.resistencia_aislamiento_mohm = val;
      }

      const tierraMatch =
        /(?:tierra[^0-9]*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:ohmios?|ohm|Ω)(?!\s*m))/i.exec(
          trimmed
        );
      if (tierraMatch) {
        const val = parseDecimal(tierraMatch[1] ?? tierraMatch[2] ?? "");
        if (val !== null) out.resistencia_tierra_ohm = val;
      }

      const dispMatch =
        /(?:disparo(?:\s+diferencial)?[^0-9]*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:ms|milisegundos?))/i.exec(
          trimmed
        );
      if (dispMatch) {
        const val = parseDecimal(dispMatch[1] ?? dispMatch[2] ?? "");
        if (val !== null) out.disparo_diferencial_ms = val;
      }

      const tensMatch =
        /(?:tension(?:\s+comprobada)?[^0-9]*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:v|voltios?)\b)/i.exec(
          norm
        );
      if (tensMatch) {
        const val = parseDecimal(tensMatch[1] ?? tensMatch[2] ?? "");
        if (val !== null) out.tension_comprobada_v = val;
      }
    }

    if (needsFont) {
      const barPruebaMatch =
        /(?:(?:prueba|presion(?:\s+de\s+prueba)?)[^0-9]*(\d+(?:[.,]\d+)?)\s*bar|(\d+(?:[.,]\d+)?)\s*bares?)/i.exec(
          norm
        );
      if (barPruebaMatch) {
        const val = parseDecimal(barPruebaMatch[1] ?? barPruebaMatch[2] ?? "");
        if (val !== null) out.presion_prueba_bar = val;
      }

      const servMatch = /servicio[^0-9]*(\d+(?:[.,]\d+)?)\s*bar/i.exec(norm);
      if (servMatch?.[1]) {
        const val = parseDecimal(servMatch[1]);
        if (val !== null) out.presion_servicio_bar = val;
      }

      const minMatch = /(\d+(?:[.,]\d+)?)\s*(?:min|minutos?)\b/i.exec(norm);
      if (minMatch?.[1]) {
        const val = parseDecimal(minMatch[1]);
        if (val !== null) out.duracion_prueba_min = val;
      } else if (/\bmedia hora\b/.test(norm)) {
        out.duracion_prueba_min = 30;
      } else if (/\buna hora\b|\b1 hora\b/.test(norm)) {
        out.duracion_prueba_min = 60;
      }

      const tempMatch = /(\d+(?:[.,]\d+)?)\s*(?:ºc|°c|grados?)\b/i.exec(norm);
      if (tempMatch?.[1]) {
        const val = parseDecimal(tempMatch[1]);
        if (val !== null) out.temperatura_consigna_acs_c = val;
      }

      if (/\b(?:con fuga|hay fuga|pierde presion)\b/.test(norm)) {
        out.estanqueidad_sin_fugas = false;
        out.resultado_apto = false;
      } else if (/\b(?:sin fugas|estanco|estanqueidad correcta|todo bien)\b/.test(norm)) {
        out.estanqueidad_sin_fugas = true;
      }
    }

    if (/\bno apto\b|\bdesfavorable\b/.test(norm)) {
      out.resultado_apto = false;
    } else if (/\bapto\b|\bfavorable\b|\bcorrecto\b|\bsin fugas\b/.test(norm)) {
      out.resultado_apto = true;
    }

    return out;
  }

  return out;
}

export function getStepExamples(
  step: GuidedStep,
  especialidad: EspecialidadActa
): [string, string] {
  switch (step) {
    case "STEP_1_IDENTIFICACION":
      return [
        "Reforma parcial de fontanería en baño principal de vivienda 3º 2ª",
        "Electricidad · Modificación parcial del cuadro eléctrico y cocina",
      ];
    case "STEP_2_INTERVINIENTES":
      return [
        "Confirmado, todo correcto",
        "El técnico es Carlos Pérez con DNI 12345678Z y cliente Marta Gómez",
      ];
    case "STEP_3_MEMORIA_TECNICA":
      if (especialidad === "fontaneria") {
        return [
          "AFCH y ACS en multicapa PEX-Al-PEX de 20mm y 16mm, llaves en falso techo, termo 80L",
          "Cobre de 18mm y 15mm, plato de ducha, lavabo e inodoro",
        ];
      }
      if (especialidad === "mixta") {
        return [
          "230V IGA 25A diferencial 40A/30mA y multicapa PEX 20mm/16mm con termo 80L",
          "C1 10A 1.5mm2, C2 16A 2.5mm2 y red AFCH/ACS en cobre con llaves en cocina",
        ];
      }
      return [
        "230V monofásica, IGA 25A con sobretensiones, diferencial 40A/30mA, C1 10A 1.5mm2, C2 16A 2.5mm2",
        "Receptores: alumbrado LED, tomas de cocina y termo eléctrico",
      ];
    case "STEP_4_PRUEBAS_OBRA":
      if (especialidad === "fontaneria") {
        return [
          "6 bares durante 30 minutos sin fugas, presión de servicio 3 bares, ACS a 60 grados",
          "Prueba de estanqueidad a 7 bares 45 min sin fugas, apto",
        ];
      }
      if (especialidad === "mixta") {
        return [
          "Aislamiento 250 MΩ, tierra 14 ohmios, disparo 18 ms y 6 bares 30 min sin fugas",
          "230V comprobados, diferencial 20 ms y prueba hidráulica 6 bares 30 min apto",
        ];
      }
      return [
        "Aislamiento 250 MΩ, puesta a tierra 14 ohmios, disparo diferencial 18 ms, 230V apto",
        "Aislamiento > 500 MΩ, tierra 12 Ω y disparo 22 ms, todo apto",
      ];
    case "STEP_5_FOTOS_Y_FIRMA":
      return [
        "Adjunta 2 a 4 fotos con el botón Hacer / Elegir Foto",
        "Recoge la firma del cliente y pulsa Generar y Compartir PDF",
      ];
  }
}

export function getStepQuickChips(
  step: GuidedStep,
  especialidad: EspecialidadActa
): string[] {
  switch (step) {
    case "STEP_1_IDENTIFICACION":
      return [
        "Electricidad · Reforma integral",
        "Fontanería · Reforma parcial de baño",
        "Mixta · Reforma vivienda completa",
        "Dame un ejemplo",
      ];
    case "STEP_2_INTERVINIENTES":
      return ["Confirmar datos", "Dame un ejemplo", "Volver atrás"];
    case "STEP_3_MEMORIA_TECNICA":
      if (especialidad === "fontaneria") {
        return [
          "AFCH y ACS multicapa PEX 20mm y 16mm",
          "Llaves en falso techo y termo 80L",
          "Dame un ejemplo",
          "Volver atrás",
        ];
      }
      if (especialidad === "mixta") {
        return [
          "230V IGA 25A diferencial 40A/30mA",
          "AFCH y ACS multicapa PEX 20mm y 16mm",
          "Dame un ejemplo",
          "Volver atrás",
        ];
      }
      return [
        "230V IGA 25A con sobretensiones y diferencial 40A/30mA",
        "C1 10A 1.5mm2 y C2 16A 2.5mm2",
        "Dame un ejemplo",
        "Volver atrás",
      ];
    case "STEP_4_PRUEBAS_OBRA":
      if (especialidad === "fontaneria") {
        return [
          "6 bares / 30 min sin fugas",
          "Servicio 3 bares y ACS 60 °C apto",
          "Dame un ejemplo",
          "Volver atrás",
        ];
      }
      if (especialidad === "mixta") {
        return [
          "Aislamiento 250 MΩ, tierra 14 Ω, disparo 18 ms",
          "6 bares / 30 min sin fugas",
          "Dame un ejemplo",
          "Volver atrás",
        ];
      }
      return [
        "Aislamiento 250 MΩ, tierra 14 Ω, disparo 18 ms",
        "230V comprobados y todo apto",
        "Dame un ejemplo",
        "Volver atrás",
      ];
    case "STEP_5_FOTOS_Y_FIRMA":
      return ["Volver atrás"];
  }
}
