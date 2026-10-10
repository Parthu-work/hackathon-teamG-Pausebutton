package ai.apty.pausebutton;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;

import java.io.IOException;
import java.util.Collections;
import java.util.Map;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * F2 · Block payment from the lock screen: no unlock, no app. The family
 * member's own sign-in (the WebView's cookie for the site) blocks the paused
 * payment, then a notification says "You blocked it", or why not, worded as
 * public/sw.js does in a browser. ("It's fine" opens the app on the approve
 * step instead, since approving always needs a second confirm.)
 */
public class NotificationActionReceiver extends BroadcastReceiver {
    static final String ACTION_BLOCK = "ai.apty.pausebutton.action.BLOCK";
    private static final String EXTRA_HOLD = "holdId";
    private static final String EXTRA_WHO = "who";
    private static final String EXTRA_TAG = "tag";

    /** The Block button of the alert with {@code tag} about the paused payment {@code holdId}. */
    static PendingIntent block(Context c, String holdId, String who, String tag) {
        Intent i = new Intent(c, NotificationActionReceiver.class)
                .setAction(ACTION_BLOCK)
                .putExtra(EXTRA_HOLD, holdId)
                .putExtra(EXTRA_WHO, who)
                .putExtra(EXTRA_TAG, tag);
        return PendingIntent.getBroadcast(c, (tag + "|block").hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_BLOCK.equals(intent.getAction())) return;
        String holdId = intent.getStringExtra(EXTRA_HOLD);
        if (!PushAlert.isId(holdId)) return;
        String who = intent.getStringExtra(EXTRA_WHO);
        Alerts.cancel(context, intent.getStringExtra(EXTRA_TAG));
        String site = Prefs.site();
        String cookie;
        try {
            cookie = CookieManager.getInstance().getCookie(site);
        } catch (RuntimeException e) {
            cookie = null; // the WebView is being updated: the server answers "sign in", and the notice says to open the app
        }
        Map<String, String> headers = cookie == null ? Collections.emptyMap() : Collections.singletonMap("Cookie", cookie);
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject().put("decision", "block").put("confirm", false);
                Backend.Result r = Backend.post(site, "/api/family/holds/" + holdId + "/decision", null, body, headers);
                Alerts.notice(app, holdId, PushAlert.blocked(holdId, who, r.ok(), r.body));
            } catch (IOException | JSONException e) {
                Alerts.notice(app, holdId, PushAlert.unreachable(holdId));
            } finally {
                pending.finish();
            }
        }, "pb-block").start();
    }
}
