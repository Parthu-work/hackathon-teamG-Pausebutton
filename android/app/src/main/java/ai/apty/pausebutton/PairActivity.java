package ai.apty.pausebutton;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
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

import androidx.core.app.NotificationManagerCompat;

import java.text.DateFormat;
import java.util.Date;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONObject;

/**
 * "Connect this phone" (screens M2 and M3). Opened from the web app's
 * pausebutton://pair?code=…&host=… link, or from the app drawer. Trades the
 * pairing code for this phone's token, then helps the person allow
 * notification access and background running, and shows whether it works.
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
    }

    /** pausebutton://pair?code=ABC123&host=https://… from the web app. */
    private void readLink(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data == null) return;
        String code = data.getQueryParameter("code");
        String host = data.getQueryParameter("host");
        if (host != null && !host.isEmpty()) hostField.setText(host);
        if (code != null && !code.isEmpty()) {
            codeField.setText(code);
            connect();
        }
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
            String message;
            try {
                JSONObject body = new JSONObject().put("code", code).put("name", Build.MANUFACTURER + " " + Build.MODEL);
                Backend.Result r = Backend.post(host, "/api/device/pair", null, body);
                if (r.ok()) {
                    JSONObject json = new JSONObject(r.body);
                    Prefs.setHost(this, host);
                    Prefs.setPaired(this, json.getString("token"), json.optString("userName", ""));
                    message = null;
                } else {
                    message = r.error();
                }
            } catch (Exception e) {
                message = "Could not reach " + host + ": " + e.getMessage();
            }
            final String error = message;
            runOnUiThread(() -> {
                connectButton.setEnabled(true);
                if (error != null) status.setText(error);
                refresh();
                reportListener();
            });
        });
    }

    private void disconnect() {
        Prefs.clearPairing(this);
        codeField.setText("");
        refresh();
    }

    /** Tells the server whether notification access is on, so the web app can show it. */
    private void reportListener() {
        final String token = Prefs.token(this);
        if (token == null) return;
        final boolean on = listenerEnabled();
        io.execute(() -> {
            try {
                Backend.post(Prefs.host(this), "/api/device/status", token, new JSONObject().put("listenerOn", on));
            } catch (Exception ignored) {
                // Shown on the next refresh through lastError if messages fail too.
            }
        });
    }

    private boolean listenerEnabled() {
        return NotificationManagerCompat.getEnabledListenerPackages(this).contains(getPackageName());
    }

    private boolean batteryUnrestricted() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
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

        boolean on = listenerEnabled();
        watcherStatus.setText(on ? "✓  Notification access is on" : "!  Notification access is off");
        watcherStatus.setTextColor(on ? 0xFF1F6B49 : 0xFFB3291E);
        allowButton.setText(on ? "Notification access settings" : "Allow notification access");

        boolean battery = batteryUnrestricted();
        batteryStatus.setText(battery ? "✓  Allowed to run in the background" : "!  The phone may stop the watcher to save battery");
        batteryStatus.setTextColor(battery ? 0xFF1F6B49 : 0xFFB3291E);
        batteryButton.setVisibility(battery ? View.GONE : View.VISIBLE);

        int delivered = Prefs.delivered(this);
        String error = Prefs.lastError(this);
        StringBuilder d = new StringBuilder();
        if (delivered > 0) {
            d.append(delivered).append(delivered == 1 ? " message sent" : " messages sent");
            d.append(", last at ").append(DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(Prefs.lastDeliveredAt(this))));
        } else {
            d.append("No message sent yet. Send yourself any SMS to test.");
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
        allowButton = button("Allow notification access", true, v -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        root.addView(allowButton);
        root.addView(text("Find “Pause Button” in the list and switch it on. Android shows a warning: that is normal for any app that reads notifications.", 14, false, 0xFF55626E));

        batteryStatus = text("", 16, true, 0xFF14202B);
        root.addView(batteryStatus);
        batteryButton = button("Allow running in background", false, v -> {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
            startActivity(i);
        });
        root.addView(batteryButton);

        root.addView(text("Messages", 13, true, 0xFF55626E));
        deliveryStatus = text("", 15, false, 0xFF14202B);
        root.addView(deliveryStatus);

        openButton = button("Open Pause Button", true, v -> startActivity(new Intent(this, LauncherActivity.class)));
        root.addView(openButton);
        disconnectButton = button("Disconnect this phone", false, v -> disconnect());
        root.addView(disconnectButton);

        TextView foot = text("This app only reads new message notifications and sends them to Pause Button to be checked. It never reads old chats or sends messages.", 13, false, 0xFF55626E);
        foot.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(foot);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
    }
}
