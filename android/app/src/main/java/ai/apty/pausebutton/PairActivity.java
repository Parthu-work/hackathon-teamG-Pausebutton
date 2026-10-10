package ai.apty.pausebutton;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.DateFormat;
import java.util.Date;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Connect this phone" (screens M2 and M3) for a pairing link opened outside
 * the app: the web app's pausebutton://pair?code=…&host=… link, tapped in a
 * browser or scanned. (Inside the app, the web app's own Connect screen does
 * the same through PauseButtonNativePlugin.) Trades the pairing code for this
 * phone's token, then helps the person agree to what the watcher does
 * (ConsentActivity), allow notification access and background running, and
 * shows what it saw today.
 */
public class PairActivity extends Activity {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private TextView status, watcherStatus, batteryStatus, deliveryStatus;
    private EditText hostField, codeField;
    private Button connectButton, disconnectButton, allowButton, batteryButton, openButton;
    private LinearLayout pairingBox;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        readLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readLink(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        reportListener();
        // Access is on but Android has not bound the listener (after an update, or killed on some phones): ask again.
        if (Prefs.consented(this) && Watcher.listenerEnabled(this) && !Prefs.listenerConnected(this)) MessageWatcherService.requestRebindQuietly(this);
        Watcher.get(this).kick();
    }

    /**
     * pausebutton://pair?code=ABC123&host=https://… from the web app: fills in
     * the code (and the address), and the person taps Connect. Anyone can send
     * such a link, so it never connects by itself, never replaces a connection,
     * and says so when it names another server than this app's own site: a
     * link in a scammer's message must not quietly send this phone's messages
     * (OTPs included) to someone else.
     */
    private void readLink(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data == null) return;
        if (Prefs.token(this) != null) return; // already connected: "Disconnect this phone" first
        String code = data.getQueryParameter("code");
        String host = data.getQueryParameter("host");
        if (host != null && !host.isEmpty()) hostField.setText(host);
        if (code != null && !code.isEmpty()) codeField.setText(code);
        status.setText(knownHost(host, Prefs.site(), Prefs.host(this))
                ? "Tap Connect to let Pause Button check this phone's messages."
                : "This link is for " + host + ", not " + Prefs.site() + ". Tap Connect only if you trust it.");
    }

    /** A link's host is the app's own site or the person's earlier choice (no host: the address field keeps theirs). */
    static boolean knownHost(String linkHost, String site, String chosen) {
        if (linkHost == null || linkHost.trim().isEmpty()) return true;
        String host = Prefs.trimSlash(linkHost.trim());
        return host.equalsIgnoreCase(Prefs.trimSlash(site)) || host.equalsIgnoreCase(Prefs.trimSlash(chosen));
    }

    private void connect() {
        final String host = Prefs.trimSlash(hostField.getText().toString().trim());
        final String code = codeField.getText().toString().trim().toUpperCase();
        if (host.isEmpty() || code.length() < 4) {
            status.setText("Type the address of Pause Button and the code shown on the phone you are protecting.");
            return;
        }
        connectButton.setEnabled(false);
        status.setText("Connecting…");
        io.execute(() -> {
            final String error = Watcher.get(this).pair(host, code, Watcher.deviceName());
            runOnUiThread(() -> {
                connectButton.setEnabled(true);
                if (error != null) status.setText(error);
                refresh();
                reportListener();
            });
        });
    }

    /** Here and on the web app at once: the server forgets the phone (now, or once it can be reached). */
    private void disconnect() {
        codeField.setText("");
        Watcher.get(this).disconnect(() -> runOnUiThread(this::refresh));
    }

    /** Tells the server whether notification access is on (the web app shows it), and learns the watch settings. */
    private void reportListener() {
        Watcher.get(this).reportStatus(Watcher.listenerEnabled(this));
    }

    /** Agreeing comes first; after that this opens Android's notification access settings. */
    private void allowAccess() {
        if (!Prefs.consented(this)) startActivity(new Intent(this, ConsentActivity.class));
        else startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
    }

    private void refresh() {
        boolean paired = Prefs.token(this) != null;
        String who = Prefs.userName(this);
        pairingBox.setVisibility(paired ? View.GONE : View.VISIBLE);
        disconnectButton.setVisibility(paired ? View.VISIBLE : View.GONE);
        if (paired) {
            status.setText("Connected to " + Prefs.host(this) + (who == null || who.isEmpty() ? "" : " as " + who) + ".");
        } else if (status.getText().length() == 0 || status.getText().toString().startsWith("Connected")) {
            status.setText("On the phone you are protecting, open Settings › Watch my messages › Connect this phone, then tap the link or type the code here.");
        }

        boolean on = Watcher.listenerEnabled(this);
        boolean agreed = Prefs.consented(this);
        watcherStatus.setText(!agreed ? (on ? "!  Paused: read what Pause Button does and agree first" : "!  Not watching yet")
                : on ? "✓  Notification access is on" : "!  Notification access is off");
        watcherStatus.setTextColor(agreed && on ? 0xFF1F6B49 : 0xFFB3291E);
        allowButton.setText(!agreed ? "See what is read, and agree" : on ? "Notification access settings" : "Allow notification access");

        boolean battery = Watcher.batteryUnrestricted(this);
        batteryStatus.setText(battery ? "✓  Allowed to run in the background" : "!  The phone may stop the watcher to save battery");
        batteryStatus.setTextColor(battery ? 0xFF1F6B49 : 0xFFB3291E);
        batteryButton.setVisibility(battery ? View.GONE : View.VISIBLE);

        // "What we saw today": counts only, never senders or text.
        String error = Prefs.lastError(this);
        StringBuilder d = new StringBuilder(Prefs.today(this).describe(Watcher.get(this).waiting()));
        if (Prefs.lastDeliveredAt(this) > 0) {
            d.append("\nLast sent at ").append(DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(Prefs.lastDeliveredAt(this))));
        } else if (paired) {
            d.append("\nSend yourself any SMS to test.");
        }
        if (error != null) d.append("\nLast problem: ").append(error);
        deliveryStatus.setText(d);
    }

    // ---------------------------------------------------------------- UI

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

    private Button button(String label, boolean primary, View.OnClickListener onClick) {
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
        b.setOnClickListener(onClick);
        return b;
    }

    private EditText field(String hint, int inputType) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setInputType(inputType);
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        e.setSingleLine(true);
        e.setPadding(dp(12), dp(14), dp(12), dp(14));
        e.setBackgroundColor(Color.WHITE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        e.setLayoutParams(lp);
        return e;
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFF7F5F0);
        root.setPadding(dp(20), dp(24), dp(20), dp(32));

        root.addView(text("Pause Button", 14, true, 0xFF55626E));
        root.addView(text("Connect this phone", 28, true, 0xFF14202B));
        status = text("", 16, false, 0xFF14202B);
        root.addView(status);

        pairingBox = new LinearLayout(this);
        pairingBox.setOrientation(LinearLayout.VERTICAL);
        pairingBox.addView(text("Pause Button address", 13, true, 0xFF55626E));
        hostField = field("https://…", InputType.TYPE_TEXT_VARIATION_URI);
        hostField.setText(Prefs.host(this));
        pairingBox.addView(hostField);
        pairingBox.addView(text("Code from the other phone", 13, true, 0xFF55626E));
        codeField = field("e.g. 7KQ2MX", InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        pairingBox.addView(codeField);
        connectButton = button("Connect", true, v -> connect());
        pairingBox.addView(connectButton);
        root.addView(pairingBox);

        root.addView(text("Watching messages", 13, true, 0xFF55626E));
        watcherStatus = text("", 16, true, 0xFF14202B);
        root.addView(watcherStatus);
        allowButton = button("Allow notification access", true, v -> allowAccess());
        root.addView(allowButton);
        root.addView(text("Find “Pause Button” in the list and switch it on. Android shows a warning: that is normal for any app that reads notifications.", 14, false, 0xFF55626E));

        batteryStatus = text("", 16, true, 0xFF14202B);
        root.addView(batteryStatus);
        batteryButton = button("Allow running in background", false, v -> {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
            startActivity(i);
        });
        root.addView(batteryButton);

        root.addView(text("What we saw today", 13, true, 0xFF55626E));
        deliveryStatus = text("", 15, false, 0xFF14202B);
        root.addView(deliveryStatus);

        openButton = button("Open Pause Button", true, v -> startActivity(new Intent(this, MainActivity.class)));
        root.addView(openButton);
        disconnectButton = button("Disconnect this phone", false, v -> disconnect());
        root.addView(disconnectButton);

        TextView foot = text("This app only reads new SMS and WhatsApp notifications and sends them to Pause Button to be checked. It never reads old chats or sends messages.", 13, false, 0xFF55626E);
        foot.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(foot);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
    }
}
