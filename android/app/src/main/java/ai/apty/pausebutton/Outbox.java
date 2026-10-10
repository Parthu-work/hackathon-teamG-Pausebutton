package ai.apty.pausebutton;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Messages the watcher saw but has not sent yet (no network, server busy).
 * They wait in a file in the app's private storage, so a restart or a flat
 * battery loses nothing, and go out oldest first once the server can be
 * reached. At most {@link #MAX} wait (beyond that the oldest is dropped) and
 * none for longer than {@link #MAX_AGE_MS}: a day-old warning helps nobody,
 * and message text should not sit on the phone. Each message keeps the id it
 * got when it was seen through every retry and restart, so the server can
 * tell a retry from a new message and checks each one once.
 */
public final class Outbox {
    public static final int MAX = 50;
    public static final long MAX_AGE_MS = 24 * 60 * 60 * 1000L;

    /** One waiting message. */
    public static final class Entry {
        /** A random UUID, the same on every try: the message's Idempotency-Key. */
        public final String id;
        public final String channel;
        public final String sender;
        public final boolean fromContact;
        public final String text;
        /** When the phone saw it. */
        public final long seenAt;
        /** Failed attempts so far (for the backoff). */
        public final int attempts;
        /** Not before this time (epoch ms): the backoff after a failure. */
        public final long nextAttemptAt;

        Entry(String id, String channel, String sender, boolean fromContact, String text, long seenAt, int attempts, long nextAttemptAt) {
            this.id = id;
            this.channel = channel;
            this.sender = sender;
            this.fromContact = fromContact;
            this.text = text;
            this.seenAt = seenAt;
            this.attempts = attempts;
            this.nextAttemptAt = nextAttemptAt;
        }

        /** What POST /api/device/inbox expects (messageId repeats the Idempotency-Key, for a proxy that drops headers). */
        public JSONObject body() throws JSONException {
            return new JSONObject().put("channel", channel).put("sender", sender).put("fromContact", fromContact).put("text", text).put("messageId", id);
        }

        /** Sent with every try of this message, so the server never checks one message twice. */
        public Map<String, String> headers() {
            return Collections.singletonMap("Idempotency-Key", id);
        }

        Entry retryAt(long at) {
            return new Entry(id, channel, sender, fromContact, text, seenAt, attempts + 1, at);
        }

        Entry dueAt(long at) {
            return new Entry(id, channel, sender, fromContact, text, seenAt, attempts, at);
        }

        JSONObject toJson() throws JSONException {
            return new JSONObject().put("id", id).put("channel", channel).put("sender", sender).put("fromContact", fromContact).put("text", text)
                    .put("seenAt", seenAt).put("attempts", attempts).put("nextAttemptAt", nextAttemptAt);
        }

        static Entry fromJson(JSONObject o) throws JSONException {
            return new Entry(o.getString("id"), o.getString("channel"), o.getString("sender"), o.optBoolean("fromContact", false),
                    o.getString("text"), o.getLong("seenAt"), o.optInt("attempts", 0), o.optLong("nextAttemptAt", 0));
        }
    }

    private final File file;
    /** Oldest first. */
    private final List<Entry> entries = new ArrayList<>();

    public Outbox(File file) {
        this.file = file;
        load();
    }

    /** Queues a message. Returns how many older ones were dropped to stay within {@link #MAX}. */
    public synchronized int add(String channel, String sender, boolean fromContact, String text, long now) {
        entries.add(new Entry(UUID.randomUUID().toString(), channel, sender, fromContact, text, now, 0, now));
        int dropped = 0;
        while (entries.size() > MAX) {
            entries.remove(0);
            dropped++;
        }
        save();
        return dropped;
    }

    /** The oldest waiting message, or null. */
    public synchronized Entry head() {
        return entries.isEmpty() ? null : entries.get(0);
    }

    public synchronized List<Entry> all() {
        return new ArrayList<>(entries);
    }

    public synchronized int size() {
        return entries.size();
    }

    public synchronized void remove(String id) {
        if (entries.removeIf(e -> e.id.equals(id))) save();
    }

    /** A failed attempt: try this one again at {@code at}. */
    public synchronized void retryAt(String id, long at) {
        for (int i = 0; i < entries.size(); i++) {
            if (entries.get(i).id.equals(id)) {
                entries.set(i, entries.get(i).retryAt(at));
                save();
                return;
            }
        }
    }

    /** The network is back (or a new message arrived): everything may be tried now. */
    public synchronized void dueNow(long now) {
        boolean changed = false;
        for (int i = 0; i < entries.size(); i++) {
            if (entries.get(i).nextAttemptAt > now) {
                entries.set(i, entries.get(i).dueAt(now));
                changed = true;
            }
        }
        if (changed) save();
    }

    /** Drops messages older than {@link #MAX_AGE_MS}. Returns how many. */
    public synchronized int expire(long now) {
        int before = entries.size();
        entries.removeIf(e -> now - e.seenAt > MAX_AGE_MS);
        int expired = before - entries.size();
        if (expired > 0) save();
        return expired;
    }

    /** The phone was disconnected: nothing it saw may go to the next person who connects it. */
    public synchronized void clear() {
        entries.clear();
        save();
    }

    private void load() {
        entries.clear();
        if (!file.exists()) return;
        try {
            JSONArray a = new JSONArray(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
            for (int i = 0; i < a.length(); i++) entries.add(Entry.fromJson(a.getJSONObject(i)));
        } catch (IOException | JSONException | RuntimeException e) {
            // A damaged file must not stop the watcher: start again empty.
            entries.clear();
            file.delete();
        }
    }

    /** Written to a temporary file first, then renamed: a crash mid-write leaves the old file intact. */
    private void save() {
        try {
            JSONArray a = new JSONArray();
            for (Entry e : entries) a.put(e.toJson());
            Files.createDirectories(file.getAbsoluteFile().getParentFile().toPath());
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(a.toString().getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
            if (!tmp.renameTo(file)) throw new IOException("rename failed");
        } catch (IOException | JSONException e) {
            // The messages stay in memory and go out while the app runs; only a restart would lose them.
        }
    }
}
