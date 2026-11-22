package es.obralocal.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    private static final int MAX_REDIRECTS = 5;
    private static final int MAX_MANIFEST_BYTES = 64 * 1024;
    private static final String USER_AGENT = "GestorAutonomo-Android-Updater";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            PackageInfo info = readInstalledPackageInfo();
            long versionCode = extractVersionCode(info);
            String versionName = info.versionName != null ? info.versionName : "1.0.0";

            JSObject ret = new JSObject();
            ret.put("versionCode", versionCode);
            ret.put("versionName", versionName);
            ret.put("packageName", getContext().getPackageName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo leer la versión instalada: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        String manifestUrl = call.getString("manifestUrl");
        if (!isHttpsUrl(manifestUrl)) {
            call.reject("La URL del manifiesto de actualización debe usar HTTPS.");
            return;
        }

        executor.execute(() -> {
            HttpsURLConnection conn = null;
            try {
                conn = openHttpsConnection(manifestUrl.trim(), 8000, 10000);
                String jsonBody = readUtf8Bounded(conn.getInputStream(), MAX_MANIFEST_BYTES);
                JSONObject obj = new JSONObject(jsonBody);

                if (!obj.has("versionCode") || !obj.has("versionName") || !obj.has("apkUrl")) {
                    call.reject("El manifiesto version.json está incompleto.");
                    return;
                }

                long remoteVersionCode = obj.getLong("versionCode");
                String remoteVersionName = obj.getString("versionName").trim();
                String apkUrl = obj.getString("apkUrl").trim();
                if (remoteVersionCode <= 0 || remoteVersionName.isEmpty() || !isHttpsUrl(apkUrl)) {
                    call.reject("El manifiesto version.json contiene campos inválidos.");
                    return;
                }

                String sha256 = obj.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
                String releaseNotes = obj.optString("releaseNotes", "").trim();
                boolean mandatory = obj.optBoolean("mandatory", false);

                PackageInfo info = readInstalledPackageInfo();
                long installedVersionCode = extractVersionCode(info);
                String installedVersionName = info.versionName != null ? info.versionName : "1.0.0";

                JSObject ret = new JSObject();
                ret.put("available", remoteVersionCode > installedVersionCode);
                ret.put("installedVersionCode", installedVersionCode);
                ret.put("installedVersionName", installedVersionName);
                ret.put("remoteVersionCode", remoteVersionCode);
                ret.put("remoteVersionName", remoteVersionName);
                ret.put("apkUrl", apkUrl);
                ret.put("sha256", sha256);
                ret.put("releaseNotes", releaseNotes);
                ret.put("mandatory", mandatory);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("No se pudo comprobar si hay actualizaciones: " + e.getMessage(), e);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        if (!isHttpsUrl(apkUrl)) {
            call.reject("La URL de descarga del APK debe usar HTTPS.");
            return;
        }
        String rawSha = call.getString("sha256", "");
        final String expectedSha256 = rawSha != null ? rawSha.trim().toLowerCase(Locale.ROOT) : "";

        executor.execute(() -> {
            HttpsURLConnection conn = null;
            try {
                Context context = getContext();
                File updatesDir = new File(context.getCacheDir(), "apk-updates");
                if (!updatesDir.exists() && !updatesDir.mkdirs()) {
                    call.reject("No se pudo preparar la carpeta de caché para el APK.");
                    return;
                }

                File finalApk = new File(updatesDir, "obralocal-update.apk");
                File tempApk = new File(updatesDir, "obralocal-update.apk.part");

                boolean needsDownload = true;
                if (finalApk.exists() && finalApk.isFile() && !expectedSha256.isEmpty()) {
                    String cachedSha = computeFileSha256(finalApk);
                    if (expectedSha256.equals(cachedSha)) {
                        needsDownload = false;
                        long len = finalApk.length();
                        emitProgress(100, len, len);
                    }
                }

                if (needsDownload) {
                    if (tempApk.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        tempApk.delete();
                    }

                    conn = openHttpsConnection(apkUrl.trim(), 15000, 30000);
                    long totalBytes = conn.getContentLengthLong();
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    byte[] buffer = new byte[16 * 1024];
                    long downloaded = 0;
                    int lastPercent = -1;
                    long lastEmitMs = 0;

                    try (
                        InputStream in = conn.getInputStream();
                        FileOutputStream out = new FileOutputStream(tempApk)
                    ) {
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            out.write(buffer, 0, read);
                            digest.update(buffer, 0, read);
                            downloaded += read;

                            int percent = totalBytes > 0
                                ? (int) Math.min(99L, (downloaded * 100L) / totalBytes)
                                : 0;
                            long now = System.currentTimeMillis();
                            if (now - lastEmitMs >= 150 || (totalBytes > 0 && percent - lastPercent >= 2)) {
                                emitProgress(percent, downloaded, totalBytes);
                                lastEmitMs = now;
                                lastPercent = percent;
                            }
                        }
                        out.getFD().sync();
                    }

                    String actualSha256 = toHex(digest.digest());
                    if (!expectedSha256.isEmpty() && !expectedSha256.equals(actualSha256)) {
                        //noinspection ResultOfMethodCallIgnored
                        tempApk.delete();
                        call.reject("El archivo descargado no coincide con la firma SHA-256 esperada.");
                        return;
                    }

                    if (finalApk.exists() && !finalApk.delete()) {
                        call.reject("No se pudo reemplazar el paquete APK temporal anterior.");
                        return;
                    }
                    if (!tempApk.renameTo(finalApk)) {
                        call.reject("No se pudo guardar el APK descargado.");
                        return;
                    }

                    emitProgress(100, downloaded, totalBytes > 0 ? totalBytes : downloaded);
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !context.getPackageManager().canRequestPackageInstalls()) {
                    Intent permIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + context.getPackageName())
                    );
                    permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(permIntent);

                    JSObject ret = new JSObject();
                    ret.put("status", "permission_required");
                    call.resolve(ret);
                    return;
                }

                Uri apkUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    finalApk
                );
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
                );
                context.startActivity(installIntent);

                JSObject ret = new JSObject();
                ret.put("status", "installer_launched");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Error descargando o iniciando la instalación: " + e.getMessage(), e);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }

    private PackageInfo readInstalledPackageInfo() throws PackageManager.NameNotFoundException {
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0));
        }
        return pm.getPackageInfo(pkg, 0);
    }

    private long extractVersionCode(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return info.getLongVersionCode();
        }
        //noinspection deprecation
        return info.versionCode;
    }

    private static boolean isHttpsUrl(String url) {
        if (url == null) return false;
        return url.trim().toLowerCase(Locale.ROOT).startsWith("https://");
    }

    private static HttpsURLConnection openHttpsConnection(
        String initialUrl,
        int connectTimeoutMs,
        int readTimeoutMs
    ) throws IOException {
        String currentUrl = initialUrl;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            if (!isHttpsUrl(currentUrl)) {
                throw new IOException("Solo se permiten conexiones HTTPS.");
            }
            URL url = new URL(currentUrl);
            URLConnection rawConn = url.openConnection();
            if (!(rawConn instanceof HttpsURLConnection)) {
                throw new IOException("Conexión no HTTPS rechazada.");
            }
            HttpsURLConnection conn = (HttpsURLConnection) rawConn;
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(connectTimeoutMs);
            conn.setReadTimeout(readTimeoutMs);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", USER_AGENT);
            conn.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*");

            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307
                || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.trim().isEmpty()) {
                    throw new IOException("Redirección HTTPS inválida sin cabecera Location.");
                }
                URL next = new URL(url, location);
                currentUrl = next.toString();
                continue;
            }

            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new IOException("Respuesta HTTP inesperada (" + code + ").");
            }
            return conn;
        }
        throw new IOException("Demasiadas redirecciones al consultar la actualización.");
    }

    private static String readUtf8Bounded(InputStream in, int maxBytes) throws IOException {
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int total = 0;
            int n;
            while ((n = stream.read(buf)) != -1) {
                total += n;
                if (total > maxBytes) {
                    throw new IOException("El manifiesto version.json supera el tamaño permitido.");
                }
                out.write(buf, 0, n);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String computeFileSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[16 * 1024];
        try (FileInputStream fis = new FileInputStream(file)) {
            int n;
            while ((n = fis.read(buf)) != -1) {
                digest.update(buf, 0, n);
            }
        }
        return toHex(digest.digest());
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
    }

    private void emitProgress(int percent, long downloadedBytes, long totalBytes) {
        JSObject data = new JSObject();
        data.put("percent", percent);
        data.put("downloadedBytes", downloadedBytes);
        data.put("totalBytes", totalBytes);
        notifyListeners("downloadProgress", data);
    }
}
