package ai.apty.pausebutton;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Before notification access: what the watcher reads, what leaves the phone
 * and what is kept, in plain words, with a clear yes or no. Only "I agree"
 * turns the watcher on (Prefs.consentAt); until then it reads nothing, even
 * if notification access was switched on in Android's settings directly.
 * Google Play asks for this "prominent disclosure" for notification access.
 */
public class ConsentActivity extends Activity {
    static final String[][] SECTIONS = {
            {"What Pause Button reads",
                    "Only new notifications from your SMS app and WhatsApp: who sent the message (a name or a number) and its text. "
                            + "Nothing from other apps, no old chats, no contact list."},
            {"What leaves this phone",
                    "For each new message from someone who is not a saved contact, the sender and the text go to Pause Button over an encrypted connection, to be checked. "
                            + "Messages from saved contacts stay on this phone while “Only unknown senders” is on, and so do messages from an app you chose not to watch "
                            + "(Pause Button › Settings › Watch my messages)."},
            {"What this phone keeps",
                    "The connection to your Pause Button account, today’s counts, and a scrambled fingerprint of recent messages so none is sent twice (not their text). "
                            + "A message that cannot be sent because there is no internet waits on this phone, in the app’s private storage: at most 50, each deleted once sent or after a day."},
            {"What Pause Button keeps",
                    "The verdict and the warning phrases of each check. Everything it keeps, and for how long, is listed in Pause Button under Settings › What we keep."},
            {"You can stop at any time",
                    "Disconnect this phone in Pause Button (Settings › Watch my messages). "
                            + "Switching off notification access in Android’s settings stops all reading."},
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFF7F5F0);
        root.setPadding(dp(20), dp(24), dp(20), dp(32));

        root.addView(text("Pause Button", 14, true, 0xFF55626E));
        root.addView(text("Before Pause Button reads your messages", 26, true, 0xFF14202B));
        for (String[] s : SECTIONS) {
            root.addView(text(s[0], 17, true, 0xFF14202B));
            root.addView(text(s[1], 16, false, 0xFF14202B));
        }
        root.addView(text("Next, Android shows a warning that Pause Button can read all notifications. It looks only at SMS and WhatsApp.", 14, false, 0xFF55626E));
        if (MessageWatcherService.mayBeRestricted(this)) {
            root.addView(text("If the switch is greyed out or Android says “Restricted setting”: open Pause Button’s App info, tap ⋮ at the top right, "
                    + "then “Allow restricted settings”, and switch it on again.", 14, false, 0xFF55626E));
        }

        root.addView(button("I agree, allow notification access", true, () -> {
            Prefs.setConsent(this, System.currentTimeMillis());
            openAccessSettings();
            finish();
        }));
        root.addView(button("Not now", false, this::finish));

        ScrollView scroll = new ScrollView(this);
        // Android 15+ draws every screen of this app edge to edge: keep clear of the status and navigation bars.
        scroll.setFitsSystemWindows(true);
        scroll.addView(root);
        setContentView(scroll);
    }

    private void openAccessSettings() {
        try {
            startActivity(MessageWatcherService.accessSettings(this));
        } catch (ActivityNotFoundException e) {
            startActivity(MessageWatcherService.accessList());
        }
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView text(String s, int sp, boolean bold, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(6), 0, dp(6));
        return t;
    }

    private Button button(String label, boolean primary, Runnable onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setMinHeight(dp(56));
        b.setBackgroundColor(primary ? 0xFF14202B : 0xFFFFFFFF);
        b.setTextColor(primary ? Color.WHITE : 0xFF14202B);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> onClick.run());
        return b;
    }
}
