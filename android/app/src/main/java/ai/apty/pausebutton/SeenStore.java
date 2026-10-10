package ai.apty.pausebutton;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Messages already handled, so the same one is not sent twice: chat apps post
 * a message's notification again with every new message, and Android can show
 * them again after a restart. Kept in a file, so a restart of the service or
 * the phone does not re-send. Only a salted hash of each message is stored,
 * never its sender or text: the salt is this install's own, so the hashes
 * cannot be matched against anything outside the phone.
 */
public final class SeenStore {
    /** The same message within this time is a repeat. */
    public static final long WINDOW_MS = 10 * 60 * 1000L;
    public static final int MAX = 200;

    private final File file;
    private final String salt;
    /** hash → when it was last seen; oldest first. */
    private final LinkedHashMap<String, Long> seen = new LinkedHashMap<>(64, 0.75f, true);

    public SeenStore(File file, String salt) {
        this.file = file;
        this.salt = salt;
        load();
    }

    /** True the first time a message shows up within {@link #WINDOW_MS}; it is then remembered. */
    public synchronized boolean firstTime(String app, String sender, String text, long now) {
        prune(now);
        String key = hash(app, sender, text);
        Long at = seen.get(key);
        if (at != null && now - at < WINDOW_MS) return false;
        seen.put(key, now);
        while (seen.size() > MAX) {
            Iterator<String> eldest = seen.keySet().iterator();
            eldest.next();
            eldest.remove();
        }
        save();
        return true;
    }

    public synchronized void clear() {
        seen.clear();
        save();
    }

    public synchronized int size() {
        return seen.size();
    }

    private void prune(long now) {
        seen.values().removeIf(at -> now - at >= WINDOW_MS);
    }

    private String hash(String app, String sender, String text) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            d.update((salt + '\u0000' + app + '\u0000' + sender + '\u0000' + text).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : d.digest()) hex.append(String.format("%02x", b));
            return hex.substring(0, 32);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private void load() {
        seen.clear();
        if (!file.exists()) return;
        try {
            JSONObject o = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
            // Oldest first, so the access order (and what is dropped first) survives the restart.
            List<Map.Entry<String, Long>> rows = new ArrayList<>();
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String k = it.next();
                rows.add(new AbstractMap.SimpleEntry<>(k, o.getLong(k)));
            }
            rows.sort(Map.Entry.comparingByValue());
            for (Map.Entry<String, Long> r : rows) seen.put(r.getKey(), r.getValue());
        } catch (IOException | JSONException | RuntimeException e) {
            seen.clear();
            file.delete();
        }
    }

    private void save() {
        try {
            JSONObject o = new JSONObject();
            for (Map.Entry<String, Long> e : seen.entrySet()) o.put(e.getKey(), (long) e.getValue());
            Files.createDirectories(file.getAbsoluteFile().getParentFile().toPath());
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(o.toString().getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
            if (!tmp.renameTo(file)) throw new IOException("rename failed");
        } catch (IOException | JSONException e) {
            // Still remembered in memory; a restart may then let one repeat through.
        }
    }
}
