package ai.apty.pausebutton;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * Every 30 minutes while the phone is connected and online, even with the
 * app closed: the watcher's sync (send what waits, fetch the person's
 * settings, tell the server the phone is alive). The live path does the real
 * work; this catches what it missed. Scheduled when the phone is connected,
 * after a reboot and whenever the app starts; cancelled when it is
 * disconnected, here or on the web app.
 */
public class SyncWorker extends Worker {
    /** WorkManager's name for it: one schedule per phone, whoever asks for it. */
    static final String NAME = "pb-sync";
    static final long EVERY_MINUTES = 30;

    public SyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        Sync.Outcome outcome = Watcher.get(c).syncNow(Watcher.listenerEnabled(c));
        // No network after all: WorkManager tries again with its backoff. Anything else waits for the next period.
        return outcome == Sync.Outcome.OFFLINE ? Result.retry() : Result.success();
    }

    /** Starts the schedule, or keeps the one already running (its timing stays). */
    static void schedule(Context c) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(SyncWorker.class, EVERY_MINUTES, TimeUnit.MINUTES)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void cancel(Context c) {
        WorkManager.getInstance(c).cancelUniqueWork(NAME);
    }
}
