package ai.apty.pausebutton;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.io.File;
import java.io.IOException;
import java.util.Random;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The message watcher's working parts, one set per app process: the outbox,
 * what was already seen, the rate gate, and the courier that takes messages
 * to the server. Shared by the notification listener, the Connect screen and
 * the boot receiver. All file and network work runs on one background thread,
 * in the order it was asked for.
 */
final class Watcher {
    /** How old the person's watch settings may get before the phone asks again. */
    private static final long RULES_MAX_AGE_MS = 60 * 60 * 1000L;
    private static final String NOTICE_CHANNEL = "watcher";
    private static final int NOTICE_DISCONNECTED = 1;

    private static Watcher instance;

    static synchronized Watcher get(Context c) {
        if (instance == null) instance = new Watcher(c.getApplicationContext());
        return instance;
    }

    /**
     * A new set, read back from the files, as after the app's process was
     * killed and started again. For tests.
     */
    static synchronized Watcher restart(Context c) {
        if (instance != null) {
            instance.io.shutdownNow();
            try {
                // Let a send in progress finish writing before anyone reads the files again.
                instance.io.awaitTermination(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        instance = new Watcher(c.getApplicationContext());
        return instance;
    }

    private final Context app;
    final Outbox outbox;
    final SeenStore seen;
    private final RateGate gate = new RateGate();
    private final Courier courier;
    private final ScheduledExecutorService io = Executors.newSingleThreadScheduledExecutor();
    private ScheduledFuture<?> nextFlush;

    private Watcher(Context app) {
        this.app = app;
        // Not backed up: message text must not leave the phone through a backup.
        File dir = app.getNoBackupFilesDir();
        outbox = new Outbox(new File(dir, "outbox.json"));
        seen = new SeenStore(new File(dir, "seen.json"), Prefs.seenSalt(app));
        courier = new Courier(outbox, this::send, events, new Random());
    }

    /**
     * A new SMS or WhatsApp message notification. It is counted, and it leaves
     * the phone only if the person agreed, the phone is connected, the app is
     * watched, the sender is not a saved contact (when only unknown senders are
     * checked), it is not a repeat, and a busy chat has not used up its room.
     */
    void onMessage(String pkg, String channel, String sender, String text) {
        io.execute(() -> {
            if (!Prefs.consented(app)) return; // nothing is read before the person agreed
            long now = System.currentTimeMillis();
            if (!seen.firstTime(pkg, sender, text, now)) {
                Prefs.count(app, DayCounts.REPEAT, 1);
                return;
            }
            Prefs.count(app, DayCounts.SEEN, 1);
            if (Prefs.token(app) == null) {
                Prefs.setLastError(app, "This phone is not connected yet");
                return;
            }
            String skip = Prefs.watchRules(app).skipReason(channel, sender);
            if (skip != null) {
                Prefs.count(app, skip, 1);
                return;
            }
            if (!gate.allow(sender, now)) {
                Prefs.count(app, DayCounts.BUSY, 1);
                return;
            }
            int dropped = outbox.add(channel, sender, WatchRules.isSavedContact(channel, sender), text, now);
            if (dropped > 0) Prefs.count(app, DayCounts.DROPPED, dropped);
            schedule(courier.retryNow(now));
        });
    }

    /**
     * The network is back, the app was opened, the listener (re)connected:
     * send what waits now, finish a disconnect the server has not heard yet,
     * and refresh the person's settings when they are old.
     */
    void kick() {
        io.execute(() -> {
            revokePending();
            if (Prefs.token(app) != null && System.currentTimeMillis() - Prefs.watchRulesAt(app) > RULES_MAX_AGE_MS) refreshRules();
            schedule(courier.retryNow(System.currentTimeMillis()));
        });
    }

    /** Tells the server whether notification access is on, and learns the person's watch settings. */
    void reportStatus(boolean listenerOn) {
        io.execute(() -> {
            String token = Prefs.token(app);
            if (token == null) return;
            try {
                Backend.Result r = Backend.post(Prefs.host(app), "/api/device/status", token, new JSONObject().put("listenerOn", listenerOn));
                if (r.ok()) Prefs.saveWatchRules(app, r.body);
                else if (r.status == 401) disconnected();
            } catch (IOException | JSONException e) {
                // Best effort: the next kick or message tries again.
            }
        });
    }

    /**
     * "Connect" with the code from the web app. Runs on the caller's thread
     * (the Connect screen's own); returns null when connected, else the
     * reason in plain words. Whatever an earlier connection left waiting is
     * dropped: it belongs to whoever connected before.
     */
    String pair(String host, String code, String deviceName) {
        try {
            JSONObject body = new JSONObject().put("code", code).put("name", deviceName);
            Backend.Result r = Backend.post(host, "/api/device/pair", null, body);
            if (!r.ok()) return r.error();
            JSONObject json = new JSONObject(r.body);
            Prefs.setHost(app, host);
            Prefs.setPaired(app, json.getString("token"), json.optString("userName", ""));
            outbox.clear();
            return null;
        } catch (IOException | JSONException e) {
            return "Could not reach " + host + ": " + e.getMessage();
        }
    }

    /**
     * "Disconnect this phone": forget the connection here at once (and drop
     * whatever waits), then tell the server, now or as soon as it can be
     * reached, so the web app forgets the phone too.
     */
    void disconnect(Runnable done) {
        io.execute(() -> {
            String token = Prefs.token(app);
            Prefs.clearPairing(app);
            outbox.clear();
            seen.clear();
            if (token != null) Prefs.setPendingRevoke(app, token);
            revokePending();
            if (done != null) done.run();
        });
    }

    /** Blocks until the work asked for so far is done. For tests. */
    void awaitIdle() throws InterruptedException {
        try {
            io.submit(() -> { }).get();
        } catch (ExecutionException e) {
            throw new IllegalStateException(e);
        }
    }

    int waiting() {
        return outbox.size();
    }

    // ---------------------------------------------------------------- on the io thread

    private void schedule(long at) {
        if (nextFlush != null) nextFlush.cancel(false);
        nextFlush = null;
        if (at < 0) return;
        long delay = Math.max(0, at - System.currentTimeMillis());
        nextFlush = io.schedule(() -> schedule(courier.flush(System.currentTimeMillis())), delay, TimeUnit.MILLISECONDS);
    }

    private Courier.Reply send(Outbox.Entry e) throws IOException {
        String token = Prefs.token(app);
        if (token == null) return new Courier.Reply(401, "", -1);
        try {
            Backend.Result r = Backend.post(Prefs.host(app), "/api/device/inbox", token, e.body());
            return new Courier.Reply(r.status, r.body, r.retryAfterMs);
        } catch (JSONException bad) {
            return new Courier.Reply(400, "", -1);
        }
    }

    private void refreshRules() {
        try {
            Backend.Result r = Backend.get(Prefs.host(app), "/api/device/status", Prefs.token(app));
            if (r.ok()) Prefs.saveWatchRules(app, r.body);
            else if (r.status == 401) disconnected();
        } catch (IOException e) {
            // Keep the last known settings.
        }
    }

    private void revokePending() {
        String token = Prefs.pendingRevoke(app);
        if (token == null) return;
        try {
            Backend.Result r = Backend.post(Prefs.host(app), "/api/device/disconnect", token, new JSONObject());
            // Done, or the server had already forgotten the phone.
            if (r.ok() || r.status == 401) Prefs.setPendingRevoke(app, null);
        } catch (IOException e) {
            // Kept: the next kick (the network coming back) tries again.
        }
    }

    /** The server no longer knows this phone (removed on the web app): unpair, drop what waits, and say so. */
    private void disconnected() {
        boolean wasConnected = Prefs.token(app) != null;
        Prefs.clearPairing(app);
        outbox.clear();
        seen.clear();
        Prefs.setLastError(app, "This phone was disconnected from Pause Button. Open the app to connect it again.");
        if (wasConnected) noticeDisconnected();
    }

    private final Courier.Events events = new Courier.Events() {
        @Override
        public void delivered(Outbox.Entry message, Courier.Reply reply) {
            Prefs.count(app, DayCounts.SENT, 1);
            Prefs.recordDelivered(app);
            Prefs.saveWatchRules(app, reply.body);
        }

        @Override
        public void unpaired(Courier.Reply reply) {
            disconnected();
        }

        @Override
        public void rejected(Outbox.Entry message, Courier.Reply reply) {
            Prefs.count(app, DayCounts.DROPPED, 1);
            Prefs.setLastError(app, "A message could not be checked (" + reply.status + ") and was dropped.");
        }

        @Override
        public void failed(String why) {
            Prefs.setLastError(app, why);
        }

        @Override
        public void expired(int count) {
            Prefs.count(app, DayCounts.DROPPED, count);
        }
    };

    /** A notification the person sees even with the app closed: the watcher stopped, and why. */
    private void noticeDisconnected() {
        NotificationManager nm = app.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(NOTICE_CHANNEL, "Message watcher", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(app, PairActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(app, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(app, NOTICE_CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Pause Button stopped checking messages")
                .setContentText("This phone was disconnected. Tap to connect it again.")
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build();
        try {
            nm.notify(NOTICE_DISCONNECTED, n);
        } catch (SecurityException e) {
            // Notifications not allowed (Android 13+): the Connect screen still says so.
        }
    }

    /** The phone's own name, for the web app's list ("Google Pixel 8"). */
    static String deviceName() {
        return Build.MANUFACTURER + " " + Build.MODEL;
    }
}
