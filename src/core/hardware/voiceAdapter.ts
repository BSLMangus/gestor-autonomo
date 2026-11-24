import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";

export interface VoiceAvailability {
  available: boolean;
  offlineSupported: boolean;
  permissionDenied: boolean;
}

export type VoiceListenResult =
  | { status: "ok"; text: string }
  | { status: "cancelled" }
  | { status: "permission_denied" }
  | { status: "unavailable" }
  | { status: "error"; reason: string };

export type VoicePauseReason =
  | "user"
  | "app_backgrounded"
  | "audio_focus_lost"
  | "inactivity_timeout"
  | "error";

export type VoiceSessionEvent =
  | { type: "listening" }
  | { type: "paused"; reason: VoicePauseReason; message?: string }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "permission_denied" }
  | { type: "unavailable" }
  | { type: "error"; reason: string; fatal: boolean };

export interface ContinuousVoiceSession {
  stop(): Promise<void>;
}

export interface VoiceInputAdapter {
  isAvailable(): Promise<VoiceAvailability>;
  listenOnceEsEs(): Promise<VoiceListenResult>;
  startContinuousEsEs?(
    onEvent: (event: VoiceSessionEvent) => void
  ): Promise<ContinuousVoiceSession | null>;
  stop?(): Promise<void>;
}

/**
 * Une segmentos de transcripción evitando espacios duplicados o huecos antes de puntuación.
 */
export function joinTranscriptSegments(base: string, addition: string): string {
  const cleanAddition = addition.trim();
  if (!cleanAddition) {
    return base;
  }
  if (!base || base.trim().length === 0) {
    return cleanAddition;
  }
  if (/\r?\n$/.test(base)) {
    return `${base}${cleanAddition}`;
  }
  const trimmedBase = base.replace(/[ \t]+$/g, "");
  if (/^[.,;:!?)]/.test(cleanAddition)) {
    return `${trimmedBase}${cleanAddition}`;
  }
  return `${trimmedBase} ${cleanAddition}`;
}

interface BrowserSpeechRecognitionResultItem {
  transcript?: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal?: boolean;
  0?: BrowserSpeechRecognitionResultItem;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex?: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getBrowserSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

/**
 * Adaptador Web para dictado en español (es-ES) mediante Web Speech API cuando está disponible.
 */
export class WebVoiceInputAdapter implements VoiceInputAdapter {
  private activeRecognition: BrowserSpeechRecognition | null = null;
  private activeContinuousStop: (() => Promise<void>) | null = null;

  async isAvailable(): Promise<VoiceAvailability> {
    const hasSpeech = getBrowserSpeechRecognitionCtor() !== null;
    return {
      available: hasSpeech,
      offlineSupported: hasSpeech,
      permissionDenied: false,
    };
  }

  async stop(): Promise<void> {
    if (this.activeContinuousStop) {
      await this.activeContinuousStop();
      return;
    }
    try {
      this.activeRecognition?.stop();
    } catch {
      // ignore stop errors when already stopped
    } finally {
      this.activeRecognition = null;
    }
  }

  async startContinuousEsEs(
    onEvent: (event: VoiceSessionEvent) => void
  ): Promise<ContinuousVoiceSession | null> {
    await this.stop();
    const Recognition = getBrowserSpeechRecognitionCtor();
    if (!Recognition) {
      onEvent({ type: "unavailable" });
      return null;
    }

    let active = true;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let currentRec: BrowserSpeechRecognition | null = null;
    let networkErrorCount = 0;
    let lastCommittedIndex = 0;

    const clearHandlers = (rec: BrowserSpeechRecognition | null) => {
      if (!rec) return;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
    };

    const stopSession = async () => {
      active = false;
      if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (this.activeContinuousStop === stopSession) {
        this.activeContinuousStop = null;
      }
      const rec = currentRec;
      currentRec = null;
      this.activeRecognition = null;
      clearHandlers(rec);
      if (rec) {
        try {
          if (typeof rec.abort === "function") {
            rec.abort();
          } else {
            rec.stop();
          }
        } catch {
          // ignore cleanup stop errors
        }
      }
    };

    const launchCycle = () => {
      if (!active) return;
      try {
        const rec = new Recognition();
        currentRec = rec;
        this.activeRecognition = rec;
        lastCommittedIndex = 0;
        rec.lang = "es-ES";
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        rec.onresult = (event) => {
          if (!active) return;
          networkErrorCount = 0;
          const startIdx = Math.max(event.resultIndex ?? 0, lastCommittedIndex);
          const interimParts: string[] = [];

          for (let i = startIdx; i < event.results.length; i += 1) {
            const item = event.results[i];
            const transcript = item?.[0]?.transcript?.trim() ?? "";
            if (item?.isFinal) {
              lastCommittedIndex = i + 1;
              if (transcript) {
                onEvent({ type: "final", text: transcript });
              }
            } else if (transcript) {
              interimParts.push(transcript);
            }
          }

          onEvent({ type: "partial", text: interimParts.join(" ").trim() });
        };

        rec.onerror = (event) => {
          if (!active) return;
          const err = event.error;
          if (err === "not-allowed" || err === "service-not-allowed") {
            active = false;
            void stopSession();
            onEvent({ type: "permission_denied" });
            return;
          }
          if (err === "audio-capture") {
            active = false;
            void stopSession();
            onEvent({
              type: "error",
              reason: "No se pudo acceder al micrófono del dispositivo.",
              fatal: true,
            });
            onEvent({
              type: "paused",
              reason: "error",
              message: "No se pudo acceder al micrófono del dispositivo.",
            });
            return;
          }
          if (err === "network") {
            networkErrorCount += 1;
            if (networkErrorCount >= 3) {
              active = false;
              void stopSession();
              onEvent({
                type: "paused",
                reason: "error",
                message: "El reconocedor del navegador requiere conexión en este equipo.",
              });
            }
          }
        };

        rec.onend = () => {
          clearHandlers(rec);
          if (currentRec === rec) {
            currentRec = null;
          }
          if (this.activeRecognition === rec) {
            this.activeRecognition = null;
          }
          if (!active) return;
          restartTimer = setTimeout(() => {
            restartTimer = null;
            if (active) {
              launchCycle();
            }
          }, 180);
        };

        rec.start();
        onEvent({ type: "listening" });
      } catch {
        active = false;
        void stopSession();
        onEvent({ type: "unavailable" });
      }
    };

    this.activeContinuousStop = stopSession;
    launchCycle();
    if (!active) {
      return null;
    }
    return { stop: stopSession };
  }

  async listenOnceEsEs(): Promise<VoiceListenResult> {
    const Recognition = getBrowserSpeechRecognitionCtor();
    if (!Recognition) {
      return { status: "unavailable" };
    }

    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) {
          track.stop();
        }
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          return { status: "permission_denied" };
        }
      }
    }

    return new Promise((resolve) => {
      try {
        const recognition = new Recognition();
        this.activeRecognition = recognition;
        recognition.lang = "es-ES";
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        let settled = false;

        const finish = (res: VoiceListenResult) => {
          if (settled) return;
          settled = true;
          this.activeRecognition = null;
          resolve(res);
        };

        recognition.onresult = (event) => {
          const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? "";
          finish(transcript ? { status: "ok", text: transcript } : { status: "cancelled" });
        };

        recognition.onerror = (event) => {
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            finish({ status: "permission_denied" });
          } else if (event.error === "aborted" || event.error === "no-speech") {
            finish({ status: "cancelled" });
          } else {
            finish({ status: "unavailable" });
          }
        };

        recognition.onend = () => {
          finish({ status: "cancelled" });
        };

        recognition.start();
      } catch {
        this.activeRecognition = null;
        resolve({ status: "unavailable" });
      }
    });
  }
}

export interface SpeechRecognitionPluginLike {
  available(): Promise<{ available: boolean }>;
  checkPermissions(): Promise<{ speechRecognition: string }>;
  requestPermissions(): Promise<{ speechRecognition: string }>;
  start(options?: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    popup?: boolean;
  }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
  isListening(): Promise<{ listening: boolean }>;
}

export interface ContinuousDictationPluginLike {
  available(): Promise<{ available: boolean; onDeviceSupported?: boolean }>;
  checkPermissions(): Promise<{ microphone: string }>;
  requestPermissions(): Promise<{ microphone: string }>;
  startSession(options?: { language?: string }): Promise<{ started: boolean; sessionId: number }>;
  stopSession(): Promise<{ stopped: boolean }>;
  isListening(): Promise<{ listening: boolean }>;
  addListener(
    eventName: "dictationPartial",
    listenerFunc: (event: { sessionId: number; text: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "dictationFinal",
    listenerFunc: (event: { sessionId: number; text: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "dictationState",
    listenerFunc: (event: {
      sessionId: number;
      status: "listening" | "paused" | "stopped";
      reason?: VoicePauseReason;
    }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "dictationError",
    listenerFunc: (event: {
      sessionId: number;
      code: string;
      message: string;
      fatal: boolean;
    }) => void
  ): Promise<PluginListenerHandle>;
}

const ContinuousDictation = registerPlugin<ContinuousDictationPluginLike>("ContinuousDictation");

/**
 * Adaptador nativo de voz en Android/iOS sobre ContinuousDictation (Android) y
 * @capgo/capacitor-speech-recognition como respaldo heredado.
 */
export class CapacitorVoiceInputAdapter implements VoiceInputAdapter {
  private readonly plugin: SpeechRecognitionPluginLike;
  private readonly continuousPlugin: ContinuousDictationPluginLike | null;
  private readonly hasInjectedContinuousPlugin: boolean;
  private readonly isNative: () => boolean;
  private readonly getPlatform: () => string;
  private activeContinuousStop: (() => Promise<void>) | null = null;

  constructor(deps?: {
    plugin?: SpeechRecognitionPluginLike;
    continuousPlugin?: ContinuousDictationPluginLike | null;
    isNative?: () => boolean;
    getPlatform?: () => string;
  }) {
    this.plugin = deps?.plugin ?? SpeechRecognition;
    this.hasInjectedContinuousPlugin = deps?.continuousPlugin !== undefined;
    this.continuousPlugin =
      deps?.continuousPlugin === undefined ? ContinuousDictation : deps.continuousPlugin;
    this.isNative = deps?.isNative ?? (() => Capacitor.isNativePlatform());
    this.getPlatform = deps?.getPlatform ?? (() => Capacitor.getPlatform());
  }

  private shouldUseContinuousPlugin(): boolean {
    if (!this.isNative() || !this.continuousPlugin) return false;
    return this.hasInjectedContinuousPlugin || this.getPlatform() === "android";
  }

  async isAvailable(): Promise<VoiceAvailability> {
    if (!this.isNative()) {
      return { available: false, offlineSupported: false, permissionDenied: false };
    }
    if (this.shouldUseContinuousPlugin() && this.continuousPlugin) {
      try {
        const [avail, perms] = await Promise.all([
          this.continuousPlugin.available(),
          this.continuousPlugin.checkPermissions(),
        ]);
        const available = Boolean(avail.available);
        return {
          available,
          offlineSupported: available,
          permissionDenied: perms.microphone === "denied",
        };
      } catch {
        // Fallback a comprobación de SpeechRecognition si el plugin nativo no estuviera registrado
      }
    }
    try {
      const [avail, perms] = await Promise.all([
        this.plugin.available(),
        this.plugin.checkPermissions(),
      ]);
      const available = Boolean(avail.available);
      return {
        available,
        offlineSupported: available,
        permissionDenied: perms.speechRecognition === "denied",
      };
    } catch {
      return { available: false, offlineSupported: false, permissionDenied: false };
    }
  }

  private async stopLegacySingleShot(): Promise<void> {
    if (!this.isNative()) return;
    try {
      const state = await this.plugin.isListening();
      if (state.listening) {
        await this.plugin.stop();
      }
    } catch {
      // ignore plugin stop errors on inactive recognition
    }
  }

  async stop(): Promise<void> {
    if (this.activeContinuousStop) {
      await this.activeContinuousStop();
    }
    await this.stopLegacySingleShot();
  }

  async startContinuousEsEs(
    onEvent: (event: VoiceSessionEvent) => void
  ): Promise<ContinuousVoiceSession | null> {
    if (!this.isNative()) {
      onEvent({ type: "unavailable" });
      return null;
    }

    if (!this.shouldUseContinuousPlugin() || !this.continuousPlugin) {
      let stopped = false;
      const stopFallback = async () => {
        stopped = true;
        if (this.activeContinuousStop === stopFallback) {
          this.activeContinuousStop = null;
        }
        await this.stopLegacySingleShot();
      };
      this.activeContinuousStop = stopFallback;
      onEvent({ type: "listening" });
      void this.listenOnceEsEs().then((res) => {
        if (this.activeContinuousStop === stopFallback) {
          this.activeContinuousStop = null;
        }
        if (stopped) return;
        if (res.status === "ok" && res.text.trim()) {
          onEvent({ type: "final", text: res.text.trim() });
          onEvent({ type: "paused", reason: "user" });
        } else if (res.status === "permission_denied") {
          onEvent({ type: "permission_denied" });
        } else if (res.status === "unavailable") {
          onEvent({ type: "unavailable" });
        } else if (res.status === "error") {
          onEvent({ type: "error", reason: res.reason, fatal: false });
          onEvent({ type: "paused", reason: "error", message: res.reason });
        } else {
          onEvent({ type: "paused", reason: "user" });
        }
      });
      return { stop: stopFallback };
    }

    const cp = this.continuousPlugin;
    if (this.activeContinuousStop) {
      await this.activeContinuousStop();
    }

    let disposed = false;
    let activeSessionId: number | null = null;
    const handles: PluginListenerHandle[] = [];

    const cleanup = async (stopNative: boolean) => {
      const wasDisposed = disposed;
      disposed = true;
      if (this.activeContinuousStop === stopHandle) {
        this.activeContinuousStop = null;
      }
      const toRemove = handles.splice(0, handles.length);
      await Promise.allSettled(toRemove.map((h) => h.remove()));
      if (stopNative && !wasDisposed) {
        await cp.stopSession().catch(() => undefined);
      } else if (stopNative && activeSessionId !== null) {
        await cp.stopSession().catch(() => undefined);
      }
    };

    const stopHandle = async () => {
      await cleanup(true);
    };
    this.activeContinuousStop = stopHandle;

    try {
      await this.stopLegacySingleShot();
      if (disposed) {
        await cleanup(false);
        return { stop: stopHandle };
      }

      const avail = await cp.available();
      if (disposed) {
        await cleanup(false);
        return { stop: stopHandle };
      }
      if (!avail.available) {
        await cleanup(false);
        onEvent({ type: "unavailable" });
        return null;
      }

      let perms = await cp.checkPermissions();
      if (disposed) {
        await cleanup(false);
        return { stop: stopHandle };
      }
      if (perms.microphone !== "granted") {
        perms = await cp.requestPermissions();
        if (disposed) {
          await cleanup(false);
          return { stop: stopHandle };
        }
        if (perms.microphone !== "granted") {
          await cleanup(false);
          onEvent({ type: "permission_denied" });
          return null;
        }
      }

      const registeredHandles = await Promise.all([
        cp.addListener("dictationPartial", (ev) => {
          if (disposed) return;
          if (activeSessionId !== null && ev.sessionId !== activeSessionId) return;
          onEvent({ type: "partial", text: ev.text });
        }),
        cp.addListener("dictationFinal", (ev) => {
          if (disposed) return;
          if (activeSessionId !== null && ev.sessionId !== activeSessionId) return;
          if (ev.text.trim()) {
            onEvent({ type: "final", text: ev.text });
          }
        }),
        cp.addListener("dictationState", (ev) => {
          if (disposed) return;
          if (activeSessionId !== null && ev.sessionId !== activeSessionId) return;
          if (ev.status === "listening") {
            onEvent({ type: "listening" });
          } else {
            const reason: VoicePauseReason = ev.reason ?? "user";
            void cleanup(false);
            onEvent({ type: "paused", reason });
          }
        }),
        cp.addListener("dictationError", (ev) => {
          if (disposed) return;
          if (activeSessionId !== null && ev.sessionId !== activeSessionId) return;
          if (ev.code === "permission_denied") {
            void cleanup(false);
            onEvent({ type: "permission_denied" });
            return;
          }
          onEvent({ type: "error", reason: ev.message, fatal: ev.fatal });
        }),
      ]);

      handles.push(...registeredHandles);

      if (disposed) {
        await cleanup(false);
        return { stop: stopHandle };
      }

      const startRes = await cp.startSession({ language: "es-ES" });
      activeSessionId = startRes.sessionId;

      if (disposed) {
        await cleanup(true);
        return { stop: stopHandle };
      }

      return { stop: stopHandle };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      await cleanup(false);
      if (lower.includes("permission") || lower.includes("denied")) {
        onEvent({ type: "permission_denied" });
      } else if (lower.includes("no disponible") || lower.includes("unavailable")) {
        onEvent({ type: "unavailable" });
      } else {
        onEvent({ type: "error", reason: msg, fatal: false });
        onEvent({ type: "paused", reason: "error", message: msg });
      }
      return null;
    }
  }

  async listenOnceEsEs(): Promise<VoiceListenResult> {
    const status = await this.isAvailable();
    if (!status.available) {
      return { status: "unavailable" };
    }
    try {
      const currentPerms = await this.plugin.checkPermissions();
      if (currentPerms.speechRecognition !== "granted") {
        const req = await this.plugin.requestPermissions();
        if (req.speechRecognition !== "granted") {
          return { status: "permission_denied" };
        }
      }

      const res = await this.plugin.start({
        language: "es-ES",
        maxResults: 1,
        partialResults: false,
        popup: false,
      });
      const match = res.matches?.[0]?.trim() ?? "";
      if (!match) {
        return { status: "cancelled" };
      }
      return { status: "ok", text: match };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes("permission") || lower.includes("denied")) {
        return { status: "permission_denied" };
      }
      if (lower.includes("cancel") || lower.includes("no match") || lower.includes("speech timeout")) {
        return { status: "cancelled" };
      }
      return { status: "error", reason: msg };
    }
  }
}

export function createVoiceInputAdapter(): VoiceInputAdapter {
  return Capacitor.isNativePlatform()
    ? new CapacitorVoiceInputAdapter()
    : new WebVoiceInputAdapter();
}
