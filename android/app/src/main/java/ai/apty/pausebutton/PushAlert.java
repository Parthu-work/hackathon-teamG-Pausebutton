package ai.apty.pausebutton;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One push message from the server, as the app reads it. It arrives through
 * Firebase as data only, every value a string: title, body, url, tag, urgent
 * ("1" or "0"), kind, alertId, checkId, holdId, who, at, receipt, and actions
 * (a JSON list of {action: "block" | "fine", title}). Same fields and same
 * rules as public/sw.js, which shows them in a browser. Plain Java (no
 * Android), so the rules are tested on the JVM.
 */
public final class PushAlert {
    /** A button on the notification: "block" (Block payment) or "fine" (It's fine). */
    public static final class Action {
        public final String action;
        public final String title;

        Action(String action, String title) {
            this.action = action;
            this.title = title;
        }
    }

    /** A notification the app shows after Block on the lock screen: what it says, where a tap goes, its one button. */
    public static final class Notice {
        public final String title;
        public final String body;
        public final String url;
        /** "Call Papa", "Open", or null for none. */
        public final String button;

        Notice(String title, String body, String url, String button) {
            this.title = title;
            this.body = body;
            this.url = url;
            this.button = button;
        }
    }

    /**
     * The longest page address the app opens: room for a whole shared message
     * in English, well within what the server takes in one request line.
     */
    public static final int MAX_PATH = 8000;

    /** Ids go into paths (/family/hold/<holdId>): letters, digits, - and _ only. */
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,80}");

    public final String title;
    public final String body;
    /** Where a tap goes: a page of the app's own site. */
    public final String url;
    /** A newer notification with the same tag replaces the older one. */
    public final String tag;
    public final boolean urgent;
    public final String kind;
    public final String alertId;
    public final String checkId;
    /** The paused payment the buttons act on, or null. */
    public final String holdId;
    /** Who the alert is about ("Papa"), for "Papa's phone now shows …". */
    public final String who;
    /** When it happened (epoch ms), or 0. */
    public final long at;
    /** The delivery id the receipt quotes, or null. */
    public final String receipt;
    /** At most two, and only with a paused payment to act on. */
    public final List<Action> actions;

    private PushAlert(Map<String, String> data) {
        title = text(data, "title", "Pause Button");
        body = text(data, "body", "");
        url = isAppPath(data.get("url")) ? data.get("url") : "/family";
        tag = text(data, "tag", "pause-button");
        urgent = "1".equals(data.get("urgent")) || "true".equals(data.get("urgent"));
        kind = text(data, "kind", null);
        alertId = id(data.get("alertId"));
        checkId = id(data.get("checkId"));
        holdId = id(data.get("holdId"));
        who = text(data, "who", "");
        at = time(data.get("at"));
        receipt = text(data, "receipt", null);
        actions = holdId == null ? Collections.emptyList() : actions(data.get("actions"));
    }

    public static PushAlert from(Map<String, String> data) {
        return new PushAlert(data == null ? Collections.emptyMap() : data);
    }

    /** The Android notification id that goes with the tag (the tag and the id together name one notification). */
    public int notificationId() {
        return tag.hashCode();
    }

    /** What POST /api/push/receipt expects: this push arrived, and whether it is on screen (else why not). */
    public JSONObject receiptBody(boolean shown, String error) throws JSONException {
        return new JSONObject().put("id", receipt).put("shown", shown).put("error", error == null ? JSONObject.NULL : error);
    }

    /**
     * Only a page of the app's own site: a path such as "/open/123" or
     * "/family/hold/9?approve=1", already URL-encoded. Never another site
     * ("//evil.example"), another scheme, the API, spaces or backslashes.
     */
    public static boolean isAppPath(String path) {
        if (path == null || path.length() > MAX_PATH || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/api/")) return false;
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c <= ' ' || c >= 0x7f || c == '\\') return false;
        }
        return true;
    }

    /** After Block on the lock screen: "You blocked it", or why not. Worded as public/sw.js (blockFromLockScreen). */
    public static Notice blocked(String holdId, String who, boolean ok, String responseBody) {
        String name = who == null || who.isEmpty() ? "Papa" : who;
        if (ok) {
            return new Notice("You blocked it", name + "'s phone now shows “Payment cancelled”. Nothing left the account.",
                    "/family/hold/" + holdId + "?call=1", "Call " + name);
        }
        String error = serverError(responseBody);
        return new Notice("Could not block it", error != null ? error : "Open Pause Button to block the payment.", "/family/hold/" + holdId, "Open");
    }

    /** Block on the lock screen, but the server could not be reached. */
    public static Notice unreachable(String holdId) {
        return new Notice("Could not reach Pause Button", "Open the app to block the payment. The money stays paused meanwhile.", "/family/hold/" + holdId, null);
    }

    static boolean isId(String s) {
        return s != null && ID.matcher(s).matches();
    }

    private static String id(String s) {
        return isId(s) ? s : null;
    }

    private static String text(Map<String, String> data, String key, String fallback) {
        String s = data.get(key);
        return s == null || s.isEmpty() ? fallback : s;
    }

    /** sw.js reads "at" with Date.parse: an ISO time; epoch ms also works. */
    private static long time(String s) {
        if (s == null || s.isEmpty()) return 0;
        try {
            return s.matches("\\d+") ? Long.parseLong(s) : Instant.parse(s).toEpochMilli();
        } catch (NumberFormatException | DateTimeParseException e) {
            return 0;
        }
    }

    private static List<Action> actions(String json) {
        List<Action> out = new ArrayList<>();
        if (json == null || json.isEmpty()) return out;
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length() && out.size() < 2; i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                String action = o.optString("action", "");
                String title = o.optString("title", "");
                if (("block".equals(action) || "fine".equals(action)) && !title.isEmpty()) out.add(new Action(action, title));
            }
        } catch (JSONException e) {
            // No buttons: a tap still opens the alert.
        }
        return out;
    }

    private static String serverError(String body) {
        try {
            String error = new JSONObject(body).optString("error", "");
            return error.isEmpty() ? null : error;
        } catch (JSONException | RuntimeException e) {
            return null;
        }
    }
}
