import React from 'react';
import { Sparkles } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';

export function InspectorView() {
  const { state, navigate } = useAppStore();

  const toneClasses = {
    success: 'bg-success-container text-on-success-container',
    warning: 'bg-warning-container text-on-warning-container',
    terracotta: 'bg-terracotta-soft text-on-primary-container',
    neutral: 'bg-surface-container text-on-surface',
  };

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      {/* Tarjeta resumen de aprendizaje local */}
      <section className="bg-terracotta-soft border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-terracotta text-white flex items-center justify-center shrink-0">
          <Sparkles className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[16px] font-semibold text-on-surface">Lo que he aprendido de ti</h2>
          <p className="text-[13px] leading-[19px] text-on-primary-container">
            Cada ajuste que haces en un presupuesto, ticket o parte queda guardado en tu teléfono.
          </p>
        </div>
      </section>

      {/* Métricas rápidas */}
      <section className="grid grid-cols-2 gap-2.5">
        <div className="bg-surface-warm-card border border-outline-variant rounded-2xl p-3.5 flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-on-surface-variant">
            Precios recordados
          </span>
          <span className="font-mono text-[26px] leading-[32px] font-bold text-on-surface tabular-nums">
            {state.pricingCatalog.length}
          </span>
        </div>
        <div className="bg-success-container border border-outline-variant rounded-2xl p-3.5 flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-on-success-container">
            Gestiones recientes
          </span>
          <span className="font-mono text-[26px] leading-[32px] font-bold text-on-success-container tabular-nums">
            +{state.activities.length}
          </span>
        </div>
      </section>

      {/* Lista cronológica */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-on-surface">Últimos cambios guardados</h3>
          <span className="text-[11px] font-semibold text-on-surface-variant">100% en local</span>
        </div>

        {state.activities.map((item) => (
          <article
            key={item.id}
            className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
                  toneClasses[item.tone]
                }`}
              >
                {item.category}
              </span>
              <span className="font-mono text-[11px] text-on-surface-variant tabular-nums">
                {item.timestamp_label}
              </span>
            </div>

            <h4 className="text-[15px] font-semibold text-on-surface">{item.title}</h4>
            <p className="text-[13px] leading-[19px] text-on-surface-variant">
              {item.highlight_value && (
                <strong className="font-mono text-on-surface tabular-nums mr-1">
                  {item.highlight_value} ·
                </strong>
              )}
              {item.description}
            </p>

            {item.action_route && item.action_label && (
              <div className="flex items-center justify-end pt-2 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => navigate(item.action_route!)}
                  className="text-[12px] font-semibold text-on-primary-container cursor-pointer hover:underline"
                >
                  {item.action_label}
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
