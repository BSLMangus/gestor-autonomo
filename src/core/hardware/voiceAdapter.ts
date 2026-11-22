import { Capacitor } from "@capacitor/core";
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

export interface VoiceInputAdapter {
  isAvailable(): Promise<VoiceAvailability>;
  listenOnceEsEs(): Promise<VoiceListenResult>;
  stop?(): Promise<void>;
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
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

  async isAvailable(): Promise<VoiceAvailability> {
    const hasSpeech = getBrowserSpeechRecognitionCtor() !== null;
    return {
      available: hasSpeech,
      offlineSupported: hasSpeech,
      permissionDenied: false,
    };
  }

  async stop(): Promise<void> {
    try {
      this.activeRecognition?.stop();
    } catch {
      // ignore stop errors when already stopped
    } finally {
      this.activeRecognition = null;
    }
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

/**
 * Adaptador nativo de voz en Android/iOS sobre @capgo/capacitor-speech-recognition.
 */
export class CapacitorVoiceInputAdapter implements VoiceInputAdapter {
  private readonly plugin: SpeechRecognitionPluginLike;
  private readonly isNative: () => boolean;

  constructor(deps?: { plugin?: SpeechRecognitionPluginLike; isNative?: () => boolean }) {
    this.plugin = deps?.plugin ?? SpeechRecognition;
    this.isNative = deps?.isNative ?? (() => Capacitor.isNativePlatform());
  }

  async isAvailable(): Promise<VoiceAvailability> {
    if (!this.isNative()) {
      return { available: false, offlineSupported: false, permissionDenied: false };
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

  async stop(): Promise<void> {
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
