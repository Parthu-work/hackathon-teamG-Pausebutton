package ai.apty.pausebutton;

import android.content.Context;
import android.content.SharedPreferences;

import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import org.json.JSONException;
import org.json.JSONObject;

/** What the app remembers: where the web app lives, and this phone's connection to it. */
public final class Prefs {
    private static final String FILE = "pause_button";

    private Prefs() {}

    private static SharedPreferences get(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /**
     * The site the app shows (capacitor.config.ts server.url; the build checks
     * it equals PB_HOST). Push comes from it, a notification opens it, and the
     * WebView's sign-in cookie belongs to it.
     */
    public static String site() {
        return BuildConfig.DEFAULT_HOST;
    }

    /** Where the message watcher sends messages: the site, unless the phone was connected to another host. */
    public static String host(Context c) {
        String h = get(c).getString("host", null);
        return (h == null || h.isEmpty()) ? site() : h;
    }

    public static void setHost(Context c, String host) {
        get(c).edit().putString("host", trimSlash(host.trim())).apply();
    }

    public static String token(Context c) {
        return get(c).getString("token", null);
    }

    public static String userName(Context c) {
        return get(c).getString("userName", null);
    }

    public static void setPaired(Context c, String token, String userName) {
        get(c).edit().putString("token", token).putString("userName", userName).putString("lastError", null).apply();
    }

    public static void clearPairing(Context c) {
        get(c).edit().remove("token").remove("userName").remove("lastError").apply();
    }

    public static int delivered(Context c) {
        return get(c).getInt("delivered", 0);
    }

    public static long lastDeliveredAt(Context c) {
        return get(c).getLong("lastDeliveredAt", 0);
    }

    public static String lastError(Context c) {
        return get(c).getString("lastError", null);
    }

    public static void recordDelivered(Context c) {
        get(c).edit()
                .putInt("delivered", delivered(c) + 1)
                .putLong("lastDeliveredAt", System.currentTimeMillis())
                .putString("lastError", null)
                .apply();
    }

    public static void setLastError(Context c, String error) {
        get(c).edit().putString("lastError", error).apply();
    }

    public static boolean listenerConnected(Context c) {
        return get(c).getBoolean("listenerConnected", false);
    }

    public static void setListenerConnected(Context c, boolean on) {
        get(c).edit().putBoolean("listenerConnected", on).apply();
    }

    // ---------------------------------------------------------------- consent (W4)

    /** When the person agreed to the disclosure before notification access; 0 = not yet. */
    public static long consentAt(Context c) {
        return get(c).getLong("consentAt", 0);
    }

    public static boolean consented(Context c) {
        return consentAt(c) > 0;
    }

    public static void setConsent(Context c, long at) {
        get(c).edit().putLong("consentAt", at).apply();
    }

    // ---------------------------------------------------------------- what to watch

    /** The person's choices from the web app (SMS, WhatsApp, only unknown senders). */
    public static WatchRules watchRules(Context c) {
        String s = get(c).getString("watchRules", null);
        try {
            return s == null ? WatchRules.DEFAULT : WatchRules.fromJson(new JSONObject(s));
        } catch (JSONException e) {
            return WatchRules.DEFAULT;
        }
    }

    public static long watchRulesAt(Context c) {
        return get(c).getLong("watchRulesAt", 0);
    }

    /** From a server answer that carries {@code settings}; anything else is ignored. */
    public static void saveWatchRules(Context c, String responseBody) {
        try {
            JSONObject settings = new JSONObject(responseBody).optJSONObject("settings");
            if (settings == null) return;
            get(c).edit()
                    .putString("watchRules", WatchRules.fromJson(settings).toJson().toString())
                    .putLong("watchRulesAt", System.currentTimeMillis())
                    .apply();
        } catch (JSONException e) {
            // Keep the last known rules.
        }
    }

    // ---------------------------------------------------------------- dedup salt, today's counts

    /** This install's own salt for the message fingerprints in SeenStore. */
    public static synchronized String seenSalt(Context c) {
        String salt = get(c).getString("seenSalt", null);
        if (salt == null) {
            byte[] b = new byte[16];
            new SecureRandom().nextBytes(b);
            StringBuilder hex = new StringBuilder();
            for (byte x : b) hex.append(String.format("%02x", x));
            salt = hex.toString();
            get(c).edit().putString("seenSalt", salt).apply();
        }
        return salt;
    }

    public static DayCounts today(Context c) {
        return DayCounts.load(get(c).getString("dayCounts", null), new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()));
    }

    public static void count(Context c, String what, int n) {
        get(c).edit().putString("dayCounts", today(c).add(what, n).save()).apply();
    }

    // ---------------------------------------------------------------- the notification permission (Android 13+)

    /** Whether the app has asked for the permission before (a first dismissal is not a refusal). */
    public static boolean notificationsAsked(Context c) {
        return get(c).getBoolean("notificationsAsked", false);
    }

    public static void setNotificationsAsked(Context c) {
        get(c).edit().putBoolean("notificationsAsked", true).apply();
    }

    /** The person refused for good ("Don't allow" twice): the app never asks again, it only offers Android's settings. */
    public static boolean notificationsRefused(Context c) {
        return get(c).getBoolean("notificationsRefused", false);
    }

    public static void setNotificationsRefused(Context c, boolean refused) {
        get(c).edit().putBoolean("notificationsRefused", refused).apply();
    }

    // ---------------------------------------------------------------- a disconnect the server has not heard yet

    public static String pendingRevoke(Context c) {
        return get(c).getString("pendingRevoke", null);
    }

    public static void setPendingRevoke(Context c, String token) {
        get(c).edit().putString("pendingRevoke", token).apply();
    }

    static String trimSlash(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
}
