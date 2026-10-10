package ai.apty.pausebutton;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

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
        Uri.Builder page = new Uri.Builder().path("/share");
        if (text != null && !text.trim().isEmpty()) page.appendQueryParameter("text", text.trim());
        page.appendQueryParameter("from", fromApp());
        Intent open = new Intent(this, MainActivity.class).putExtra(MainActivity.EXTRA_URL, page.build().toString());
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(open);
        finish();
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
