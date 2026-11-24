package es.obralocal.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.WindowManager;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/**
 * Plugin nativo Android de dictado continuo en primer plano resiliente a notificaciones.
 * Serializa todo su estado en el Main Looper, adquiere foco de audio no destructivo frente a
 * avisos de notificación y mantiene la sesión viva mediante reinicio controlado y watchdog de silencio.
 */
@CapacitorPlugin(
    name = "ContinuousDictation",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = ContinuousDictationPlugin.MIC_ALIAS),
    }
)
public class ContinuousDictationPlugin extends Plugin {

    public static final String MIC_ALIAS = "microphone";
    private static final String TAG = "ContinuousDictation";
    private static final long SILENCE_INACTIVITY_TIMEOUT_MS = 90_000L;
    private static final int MAX_CONSECUTIVE_HARD_ERRORS = 4;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private boolean sessionActive = false;
    private long currentSessionId = 0L;
    private String activeLanguage = "es-ES";
    private String lastInterimText = "";
    private int consecutiveHardErrors = 0;
    private long lastSpeechActivityMs = 0L;
    private boolean usingOnDeviceRecognizer = false;
    private boolean triedFallbackFromOnDevice = false;

    private SpeechRecognizer speechRecognizer;
    private Runnable pendingRestartRunnable;

    private AudioManager audioManager;
    private Object audioFocusRequestObj;
    private boolean audioFocusHeld = false;

    private final AudioManager.OnAudioFocusChangeListener focusChangeListener = focusChange ->
        mainHandler.post(() -> handleAudioFocusChange(focusChange));

    @RequiresApi(Build.VERSION_CODES.O)
    private static final class Api26AudioFocusHelper {
        static Object buildAndRequest(
            AudioManager am,
            AudioManager.OnAudioFocusChangeListener listener,
            Handler handler
        ) {
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            AudioFocusRequest req = new AudioFocusRequest.Builder(
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            )
                .setAudioAttributes(attrs)
                .setWillPauseWhenDucked(false)
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(listener, handler)
                .build();
            am.requestAudioFocus(req);
            return req;
        }

        static void abandon(AudioManager am, Object reqObj) {
            if (reqObj instanceof AudioFocusRequest) {
                am.abandonAudioFocusRequest((AudioFocusRequest) reqObj);
            }
        }
    }

    @PluginMethod
    public void available(PluginCall call) {
        Context ctx = getContext();
        boolean classicAvailable = SpeechRecognizer.isRecognitionAvailable(ctx);
        boolean onDeviceSupported =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx);

        JSObject ret = new JSObject();
        ret.put("available", classicAvailable || onDeviceSupported);
        ret.put("onDeviceSupported", onDeviceSupported);
        call.resolve(ret);
    }

    @PluginMethod
    @Override
    public void checkPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put(MIC_ALIAS, permissionStateValue(getPermissionState(MIC_ALIAS)));
        call.resolve(ret);
    }

    @PluginMethod
    @Override
    public void requestPermissions(PluginCall call) {
        requestPermissionForAlias(MIC_ALIAS, call, "permissionsCallback");
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put(MIC_ALIAS, permissionStateValue(getPermissionState(MIC_ALIAS)));
        call.resolve(ret);
    }

    @PluginMethod
    public void isListening(PluginCall call) {
        mainHandler.post(() -> {
            JSObject ret = new JSObject();
            ret.put("listening", sessionActive);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void startSession(PluginCall call) {
        String rawLang = call.getString("language", "es-ES");
        final String language = rawLang != null && !rawLang.trim().isEmpty() ? rawLang.trim() : "es-ES";

        mainHandler.post(() -> {
            Context ctx = getContext();
            boolean classicAvailable = SpeechRecognizer.isRecognitionAvailable(ctx);
            boolean onDeviceSupported =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx);

            if (!classicAvailable && !onDeviceSupported) {
                call.reject("Reconocimiento de voz offline no disponible en este dispositivo.");
                return;
            }

            if (getPermissionState(MIC_ALIAS) != PermissionState.GRANTED) {
                call.reject("Missing microphone permission");
                return;
            }

            Activity activity = getActivity();
            if (activity == null || activity.isFinishing()) {
                call.reject("La actividad no está disponible para iniciar el dictado.");
                return;
            }

            teardownRecognizerInternal();
            cancelPendingRestart();

            currentSessionId += 1L;
            final long sid = currentSessionId;
            sessionActive = true;
            activeLanguage = language;
            lastInterimText = "";
            consecutiveHardErrors = 0;
            triedFallbackFromOnDevice = false;
            lastSpeechActivityMs = SystemClock.elapsedRealtime();

            acquireAudioFocusInternal();
            setKeepScreenOn(true);

            if (!startRecognizerCycle(sid, false)) {
                sessionActive = false;
                releaseAudioFocusInternal();
                setKeepScreenOn(false);
                call.reject("No se pudo iniciar el reconocedor de voz local.");
                return;
            }

            emitState(sid, "listening", null);
            JSObject ret = new JSObject();
            ret.put("started", true);
            ret.put("sessionId", sid);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void stopSession(PluginCall call) {
        mainHandler.post(() -> {
            long sid = currentSessionId;
            boolean wasActive = sessionActive;
            sessionActive = false;
            lastInterimText = "";
            consecutiveHardErrors = 0;
            cancelPendingRestart();
            teardownRecognizerInternal();
            releaseAudioFocusInternal();
            setKeepScreenOn(false);
            if (wasActive) {
                emitState(sid, "stopped", "user");
            }
            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
        });
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        mainHandler.post(() -> {
            if (sessionActive) {
                pauseSessionInternal("app_backgrounded");
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        sessionActive = false;
        lastInterimText = "";
        pendingRestartRunnable = null;
        teardownRecognizerInternal();
        releaseAudioFocusInternal();
        setKeepScreenOn(false);
        super.handleOnDestroy();
    }

    private void handleAudioFocusChange(int focusChange) {
        if (!sessionActive) return;

        if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            // Avisos cortos de notificación: mantener dictado sin cortes.
            return;
        }

        if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            AudioManager am = getAudioManager();
            if (am != null) {
                int mode = am.getMode();
                boolean isPhoneOrCall =
                    mode == AudioManager.MODE_RINGTONE ||
                    mode == AudioManager.MODE_IN_CALL ||
                    mode == AudioManager.MODE_IN_COMMUNICATION;
                if (isPhoneOrCall) {
                    pauseSessionInternal("audio_focus_lost");
                }
            }
            return;
        }

        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
            pauseSessionInternal("audio_focus_lost");
        }
    }

    private void pauseSessionInternal(String reason) {
        long sid = currentSessionId;
        if (!sessionActive) return;

        if (!lastInterimText.isEmpty()) {
            emitFinalAndClearInterim(sid, lastInterimText);
        }
        sessionActive = false;
        consecutiveHardErrors = 0;
        cancelPendingRestart();
        teardownRecognizerInternal();
        releaseAudioFocusInternal();
        setKeepScreenOn(false);
        emitState(sid, "paused", reason);
    }

    private boolean startRecognizerCycle(long sid, boolean forceClassicRecognizer) {
        Activity activity = getActivity();
        Context ctx = getContext();
        if (activity == null || activity.isFinishing() || ctx == null || !sessionActive || sid != currentSessionId) {
            return false;
        }

        try {
            teardownRecognizerInternal();
            if (
                !forceClassicRecognizer &&
                !triedFallbackFromOnDevice &&
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(ctx)
            ) {
                try {
                    speechRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx);
                    usingOnDeviceRecognizer = true;
                } catch (Exception ex) {
                    Logger.warn(TAG, "Fallback a createSpeechRecognizer clásico: " + ex.getMessage());
                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(ctx);
                    usingOnDeviceRecognizer = false;
                }
            } else {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(ctx);
                usingOnDeviceRecognizer = false;
            }

            if (speechRecognizer == null) {
                return false;
            }

            speechRecognizer.setRecognitionListener(new SessionRecognitionListener(sid));
            speechRecognizer.startListening(buildRecognitionIntent(ctx));
            return true;
        } catch (Exception ex) {
            Logger.error(TAG, "Error iniciando SpeechRecognizer: " + ex.getMessage(), ex);
            teardownRecognizerInternal();
            return false;
        }
    }

    private Intent buildRecognitionIntent(Context ctx) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, activeLanguage);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, activeLanguage);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
        intent.putExtra("android.speech.extra.DICTATION_MODE", true);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 60_000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 60_000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 10_000L);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.putExtra(
                RecognizerIntent.EXTRA_SEGMENTED_SESSION,
                RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS
            );
        }
        return intent;
    }

    private void scheduleRestart(long sid, long delayMs, boolean recreate, boolean forceClassic) {
        cancelPendingRestart();
        if (!sessionActive || sid != currentSessionId) {
            return;
        }
        pendingRestartRunnable = () -> {
            pendingRestartRunnable = null;
            if (!sessionActive || sid != currentSessionId) {
                return;
            }
            Activity activity = getActivity();
            if (activity == null || activity.isFinishing()) {
                pauseSessionInternal("app_backgrounded");
                return;
            }
            if (recreate || speechRecognizer == null) {
                if (!startRecognizerCycle(sid, forceClassic)) {
                    emitError(sid, "recognizer_restart_failed", "No se pudo reanudar el micrófono.", false);
                    pauseSessionInternal("error");
                }
            } else {
                try {
                    speechRecognizer.startListening(buildRecognitionIntent(getContext()));
                } catch (Exception ex) {
                    if (!startRecognizerCycle(sid, forceClassic)) {
                        emitError(sid, "recognizer_restart_failed", "No se pudo reanudar el micrófono.", false);
                        pauseSessionInternal("error");
                    }
                }
            }
        };
        mainHandler.postDelayed(pendingRestartRunnable, delayMs);
    }

    private void cancelPendingRestart() {
        if (pendingRestartRunnable != null) {
            mainHandler.removeCallbacks(pendingRestartRunnable);
            pendingRestartRunnable = null;
        }
    }

    private void teardownRecognizerInternal() {
        if (speechRecognizer != null) {
            try {
                speechRecognizer.setRecognitionListener(null);
            } catch (Exception ignored) {}
            try {
                speechRecognizer.cancel();
            } catch (Exception ignored) {}
            try {
                speechRecognizer.destroy();
            } catch (Exception ignored) {}
            speechRecognizer = null;
        }
        usingOnDeviceRecognizer = false;
    }

    private AudioManager getAudioManager() {
        if (audioManager == null && getContext() != null) {
            audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        }
        return audioManager;
    }

    @SuppressWarnings("deprecation")
    private void acquireAudioFocusInternal() {
        if (audioFocusHeld) return;
        AudioManager am = getAudioManager();
        if (am == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequestObj = Api26AudioFocusHelper.buildAndRequest(am, focusChangeListener, mainHandler);
            } else {
                am.requestAudioFocus(
                    focusChangeListener,
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                );
            }
            audioFocusHeld = true;
        } catch (Exception ex) {
            Logger.warn(TAG, "No se pudo solicitar foco de audio: " + ex.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private void releaseAudioFocusInternal() {
        if (!audioFocusHeld) return;
        AudioManager am = getAudioManager();
        if (am != null) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequestObj != null) {
                    Api26AudioFocusHelper.abandon(am, audioFocusRequestObj);
                } else {
                    am.abandonAudioFocus(focusChangeListener);
                }
            } catch (Exception ignored) {}
        }
        audioFocusRequestObj = null;
        audioFocusHeld = false;
    }

    private void setKeepScreenOn(boolean keepOn) {
        Activity activity = getActivity();
        if (activity == null || activity.getWindow() == null) return;
        if (keepOn) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    private void emitPartial(long sid, String text) {
        JSObject data = new JSObject();
        data.put("sessionId", sid);
        data.put("text", text);
        notifyListeners("dictationPartial", data);
    }

    private void emitFinalAndClearInterim(long sid, String rawText) {
        String trimmed = rawText != null ? rawText.trim() : "";
        lastInterimText = "";
        if (trimmed.isEmpty()) {
            return;
        }
        consecutiveHardErrors = 0;
        lastSpeechActivityMs = SystemClock.elapsedRealtime();

        JSObject data = new JSObject();
        data.put("sessionId", sid);
        data.put("text", trimmed);
        notifyListeners("dictationFinal", data);
    }

    private void emitState(long sid, String status, String reason) {
        JSObject data = new JSObject();
        data.put("sessionId", sid);
        data.put("status", status);
        if (reason != null) {
            data.put("reason", reason);
        }
        notifyListeners("dictationState", data);
    }

    private void emitError(long sid, String code, String message, boolean fatal) {
        JSObject data = new JSObject();
        data.put("sessionId", sid);
        data.put("code", code);
        data.put("message", message);
        data.put("fatal", fatal);
        notifyListeners("dictationError", data);
    }

    private String permissionStateValue(PermissionState state) {
        if (state == null) return "prompt";
        switch (state) {
            case GRANTED:
                return "granted";
            case DENIED:
                return "denied";
            case PROMPT:
            case PROMPT_WITH_RATIONALE:
            default:
                return "prompt";
        }
    }

    private static String extractBestMatch(Bundle bundle) {
        if (bundle == null) return "";
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return "";
        String first = matches.get(0);
        return first != null ? first.trim() : "";
    }

    private class SessionRecognitionListener implements RecognitionListener {

        private final long listenerSessionId;

        SessionRecognitionListener(long listenerSessionId) {
            this.listenerSessionId = listenerSessionId;
        }

        @Override
        public void onReadyForSpeech(Bundle params) {}

        @Override
        public void onBeginningOfSpeech() {
            if (listenerSessionId != currentSessionId || !sessionActive) return;
            lastSpeechActivityMs = SystemClock.elapsedRealtime();
        }

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {}

        @Override
        public void onPartialResults(Bundle partialResults) {
            if (listenerSessionId != currentSessionId || !sessionActive) return;
            String text = extractBestMatch(partialResults);
            if (!text.isEmpty()) {
                lastInterimText = text;
                lastSpeechActivityMs = SystemClock.elapsedRealtime();
                emitPartial(listenerSessionId, text);
            }
        }

        @Override
        public void onSegmentResults(@NonNull Bundle segmentResults) {
            if (listenerSessionId != currentSessionId || !sessionActive) return;
            String text = extractBestMatch(segmentResults);
            if (!text.isEmpty()) {
                emitFinalAndClearInterim(listenerSessionId, text);
            }
        }

        @Override
        public void onEndOfSegmentedSession() {
            if (listenerSessionId != currentSessionId || !sessionActive) return;
            if (!lastInterimText.isEmpty()) {
                emitFinalAndClearInterim(listenerSessionId, lastInterimText);
            }
            scheduleRestart(listenerSessionId, 180L, false, false);
        }

        @Override
        public void onResults(Bundle results) {
            if (listenerSessionId != currentSessionId || !sessionActive) return;
            String text = extractBestMatch(results);
            if (!text.isEmpty()) {
                emitFinalAndClearInterim(listenerSessionId, text);
            } else if (!lastInterimText.isEmpty()) {
                emitFinalAndClearInterim(listenerSessionId, lastInterimText);
            }
            scheduleRestart(listenerSessionId, 180L, false, false);
        }

        @Override
        public void onError(int error) {
            if (listenerSessionId != currentSessionId || !sessionActive) return;

            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                lastInterimText = "";
                sessionActive = false;
                cancelPendingRestart();
                teardownRecognizerInternal();
                releaseAudioFocusInternal();
                setKeepScreenOn(false);
                emitError(
                    listenerSessionId,
                    "permission_denied",
                    "Permiso de micrófono requerido para dictar.",
                    true
                );
                emitState(listenerSessionId, "paused", "error");
                return;
            }

            if (
                error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ||
                error == SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT
            ) {
                if (usingOnDeviceRecognizer && !triedFallbackFromOnDevice) {
                    triedFallbackFromOnDevice = true;
                    scheduleRestart(listenerSessionId, 180L, true, true);
                    return;
                }
                lastInterimText = "";
                sessionActive = false;
                cancelPendingRestart();
                teardownRecognizerInternal();
                releaseAudioFocusInternal();
                setKeepScreenOn(false);
                emitError(
                    listenerSessionId,
                    "offline_language_unavailable",
                    "Falta descargar el paquete de voz offline en español (es-ES) en los ajustes de Google/Android.",
                    true
                );
                emitState(listenerSessionId, "paused", "error");
                return;
            }

            if (!lastInterimText.isEmpty()) {
                emitFinalAndClearInterim(listenerSessionId, lastInterimText);
            }

            if (
                error == SpeechRecognizer.ERROR_NO_MATCH ||
                error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
            ) {
                long silentMs = SystemClock.elapsedRealtime() - lastSpeechActivityMs;
                if (silentMs >= SILENCE_INACTIVITY_TIMEOUT_MS) {
                    pauseSessionInternal("inactivity_timeout");
                    return;
                }
                scheduleRestart(listenerSessionId, 350L, false, triedFallbackFromOnDevice);
                return;
            }

            consecutiveHardErrors += 1;
            if (consecutiveHardErrors >= MAX_CONSECUTIVE_HARD_ERRORS) {
                emitError(
                    listenerSessionId,
                    "recognizer_error_" + error,
                    "El micrófono se pausó tras varias interrupciones del sistema.",
                    false
                );
                pauseSessionInternal("error");
                return;
            }

            long backoffMs = 350L * consecutiveHardErrors;
            scheduleRestart(listenerSessionId, backoffMs, true, triedFallbackFromOnDevice);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    }
}
