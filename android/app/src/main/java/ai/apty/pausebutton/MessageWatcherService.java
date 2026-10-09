package ai.apty.pausebutton;

import android.app.Notification;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONObject;

/**
 * Screens M1–M4 in real life: once the person allows notification access, this
 * service sees every new SMS and WhatsApp notification and sends its text to
 * the server, which checks it like a pasted message and warns the family.
 * It never reads old chats and never sends anything itself.
 */
public class MessageWatcherService extends NotificationListenerService {
    private static final Set<String> WHATSAPP = new HashSet<>(Arrays.asList("com.whatsapp", "com.whatsapp.w4b"));
    private static final Set<String> SMS = new HashSet<>(Arrays.asList(
            "com.google.android.apps.messaging", // Google Messages
            "com.samsung.android.messaging",     // Samsung Messages
            "com.android.mms", "com.android.messaging",
            "com.oneplus.mms", "com.miui.sms", "com.sonymobile.android.mms"));
    private static final long DEDUPE_MS = 10 * 60 * 1000L;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final LinkedHashMap<String, Long> seen = new LinkedHashMap<String, Long>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
            return size() > 200;
        }
    };

    @Override
    public void onListenerConnected() {
        Prefs.setListenerConnected(this, true);
        report(true);
    }

    @Override
    public void onListenerDisconnected() {
        Prefs.setListenerConnected(this, false);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String channel = channelFor(sbn.getPackageName());
        if (channel == null) return;
        Notification n = sbn.getNotification();
        if (n == null || n.extras == null) return;
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return; // "3 new messages", not a message

        Bundle ex = n.extras;
        String sender = str(ex.getCharSequence(Notification.EXTRA_TITLE));
        String text = str(ex.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (text.isEmpty()) text = str(ex.getCharSequence(Notification.EXTRA_TEXT));

        // Chat-style notifications carry the messages themselves: use the newest one.
        Parcelable[] messages = ex.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (messages != null && messages.length > 0 && messages[messages.length - 1] instanceof Bundle) {
            Bundle last = (Bundle) messages[messages.length - 1];
            String t = str(last.getCharSequence("text"));
            String s = str(last.getCharSequence("sender"));
            if (!t.isEmpty()) text = t;
            if (sender.isEmpty() && !s.isEmpty()) sender = s;
        }
        if (sender.isEmpty() || text.isEmpty() || looksLikeSummary(text)) return;

        String key = sbn.getPackageName() + "|" + sender + "|" + text;
        synchronized (seen) {
            Long at = seen.get(key);
            long now = System.currentTimeMillis();
            if (at != null && now - at < DEDUPE_MS) return;
            seen.put(key, now);
        }
        final String ch = channel, from = sender, body = text;
        final boolean fromContact = !looksLikeNumber(sender); // a saved contact shows a name, a stranger a number
        io.execute(() -> deliver(ch, from, fromContact, body));
    }

    private String channelFor(String pkg) {
        if (WHATSAPP.contains(pkg)) return "whatsapp";
        if (SMS.contains(pkg)) return "sms";
        // Debug builds also accept notifications posted from `adb shell cmd notification post`, for testing.
        if (BuildConfig.DEBUG && "com.android.shell".equals(pkg)) return "sms";
        return null;
    }

    private void deliver(String channel, String sender, boolean fromContact, String text) {
        String token = Prefs.token(this);
        if (token == null) {
            Prefs.setLastError(this, "This phone is not connected yet");
            return;
        }
        try {
            JSONObject body = new JSONObject()
                    .put("channel", channel)
                    .put("sender", sender)
                    .put("fromContact", fromContact)
                    .put("text", text);
            Backend.Result r = Backend.post(Prefs.host(this), "/api/device/inbox", token, body);
            if (r.ok()) Prefs.recordDelivered(this);
            else if (r.status == 401) Prefs.setLastError(this, "Disconnected: connect this phone again");
            else Prefs.setLastError(this, r.error());
        } catch (Exception e) {
            Prefs.setLastError(this, "Could not reach the server: " + e.getMessage());
        }
    }

    /** Tells the server whether notification access is on (shown on the Connect screen). */
    private void report(boolean on) {
        String token = Prefs.token(this);
        if (token == null) return;
        io.execute(() -> {
            try {
                Backend.post(Prefs.host(this), "/api/device/status", token, new JSONObject().put("listenerOn", on));
            } catch (Exception ignored) {
                // Best effort: the next message will try again.
            }
        });
    }

    static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }

    static boolean looksLikeNumber(String sender) {
        String digits = sender.replaceAll("[\\s()+\\-.]", "");
        return digits.matches("\\d{8,}") || sender.contains("XXXX");
    }

    static boolean looksLikeSummary(String text) {
        return text.matches("(?i)^\\d+ new messages?.*") || text.matches("(?i)^\\d+ messages? from .*");
    }
}
