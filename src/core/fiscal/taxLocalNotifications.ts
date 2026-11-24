import { Capacitor } from "@capacitor/core";
import {
  LocalNotifications,
  type LocalNotificationSchema,
} from "@capacitor/local-notifications";
import type { SqliteExecutor } from "../contracts/types";
import { SettingsRepository } from "../db/repositories/settingsRepo";
import { TaxCalendarRepository } from "../db/repositories/taxCalendarRepo";
import { getLocalTodayIso } from "./dateQuarter";
import {
  computeUpcomingGroupedAlerts,
  DEFAULT_ACTIVE_TAX_MODELS,
} from "./taxCalendarEngine";

export const TAX_NOTIFICATION_CHANNEL_ID = "aeat_tax_deadlines";
export const TAX_NOTIFICATION_ID_BASE = 700000;
export const TAX_NOTIFICATION_ID_MAX = 700999;
export const TAX_NOTIFICATION_HORIZON_DAYS = 60;

export type TaxNotificationPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "prompt-with-rationale"
  | "unsupported";

export interface TaxNotificationSyncResult {
  scheduled: number;
  cancelled: number;
  skippedReason?: "not_native" | "permission_not_granted";
}

function buildNineAmLocalDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(year, month - 1, day, 9, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

async function cancelManagedTaxNotifications(): Promise<number> {
  const pending = await LocalNotifications.getPending();
  const managedIds = pending.notifications
    .map((n) => n.id)
    .filter((id) => id >= TAX_NOTIFICATION_ID_BASE && id <= TAX_NOTIFICATION_ID_MAX);
  if (managedIds.length === 0) return 0;
  await LocalNotifications.cancel({
    notifications: managedIds.map((id) => ({ id })),
  });
  return managedIds.length;
}

async function ensureTaxNotificationChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  try {
    await LocalNotifications.createChannel({
      id: TAX_NOTIFICATION_CHANNEL_ID,
      name: "Plazos Hacienda (AEAT)",
      description: "Avisos anticipados de inicio y cierre de modelos fiscales",
      importance: 4,
      visibility: 1,
    });
  } catch {
    // Canal ya creado o plataforma anterior a Android 8
  }
}

export async function getTaxNotificationPermissionStatus(): Promise<TaxNotificationPermissionState> {
  if (!Capacitor.isNativePlatform()) {
    return "unsupported";
  }
  try {
    const status = await LocalNotifications.checkPermissions();
    return status.display;
  } catch {
    return "denied";
  }
}

export async function requestTaxNotificationPermission(): Promise<TaxNotificationPermissionState> {
  if (!Capacitor.isNativePlatform()) {
    return "unsupported";
  }
  try {
    const status = await LocalNotifications.requestPermissions();
    return status.display;
  } catch {
    return "denied";
  }
}

export async function syncTaxLocalNotifications(
  executor: SqliteExecutor,
  todayIso = getLocalTodayIso()
): Promise<TaxNotificationSyncResult> {
  if (!Capacitor.isNativePlatform()) {
    return { scheduled: 0, cancelled: 0, skippedReason: "not_native" };
  }

  let cancelled = 0;
  try {
    cancelled = await cancelManagedTaxNotifications();
  } catch {
    cancelled = 0;
  }

  const perm = await getTaxNotificationPermissionStatus();
  if (perm !== "granted") {
    return { scheduled: 0, cancelled, skippedReason: "permission_not_granted" };
  }

  await ensureTaxNotificationChannel();

  const settingsRepo = new SettingsRepository(executor);
  const taxRepo = new TaxCalendarRepository(executor);
  const [settings, statesMap, dismissals] = await Promise.all([
    settingsRepo.getAppSettingsOrNull(),
    taxRepo.listAllStates(),
    taxRepo.listDismissedAlertKeys(),
  ]);

  const activeModels = settings?.active_tax_models ?? DEFAULT_ACTIVE_TAX_MODELS;
  const groupedDays = computeUpcomingGroupedAlerts(
    todayIso,
    TAX_NOTIFICATION_HORIZON_DAYS,
    activeModels,
    statesMap,
    dismissals
  );

  const nowMs = Date.now();
  const maxSlots = TAX_NOTIFICATION_ID_MAX - TAX_NOTIFICATION_ID_BASE + 1;
  const notifications: LocalNotificationSchema[] = [];

  for (const day of groupedDays) {
    if (notifications.length >= maxSlots) break;
    const at = buildNineAmLocalDate(day.triggerDateIso);
    if (!at || at.getTime() <= nowMs) {
      continue;
    }
    const id = TAX_NOTIFICATION_ID_BASE + notifications.length;
    notifications.push({
      id,
      channelId: TAX_NOTIFICATION_CHANNEL_ID,
      title: day.title,
      body: day.body,
      schedule: { at },
      extra: {
        targetRoute: "calendar",
        tab: "hacienda",
        focusDateIso: day.triggerDateIso,
      },
    });
  }

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications });
  }

  return { scheduled: notifications.length, cancelled };
}

export async function registerTaxNotificationClickListener(
  onOpenTaxCalendar: (focusDateIso?: string) => void
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) {
    return () => undefined;
  }

  const handle = await LocalNotifications.addListener(
    "localNotificationActionPerformed",
    (action) => {
      const notif = action.notification;
      const extra = (notif?.extra ?? null) as Record<string, unknown> | null;
      const isTaxId =
        typeof notif?.id === "number" &&
        notif.id >= TAX_NOTIFICATION_ID_BASE &&
        notif.id <= TAX_NOTIFICATION_ID_MAX;
      if (extra?.targetRoute === "calendar" || isTaxId) {
        const focusDateIso =
          typeof extra?.focusDateIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(extra.focusDateIso)
            ? extra.focusDateIso
            : undefined;
        onOpenTaxCalendar(focusDateIso);
      }
    }
  );

  return () => {
    void handle.remove();
  };
}
