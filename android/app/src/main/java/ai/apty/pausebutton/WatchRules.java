package ai.apty.pausebutton;

import java.util.regex.Pattern;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the person chose on the web app (Settings › Watch my messages), so the
 * phone itself can leave out what is not to be checked: a message from an app
 * that is not watched, or from a saved contact when only unknown senders are
 * checked, never leaves the phone. The server applies the same rules again.
 */
public final class WatchRules {
    /** Until the server says otherwise: the web app's defaults. */
    public static final WatchRules DEFAULT = new WatchRules(true, true, true);

    public final boolean sms;
    public final boolean whatsapp;
    public final boolean unknownOnly;

    public WatchRules(boolean sms, boolean whatsapp, boolean unknownOnly) {
        this.sms = sms;
        this.whatsapp = whatsapp;
        this.unknownOnly = unknownOnly;
    }

    /** From the server's {@code settings}: watchSms, watchWhatsapp, unknownOnly. */
    public static WatchRules fromJson(JSONObject o) {
        if (o == null) return DEFAULT;
        return new WatchRules(o.optBoolean("watchSms", true), o.optBoolean("watchWhatsapp", true), o.optBoolean("unknownOnly", true));
    }

    public JSONObject toJson() throws JSONException {
        return new JSONObject().put("watchSms", sms).put("watchWhatsapp", whatsapp).put("unknownOnly", unknownOnly);
    }

    /** Why this message stays on the phone ("off" or "contact"), or null when it is to be checked. */
    public String skipReason(String channel, String sender) {
        if ("sms".equals(channel) ? !sms : !whatsapp) return "off";
        if (unknownOnly && isSavedContact(channel, sender)) return "contact";
        return null;
    }

    // Indian SMS sender headers: "VM-HDFCBK", "JD-ICICIT-S", or a bare "HDFCBK" (6 to 11
    // capitals; shorter all-caps names such as "PAPA" or "MUMMY" are left as contacts).
    private static final Pattern SMS_HEADER = Pattern.compile("^[A-Za-z]{2}-[A-Za-z0-9]{3,10}(-[A-Za-z])?$");
    private static final Pattern SMS_SHORT_ID = Pattern.compile("^[A-Z0-9]{6,11}$");

    /**
     * Whether a sender looks like one of the person's saved contacts. The
     * notification only shows a name for a saved contact; a stranger shows as
     * a number, as "~Name" (WhatsApp) or as an SMS header. A header is a
     * business, never a contact: bank-impersonation SMS come from those.
     */
    public static boolean isSavedContact(String channel, String sender) {
        String s = sender == null ? "" : sender.trim();
        if (s.isEmpty() || looksLikeNumber(s) || s.startsWith("~")) return false;
        if ("sms".equals(channel) && (SMS_HEADER.matcher(s).matches() || (SMS_SHORT_ID.matcher(s).matches() && s.matches(".*[A-Z].*")))) return false;
        return true;
    }

    static boolean looksLikeNumber(String sender) {
        String digits = sender.replaceAll("[\\s()+\\-.]", "");
        return digits.matches("\\d{5,}") || sender.contains("XXXX");
    }
}
