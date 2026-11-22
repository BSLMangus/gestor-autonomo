import React, { useMemo, useState } from 'react';
import {
  Clock,
  FileUp,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import type { PricingCatalogItem, PricingUnit, TradeCategory } from '../../types/domain';
import {
  calculateDailyHoursFromDefaults,
  eurosToCents,
  formatEuros,
  formatHours,
  parseSpanishNumber,
} from '../../utils/format';

const WEEKDAY_BUTTONS = [
  { id: 1, label: 'L' },
  { id: 2, label: 'M' },
  { id: 3, label: 'X' },
  { id: 4, label: 'J' },
  { id: 5, label: 'V' },
  { id: 6, label: 'S' },
  { id: 7, label: 'D' },
];

export function PricingCatalogView() {
  const {
    state,
    updateSettings,
    updateWorkScheduleDefaults,
    upsertCatalogItem,
    deleteCatalogItem,
    pushToast,
  } = useAppStore();

  const [search, setSearch] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<'Todas' | TradeCategory>('Todas');
  const [editingRate, setEditingRate] = useState(false);
  const [rateDraft, setRateDraft] = useState(
    (state.settings.hourly_rate_cents / 100).toFixed(2).replace('.', ','),
  );

  // Add/Edit item modal
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PricingCatalogItem | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState<TradeCategory>('Fontanería');
  const [itemUnit, setItemUnit] = useState<PricingUnit>('ud');
  const [itemPriceStr, setItemPriceStr] = useState('45,00');

  // Importer modal
  const [showImporter, setShowImporter] = useState(false);
  const [importText, setImportText] = useState(
    'Colocación inodoro completo;Fontanería;ud;165,00\nSustitución cuadro eléctrico vivienda;Electricidad;ud;420,00',
  );

  const schedule = state.workScheduleDefaults;
  const dailySummary = calculateDailyHoursFromDefaults(schedule);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.pricingCatalog.filter((item) => {
      if (selectedTrade !== 'Todas' && item.category !== selectedTrade) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state.pricingCatalog, search, selectedTrade]);

  const toggleWorkDay = (dayId: number) => {
    const exists = schedule.work_days.includes(dayId);
    const nextDays = exists
      ? schedule.work_days.filter((d) => d !== dayId)
      : [...schedule.work_days, dayId].sort((a, b) => a - b);
    updateWorkScheduleDefaults({ ...schedule, work_days: nextDays });
  };

  const openNewItemModal = () => {
    setEditingItem(null);
    setItemName('');
    setItemCategory('Fontanería');
    setItemUnit('ud');
    setItemPriceStr('45,00');
    setItemModalOpen(true);
  };

  const openEditItemModal = (item: PricingCatalogItem) => {
    setEditingItem(item);
    setItemName(item.name);
    setItemCategory(item.category);
    setItemUnit(item.unit);
    setItemPriceStr((item.unit_price_cents / 100).toFixed(2).replace('.', ','));
    setItemModalOpen(true);
  };

  const handleSaveItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) return;
    upsertCatalogItem({
      id: editingItem?.id,
      name: itemName.trim(),
      category: itemCategory,
      unit: itemUnit,
      unit_price_cents: Math.max(0, eurosToCents(parseSpanishNumber(itemPriceStr))),
    });
    setItemModalOpen(false);
  };

  const handleImportLines = () => {
    const rows = importText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    let count = 0;
    for (const row of rows) {
      const [name, cat, unit, price] = row.split(';').map((s) => s.trim());
      if (!name || !price) continue;
      upsertCatalogItem({
        name,
        category: (cat as TradeCategory) || 'General',
        unit: (unit as PricingUnit) || 'ud',
        unit_price_cents: Math.max(0, eurosToCents(parseSpanishNumber(price))),
      });
      count += 1;
    }
    setShowImporter(false);
    if (count > 0) {
      pushToast(`${count} partidas importadas a tu tarifario`);
    }
  };

  const handleSaveHourlyRate = () => {
    const cents = Math.max(100, eurosToCents(parseSpanishNumber(rateDraft)));
    updateSettings({ hourly_rate_cents: cents });
    setEditingRate(false);
  };

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      {/* Tarifa base mano de obra */}
      <section className="bg-terracotta-soft border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold text-on-primary-container">
              Tarifa base mano de obra
            </span>
            <span className="font-mono text-[24px] leading-[30px] font-bold text-on-surface tabular-nums">
              {formatEuros(state.settings.hourly_rate_cents)}/h
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setRateDraft(
                (state.settings.hourly_rate_cents / 100).toFixed(2).replace('.', ','),
              );
              setEditingRate((v) => !v);
            }}
            className="min-h-[40px] px-3.5 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface font-semibold text-[12px] inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>{editingRate ? 'Cerrar' : 'Cambiar'}</span>
          </button>
        </div>

        {editingRate && (
          <div className="flex items-center gap-2 pt-2 border-t border-outline-variant">
            <input
              type="text"
              value={rateDraft}
              onChange={(e) => setRateDraft(e.target.value)}
              className="flex-1 min-h-[44px] rounded-xl bg-surface-container-lowest border border-outline-variant px-3 font-mono text-[15px] font-semibold tabular-nums"
            />
            <button
              type="button"
              onClick={handleSaveHourlyRate}
              className="min-h-[44px] px-4 rounded-xl bg-primary text-white font-semibold text-[13px] cursor-pointer"
            >
              Guardar €/h
            </button>
          </div>
        )}
      </section>

      {/* Mi Horario Habitual de Trabajo (vinculado al Calendario) */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-on-primary-container" />
            <h2 className="text-[15px] font-semibold text-on-surface">
              Mi Horario Habitual de Trabajo
            </h2>
          </div>
          <span className="font-mono text-[11px] font-semibold text-on-success-container bg-success-container px-2.5 py-0.5 rounded-full tabular-nums">
            {formatHours(dailySummary.totalHours)}/día
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_BUTTONS.map((day) => {
            const active = schedule.work_days.includes(day.id);
            return (
              <button
                key={day.id}
                type="button"
                onClick={() => toggleWorkDay(day.id)}
                aria-pressed={active}
                className={`min-h-[42px] rounded-xl font-semibold text-[12px] cursor-pointer transition-colors ${
                  active
                    ? 'bg-secondary text-on-secondary'
                    : 'bg-surface-container-low border border-outline-variant text-on-surface-variant'
                }`}
              >
                {day.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between bg-surface-container-low rounded-2xl p-2.5">
            <div className="flex flex-col pl-1">
              <span className="text-[12px] font-semibold text-on-surface">Mañana</span>
              <span className="text-[11px] text-on-surface-variant">
                {formatHours(dailySummary.morningHours)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={schedule.morning_start}
                onChange={(e) =>
                  updateWorkScheduleDefaults({ ...schedule, morning_start: e.target.value })
                }
                className="min-h-[40px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
              />
              <span className="text-outline">–</span>
              <input
                type="time"
                value={schedule.morning_end}
                onChange={(e) =>
                  updateWorkScheduleDefaults({ ...schedule, morning_end: e.target.value })
                }
                className="min-h-[40px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
              />
            </div>
          </div>

          <div className="flex items-center justify-between bg-surface-container-low rounded-2xl p-2.5">
            <div className="flex flex-col pl-1">
              <span className="text-[12px] font-semibold text-on-surface">Tarde</span>
              <span className="text-[11px] text-on-surface-variant">
                {formatHours(dailySummary.afternoonHours)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={schedule.afternoon_start}
                onChange={(e) =>
                  updateWorkScheduleDefaults({ ...schedule, afternoon_start: e.target.value })
                }
                className="min-h-[40px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
              />
              <span className="text-outline">–</span>
              <input
                type="time"
                value={schedule.afternoon_end}
                onChange={(e) =>
                  updateWorkScheduleDefaults({ ...schedule, afternoon_end: e.target.value })
                }
                className="min-h-[40px] px-2 rounded-xl bg-surface-container-lowest border border-outline-variant font-mono text-[12px] tabular-nums"
              />
            </div>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 min-h-[46px] px-3 py-2 rounded-xl bg-terracotta-soft border border-outline-variant cursor-pointer">
          <span className="text-[13px] text-on-primary-container">
            Aplicar automáticamente este horario al crear una obra con fechas
          </span>
          <input
            type="checkbox"
            checked={schedule.auto_apply_to_jobs}
            onChange={(e) =>
              updateWorkScheduleDefaults({
                ...schedule,
                auto_apply_to_jobs: e.target.checked,
              })
            }
            className="w-5 h-5 rounded border-outline accent-terracotta shrink-0"
          />
        </label>
      </section>

      {/* Buscador y filtros por oficio */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="flex-1 relative flex items-center">
            <Search className="w-5 h-5 text-outline absolute left-3" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar partida o material..."
              className="min-h-[46px] w-full rounded-2xl bg-surface-container-lowest border border-outline-variant pl-10 pr-3 text-[14px] placeholder:text-outline focus:outline-none focus:border-terracotta"
            />
          </label>
          <button
            type="button"
            onClick={() => setShowImporter(true)}
            aria-label="Importar tarifario"
            className="min-h-[46px] px-3 rounded-2xl bg-surface-container-lowest border border-outline-variant hover:border-terracotta text-on-surface font-semibold text-[12px] inline-flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <FileUp className="w-4 h-4" />
            <span>Importar</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {(['Todas', 'Fontanería', 'Albañilería', 'Electricidad', 'Pintura'] as const).map(
            (trade) => (
              <button
                key={trade}
                type="button"
                onClick={() => setSelectedTrade(trade)}
                aria-pressed={selectedTrade === trade}
                className={`min-h-[36px] px-3.5 rounded-full font-semibold text-[11px] shrink-0 cursor-pointer ${
                  selectedTrade === trade
                    ? 'bg-secondary text-on-secondary'
                    : 'bg-surface-container-lowest border border-outline-variant text-on-surface-variant'
                }`}
              >
                {trade === 'Todas' ? `Todas (${state.pricingCatalog.length})` : trade}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Partidas guardadas */}
      <section className="flex flex-col gap-3">
        {filteredItems.map((item) => (
          <article
            key={item.id}
            className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
                  item.learned_from
                    ? 'bg-success-container text-on-success-container'
                    : 'bg-surface-container text-on-surface'
                }`}
              >
                {item.learned_from
                  ? `Aprendido en ${item.learned_from}`
                  : `Usado ${item.usage_count} veces`}
              </span>
              <span className="text-[11px] font-semibold text-on-surface-variant">
                {item.category}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-on-surface">{item.name}</h3>
              <span className="font-mono text-[15px] font-semibold text-on-surface tabular-nums shrink-0">
                {formatEuros(item.unit_price_cents)}/{item.unit}
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1.5 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => openEditItemModal(item)}
                className="text-[12px] font-semibold text-on-primary-container cursor-pointer"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => deleteCatalogItem(item.id)}
                aria-label="Eliminar partida"
                className="text-outline hover:text-coral-alert cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </article>
        ))}
      </section>

      <button
        type="button"
        onClick={openNewItemModal}
        className="min-h-[48px] w-full rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
      >
        <Plus className="w-5 h-5" />
        <span>Añadir partida al tarifario</span>
      </button>

      {/* Modal Añadir / Editar partida */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-50 bg-secondary/45 flex items-end sm:items-center justify-center p-4">
          <form
            onSubmit={handleSaveItem}
            className="w-full max-w-[385px] bg-surface-container-lowest rounded-[24px] p-5 border border-outline-variant shadow-2xl flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-on-surface">
                {editingItem ? 'Editar partida' : 'Nueva partida en tarifario'}
              </h3>
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              required
              placeholder="Nombre de la partida"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[14px]"
            />

            <div className="grid grid-cols-2 gap-2">
              <select
                value={itemCategory}
                onChange={(e) => setItemCategory(e.target.value as TradeCategory)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
              >
                <option value="Fontanería">Fontanería</option>
                <option value="Albañilería">Albañilería</option>
                <option value="Electricidad">Electricidad</option>
                <option value="Pintura">Pintura</option>
                <option value="General">General</option>
              </select>
              <select
                value={itemUnit}
                onChange={(e) => setItemUnit(e.target.value as PricingUnit)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[13px]"
              >
                <option value="ud">ud</option>
                <option value="m2">m2</option>
                <option value="h">h</option>
                <option value="ml">ml</option>
                <option value="pa">pa</option>
              </select>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-on-surface">Precio unitario (€)</span>
              <input
                type="text"
                value={itemPriceStr}
                onChange={(e) => setItemPriceStr(e.target.value)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[15px] tabular-nums"
              />
            </label>

            <button
              type="submit"
              className="min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] cursor-pointer"
            >
              Guardar en tarifario
            </button>
          </form>
        </div>
      )}

      {/* Modal Importador rápido */}
      {showImporter && (
        <div className="fixed inset-0 z-50 bg-secondary/45 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-[385px] bg-surface-container-lowest rounded-[24px] p-5 border border-outline-variant shadow-2xl flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-on-surface">Importar lista de precios</h3>
              <button
                type="button"
                onClick={() => setShowImporter(false)}
                className="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[12px] text-on-surface-variant">
              Pega una partida por línea con formato: <span className="font-mono">Nombre;Oficio;Unidad;Precio</span>
            </p>
            <textarea
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="rounded-xl bg-surface-container-low border border-outline-variant p-3 font-mono text-[12px]"
            />
            <button
              type="button"
              onClick={handleImportLines}
              className="min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] cursor-pointer"
            >
              Importar partidas
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
