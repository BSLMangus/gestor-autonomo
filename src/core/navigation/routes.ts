import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type CalendarRouteTab = "month" | "week" | "jobs" | "hacienda";

export type AppRoute =
  | { name: "home" }
  | { name: "chat" }
  | { name: "jobs"; focusJobId?: string }
  | { name: "calendar"; focusDateIso?: string; tab?: CalendarRouteTab }
  | { name: "quotes" }
  | { name: "quote_detail"; quoteId: string }
  | { name: "invoice_detail"; invoiceId: string }
  | { name: "ticket_detail"; ticketId: string }
  | { name: "clients" }
  | { name: "client_detail"; clientId: string }
  | { name: "fiscal" }
  | { name: "activity" }
  | { name: "pricing" }
  | { name: "settings"; section?: "general" | "personalizacion" };

export function parseHashToRoute(rawHash: string): AppRoute {
  const cleaned = rawHash.replace(/^#/, "").trim();
  const path = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  const normalized = path === "" ? "/" : path;

  if (normalized === "/" || normalized === "/inicio") {
    return { name: "home" };
  }
  if (normalized === "/asistente" || normalized === "/chat") {
    return { name: "chat" };
  }
  if (normalized.startsWith("/obras")) {
    const [, query] = normalized.split("?");
    const params = query ? new URLSearchParams(query) : null;
    const focusJobId = params?.get("job") ?? undefined;
    return focusJobId ? { name: "jobs", focusJobId } : { name: "jobs" };
  }
  if (normalized.startsWith("/calendario")) {
    const [, query] = normalized.split("?");
    const params = query ? new URLSearchParams(query) : null;
    const focusDateIso = params?.get("date") ?? undefined;
    const rawTab = params?.get("tab");
    const tab: CalendarRouteTab | undefined =
      rawTab === "month" || rawTab === "week" || rawTab === "jobs" || rawTab === "hacienda"
        ? rawTab
        : undefined;
    if (focusDateIso || tab) {
      return {
        name: "calendar",
        ...(focusDateIso ? { focusDateIso } : {}),
        ...(tab ? { tab } : {}),
      };
    }
    return { name: "calendar" };
  }
  if (normalized === "/presupuestos") {
    return { name: "quotes" };
  }
  if (normalized.startsWith("/presupuestos/")) {
    const quoteId = decodeURIComponent(
      normalized.slice("/presupuestos/".length).split("?")[0] ?? ""
    ).trim();
    if (quoteId) {
      return { name: "quote_detail", quoteId };
    }
    return { name: "quotes" };
  }
  if (normalized.startsWith("/facturas/")) {
    const invoiceId = decodeURIComponent(
      normalized.slice("/facturas/".length).split("?")[0] ?? ""
    ).trim();
    if (invoiceId) {
      return { name: "invoice_detail", invoiceId };
    }
    return { name: "fiscal" };
  }
  if (normalized.startsWith("/tickets/")) {
    const ticketId = decodeURIComponent(
      normalized.slice("/tickets/".length).split("?")[0] ?? ""
    ).trim();
    if (ticketId) {
      return { name: "ticket_detail", ticketId };
    }
    return { name: "fiscal" };
  }
  if (normalized === "/clientes") {
    return { name: "clients" };
  }
  if (normalized.startsWith("/clientes/")) {
    const clientId = decodeURIComponent(normalized.slice("/clientes/".length).split("?")[0] ?? "").trim();
    if (clientId) {
      return { name: "client_detail", clientId };
    }
    return { name: "clients" };
  }
  if (normalized === "/hucha") {
    return { name: "fiscal" };
  }
  if (normalized === "/actividad") {
    return { name: "activity" };
  }
  if (normalized === "/tarifario" || normalized === "/personalizacion") {
    return { name: "pricing" };
  }
  if (normalized === "/ajustes/personalizacion") {
    return { name: "settings", section: "personalizacion" };
  }
  if (normalized.startsWith("/ajustes")) {
    return { name: "settings", section: "general" };
  }
  return { name: "home" };
}

export function routeToHash(route: AppRoute): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "chat":
      return "#/asistente";
    case "jobs":
      return route.focusJobId
        ? `#/obras?job=${encodeURIComponent(route.focusJobId)}`
        : "#/obras";
    case "calendar": {
      const search = new URLSearchParams();
      if (route.focusDateIso) search.set("date", route.focusDateIso);
      if (route.tab) search.set("tab", route.tab);
      const qs = search.toString();
      return qs ? `#/calendario?${qs}` : "#/calendario";
    }
    case "quotes":
      return "#/presupuestos";
    case "quote_detail":
      return `#/presupuestos/${encodeURIComponent(route.quoteId)}`;
    case "invoice_detail":
      return `#/facturas/${encodeURIComponent(route.invoiceId)}`;
    case "ticket_detail":
      return `#/tickets/${encodeURIComponent(route.ticketId)}`;
    case "clients":
      return "#/clientes";
    case "client_detail":
      return `#/clientes/${encodeURIComponent(route.clientId)}`;
    case "fiscal":
      return "#/hucha";
    case "activity":
      return "#/actividad";
    case "pricing":
      return "#/tarifario";
    case "settings":
      return route.section === "personalizacion"
        ? "#/ajustes/personalizacion"
        : "#/ajustes";
  }
}

export function isSameRoute(a: AppRoute, b: AppRoute): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "quote_detail" && b.name === "quote_detail") {
    return a.quoteId === b.quoteId;
  }
  if (a.name === "invoice_detail" && b.name === "invoice_detail") {
    return a.invoiceId === b.invoiceId;
  }
  if (a.name === "ticket_detail" && b.name === "ticket_detail") {
    return a.ticketId === b.ticketId;
  }
  if (a.name === "client_detail" && b.name === "client_detail") {
    return a.clientId === b.clientId;
  }
  if (a.name === "jobs" && b.name === "jobs") {
    return a.focusJobId === b.focusJobId;
  }
  if (a.name === "calendar" && b.name === "calendar") {
    return a.focusDateIso === b.focusDateIso && a.tab === b.tab;
  }
  if (a.name === "settings" && b.name === "settings") {
    return (a.section ?? "general") === (b.section ?? "general");
  }
  return true;
}

export function getRouteTitle(route: AppRoute): string {
  switch (route.name) {
    case "home":
      return "Gestor Autónomo";
    case "chat":
      return "Asistente IA";
    case "jobs":
      return "Obras";
    case "calendar":
      return "Agenda y Calendario";
    case "quotes":
      return "Presupuestos";
    case "quote_detail":
      return "Detalle de Presupuesto";
    case "invoice_detail":
      return "Detalle de Factura";
    case "ticket_detail":
      return "Detalle de Ticket";
    case "clients":
      return "Clientes";
    case "client_detail":
      return "Ficha de Cliente";
    case "fiscal":
      return "Hucha Fiscal";
    case "activity":
      return "Actividad";
    case "pricing":
      return "Personalización y Tarifario";
    case "settings":
      return route.section === "personalizacion" ? "Ajustes · Personalización" : "Ajustes";
  }
}

export const BACK_PRIORITY = {
  ZOOM_TEXT_EDITOR: 120,
  CONTEXTUAL_VOICE: 110,
  VOICE_OVERLAY: 100,
  CAMERA_SHEET: 90,
  WIDGET_OVERLAY: 80,
  MODAL_SECONDARY: 70,
  NAV_DRAWER: 60,
} as const;

interface RegisteredBackHandler {
  id: string;
  priority: number;
  handler: () => boolean;
}

export function useAppRouter(initialRoute: AppRoute = { name: "home" }) {
  const [route, setRoute] = useState<AppRoute>(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      return parseHashToRoute(window.location.hash);
    }
    return initialRoute;
  });

  const historyStackRef = useRef<AppRoute[]>([route]);
  const currentRouteRef = useRef<AppRoute>(route);
  const backHandlersRef = useRef<RegisteredBackHandler[]>([]);
  const syncingFromHashRef = useRef(false);

  useEffect(() => {
    currentRouteRef.current = route;
  }, [route]);

  const navigate = useCallback((next: AppRoute, options?: { replace?: boolean }) => {
    setRoute((prev) => {
      if (isSameRoute(prev, next) && !options?.replace) {
        return prev;
      }
      if (options?.replace) {
        const stack = [...historyStackRef.current];
        if (stack.length > 0) {
          stack[stack.length - 1] = next;
        } else {
          stack.push(next);
        }
        historyStackRef.current = stack;
      } else {
        const stack = [...historyStackRef.current, next].slice(-30);
        historyStackRef.current = stack;
      }
      if (typeof window !== "undefined") {
        const nextHash = routeToHash(next);
        if (window.location.hash !== nextHash) {
          syncingFromHashRef.current = true;
          window.location.hash = nextHash;
          setTimeout(() => {
            syncingFromHashRef.current = false;
          }, 0);
        }
      }
      return next;
    });
  }, []);

  const goBack = useCallback((): boolean => {
    const sorted = [...backHandlersRef.current].sort((a, b) => b.priority - a.priority);
    for (const entry of sorted) {
      if (entry.handler()) {
        return true;
      }
    }

    if (historyStackRef.current.length > 1) {
      const stack = [...historyStackRef.current];
      stack.pop();
      const target = stack[stack.length - 1] ?? { name: "home" };
      historyStackRef.current = stack;
      setRoute(target);
      if (typeof window !== "undefined") {
        const nextHash = routeToHash(target);
        if (window.location.hash !== nextHash) {
          syncingFromHashRef.current = true;
          window.location.hash = nextHash;
          setTimeout(() => {
            syncingFromHashRef.current = false;
          }, 0);
        }
      }
      return true;
    }

    if (currentRouteRef.current.name !== "home") {
      navigate({ name: "home" }, { replace: true });
      return true;
    }

    return false;
  }, [navigate]);

  const registerBackHandler = useCallback((priority: number, handler: () => boolean) => {
    const id = `bh_${crypto.randomUUID().slice(0, 8)}`;
    backHandlersRef.current = [...backHandlersRef.current, { id, priority, handler }];
    return () => {
      backHandlersRef.current = backHandlersRef.current.filter((h) => h.id !== id);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.hash) {
      syncingFromHashRef.current = true;
      window.location.hash = routeToHash(currentRouteRef.current);
      setTimeout(() => {
        syncingFromHashRef.current = false;
      }, 0);
    }

    const onHashChange = () => {
      if (syncingFromHashRef.current) return;
      const parsed = parseHashToRoute(window.location.hash);
      setRoute((prev) => {
        if (isSameRoute(prev, parsed)) return prev;
        historyStackRef.current = [...historyStackRef.current, parsed].slice(-30);
        return parsed;
      });
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let removeListener: (() => Promise<void>) | null = null;

    void CapacitorApp.addListener("backButton", () => {
      const handled = goBack();
      if (!handled) {
        void CapacitorApp.exitApp();
      }
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
      } else {
        removeListener = () => handle.remove();
      }
    });

    return () => {
      disposed = true;
      if (removeListener) {
        void removeListener();
      }
    };
  }, [goBack]);

  return {
    route,
    navigate,
    goBack,
    registerBackHandler,
  };
}
