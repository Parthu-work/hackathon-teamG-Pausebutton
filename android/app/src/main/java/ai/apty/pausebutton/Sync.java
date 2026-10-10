package ai.apty.pausebutton;

import java.io.IOException;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The safety net under the live path, every 30 minutes ({@link SyncWorker}):
 * <ol>
 *   <li>send what waits in the outbox (even a message still in its backoff);</li>
 *   <li>GET /api/device/status: learn the person's watch settings again;</li>
 *   <li>POST /api/device/status {listenerOn, waiting, sync: true}: the phone is
 *       alive, this is how many messages still wait. The server records it,
 *       and flags a phone it has not heard from in an hour.</li>
 * </ol>
 * Plain Java (no Android), so the order is tested on the JVM; the watcher
 * runs it on its own thread.
 */
public final class Sync {
    /** The two status calls. Each saves the settings from a 2xx answer itself. */
    public interface Server {
        Courier.Reply getStatus() throws IOException;

        Courier.Reply postStatus(JSONObject body) throws IOException;
    }

    /** How a sync ended. */
    public enum Outcome {
        DONE,
        /** No network, or the server could not be reached: WorkManager tries again soon. */
        OFFLINE,
        /** The server no longer knows this phone (401). */
        UNPAIRED,
    }

    private final Courier courier;
    private final Outbox outbox;
    private final Server server;

    public Sync(Courier courier, Outbox outbox, Server server) {
        this.courier = courier;
        this.outbox = outbox;
        this.server = server;
    }

    public Outcome run(boolean listenerOn, long now) {
        courier.retryNow(now);
        try {
            if (server.getStatus().status == 401) return Outcome.UNPAIRED;
            if (server.postStatus(statusBody(listenerOn, outbox.size())).status == 401) return Outcome.UNPAIRED;
            return Outcome.DONE;
        } catch (IOException e) {
            return Outcome.OFFLINE;
        }
    }

    static JSONObject statusBody(boolean listenerOn, int waiting) {
        try {
            return new JSONObject().put("listenerOn", listenerOn).put("waiting", waiting).put("sync", true);
        } catch (JSONException e) {
            throw new IllegalStateException(e); // a boolean and an int always fit
        }
    }
}
