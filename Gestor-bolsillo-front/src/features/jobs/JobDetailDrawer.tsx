import React, { useState } from 'react';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileText,
  Link2,
  Plus,
  ReceiptText,
} from 'lucide-react';
import { IMG_PLUMBING_PIPE, IMG_TICKET_RECEIPT, TODAY_ISO, useAppStore } from '../../services/mockStore';
import type { JobStatus } from '../../types/domain';
import {
  formatDateRange,
  formatEuros,
  formatShortDate,
  formatShortDayLabel,
  formatSignedEuros,
  formatSignedHours,
} from '../../utils/format';

interface JobDetailDrawerProps {
  jobId: string | null;
  onClose: () => void;
}

type DetailTab = 'diario' | 'fotos' | 'gastos' | 'docs';

export function JobDetailDrawer({ jobId, onClose }: JobDetailDrawerProps) {
  const {
    state,
    openOverlay,
    openPrintableDoc,
    updateJobStatus,
    addManualDiaryNote,
    getClientById,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<DetailTab>('diario');
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteText, setNoteText] = useState('');

  if (!jobId) return null;

  const job = state.jobs.find((j) => j.id === jobId);
  if (!job) return null;

  const client = getClientById(job.client_id);
  const jobEntries = state.scheduleEntries.filter((e) => e.job_id === job.id);
  const plannedHours =
    jobEntries.reduce((s, e) => s + e.planned_hours, 0) || job.estimated_hours || 0;
  const loggedHours = jobEntries.reduce((s, e) => s + (e.actual_hours ?? 0), 0);

  const photos = state.jobPhotos.filter((p) => p.job_id === job.id);
  const diary = state.jobDiaryEntries.filter((d) => d.job_id === job.id);
  const tickets = state.expenseTickets.filter((t) => t.job_id === job.id);
  const quotes = state.quotes.filter((q) => q.job_id === job.id);
  const invoices = state.invoices.filter((i) => i.job_id === job.id);

  const primaryAmount =
    quotes[0]?.total_cents ?? invoices.reduce((s, i) => s + i.total_cents, 0);

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    addManualDiaryNote(job.id, noteText.trim());
    setNoteText('');
    setShowNoteForm(false);
  };

  return (
    <div className="absolute inset-0 z-40 bg-surface flex flex-col overflow-hidden">
      {/* Cabecera contextual */}
      <header className="shrink-0 h-[56px] bg-surface border-b border-outline-variant px-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          aria-label="Volver a obras"
          className="w-12 h-12 -ml-2 rounded-full text-on-surface inline-flex items-center justify-center hover:bg-surface-container cursor-pointer"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        <div className="flex flex-col items-center">
          <h2 className="text-[16px] font-semibold text-on-surface">Detalle de Obra</h2>
          <span className="font-mono text-[12px] text-on-surface-variant tabular-nums">
            {job.job_code}
          </span>
        </div>

        <button
          type="button"
          onClick={() =>
            openOverlay({
              kind: 'photo',
              initialJobId: job.id,
              initialCaption: `Avance en ${job.title}`,
              initialImageUrl: IMG_PLUMBING_PIPE,
            })
          }
          aria-label="Añadir foto de obra"
          className="w-12 h-12 -mr-2 rounded-full text-on-primary-container inline-flex items-center justify-center hover:bg-terracotta-soft cursor-pointer"
        >
          <Camera className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-8 flex flex-col gap-4">
        {/* Tarjeta resumen de obra */}
        <section className="bg-surface-warm-card border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5 min-w-0">
              <h3 className="text-[19px] leading-[25px] font-bold text-on-surface">
                {job.title}
              </h3>
              <span className="text-[13px] text-on-surface-variant">{job.address}</span>
              {client && (
                <span className="text-[12px] font-semibold text-on-primary-container">
                  Cliente: {client.name}
                </span>
              )}
            </div>
            <select
              value={job.status}
              onChange={(e) => updateJobStatus(job.id, e.target.value as JobStatus)}
              aria-label="Estado de la obra"
              className="px-2.5 py-1 rounded-full bg-success-container text-on-success-container font-semibold text-[11px] border border-outline-variant cursor-pointer"
            >
              <option value="pendiente">Pendiente</option>
              <option value="en_curso">En curso</option>
              <option value="finalizado">Finalizada</option>
              <option value="cancelado">Cancelada</option>
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-outline-variant">
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-on-surface-variant">Fechas</span>
              <span className="font-mono text-[12px] text-on-surface tabular-nums">
                {formatDateRange(job.start_date_iso, job.end_date_iso)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-on-surface-variant">Horas</span>
              <span className="font-mono text-[12px] text-on-surface tabular-nums">
                {loggedHours.toFixed(0)} / {plannedHours.toFixed(0)} h
              </span>
            </div>
            <div className="flex flex-col text-right">
              <span className="text-[11px] font-semibold text-on-surface-variant">Importe</span>
              <span className="font-mono text-[12px] font-semibold text-on-surface tabular-nums">
                {formatEuros(primaryAmount)}
              </span>
            </div>
          </div>
        </section>

        {/* Tabs de sección */}
        <div className="grid grid-cols-4 gap-1 bg-surface-container-lowest border border-outline-variant rounded-full p-1">
          {(
            [
              { id: 'diario', label: 'Diario' },
              { id: 'fotos', label: `Fotos (${photos.length})` },
              { id: 'gastos', label: `Gastos (${tickets.length})` },
              { id: 'docs', label: 'Docs' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
              className={`min-h-[36px] rounded-full font-semibold text-[11px] cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? 'bg-terracotta-soft text-on-primary-container'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: DIARIO */}
        {activeTab === 'diario' && (
          <div className="flex flex-col gap-4">
            {photos.length > 0 && (
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[15px] font-semibold text-on-surface">
                    Fotos selladas de obra
                  </h4>
                  <span className="text-[11px] font-semibold text-on-surface-variant">
                    Guardadas en local
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {photos.slice(0, 2).map((photo) => (
                    <figure
                      key={photo.id}
                      className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col"
                    >
                      <img
                        src={photo.image_url}
                        alt={photo.caption}
                        referrerPolicy="no-referrer"
                        className="w-full h-28 object-cover"
                      />
                      <figcaption className="p-2 flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-on-surface truncate">
                          {photo.caption}
                        </span>
                        <span className="font-mono text-[10px] text-on-surface-variant tabular-nums">
                          {formatShortDate(photo.captured_at_iso.slice(0, 10))} ·{' '}
                          {photo.captured_at_iso.slice(11, 16)}
                        </span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            )}

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[15px] font-semibold text-on-surface">
                  Diario y partes vinculados
                </h4>
                <button
                  type="button"
                  onClick={() => setShowNoteForm((v) => !v)}
                  className="text-[12px] font-semibold text-on-primary-container cursor-pointer"
                >
                  + Añadir nota
                </button>
              </div>

              {showNoteForm && (
                <form
                  onSubmit={handleSaveNote}
                  className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-3 flex flex-col gap-2"
                >
                  <textarea
                    rows={2}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Escribe una nota para el diario de esta obra..."
                    className="w-full rounded-xl bg-surface-container-low border border-outline-variant p-2.5 text-[13px]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNoteForm(false)}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-on-surface-variant cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 rounded-lg bg-primary text-white text-[12px] font-semibold cursor-pointer"
                    >
                      Guardar nota
                    </button>
                  </div>
                </form>
              )}

              {diary.length === 0 ? (
                <p className="text-[13px] text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-2xl p-4">
                  Todavía no hay entradas en el diario de esta obra.
                </p>
              ) : (
                diary.map((entry) => (
                  <article
                    key={entry.id}
                    className="bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-on-surface-variant tabular-nums">
                        {formatShortDayLabel(entry.date_iso)} · {entry.time_range}
                      </span>
                      {entry.delta_hours !== undefined && entry.delta_hours !== 0 ? (
                        <span
                          className={`px-2 py-0.5 rounded-full font-semibold text-[11px] tabular-nums ${
                            entry.delta_hours > 0
                              ? 'bg-warning-container text-on-warning-container'
                              : 'bg-info-container text-on-info-container'
                          }`}
                        >
                          {formatSignedHours(entry.delta_hours)} (
                          {formatSignedEuros(entry.delta_cents ?? 0)})
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-success-container text-on-success-container font-semibold text-[11px]">
                          En hora
                        </span>
                      )}
                    </div>
                    <p className="text-[14px] leading-[20px] text-on-surface">{entry.summary}</p>
                    <div className="flex items-center gap-1.5 pt-1.5 border-t border-outline-variant text-[11px] font-semibold text-on-surface-variant">
                      {entry.linked_schedule_id ? (
                        <Link2 className="w-3.5 h-3.5 text-on-warning-container shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-on-success-container shrink-0" />
                      )}
                      <span>{entry.tag}</span>
                    </div>
                  </article>
                ))
              )}

              <button
                type="button"
                onClick={() =>
                  openOverlay({
                    kind: 'schedule',
                    jobId: job.id,
                    dateIso: TODAY_ISO,
                  })
                }
                className="min-h-[46px] w-full rounded-xl bg-secondary text-white font-semibold text-[13px] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Registrar parte de jornada hoy</span>
              </button>
            </section>
          </div>
        )}

        {/* TAB 2: FOTOS */}
        {activeTab === 'fotos' && (
          <section className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5">
              {photos.map((photo) => (
                <figure
                  key={photo.id}
                  className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden flex flex-col"
                >
                  <img
                    src={photo.image_url}
                    alt={photo.caption}
                    referrerPolicy="no-referrer"
                    className="w-full h-32 object-cover"
                  />
                  <figcaption className="p-2.5 flex flex-col gap-0.5">
                    <span className="text-[12px] font-semibold text-on-surface">
                      {photo.caption}
                    </span>
                    <span className="font-mono text-[10px] text-on-surface-variant tabular-nums">
                      {formatShortDate(photo.captured_at_iso.slice(0, 10))} ·{' '}
                      {photo.captured_at_iso.slice(11, 16)}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                openOverlay({
                  kind: 'photo',
                  initialJobId: job.id,
                  initialImageUrl: IMG_PLUMBING_PIPE,
                })
              }
              className="min-h-[48px] w-full rounded-xl bg-primary text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>Sellar nueva foto en esta obra</span>
            </button>
          </section>
        )}

        {/* TAB 3: GASTOS */}
        {activeTab === 'gastos' && (
          <section className="flex flex-col gap-3">
            {tickets.length === 0 ? (
              <p className="text-[13px] text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-2xl p-4">
                No hay tickets imputados todavía a esta obra.
              </p>
            ) : (
              tickets.map((tkt) => (
                <div
                  key={tkt.id}
                  className="bg-surface-warm-card border border-outline-variant rounded-2xl p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-semibold text-on-surface">
                      {tkt.supplier_name}
                    </span>
                    <span className="text-[12px] text-on-surface-variant">
                      {tkt.category} · {formatShortDate(tkt.issue_date_iso)}
                    </span>
                  </div>
                  <span className="font-mono text-[15px] font-semibold text-on-surface tabular-nums">
                    {formatEuros(tkt.total_cents)}
                  </span>
                </div>
              ))
            )}
            <button
              type="button"
              onClick={() =>
                openOverlay({
                  kind: 'ticket',
                  initialJobId: job.id,
                  initialImageUrl: IMG_TICKET_RECEIPT,
                })
              }
              className="min-h-[48px] w-full rounded-xl bg-primary text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ReceiptText className="w-4 h-4" />
              <span>Escanear ticket para esta obra</span>
            </button>
          </section>
        )}

        {/* TAB 4: PRESUPUESTOS Y FACTURAS */}
        {activeTab === 'docs' && (
          <section className="flex flex-col gap-3">
            {quotes.map((q) => (
              <div
                key={q.id}
                className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-3.5 flex items-center justify-between gap-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-mono text-[11px] text-on-surface-variant">
                    {q.quote_code} · {q.status}
                  </span>
                  <span className="text-[14px] font-semibold text-on-surface truncate">
                    {q.title}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openPrintableDoc({ kind: 'quote', id: q.id })}
                  className="px-3 py-1.5 rounded-lg bg-terracotta-soft text-on-primary-container font-mono text-[12px] font-semibold shrink-0 cursor-pointer"
                >
                  {formatEuros(q.total_cents)}
                </button>
              </div>
            ))}

            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-3.5 flex items-center justify-between gap-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="font-mono text-[11px] text-on-surface-variant">
                    {inv.invoice_number} · {inv.status === 'pagado' ? 'Cobrada' : 'Pendiente'}
                  </span>
                  <span className="text-[14px] font-semibold text-on-surface truncate">
                    {inv.concept}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openPrintableDoc({ kind: 'invoice', id: inv.id })}
                  className="px-3 py-1.5 rounded-lg bg-success-container text-on-success-container font-mono text-[12px] font-semibold shrink-0 cursor-pointer"
                >
                  {formatEuros(inv.total_cents)}
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                openOverlay({
                  kind: 'quote',
                  initialClientId: job.client_id,
                  initialJobId: job.id,
                  initialTitle: job.title,
                })
              }
              className="min-h-[48px] w-full rounded-xl bg-secondary text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>Nuevo presupuesto para esta obra</span>
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
