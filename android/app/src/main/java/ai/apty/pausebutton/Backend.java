package ai.apty.pausebutton;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;

import org.json.JSONObject;

/** Talks to the Pause Button server (the same API the web app uses). Call from a background thread. */
public final class Backend {
    private Backend() {}

    public static final class Result {
        public final int status;
        public final String body;
        /** The server's Retry-After (sent with a 429) in ms, or -1. */
        public final long retryAfterMs;

        Result(int status, String body, long retryAfterMs) {
            this.status = status;
            this.body = body;
            this.retryAfterMs = retryAfterMs;
        }

        public boolean ok() {
            return status >= 200 && status < 300;
        }

        /** The server's plain-language error, when it sent one. */
        public String error() {
            try {
                return new JSONObject(body).optString("error", "Server said " + status);
            } catch (Exception e) {
                return "Server said " + status;
            }
        }
    }

    public static Result post(String host, String path, String token, JSONObject body) throws IOException {
        return send("POST", host, path, token, body, Collections.emptyMap());
    }

    /** With extra request headers: an Idempotency-Key, or the WebView's Cookie for a family member's decision. */
    public static Result post(String host, String path, String token, JSONObject body, Map<String, String> headers) throws IOException {
        return send("POST", host, path, token, body, headers);
    }

    public static Result get(String host, String path, String token) throws IOException {
        return send("GET", host, path, token, null, Collections.emptyMap());
    }

    private static Result send(String method, String host, String path, String token, JSONObject body, Map<String, String> headers) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(host + path).openConnection();
        try {
            c.setConnectTimeout(10_000);
            c.setReadTimeout(20_000);
            c.setRequestMethod(method);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "PauseButton-Android/" + BuildConfig.VERSION_NAME);
            if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
            for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            return new Result(status, in == null ? "" : readAll(in), retryAfterMs(c.getHeaderField("Retry-After")));
        } finally {
            c.disconnect();
        }
    }

    /** Retry-After in seconds (the server never sends the date form). */
    static long retryAfterMs(String header) {
        if (header == null) return -1;
        try {
            return Math.max(0, Long.parseLong(header.trim())) * 1000;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
}
