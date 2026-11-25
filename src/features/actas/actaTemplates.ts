import type {
  ActaPuestaEnMarchaData,
  AppSettingsRecord,
  EspecialidadActa,
  TipoActuacionActa,
} from "../../core/contracts/types";

export const ACTA_CONFORMIDAD_TEMPLATE =
  "El instalador autorizado arriba identificado CERTIFICA que la instalación descrita en la presente Acta ha sido ejecutada, verificada y probada conforme a las prescripciones técnicas del Reglamento Electrotécnico para Baja Tensión (RD 842/2002) y/o el Código Técnico de la Edificación (CTE DB HS-4), habiendo superado satisfactoriamente las pruebas reglamentarias de seguridad y estanqueidad previas a su puesta en servicio.";

export const ACTA_MANTENIMIENTO_ELECTRICIDAD =
  "Se recomienda accionar mensualmente el botón de prueba ('T') del interruptor diferencial para verificar su correcto disparo. No manipular el interior del cuadro eléctrico ni sobrecargar bases de enchufe. Ante cualquier anomalía o disparo reiterado de protecciones, desconectar el circuito afectado y contactar con el instalador.";

export const ACTA_MANTENIMIENTO_FONTANERIA =
  "Se informa al titular de la ubicación de las llaves de corte general y parciales para su cierre en caso de emergencia o ausencia prolongada. Limpiar periódicamente los filtros aireadores de griferías y verificar la válvula de seguridad del termo/acumulador. Mantener la temperatura de acumulación de ACS en torno a 60 °C.";

export function getActaMantenimientoTemplate(especialidad: EspecialidadActa): string {
  if (especialidad === "electricidad") {
    return ACTA_MANTENIMIENTO_ELECTRICIDAD;
  }
  if (especialidad === "fontaneria") {
    return ACTA_MANTENIMIENTO_FONTANERIA;
  }
  return `Electricidad: ${ACTA_MANTENIMIENTO_ELECTRICIDAD}\n\nFontanería y ACS: ${ACTA_MANTENIMIENTO_FONTANERIA}`;
}

export function buildActaRecepcionTemplate(plazoGarantiaMeses: number): string {
  const safeMonths = Math.max(1, Math.min(120, Math.round(plazoGarantiaMeses || 24)));
  return `El titular o representante declara recibir la instalación en correcto estado de funcionamiento, haber sido informado de su manejo básico y manifestar su conformidad con los trabajos ejecutados. La garantía sobre la mano de obra y materiales aportados tendrá una vigencia de ${safeMonths} meses desde la fecha de firma, quedando anulada en caso de manipulación por personal ajeno a la empresa instaladora.`;
}

export function isDefaultMantenimientoText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return (
    trimmed === ACTA_MANTENIMIENTO_ELECTRICIDAD ||
    trimmed === ACTA_MANTENIMIENTO_FONTANERIA ||
    trimmed === getActaMantenimientoTemplate("mixta")
  );
}

export function isDefaultRecepcionText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^El titular o representante declara recibir la instalación en correcto estado de funcionamiento, haber sido informado de su manejo básico y manifestar su conformidad con los trabajos ejecutados\. La garantía sobre la mano de obra y materiales aportados tendrá una vigencia de \d+ meses desde la fecha de firma, quedando anulada en caso de manipulación por personal ajeno a la empresa instaladora\.$/.test(
    trimmed
  );
}

export function createDefaultMemoriaElectricidad(
  receptoresSugeridos = ""
): NonNullable<ActaPuestaEnMarchaData["memoria_electricidad"]> {
  return {
    tension_nominal: "230V Monofásica",
    iga_amperios: 25,
    protector_sobretensiones: true,
    diferencial_calibre: "40A / 30mA Clase A",
    circuitos: [],
    receptores_conectados: receptoresSugeridos,
  };
}

export function createDefaultMemoriaFontaneria(
  equiposSanitariosSugeridos = ""
): NonNullable<ActaPuestaEnMarchaData["memoria_fontaneria"]> {
  return {
    redes_intervenidas: ["AFCH", "ACS"],
    material_tuberias: "",
    diametros_mm: "",
    ubicacion_llaves_corte: "",
    equipos_sanitarios: equiposSanitariosSugeridos,
  };
}

export function createDefaultPruebasElectricidad(): NonNullable<
  ActaPuestaEnMarchaData["pruebas_electricidad"]
> {
  return {
    inspeccion_visual_bornes_etiquetado: true,
    continuidad_proteccion_equipotencial: true,
    resistencia_aislamiento_mohm: null,
    resistencia_tierra_ohm: null,
    disparo_diferencial_ms: null,
    tension_comprobada_v: 230,
    resultado_apto: true,
  };
}

export function createDefaultPruebasFontaneria(): NonNullable<
  ActaPuestaEnMarchaData["pruebas_fontaneria"]
> {
  return {
    presion_prueba_bar: null,
    duracion_prueba_min: null,
    estanqueidad_sin_fugas: true,
    presion_servicio_bar: null,
    comprobacion_desagues_valvulas: true,
    temperatura_consigna_acs_c: null,
    resultado_apto: true,
  };
}

export function buildDefaultActaData(params: {
  codigoActa: string;
  fechaEmisionIso: string;
  especialidad: EspecialidadActa;
  tipoActuacion?: TipoActuacionActa;
  alcanceUbicacion?: string;
  instalador?: Partial<ActaPuestaEnMarchaData["instalador"]>;
  cliente?: Partial<ActaPuestaEnMarchaData["cliente"]>;
  plazoGarantiaMeses?: number;
  receptoresSugeridos?: string;
  equiposSanitariosSugeridos?: string;
}): ActaPuestaEnMarchaData {
  const plazo = Math.max(1, Math.min(120, Math.round(params.plazoGarantiaMeses ?? 24)));
  const needsElec = params.especialidad === "electricidad" || params.especialidad === "mixta";
  const needsFont = params.especialidad === "fontaneria" || params.especialidad === "mixta";

  return {
    titulo_documento: "Acta de Puesta en Marcha y Certificación Interna de Instalación",
    codigo_acta: params.codigoActa,
    fecha_emision: params.fechaEmisionIso,
    especialidad: params.especialidad,
    tipo_actuacion: params.tipoActuacion ?? "reforma_integral",
    alcance_ubicacion: params.alcanceUbicacion ?? "",
    instalador: {
      nombre_razon_social: params.instalador?.nombre_razon_social ?? "",
      nif_cif: params.instalador?.nif_cif ?? "",
      domicilio_fiscal: params.instalador?.domicilio_fiscal ?? "",
      telefono: params.instalador?.telefono ?? "",
      email: params.instalador?.email ?? "",
      ...(params.instalador?.num_registro_empresa
        ? { num_registro_empresa: params.instalador.num_registro_empresa }
        : {}),
      tecnico_nombre: params.instalador?.tecnico_nombre ?? "",
      tecnico_dni: params.instalador?.tecnico_dni ?? "",
      ...(params.instalador?.num_carne_instalador
        ? { num_carne_instalador: params.instalador.num_carne_instalador }
        : {}),
    },
    cliente: {
      nombre_razon_social: params.cliente?.nombre_razon_social ?? "",
      nif_cif: params.cliente?.nif_cif ?? "",
      direccion_emplazamiento: params.cliente?.direccion_emplazamiento ?? "",
      ...(params.cliente?.telefono ? { telefono: params.cliente.telefono } : {}),
      ...(params.cliente?.email ? { email: params.cliente.email } : {}),
    },
    ...(needsElec
      ? {
          memoria_electricidad: createDefaultMemoriaElectricidad(params.receptoresSugeridos ?? ""),
          pruebas_electricidad: createDefaultPruebasElectricidad(),
        }
      : {}),
    ...(needsFont
      ? {
          memoria_fontaneria: createDefaultMemoriaFontaneria(
            params.equiposSanitariosSugeridos ?? ""
          ),
          pruebas_fontaneria: createDefaultPruebasFontaneria(),
        }
      : {}),
    fotos: [],
    instrucciones_mantenimiento: getActaMantenimientoTemplate(params.especialidad),
    plazo_garantia_meses: plazo,
    clausula_conformidad: ACTA_CONFORMIDAD_TEMPLATE,
    clausula_recepcion_cliente: buildActaRecepcionTemplate(plazo),
  };
}

/**
 * Comprueba si la ficha habitual de instalador tiene los datos mínimos técnicos y fiscales
 * para rellenar un acta automáticamente sin tener que crearla en el momento.
 */
export function isInstallerActaProfileComplete(
  settings: Pick<
    AppSettingsRecord,
    "emitter_name" | "emitter_nif" | "emitter_tech_name" | "emitter_tech_dni"
  >
): boolean {
  return (
    settings.emitter_name.trim().length > 0 &&
    settings.emitter_nif.trim().length > 0 &&
    settings.emitter_tech_name.trim().length > 0 &&
    settings.emitter_tech_dni.trim().length > 0
  );
}

/**
 * Calcula el progreso por bloques (7 bloques) de forma homogénea para vista libre,
 * listado y asistente guiado.
 */
export function computeActaCompletion(
  data: ActaPuestaEnMarchaData,
  firmas?: { cliente?: string | null; instalador?: string | null }
): { completedBlocks: number; totalBlocks: 7; blockStates: boolean[] } {
  const b1 =
    data.codigo_acta.trim().length > 0 &&
    data.fecha_emision.trim().length > 0 &&
    data.alcance_ubicacion.trim().length > 0;

  const b2 =
    data.instalador.nombre_razon_social.trim().length > 0 &&
    data.instalador.nif_cif.trim().length > 0 &&
    data.instalador.tecnico_nombre.trim().length > 0 &&
    data.cliente.nombre_razon_social.trim().length > 0 &&
    data.cliente.direccion_emplazamiento.trim().length > 0;

  const needsElec = data.especialidad === "electricidad" || data.especialidad === "mixta";
  const needsFont = data.especialidad === "fontaneria" || data.especialidad === "mixta";

  const memElecOk =
    !needsElec ||
    Boolean(
      data.memoria_electricidad &&
        data.memoria_electricidad.diferencial_calibre.trim().length > 0 &&
        (data.memoria_electricidad.circuitos.length > 0 ||
          data.memoria_electricidad.receptores_conectados.trim().length > 0)
    );
  const memFontOk =
    !needsFont ||
    Boolean(
      data.memoria_fontaneria &&
        data.memoria_fontaneria.redes_intervenidas.length > 0 &&
        data.memoria_fontaneria.material_tuberias.trim().length > 0
    );
  const b3 = memElecOk && memFontOk;

  const pruElecOk =
    !needsElec ||
    Boolean(
      data.pruebas_electricidad &&
        (data.pruebas_electricidad.resistencia_aislamiento_mohm !== null ||
          data.pruebas_electricidad.resistencia_tierra_ohm !== null ||
          data.pruebas_electricidad.disparo_diferencial_ms !== null ||
          data.pruebas_electricidad.tension_comprobada_v !== null)
    );
  const pruFontOk =
    !needsFont ||
    Boolean(
      data.pruebas_fontaneria &&
        data.pruebas_fontaneria.presion_prueba_bar !== null &&
        data.pruebas_fontaneria.duracion_prueba_min !== null
    );
  const b4 = pruElecOk && pruFontOk;

  const b5 = data.fotos.length >= 2;
  const b6 =
    data.instrucciones_mantenimiento.trim().length > 0 &&
    data.clausula_conformidad.trim().length > 0 &&
    data.clausula_recepcion_cliente.trim().length > 0 &&
    data.plazo_garantia_meses >= 1;
  const b7 = Boolean(firmas?.cliente && firmas.cliente.trim().length > 0);

  const blockStates = [b1, b2, b3, b4, b5, b6, b7];
  const completedBlocks = blockStates.filter(Boolean).length;
  return { completedBlocks, totalBlocks: 7, blockStates };
}
