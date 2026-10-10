package ai.apty.pausebutton;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * After a reboot or an app update, Android binds the notification listener
 * again by itself on most phones, but not on all. This asks for it, so the
 * watcher comes back and sends what waited in the outbox, and makes sure the
 * 30-minute sync is scheduled.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        if (Prefs.token(context) == null) return;
        SyncWorker.schedule(context);
        if (!Prefs.consented(context)) return;
        MessageWatcherService.requestRebindQuietly(context);
        Watcher.get(context).kick();
    }
}
