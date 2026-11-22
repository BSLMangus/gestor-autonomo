import React from 'react';
import { Landmark, ReceiptText, Wallet, X } from 'lucide-react';
import type { FiscalQuarterSummary } from '../../services/mockStore';
import type { ExpenseTicket } from '../../types/domain';
import { formatEuros, formatShortDate } from '../../utils/format';

export type FiscalModalKind =
  | { type: 'tax' }
  | { type: 'free' }
  | { type: 'ticket'; ticket: ExpenseTicket }
  | null;

interface FiscalDetailModalsProps {
  modal: FiscalModalKind;
  summary: FiscalQuarterSummary;
  irpfRate: number;
  onClose: () => void;
}

export function FiscalDetailModals({
  modal,
  summary,
  irpfRate,
  onClose,
}: FiscalDetailModalsProps) {
  if (!modal) return null;

  return (
    <div className="fixed inset-0 z-50 bg-secondary/45 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-[385px] bg-surface-container-lowest border border-outline-variant rounded-[24px] p-5 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {modal.type === 'tax' && (
              <Landmark className="w-5 h-5 text-on-warning-container" />
            )}
            {modal.type === 'free' && (
              <Wallet className="w-5 h-5 text-on-success-container" />
            )}
            {modal.type === 'ticket' && (
              <ReceiptText className="w-5 h-5 text-on-primary-container" />
            )}
            <h3 className="text-[16px] font-semibold text-on-surface">
              {modal.type === 'tax'
                ? `Hacienda Intocable · ${summary.quarter}`
                : modal.type === 'free'
                  ? `Tu dinero Libre Real · ${summary.quarter}`
                  : modal.ticket.supplier_name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="w-9 h-9 rounded-full hover:bg-surface-container flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {modal.type === 'tax' && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-on-surface-variant">
              Este dinero no es beneficio: conviene dejarlo apartado hasta presentar el trimestre.
            </p>
            <div className="bg-warning-container rounded-2xl p-3.5 flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-on-warning-container">IVA cobrado en facturas</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatEuros(summary.vatCollectedCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-warning-container">(-) IVA deducible en tickets</span>
                <span className="font-mono font-semibold text-on-success-container tabular-nums">
                  -{formatEuros(summary.vatDeductibleCents)}
                </span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-outline-variant font-semibold">
                <span className="text-on-warning-container">Resultado IVA (Modelo 303)</span>
                <span className="font-mono tabular-nums">
                  {formatEuros(summary.vatToPayCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-warning-container">
                  Estimación IRPF ({irpfRate}% · Modelo 130)
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatEuros(summary.irpfToPayCents)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-outline-variant text-[15px] font-bold">
                <span className="text-on-warning-container">Total a reservar</span>
                <span className="font-mono tabular-nums">
                  {formatEuros(summary.taxReserveCents)}
                </span>
              </div>
            </div>
          </div>
        )}

        {modal.type === 'free' && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-on-surface-variant">
              Es lo que te queda limpio en el bolsillo tras descontar gastos pagados y la reserva de
              impuestos.
            </p>
            <div className="bg-success-container rounded-2xl p-3.5 flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-on-success-container">Cobrado en el trimestre</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatEuros(summary.collectedCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-success-container">(-) Gastos y tickets</span>
                <span className="font-mono font-semibold tabular-nums">
                  -{formatEuros(summary.expensesTotalCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-success-container">(-) Reserva Hacienda</span>
                <span className="font-mono font-semibold tabular-nums">
                  -{formatEuros(summary.taxReserveCents)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-outline-variant text-[15px] font-bold">
                <span className="text-on-success-container">Libre Real disponible</span>
                <span className="font-mono tabular-nums">
                  {formatEuros(summary.freeRealCents)}
                </span>
              </div>
            </div>
          </div>
        )}

        {modal.type === 'ticket' && (
          <div className="flex flex-col gap-3">
            {modal.ticket.image_url && (
              <img
                src={modal.ticket.image_url}
                alt={`Ticket de ${modal.ticket.supplier_name}`}
                referrerPolicy="no-referrer"
                className="w-full h-36 object-cover rounded-xl border border-outline-variant"
              />
            )}
            <div className="bg-surface-warm-card rounded-2xl p-3.5 flex flex-col gap-1.5 text-[13px]">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Fecha</span>
                <span className="font-mono tabular-nums">
                  {formatShortDate(modal.ticket.issue_date_iso)} 2026
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Categoría</span>
                <span className="font-semibold">{modal.ticket.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Base imponible</span>
                <span className="font-mono tabular-nums">
                  {formatEuros(modal.ticket.base_cents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">
                  IVA deducible ({modal.ticket.vat_rate}%)
                </span>
                <span className="font-mono font-semibold text-on-success-container tabular-nums">
                  {formatEuros(modal.ticket.vat_cents)}
                </span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-outline-variant font-bold text-[15px]">
                <span>Total</span>
                <span className="font-mono tabular-nums">
                  {formatEuros(modal.ticket.total_cents)}
                </span>
              </div>
            </div>
            {modal.ticket.notes && (
              <p className="text-[12px] text-on-surface-variant">{modal.ticket.notes}</p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="min-h-[46px] rounded-xl bg-secondary text-white font-semibold text-[14px] cursor-pointer"
        >
          Entendido
        </button>
      </div>
    </div>
  );
}
