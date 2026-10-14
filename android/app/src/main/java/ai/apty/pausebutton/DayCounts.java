package ai.apty.pausebutton;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * "What we saw today" on the Connect screen: how many message notifications
 * the watcher read today and what became of each. Counts only, no senders
 * and no text. Starts again at midnight (the phone's own time).
 */
public final class DayCounts {
    /** Read: a message notification from a watched app. */
    public static final String SEEN = "seen";
    /** Sent to Pause Button to be checked. */
    public static final String SENT = "sent";
    /** From a saved contact, and only unknown senders are checked: stayed on the phone. */
    public static final String CONTACT = "contact";
    /** From an app that is not watched (SMS or WhatsApp switched off): stayed on the phone. */
    public static final String OFF = "off";
    /** The same message again (a chat app re-posts its notification): not sent twice. */
    public static final String REPEAT = "repeat";
    /** Too many at once (a busy group chat): skipped. */
    public static final String BUSY = "busy";
    /** Could not be sent within a day, or the server refused it: dropped. */
    public static final String DROPPED = "dropped";

    // Why a message stayed on the phone, for the Connect screen (Prefs.lastSkip); not counted.
    /** The person has not agreed on the consent screen: nothing is read. */
    public static final String NO_CONSENT = "noconsent";
    /** No device token: the phone was never connected, or was disconnected. */
    public static final String UNPAIRED = "unpaired";
    /** The notification had no sender or no text to read. */
    public static final String NO_TEXT = "notext";

    /**
     * The Connect screen's line for the last message that did not leave the
     * phone, and why, in plain words. Never the sender or the text.
     */
    public static String whyNotSent(String reason, String channel) {
        String app = "whatsapp".equals(channel) ? "WhatsApp" : "SMS";
        switch (reason) {
            case NO_CONSENT: return "Not read: message reading was not agreed to on this phone yet";
            case UNPAIRED: return "Not sent: this phone is not connected yet";
            case REPEAT: return "Seen again, not sent twice: the same message was already handled";
            case CONTACT: return "Not sent: from a saved contact, and only unknown senders are checked";
            case OFF: return "Not sent: " + app + " is switched off in Watch my messages";
            case BUSY: return "Not sent: too many messages at once from one chat";
            case NO_TEXT: return "Not read: the " + app + " notification showed no sender or text";
            default: return "Not sent: " + reason;
        }
    }

    private final String day;
    private final Map<String, Integer> counts;

    private DayCounts(String day, Map<String, Integer> counts) {
        this.day = day;
        this.counts = counts;
    }

    /** Today's counts from what was saved; a saved yesterday starts again from zero. */
    public static DayCounts load(String saved, String today) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        try {
            if (saved != null) {
                JSONObject o = new JSONObject(saved);
                if (today.equals(o.optString("day"))) {
                    JSONObject c = o.getJSONObject("counts");
                    for (Iterator<String> it = c.keys(); it.hasNext(); ) {
                        String k = it.next();
                        counts.put(k, c.getInt(k));
                    }
                }
            }
        } catch (JSONException e) {
            counts.clear();
        }
        return new DayCounts(today, counts);
    }

    public DayCounts add(String what, int n) {
        Map<String, Integer> next = new LinkedHashMap<>(counts);
        next.put(what, get(what) + n);
        return new DayCounts(day, next);
    }

    public int get(String what) {
        Integer n = counts.get(what);
        return n == null ? 0 : n;
    }

    public String day() {
        return day;
    }

    public String save() {
        try {
            JSONObject c = new JSONObject();
            for (Map.Entry<String, Integer> e : counts.entrySet()) c.put(e.getKey(), (int) e.getValue());
            return new JSONObject().put("day", day).put("counts", c).toString();
        } catch (JSONException e) {
            return null;
        }
    }

    /** The Connect screen's lines: only what happened, in plain words. */
    public String describe(int waiting) {
        StringBuilder s = new StringBuilder();
        int seen = get(SEEN);
        s.append(seen == 0 ? "No messages read today." : seen + (seen == 1 ? " message read today" : " messages read today"));
        line(s, get(SENT), "sent to Pause Button to be checked");
        line(s, waiting, "waiting for the internet");
        line(s, get(CONTACT), "from saved contacts, not sent");
        line(s, get(OFF), "from apps you are not watching, not sent");
        line(s, get(REPEAT), "repeats, not sent again");
        line(s, get(BUSY), "skipped: too many at once");
        line(s, get(DROPPED), "could not be checked and were dropped");
        return s.toString();
    }

    private static void line(StringBuilder s, int n, String what) {
        if (n > 0) s.append("\n· ").append(n).append(' ').append(what);
    }
}
