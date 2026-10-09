package ai.apty.pausebutton;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

/** Talks to the Pause Button server (the same API the web app uses). Call from a background thread. */
public final class Backend {
    private Backend() {}

    public static final class Result {
        public final int status;
        public final String body;

        Result(int status, String body) {
            this.status = status;
            this.body = body;
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
        return send("POST", host, path, token, body);
    }

    public static Result get(String host, String path, String token) throws IOException {
        return send("GET", host, path, token, null);
    }

    private static Result send(String method, String host, String path, String token, JSONObject body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(host + path).openConnection();
        try {
            c.setConnectTimeout(10_000);
            c.setReadTimeout(20_000);
            c.setRequestMethod(method);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "PauseButton-Android/" + BuildConfig.VERSION_NAME);
            if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            return new Result(status, in == null ? "" : readAll(in));
        } finally {
            c.disconnect();
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
