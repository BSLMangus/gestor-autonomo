import React from 'react';
import {
  CalendarDays,
  ChevronRight,
  FileText,
  HardHat,
  Home,
  PiggyBank,
  Plus,
  Settings,
  Sparkles,
  Tag,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useAppStore } from '../../services/mockStore';
import type { AppRoute } from '../../types/domain';

export function AppNavigationDrawer() {
  const {
    state,
    route,
    navigate,
    drawerOpen,
    setDrawerOpen,
    setActiveConversationId,
    startNewConversation,
  } = useAppStore();

  if (!drawerOpen) return null;

  const activeJobsCount = state.jobs.filter((j) => j.status === 'en_curso').length;
  const docsCount = state.quotes.length + state.invoices.length;

  const navItems: Array<{
    route: AppRoute;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
    badgeAccent?: boolean;
  }> = [
    { route: '#/', label: 'Inicio', icon: Home },
    { route: '#/obras', label: 'Obras', icon: HardHat, badge: String(activeJobsCount) },
    { route: '#/calendario', label: 'Agenda y Calendario', icon: CalendarDays, badge: 'Hoy', badgeAccent: true },
    { route: '#/presupuestos', label: 'Presupuestos y Facturas', icon: FileText, badge: String(docsCount) },
    { route: '#/clientes', label: 'Clientes', icon: Users },
    { route: '#/hucha', label: 'Hucha Fiscal', icon: PiggyBank },
    { route: '#/tarifario', label: 'Tarifario y Precios', icon: Tag },
    { route: '#/actividad', label: 'Actividad del asistente', icon: Sparkles },
  ];

  const handleOpenConversation = (convId: string) => {
    setActiveConversationId(convId);
    navigate('#/asistente');
  };

  const handleNewConversation = () => {
    startNewConversation();
    navigate('#/asistente');
  };

  return (
    <div className="absolute inset-0 z-50 flex">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Cerrar menú lateral"
        onClick={() => setDrawerOpen(false)}
        className="absolute inset-0 bg-secondary/45 backdrop-blur-[1px] transition-opacity"
      />

      {/* Drawer Panel */}
      <aside
        aria-label="Menú de módulos y conversaciones"
        className="relative z-10 w-[312px] max-w-[85%] h-full bg-surface-container-lowest border-r border-outline-variant flex flex-col justify-between shadow-2xl overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* Header */}
          <div className="p-4 border-b border-outline-variant flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-terracotta text-white flex items-center justify-center shrink-0">
                <Wrench className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <span className="text-[16px] leading-[22px] font-semibold text-on-surface">
                  ObraLocal AI
                </span>
                <span className="text-[11px] leading-[14px] font-semibold text-on-success-container">
                  100% Local · Sin nube
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Cerrar menú"
              className="w-10 h-10 rounded-full text-on-surface-variant inline-flex items-center justify-center hover:bg-surface-container"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Modules */}
          <nav
            aria-label="Módulos de la aplicación"
            className="p-3 flex flex-col gap-1 border-b border-outline-variant"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                route === item.route ||
                (item.route === '#/clientes' && route.startsWith('#/clientes/'));
              return (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => navigate(item.route)}
                  className={`min-h-[48px] px-3 rounded-2xl flex items-center justify-between text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-terracotta-soft text-on-primary-container font-semibold'
                      : 'text-on-surface hover:bg-surface-container font-normal'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-5 h-5 shrink-0 ${
                        isActive ? 'text-on-primary-container' : 'text-on-surface-variant'
                      }`}
                    />
                    <span className="text-[14px] leading-[20px] truncate">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={
                        item.badgeAccent
                          ? 'text-[11px] font-semibold text-on-primary-container bg-terracotta-soft px-2 py-0.5 rounded-full shrink-0'
                          : 'font-mono text-[12px] text-on-surface-variant tabular-nums shrink-0'
                      }
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Recent Conversations */}
          <section className="p-3 flex flex-col gap-2">
            <div className="px-1">
              <span className="text-[12px] font-semibold text-on-surface-variant">
                Conversaciones recientes
              </span>
            </div>

            <button
              type="button"
              onClick={handleNewConversation}
              className="min-h-[48px] w-full px-3 rounded-2xl bg-secondary text-on-secondary font-semibold text-[14px] flex items-center justify-center gap-1.5 hover:bg-secondary/90 transition-colors cursor-pointer"
            >
              <Plus className="w-[18px] h-[18px]" aria-hidden="true" />
              <span>Nueva conversación</span>
            </button>

            {state.conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => handleOpenConversation(conv.id)}
                className={`p-3 rounded-2xl text-left flex flex-col gap-1 transition-colors cursor-pointer ${
                  conv.pending_confirmation
                    ? 'bg-warning-container border border-outline-variant'
                    : 'hover:bg-surface-container'
                }`}
              >
                <span className="text-[14px] leading-[20px] font-semibold text-on-surface truncate">
                  {conv.title}
                </span>
                <div className="flex items-center gap-1.5">
                  {conv.pending_confirmation && (
                    <span className="w-2 h-2 rounded-full bg-amber-tax shrink-0" />
                  )}
                  <span
                    className={`text-[11px] font-semibold ${
                      conv.pending_confirmation
                        ? 'text-on-warning-container'
                        : 'text-on-surface-variant'
                    }`}
                  >
                    {conv.subtitle} · {conv.updated_label}
                  </span>
                </div>
              </button>
            ))}
          </section>
        </div>

        {/* Bottom Anchored Settings */}
        <div className="p-3 border-t border-outline-variant bg-surface-container-lowest">
          <button
            type="button"
            onClick={() => navigate('#/ajustes')}
            className={`min-h-[48px] w-full px-3 rounded-2xl flex items-center justify-between transition-colors cursor-pointer ${
              route === '#/ajustes'
                ? 'bg-terracotta-soft text-on-primary-container'
                : 'text-on-surface hover:bg-surface-container'
            }`}
          >
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-on-surface-variant" aria-hidden="true" />
              <span className="text-[14px] font-semibold">Ajustes y datos fiscales</span>
            </div>
            <ChevronRight className="w-[18px] h-[18px] text-outline" aria-hidden="true" />
          </button>
        </div>
      </aside>
    </div>
  );
}
