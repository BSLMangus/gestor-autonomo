# ObraLocal AI — Aplicación Móvil Interactiva para Autónomos de Reformas

Transformación integral de los 16 diseños de Google Stitch en una aplicación móvil **React 19 + TypeScript estricto + Tailwind CSS v4** completamente navegable e interactiva, optimizada para un viewport móvil Android/Capacitor (`390×844px` centrado) con arquitectura desacoplada lista para conectar a SQLite local y agentes en el futuro.

---

## Decisiones Confirmadas y Revisión del Usuario

> [!IMPORTANT]
> Todas las decisiones clave de experiencia y prototipado han quedado confirmadas tras tus respuestas y se integran como requisitos de máxima prioridad junto al diseño visual adjunto.

- **Persistencia local con reinicio demo**: Todos los cambios (obras creadas, partes de jornada, presupuestos, facturas cobradas, tickets, clientes, horario habitual y ajustes) se persisten automáticamente en `localStorage`, incluyendo un botón explícito en **Ajustes** para restaurar los datos de demostración iniciales en cualquier momento.
- **Simulación ágil + entrada real en Voz y Cámara**: Tanto el Asistente de Voz como el Escáner de Cámara ofrecerán **escenarios de un toque** (para demostrar al instante cada flujo) junto con **dictado/escritura libre** y **carga real de imagen** desde el dispositivo.
- **Flujo Generativo con aprobación previa y PDF imprimible/descargable**: Cualquier presupuesto, factura, ticket escaneado, foto sellada de diario o parte diario se abre en un **overlay a pantalla completa de interfaz generativa** donde el autónomo revisa, edita en vivo, rechaza o aprueba. Al aprobar un presupuesto o emitir una factura, se genera al instante una **vista previa documental limpia lista para imprimir o guardar como PDF** y compartir.

---

## 1. Visión General y Concepto Central

- **Qué resuelve**: ObraLocal AI es el cuaderno de obra, agenda de jornadas, gestor de presupuestos/facturas y hucha fiscal trimestral para un autónomo de reformas y oficios en España, diseñado para usarse con una sola mano a pie de obra, en español cercano y natural, sin ninguna jerga técnica visible.
- **Usuario objetivo**: Autónomos de fontanería, albañilería, electricidad y reformas integrales (representados en la demo por *Carlos Mendoza — Reformas y Fontanería Mendoza*) que necesitan saber en 3 segundos cuánto dinero es suyo de verdad y cuánto es de Hacienda, controlar si una obra se alarga en horas y emitir presupuestos o registrar tickets sin perder la tarde en papeleo.
- **Valor principal**: Todo está conectado en tiempo real: crear una obra con fechas genera automáticamente sus jornadas en el Calendario; registrar horas extra recalcula la desviación económica según la tarifa `€/h` y añade una entrada al Diario de Obra; aprobar un presupuesto actualiza el Tarifario si el usuario lo marca; cobrar una factura o guardar un ticket recalcula al instante los gráficos de la Hucha Fiscal.

---

## 2. Experiencia de Usuario y Diseño Visual

### Flujos de Usuario Clave
1. **Inicio modular (`#/`)**: Saludo personal, tarjeta financiera *Tu dinero hoy* (*Libre real* en esmeralda vs *Hacienda intocable* en ámbar con barra de proporción), tarjeta protagonista del *Asistente de Obra* con propuestas pendientes de revisar y cuadrícula de módulos (*Agenda y Calendario* a ancho completo, *Obras*, *Presupuestos*, *Clientes*, *Hucha Fiscal*, *Tarifario* y *Actividad*).
2. **Agenda, Calendario y Parte de Jornada (`#/calendario`)**: Selector de mes/semana/lista de obras, calendario visual con bloques continuos por rango de fechas y puntos de estado (*En hora*, *Horas extra*, *Antes de hora*), tarjeta de agenda del día seleccionado y gráfica de *Previsto vs Real* con impacto en euros. Al pulsar en registrar salida o ajustar horas, se abre el **Parte de Jornada** en el overlay generativo con ajustes rápidos (`-1,5 h`, `-30 m`, `En hora`, `+30 m`, `+1 h`, `+2 h`), cálculo instantáneo del sobrecoste/ahorro, chips de motivo y opción de vincular automáticamente la nota al Diario de Obra.
3. **Asistente de Obra y Voz (`#/asistente` + `GlobalVoiceOverlay`)**: Conversación natural con tarjetas resumen clicables que abren cada propuesta en el overlay generativo (revisar parte del día, abrir borrador de presupuesto, registrar ticket). El botón protagonista **Voz** de la barra inferior permite dictar/escribir libremente o lanzar un escenario de un toque que genera al momento un nuevo borrador interactivo en el hilo.
4. **Cámara, Tickets y Diario de Obra (`GlobalCameraChoiceSheet`)**: Al pulsar **Cámara** se despliega una hoja inferior para elegir entre *Escanear Ticket de Gasto* (lectura de proveedor, categoría, obra vinculada, base e IVA 21% editable en vivo que suma directamente a la Hucha Fiscal) o *Foto de Diario de Obra* (captura o subida de foto con sello de fecha/hora, pie de foto y vinculación directa a una obra).
5. **Presupuestos, Facturas y PDF (`#/presupuestos`)**: Filtros por estado (*Todos*, *Presupuestos*, *Facturas*, *Por cobrar*), constructor generativo editable partida a partida (cantidad, unidad `m2`/`ud`/`h`, precio unitario, selector de IVA `10% Vivienda`, `21% General` u `Otro %`, casilla *Guardar precio en mi tarifario* y cálculo exacto en céntimos). Desde presupuestos aceptados se puede emitir **anticipo del 40%** (`ANT`) o **factura completa** (`FAC`), marcar facturas como cobradas y abrir la vista previa PDF imprimible/descargable.
6. **Obras, Clientes, Hucha Fiscal, Tarifario, Actividad y Ajustes**:
   - **Obras (`#/obras`)**: Filtros por estado, creación de obra con fechas de inicio/fin que autogenera sus jornadas en el Calendario según el horario habitual, y cajón/vista de detalle con pestañas de *Diario*, *Fotos selladas*, *Gastos* y documentos vinculados.
   - **Clientes (`#/clientes` y `#/clientes/:id`)**: Buscador instantáneo por nombre, NIF o teléfono, creación de cliente y ficha completa con 4 KPIs económicos (*Presupuestado*, *Facturado*, *Cobrado*, *Pendiente*), llamada directa y lista de obras asociadas.
   - **Hucha Fiscal (`#/hucha`)**: Selector de trimestre (`2026-T3` / `2026-T4`), tarjetas *Para Hacienda* (desglose IVA + IRPF) vs *Libre Real*, gráficos SVG interactivos (anillo *Reparto de cada euro*, barras verticales del trimestre y barras horizontales de rentabilidad neta por obra), desglose modal interactivo y listado de tickets deducibles.
   - **Tarifario (`#/tarifario`) y Ajustes (`#/ajustes`)**: Tarifa base `€/hora`, configuración de *Mi Horario Habitual de Trabajo* (días laborables `L–D`, tramos de mañana y tarde, switch de aplicación automática), catálogo buscable por oficio, alta de partidas personalizadas, importador rápido de tarifa, datos fiscales del emisor, numeración correlativa y exportación/reinicio de datos demo.
   - **Actividad (`#/actividad`)**: Registro coloquial de todo lo que el asistente ha guardado o aprendido (precios recordados, desviaciones de jornada, IVA habitual) con enlace directo para editar o ajustar.

### Identidad Visual y Sistema de Diseño
- **Dirección estética**: Utilitaria, cálida y de alto contraste pensada para lectura rápida a plena luz del día en obra, replicando con fidelidad los 16 diseños adjuntos de Google Stitch.
- **Paleta y atmósfera**:
  - Fondo principal cálido `#FAF9F6`, tarjetas blancas `#FFFFFF` y tarjetas cálidas estructurales `#F4F0EA` con bordes sutiles `#E2E8F0`.
  - Acento terracota `#EA580C` / `#D04B00` para acciones primarias y botón central de Voz; pizarra `#0F172A` para texto principal y acciones secundarias.
  - Semántica financiera inconfundible: esmeralda `#059669` (`#ECFDF5`) para dinero *Libre Real* y estados *En hora / Cobrada*; ámbar `#D97706` (`#FFFBEB`) para *Hacienda Intocable* y *Horas extra*; coral `#DC2626` (`#FEF2F2`) para facturas vencidas y acciones destructivas; azul `#2563EB` (`#EFF6FF`) para jornadas terminadas *Antes de hora*.
- **Tipografía y rigor numérico**: `Inter` para interfaz y `JetBrains Mono` con `tabular-nums` en todos los importes en formato español (`1.250,50 €`), porcentajes, horarios y códigos (`OBR-2026-001`, `PRE-2026-014`, `FAC-2026-018`).
- **Ergonomía móvil**: Marco móvil centrado (`max-w-md mx-auto h-dvh` con ancho de referencia `390px` sobre fondo exterior neutro en escritorio), cabecera fija de `56px`, barra inferior fija de `64px` (3 botones: *Inicio*, botón flotante *Voz* y *Cámara*), áreas táctiles mínimas de `48px` y menú lateral deslizable (`AppNavigationDrawer`) con acceso a los 8 módulos, conversaciones recientes y Ajustes anclado abajo.

---

## 3. Decisiones Clave de Producto y Compromisos

- **Separación estricta entre UI y capa de datos (`mockStore`)**:
  - *Enfoque elegido*: Un contexto reactivo desacoplado con operaciones tipadas en céntimos (`*_cents`) y sincronización automática con `localStorage`, respetando exactamente los contratos de entidades solicitados (`Client`, `Job`, `ScheduleEntry`, `WorkScheduleDefaults`, `Quote`, `Invoice`, `ExpenseTicket`).
  - *Por qué*: Permite sustituir en el futuro la implementación interna por consultas SQLite (Capacitor) y flujos LangGraph sin reescribir ningún componente visual.
  - *Alternativa descartada*: Estado disperso por componente, que impediría la reactividad cruzada entre Calendario, Obras, Presupuestos y Hucha Fiscal.
- **Cálculo financiero en céntimos enteros**:
  - *Enfoque elegido*: Toda la aritmética de partidas, subtotales, IVA (10%, 21% o personalizado), anticipos del 40%, IRPF trimestral y rentabilidad por obra se calcula en céntimos enteros y se formatea en euros al renderizar.
  - *Por qué*: Evita errores de redondeo en coma flotante y mantiene coherencia exacta con una futura base de datos contable SQLite.
- **Imágenes locales generadas para fotos de obra y ticket**:
  - *Enfoque elegido*: Sustituir las URLs externas temporales de los HTML por 3 fotografías locales realistas (tubería de desagüe en obra, alicatado porcelánico de ducha y ticket de almacén de fontanería) con contenedor de respaldo visual.
  - *Por qué*: Garantiza funcionamiento 100% offline y cero imágenes rotas en cualquier entorno de previsualización.

---

## 4. Arquitectura Técnica y Estrategia de Datos

### Diagrama de Arquitectura y Componentes

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HashRouter (window.location.hash)                    │
│   #/ | #/asistente | #/calendario | #/obras | #/presupuestos | #/hucha  │
│        #/clientes | #/clientes/:id | #/tarifario | #/actividad | #/ajustes│
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             AppStoreProvider (src/services/mockStore.ts)                │
│  Estado tipado en memoria + persistencia localStorage + reset demo      │
│  [Clients · Jobs · ScheduleEntries · WorkScheduleDefaults · Quotes ·    │
│   Invoices · ExpenseTickets · PricingCatalog · ChatThreads · Activity]  │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              MobileShell (max-w-md mx-auto h-dvh, 390px)                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ TopHeader (56px): [Menú] ──── Título dinámico ──── [Ajustes]      │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │ Active Feature View (scroll independiente):                       │  │
│  │  • HomeHubView          • CalendarScheduleView                    │  │
│  │  • ChatTimelineView     • JobsView + JobDetailDrawer              │  │
│  │  • QuotesView           • ClientsView + ClientProfileView         │  │
│  │  • FiscalDashboardView  • PricingCatalogView                      │  │
│  │  • InspectorView        • SettingsSheet                           │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │ GlobalBottomNav (64px): [Inicio] ─── [● Voz] ─── [Cámara]         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  Capas interactivas globales (Overlays / Drawers):                      │
│  • AppNavigationDrawer (menú lateral + conversaciones + Ajustes)        │
│  • GlobalVoiceOverlay (dictado/texto libre + ejemplos de un toque)      │
│  • GlobalCameraChoiceSheet (Escanear Ticket OCR | Foto Diario de Obra)  │
│  • GenerativeWidgetOverlay (Full-screen: Presupuesto, Factura, Ticket,  │
│    Foto sellada, Parte de Jornada → Editar / Rechazar / Aprobar)        │
│  • PrintableDocumentModal (Vista previa imprimible / guardar PDF)       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Modelo de Datos y Cálculos Reactivos
- **Entidades núcleo**: `Client`, `Job`, `ScheduleEntry`, `WorkScheduleDefaults`, `Quote` (con `QuoteLine[]`), `Invoice` (series `ANT` y `FAC`), `ExpenseTicket`, además de entidades de apoyo para `JobDiaryEntry`, `JobPhoto`, `CatalogItem`, `ChatConversation`, `ActivityEntry` y `BusinessSettings` (datos fiscales del emisor, tarifa base `38,00 €/h`, IVA/IRPF por defecto y contadores correlativos).
- **Datos iniciales de demostración**: 4 clientes realistas (*Elena Navarro*, *Marta Ruiz*, *Comunidad Velázquez 42*, *Restaurante El Patio* / *Javier Morales*), obras activas en noviembre de 2026 con rangos de fechas continuos (incluyendo *OBR-2026-001 Reforma baño Marta Ruiz* del 22 al 30 nov, *OBR-2026-014 Baño Calle Alcalá* y *OBR-2026-011 Bajante Velázquez* con desviación de `+4,5 h`), presupuestos en distintos estados, facturas cobradas/pendientes/vencidas, tickets deducibles del `2026-T4` y `2026-T3`, y tarifario con `38,00 €/h` y horario `L–V 08:00–14:00` y `15:00–17:00`.

### Mapeo de Interacciones y Mutaciones de Estado
1. **Creación de obra con fechas (`JobsView` → `CalendarScheduleView`)**: Al guardar una nueva obra con `start_date_iso` y `end_date_iso` y la aplicación automática activada, el store recorre el rango, filtra según `WorkScheduleDefaults.work_days` y genera automáticamente un `ScheduleEntry` por cada día laborable con sus horas previstas y actualiza `estimated_hours` de la obra.
2. **Parte diario de jornada (`CalendarScheduleView` → `GenerativeWidgetOverlay`)**: Seleccionar un día o pulsar *Registrar salida* abre el parte diario en pantalla completa. Cambiar la desviación actualiza en tiempo real la hora real, horas trabajadas, estado (`en_hora` / `antes` / `alargado`) e impacto en euros (`delta_horas × tarifa_hora`). Al confirmar, se actualiza la gráfica de *Previsto vs Real*, se añade la nota al *Diario de Obra* (si la casilla está marcada) y se registra el aprendizaje en *Actividad*.
3. **Constructor de Presupuestos y Facturación (`QuotesView` / `ChatTimelineView` → `GenerativeWidgetOverlay` → `PrintableDocumentModal`)**: Añadir, editar o eliminar partidas y alternar IVA (`10%`, `21%`, personalizado) recalcula `subtotal_cents`, `vat_cents` y `total_cents` al instante. Al aprobar: se actualiza el estado, se guardan en el Tarifario las partidas marcadas y se despliega la vista previa imprimible/descargable en PDF. Desde presupuestos aceptados se puede emitir un anticipo del 40% (`ANT`) o factura final (`FAC`), pasando también por revisión generativa antes de emitir y mostrar su PDF.
4. **Cobros, Tickets OCR y Hucha Fiscal (`FiscalDashboardView` + `GlobalCameraChoiceSheet`)**: Marcar una factura como cobrada o guardar un ticket desde el escáner OCR (con imagen precargada de muestra o archivo subido por el usuario) recalcula dinámicamente los KPIs de *Hacienda Intocable* (IVA repercutido menos IVA soportado + estimación de IRPF) vs *Libre Real*, el gráfico donut SVG, las barras del trimestre y la rentabilidad neta por obra.
