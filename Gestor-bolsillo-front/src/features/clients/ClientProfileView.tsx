import React from 'react';
import { Phone, PlusCircle } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import { formatDateRange, formatEuros, getInitials } from '../../utils/format';

interface ClientProfileViewProps {
  clientId: string;
}

export function ClientProfileView({ clientId }: ClientProfileViewProps) {
  const { state, navigate, openOverlay, pushToast } = useAppStore();

  const client = state.clients.find((c) => c.id === clientId);
  if (!client) {
    return (
      <main className="px-4 pt-8 text-center flex flex-col items-center gap-3">
        <p className="text-[14px] text-on-surface-variant">Cliente no encontrado.</p>
        <button
          type="button"
          onClick={() => navigate('#/clientes')}
          className="px-4 py-2 rounded-xl bg-secondary text-white text-[13px] font-semibold cursor-pointer"
        >
          Volver a clientes
        </button>
      </main>
    );
  }

  const clientJobs = state.jobs.filter((j) => j.client_id === client.id);
  const clientQuotes = state.quotes.filter((q) => q.client_id === client.id);
  const clientInvoices = state.invoices.filter((i) => i.client_id === client.id);

  const totalQuoted = clientQuotes.reduce((s, q) => s + q.total_cents, 0);
  const totalInvoiced = clientInvoices.reduce((s, i) => s + i.total_cents, 0);
  const totalPaid = clientInvoices
    .filter((i) => i.status === 'pagado')
    .reduce((s, i) => s + i.total_cents, 0);
  const totalPending = clientInvoices
    .filter((i) => i.status !== 'pagado')
    .reduce((s, i) => s + i.total_cents, 0);

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      {/* Cabecera de identidad */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-14 h-14 rounded-full bg-terracotta-soft text-on-primary-container font-bold text-[19px] flex items-center justify-center shrink-0">
            {getInitials(client.name)}
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <h2 className="text-[19px] leading-[24px] font-bold text-on-surface truncate">
              {client.name}
            </h2>
            <div className="flex items-center gap-2 flex-wrap font-mono text-[12px] text-on-surface-variant tabular-nums">
              <span>{client.phone}</span>
              <span className="text-outline">·</span>
              <span>NIF {client.nif}</span>
            </div>
            <span className="text-[13px] text-on-surface-variant">{client.fiscal_address}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => pushToast(`Llamando a ${client.name} (${client.phone})`, 'info')}
          aria-label="Llamar al cliente"
          className="w-11 h-11 rounded-full bg-terracotta-soft text-on-primary-container inline-flex items-center justify-center shrink-0 cursor-pointer"
        >
          <Phone className="w-5 h-5" />
        </button>
      </section>

      {client.notes && (
        <p className="text-[13px] text-on-surface-variant bg-surface-warm-card border border-outline-variant rounded-2xl px-3.5 py-2.5">
          {client.notes}
        </p>
      )}

      {/* 4 mini-tarjetas de resumen */}
      <section className="grid grid-cols-2 gap-2.5">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-3 flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-on-surface-variant">Presupuestado</span>
          <span className="font-mono text-[16px] font-bold text-on-surface tabular-nums">
            {formatEuros(totalQuoted)}
          </span>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-3 flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-on-surface-variant">Facturado</span>
          <span className="font-mono text-[16px] font-bold text-on-surface tabular-nums">
            {formatEuros(totalInvoiced)}
          </span>
        </div>
        <div className="bg-success-container border border-outline-variant rounded-2xl p-3 flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-on-success-container">Cobrado</span>
          <span className="font-mono text-[16px] font-bold text-on-success-container tabular-nums">
            {formatEuros(totalPaid)}
          </span>
        </div>
        <div className="bg-warning-container border border-outline-variant rounded-2xl p-3 flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-on-warning-container">Pendiente</span>
          <span className="font-mono text-[16px] font-bold text-on-warning-container tabular-nums">
            {formatEuros(totalPending)}
          </span>
        </div>
      </section>

      {/* Acceso rápido nuevo presupuesto */}
      <button
        type="button"
        onClick={() =>
          openOverlay({
            kind: 'quote',
            initialClientId: client.id,
            initialTitle: `Reforma · ${client.name}`,
          })
        }
        className="min-h-[48px] w-full px-5 rounded-xl bg-primary hover:bg-terracotta text-white font-semibold text-[14px] flex items-center justify-center gap-2 shadow-sm cursor-pointer"
      >
        <PlusCircle className="w-5 h-5" />
        <span>Nuevo presupuesto</span>
      </button>

      {/* Obras asociadas */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-on-surface">Obras asociadas</h3>
          <span className="text-[12px] font-semibold text-on-surface-variant">
            {clientJobs.length} {clientJobs.length === 1 ? 'obra' : 'obras'}
          </span>
        </div>

        {clientJobs.map((job) => {
          const quote = state.quotes.find((q) => q.job_id === job.id);
          const invSum = state.invoices
            .filter((i) => i.job_id === job.id)
            .reduce((s, i) => s + i.total_cents, 0);
          const amount = quote?.total_cents ?? invSum;

          return (
            <button
              key={job.id}
              type="button"
              onClick={() => navigate('#/obras')}
              className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2 hover:border-terracotta transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
                  {job.job_code}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
                    job.status === 'en_curso'
                      ? 'bg-terracotta-soft text-on-primary-container'
                      : 'bg-success-container text-on-success-container'
                  }`}
                >
                  {job.status === 'en_curso' ? 'En curso' : 'Finalizada'}
                </span>
              </div>
              <h4 className="text-[15px] font-semibold text-on-surface">{job.title}</h4>
              <div className="flex items-center justify-between pt-2 border-t border-outline-variant">
                <span className="text-[13px] text-on-surface-variant">
                  {quote
                    ? `Presupuesto ${quote.quote_code}`
                    : formatDateRange(job.start_date_iso, job.end_date_iso)}
                </span>
                <span className="font-mono text-[15px] font-semibold text-on-surface tabular-nums">
                  {formatEuros(amount)}
                </span>
              </div>
            </button>
          );
        })}
      </section>
    </main>
  );
}
