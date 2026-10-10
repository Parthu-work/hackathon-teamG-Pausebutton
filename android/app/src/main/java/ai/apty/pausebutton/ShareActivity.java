package ai.apty.pausebutton;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/**
 * F1 · Forward to Pause: no copy, no paste. "Pause Button" appears in the
 * phone's Share sheet (WhatsApp, Messages, any app that shares text). The
 * shared text is handed to the web app's /share page, in the app, which
 * checks it at once and opens the verdict. The app it came from is passed
 * along so the verdict can say "Forwarded from WhatsApp".
 */
public class ShareActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        String text = intent != null ? intent.getStringExtra(Intent.EXTRA_TEXT) : null;
        String subject = intent != null ? intent.getStringExtra(Intent.EXTRA_SUBJECT) : null;
        if ((text == null || text.trim().isEmpty()) && subject != null) text = subject;
        Intent open = new Intent(this, MainActivity.class).putExtra(MainActivity.EXTRA_URL, page(text, fromApp()));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(open);
        finish();
    }

    /**
     * "/share?text=…&from=…". A very long message is cut to fit the longest
     * page the app opens ({@link PushAlert#MAX_PATH}; in Hindi or Telugu each
     * letter takes 9 characters here), so its start is still checked instead
     * of the app opening on its home screen.
     */
    static String page(String text, String from) {
        String query = "from=" + encode(from);
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) return "/share?" + query;
        String path = "/share?text=" + encode(t) + "&" + query;
        while (path.length() > PushAlert.MAX_PATH) {
            int keep = Math.min(t.length() - 1, (int) ((long) t.length() * PushAlert.MAX_PATH / path.length()));
            if (keep > 0 && Character.isHighSurrogate(t.charAt(keep - 1))) keep--; // never half a letter
            t = t.substring(0, keep);
            path = "/share?text=" + encode(t) + "&" + query;
        }
        return path;
    }

    /** As encodeURIComponent does it (a space is %20), which the page decodes. (The Charset overload needs Android 13.) */
    private static String encode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e); // every Java has UTF-8
        }
    }

    /** The app that shared the text, from the referrer Android attaches ("android-app://com.whatsapp"). */
    private String fromApp() {
        Uri referrer = getReferrer();
        String pkg = referrer != null && "android-app".equals(referrer.getScheme()) ? referrer.getHost() : null;
        if (pkg == null) return "other";
        if (pkg.startsWith("com.whatsapp")) return "whatsapp";
        if (pkg.contains("messaging") || pkg.contains("mms") || pkg.contains("sms")) return "sms";
        if (pkg.contains("telegram")) return "telegram";
        return "other";
    }
}
