import React, { useMemo, useState } from 'react';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import { getInitials } from '../../utils/format';

export function ClientsView() {
  const { state, navigate, createClient } = useAppStore();

  const [query, setQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);

  const [name, setName] = useState('');
  const [nif, setNif] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fiscalAddress, setFiscalAddress] = useState('');
  const [notes, setNotes] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.clients;
    return state.clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.nif.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q),
    );
  }, [state.clients, query]);

  const avatarTones = [
    'bg-terracotta-soft text-on-primary-container',
    'bg-secondary-container text-on-secondary-container',
    'bg-success-container text-on-success-container',
    'bg-warning-container text-on-warning-container',
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const created = createClient({
      name: name.trim(),
      nif: nif.trim() || 'Pendiente',
      phone: phone.trim() || 'Sin teléfono',
      email: email.trim(),
      fiscal_address: fiscalAddress.trim() || 'Madrid',
      notes: notes.trim(),
    });
    setShowNewModal(false);
    setName('');
    setNif('');
    setPhone('');
    setEmail('');
    setFiscalAddress('');
    setNotes('');
    navigate(`#/clientes/${created.id}`);
  };

  return (
    <main className="px-4 pt-4 pb-8 flex flex-col gap-4">
      {/* Buscador superior + botón Nuevo */}
      <div className="flex items-center gap-2">
        <label className="flex-1 relative flex items-center">
          <Search className="w-5 h-5 text-outline absolute left-3" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nombre, NIF o teléfono..."
            className="min-h-[48px] w-full rounded-2xl bg-surface-container-lowest border border-outline-variant pl-10 pr-3 text-[14px] text-on-surface placeholder:text-outline focus:outline-none focus:border-terracotta focus:ring-1 focus:ring-terracotta"
          />
        </label>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          aria-label="Nuevo cliente"
          className="min-h-[48px] px-3.5 rounded-2xl bg-secondary text-on-secondary font-semibold text-[14px] inline-flex items-center gap-1 shrink-0 cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          <span>Nuevo</span>
        </button>
      </div>

      {/* Lista de clientes */}
      <section className="flex flex-col gap-3">
        <span className="text-[12px] font-semibold text-on-surface-variant">
          {filtered.length} {filtered.length === 1 ? 'cliente guardado' : 'clientes guardados'} en local
        </span>

        {filtered.map((client, idx) => {
          const jobsCount = state.jobs.filter((j) => j.client_id === client.id).length;
          const quotesCount = state.quotes.filter((q) => q.client_id === client.id).length;
          const overdueCount = state.invoices.filter(
            (i) => i.client_id === client.id && i.status === 'vencido',
          ).length;

          return (
            <button
              key={client.id}
              type="button"
              onClick={() => navigate(`#/clientes/${client.id}`)}
              className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-[20px] p-4 shadow-[0_2px_10px_rgba(15,23,42,0.04)] flex flex-col gap-3 hover:border-terracotta transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-12 h-12 rounded-full font-semibold text-[15px] flex items-center justify-center shrink-0 ${
                      avatarTones[idx % avatarTones.length]
                    }`}
                  >
                    {getInitials(client.name)}
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <h2 className="text-[16px] font-semibold text-on-surface truncate">
                      {client.name}
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap font-mono text-[12px] text-on-surface-variant tabular-nums">
                      <span>{client.phone}</span>
                      <span className="text-outline">·</span>
                      <span>{client.nif}</span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-outline shrink-0" />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface font-semibold text-[11px]">
                  {jobsCount} {jobsCount === 1 ? 'obra' : 'obras'}
                </span>
                {overdueCount > 0 ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-error-container text-on-error-container font-semibold text-[11px]">
                    {overdueCount} factura vencida
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-warning-container text-on-warning-container font-semibold text-[11px]">
                    {quotesCount} {quotesCount === 1 ? 'presupuesto' : 'presupuestos'}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </section>

      {/* Modal Nuevo Cliente */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-secondary/45 flex items-end sm:items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-[385px] bg-surface-container-lowest rounded-[24px] p-5 border border-outline-variant shadow-2xl flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-on-surface">Nuevo cliente</h3>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              required
              placeholder="Nombre completo o empresa"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[14px]"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="NIF / CIF"
                value={nif}
                onChange={(e) => setNif(e.target.value)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
              />
              <input
                type="tel"
                placeholder="Teléfono"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 font-mono text-[13px]"
              />
            </div>
            <input
              type="text"
              placeholder="Dirección fiscal"
              value={fiscalAddress}
              onChange={(e) => setFiscalAddress(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[14px]"
            />
            <input
              type="email"
              placeholder="Correo electrónico (opcional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-[44px] rounded-xl bg-surface-container-low border border-outline-variant px-3 text-[14px]"
            />
            <textarea
              rows={2}
              placeholder="Notas (portería, horario, IVA habitual...)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-xl bg-surface-container-low border border-outline-variant p-3 text-[13px]"
            />
            <button
              type="submit"
              className="min-h-[48px] rounded-xl bg-primary text-white font-semibold text-[14px] cursor-pointer"
            >
              Guardar cliente
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
