package ai.apty.pausebutton;

import android.content.Context;
import android.content.SharedPreferences;

/** What the app remembers: where the web app lives, and this phone's connection to it. */
public final class Prefs {
    private static final String FILE = "pause_button";

    private Prefs() {}

    private static SharedPreferences get(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** The web app's address; the build's default until the person connects to another host. */
    public static String host(Context c) {
        String h = get(c).getString("host", null);
        return (h == null || h.isEmpty()) ? BuildConfig.DEFAULT_HOST : h;
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

    static String trimSlash(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
}
