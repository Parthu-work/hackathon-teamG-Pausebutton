package ai.apty.pausebutton;

import java.io.BufferedReader;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Pause Button's API as far as the phone sees it, on the device's own
 * loopback: answers what a test scripts per path (200 "{}" otherwise) and
 * records every request. One request per connection, like the app's.
 * Bodies are read as characters: the tests send ASCII only.
 */
final class StubServer implements Closeable {
    static final class Request {
        final String method;
        final String path;
        final String authorization;
        /** The Idempotency-Key header, or null. */
        final String idempotencyKey;
        final String body;

        Request(String method, String path, String authorization, String idempotencyKey, String body) {
            this.method = method;
            this.path = path;
            this.authorization = authorization;
            this.idempotencyKey = idempotencyKey;
            this.body = body;
        }
    }

    private final ServerSocket socket;
    private final Map<String, ArrayDeque<String[]>> scripted = new HashMap<>();
    private final List<Request> requests = new ArrayList<>();

    StubServer() throws IOException {
        socket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(this::serve, "stub-server");
        t.setDaemon(true);
        t.start();
    }

    String url() {
        return "http://127.0.0.1:" + socket.getLocalPort();
    }

    /** The next request to {@code path} gets this answer. */
    synchronized StubServer respond(String path, int status, String body) {
        scripted.computeIfAbsent(path, p -> new ArrayDeque<>()).add(new String[] {String.valueOf(status), body});
        return this;
    }

    synchronized List<Request> requests(String path) {
        List<Request> out = new ArrayList<>();
        for (Request r : requests) if (r.path.equals(path)) out.add(r);
        return out;
    }

    /** Every request so far, in order, as "POST /api/device/inbox". */
    synchronized List<String> calls() {
        List<String> out = new ArrayList<>();
        for (Request r : requests) out.add(r.method + " " + r.path);
        return out;
    }

    /** Waits (at most 10 s) until {@code call} ("GET /api/device/status") has been made {@code times} times. */
    void await(String call, int times) throws InterruptedException {
        long until = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < until) {
            int n = 0;
            for (String c : calls()) if (c.equals(call)) n++;
            if (n >= times) return;
            Thread.sleep(20);
        }
    }

    /** An address where nothing listens: the phone sees "no network" there. */
    static String deadUrl() throws IOException {
        try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            return "http://127.0.0.1:" + s.getLocalPort();
        }
    }

    @Override
    public void close() throws IOException {
        socket.close();
    }

    private void serve() {
        while (!socket.isClosed()) {
            try (Socket s = socket.accept()) {
                handle(s);
            } catch (IOException e) {
                // Closed, or a client gave up: go on until closed.
            }
        }
    }

    private void handle(Socket s) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        String[] line = in.readLine().split(" ");
        int length = 0;
        String authorization = null;
        String idempotencyKey = null;
        for (String h; (h = in.readLine()) != null && !h.isEmpty(); ) {
            String lower = h.toLowerCase(Locale.ROOT);
            if (lower.startsWith("content-length:")) length = Integer.parseInt(h.substring(15).trim());
            if (lower.startsWith("authorization:")) authorization = h.substring(14).trim();
            if (lower.startsWith("idempotency-key:")) idempotencyKey = h.substring(16).trim();
        }
        char[] body = new char[length];
        int read = 0;
        while (read < length) {
            int n = in.read(body, read, length - read);
            if (n < 0) break;
            read += n;
        }
        String[] answer;
        synchronized (this) {
            requests.add(new Request(line[0], line[1], authorization, idempotencyKey, new String(body, 0, read)));
            ArrayDeque<String[]> q = scripted.get(line[1]);
            answer = q == null || q.isEmpty() ? new String[] {"200", "{}"} : q.poll();
        }
        byte[] out = answer[1].getBytes(StandardCharsets.UTF_8);
        OutputStream os = s.getOutputStream();
        os.write(("HTTP/1.1 " + answer[0] + " X\r\nContent-Type: application/json\r\nContent-Length: " + out.length
                + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        os.write(out);
        os.flush();
    }
}
