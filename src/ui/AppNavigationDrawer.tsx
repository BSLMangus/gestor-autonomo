import {
  Activity,
  Briefcase,
  Calculator,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Home,
  LogOut,
  MessageSquare,
  Plus,
  Settings,
  Sliders,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { ChatThreadRecord, LocalAccountRecord } from "../core/contracts/types";
import { isSameRoute, type AppRoute } from "../core/navigation/routes";

interface AppNavigationDrawerProps {
  open: boolean;
  currentRoute: AppRoute;
  threads: ChatThreadRecord[];
  activeThreadId: string | null;
  activeAccount?: LocalAccountRecord | null;
  onClose: () => void;
  onNavigate: (route: AppRoute) => void;
  onSelectThread: (threadId: string) => Promise<void>;
  onCreateThread: () => Promise<void>;
  onLogout?: () => Promise<void>;
}

function formatDisplayThreadTitle(title: string): string {
  return title.replace(/\s*\((?:Pausa HITL|Validar Gate \d+)\)/gi, "").trim();
}

const DRAWER_MODULES: Array<{
  id: string;
  label: string;
  route: AppRoute;
  icon: typeof Home;
  badge?: string;
}> = [
  { id: "home", label: "Inicio", route: { name: "home" }, icon: Home },
  { id: "chat", label: "Asistente / Chat IA", route: { name: "chat" }, icon: MessageSquare },
  { id: "jobs", label: "Obras", route: { name: "jobs" }, icon: Briefcase },
  { id: "calendar", label: "Agenda y Calendario", route: { name: "calendar" }, icon: CalendarDays, badge: "Hoy" },
  { id: "quotes", label: "Presupuestos", route: { name: "quotes" }, icon: FileText },
  { id: "actas", label: "Actas técnicas", route: { name: "actas" }, icon: ClipboardCheck },
  { id: "clients", label: "Clientes", route: { name: "clients" }, icon: Users },
  { id: "fiscal", label: "Hucha Fiscal", route: { name: "fiscal" }, icon: Calculator },
  { id: "pricing", label: "Personalización y Tarifario", route: { name: "pricing" }, icon: Sliders },
  { id: "activity", label: "Actividad del asistente", route: { name: "activity" }, icon: Activity },
];

export function AppNavigationDrawer({
  open,
  currentRoute,
  threads,
  activeThreadId,
  activeAccount,
  onClose,
  onNavigate,
  onSelectThread,
  onCreateThread,
  onLogout,
}: AppNavigationDrawerProps) {
  if (!open) return null;

  return (
    <div
      data-testid="app-navigation-drawer"
      className="fixed inset-0 z-50 flex bg-[#4B7094]/40 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Menú principal y conversaciones"
    >
      <aside className="relative flex h-full w-[312px] max-w-[85vw] flex-col ruled-notebook border-r border-[#E5DFD2] bg-[#FFFDF7] shadow-2xl overflow-hidden pl-3">
        {/* Agujeros decorativos de archivador */}
        <span className="pointer-events-none absolute left-2 top-16 h-2.5 w-2.5 rounded-full paper-hole border" aria-hidden="true" />
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full paper-hole border" aria-hidden="true" />
        <span className="pointer-events-none absolute left-2 bottom-16 h-2.5 w-2.5 rounded-full paper-hole border" aria-hidden="true" />

        {/* Cabecera del menú */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#E5DFD2] px-4 pl-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-terracotta text-white shrink-0 shadow-xs">
              <Wrench className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="text-[16px] leading-[22px] font-semibold text-[#2C2621]">
                Gestor Autónomo
              </div>
              <div className="text-[11px] leading-[14px] font-semibold text-[#1B3A24]">
                100% Local · Sin nube
              </div>
            </div>
          </div>
          <button
            type="button"
            data-testid="drawer-close-btn"
            onClick={onClose}
            aria-label="Cerrar menú"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#6B6860] hover:bg-[#EFECE4] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Contenido scrollable: Módulos + Conversaciones */}
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          <nav
            aria-label="Módulos de la aplicación"
            className="p-3 pl-5 space-y-1 border-b border-[#E5DFD2]"
          >
            {DRAWER_MODULES.map((item) => {
              const Icon = item.icon;
              const isActive =
                isSameRoute(currentRoute, item.route) ||
                (item.id === "clients" && currentRoute.name === "client_detail") ||
                (item.id === "quotes" && currentRoute.name === "quote_detail") ||
                (item.id === "actas" && currentRoute.name === "acta_detail") ||
                (item.id === "fiscal" &&
                  (currentRoute.name === "invoice_detail" ||
                    currentRoute.name === "ticket_detail"));
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`drawer-nav-${item.id}`}
                  onClick={() => {
                    onNavigate(item.route);
                    onClose();
                  }}
                  className={`flex min-h-[48px] w-full items-center justify-between gap-2.5 rounded-2xl px-3 text-left text-[14px] transition-colors cursor-pointer ${
                    isActive
                      ? "postit-peach border border-[#EA580C]/30 text-[#4A2500] font-semibold shadow-xs"
                      : "text-[#2C2621] hover:bg-[#EFECE4] font-normal"
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`h-5 w-5 shrink-0 ${
                        isActive ? "text-[#4A2500]" : "text-[#6B6860]"
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge && (
                    <span className="shrink-0 rounded-full status-cobalt px-2 py-0.5 text-[11px] font-semibold">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Conversaciones (Hilos e Inboxes) */}
          <div className="p-3 pl-5 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[12px] font-semibold text-[#6B6860]">
                Conversaciones ({threads.length})
              </span>
            </div>

            <button
              type="button"
              data-testid="drawer-new-thread-btn"
              onClick={() => void onCreateThread()}
              className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-2xl bg-[#4B7094] px-3 text-[14px] font-semibold text-[#FFFDF9] hover:bg-[#3F6080] shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
              <span>Nueva conversación</span>
            </button>

            <div className="space-y-1.5">
              {threads.map((thr) => {
                const isActive = thr.thread_id === activeThreadId && currentRoute.name === "chat";
                const statusLabel =
                  thr.status === "interrupted"
                    ? "Por confirmar"
                    : thr.status === "running"
                      ? "Procesando..."
                      : thr.status === "error"
                        ? "Con incidencia"
                        : "Hilo";
                return (
                  <button
                    key={thr.thread_id}
                    type="button"
                    data-testid={`thread-item-${thr.thread_id}`}
                    onClick={() => void onSelectThread(thr.thread_id)}
                    className={`w-full rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
                      thr.status === "interrupted"
                        ? "postit-note postit-yellow tilt-subtle-left border-[#E6B84C]/50"
                        : isActive
                          ? "border-[#EA580C]/50 bg-[#FFD6B0]/85"
                          : "border-transparent bg-[#FFFDF7]/90 hover:bg-[#F5F1E6]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[14px] font-semibold text-[#2C2621]">
                        {formatDisplayThreadTitle(thr.title)}
                      </span>
                      {thr.status === "interrupted" && (
                        <span className="shrink-0 rounded-full status-tangerine px-2 py-0.5 text-[10px] font-semibold">
                          Pendiente
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] font-semibold text-[#6B6860]">
                      <span className={thr.status === "interrupted" ? "text-[#3E3300]" : ""}>
                        {statusLabel}
                      </span>
                      <span>{thr.active_job_id ? "Con obra vinculada" : "General"}</span>
                    </div>
                  </button>
                );
              })}
              {threads.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#E5DFD2] bg-[#FFFDF7]/80 p-3 text-center text-[12px] text-[#6B6860]">
                  Sin conversaciones recientes.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Ajustes y cuenta anclados al final del menú lateral */}
        <div className="mt-auto shrink-0 border-t border-[#E2DDD0] nav-cream p-3 pl-5 space-y-1.5">
          {activeAccount && (
            <div className="flex items-center justify-between gap-2 px-3 py-1">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-[#2C2621]">
                  {activeAccount.display_name}
                </div>
                <div className="truncate text-[10px] text-[#6B6860]">
                  {activeAccount.email}
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            data-testid="drawer-nav-settings"
            onClick={() => {
              onNavigate({ name: "settings", section: "general" });
              onClose();
            }}
            className={`flex min-h-[48px] w-full items-center justify-between rounded-2xl px-3 text-[14px] font-semibold transition-colors cursor-pointer ${
              currentRoute.name === "settings"
                ? "bg-[#FFD6B0] text-[#4A2500]"
                : "text-[#2C2621] hover:bg-[#EFECE4]"
            }`}
          >
            <span className="flex items-center gap-3">
              <Settings className="h-5 w-5 text-[#6B6860]" aria-hidden="true" />
              <span>Ajustes y datos fiscales</span>
            </span>
            <ChevronRight className="h-[18px] w-[18px] text-[#6B6860]" aria-hidden="true" />
          </button>
          {onLogout && (
            <button
              type="button"
              data-testid="drawer-logout-btn"
              onClick={() => {
                onClose();
                void onLogout();
              }}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-3 text-[13px] font-semibold text-[#DC2626] hover:bg-[#FAD2D8]/70 transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Cerrar sesión</span>
            </button>
          )}
        </div>
      </aside>

      <div className="flex-1" onClick={onClose} aria-hidden="true" />
    </div>
  );
}
