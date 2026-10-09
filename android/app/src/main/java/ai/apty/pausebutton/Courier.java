package ai.apty.pausebutton;

import java.io.IOException;
import java.util.Random;

/**
 * Takes the outbox to the server, oldest first, one message at a time, and
 * decides what each answer means:
 * <ul>
 *   <li>2xx: delivered.</li>
 *   <li>401: this phone was disconnected (from the web app, or its token is
 *       gone). Stop, drop what waits, and say so: retrying can never help.</li>
 *   <li>429: the server asks the phone to slow down. Wait as long as it says.</li>
 *   <li>5xx, a timeout or no network: try again later, waiting longer each time.</li>
 *   <li>Any other 4xx: the server will never take this message (too long,
 *       malformed). Drop it and go on with the next.</li>
 * </ul>
 * Plain Java (no Android), so its rules are tested on the JVM.
 */
public final class Courier {
    public static final long BACKOFF_MIN_MS = 15_000;
    public static final long BACKOFF_MAX_MS = 15 * 60_000;

    /** The server's answer to one message. */
    public static final class Reply {
        public final int status;
        public final String body;
        /** The server's Retry-After in ms, or -1 when it sent none. */
        public final long retryAfterMs;

        public Reply(int status, String body, long retryAfterMs) {
            this.status = status;
            this.body = body == null ? "" : body;
            this.retryAfterMs = retryAfterMs;
        }

        public boolean ok() {
            return status >= 200 && status < 300;
        }
    }

    /** Sends one message to POST /api/device/inbox. */
    public interface Transport {
        Reply send(Outbox.Entry message) throws IOException;
    }

    /** What happened, for today's counts and the Connect screen. Called on the courier's thread. */
    public interface Events {
        void delivered(Outbox.Entry message, Reply reply);

        void unpaired(Reply reply);

        void rejected(Outbox.Entry message, Reply reply);

        void failed(String why);

        void expired(int count);
    }

    private final Outbox outbox;
    private final Transport transport;
    private final Events events;
    private final Random random;
    /** The server's own "not before" (a 429's Retry-After): a new message does not cut it short. */
    private long serverHoldUntil = 0;

    public Courier(Outbox outbox, Transport transport, Events events, Random random) {
        this.outbox = outbox;
        this.transport = transport;
        this.events = events;
        this.random = random;
    }

    /** Sends whatever is due. Returns when to try again (epoch ms), or -1 when nothing waits. */
    public synchronized long flush(long now) {
        int expired = outbox.expire(now);
        if (expired > 0) events.expired(expired);
        if (now < serverHoldUntil) return outbox.size() > 0 ? serverHoldUntil : -1;
        Outbox.Entry e;
        while ((e = outbox.head()) != null) {
            // Oldest first: a newer message never overtakes one that is waiting out its backoff.
            if (e.nextAttemptAt > now) return e.nextAttemptAt;
            Reply r;
            try {
                r = transport.send(e);
            } catch (IOException io) {
                return later(e, now, backoffMs(e.attempts + 1), "Could not reach Pause Button. The message waits for the internet.");
            }
            if (r.ok()) {
                outbox.remove(e.id);
                events.delivered(e, r);
            } else if (r.status == 401) {
                outbox.clear();
                events.unpaired(r);
                return -1;
            } else if (r.status == 429) {
                serverHoldUntil = now + (r.retryAfterMs >= 0 ? r.retryAfterMs : backoffMs(e.attempts + 1));
                return later(e, now, serverHoldUntil - now, "Pause Button asked the phone to slow down. Trying again shortly.");
            } else if (r.status >= 500 || r.status == 408) {
                return later(e, now, backoffMs(e.attempts + 1), "Pause Button had a problem (" + r.status + "). Trying again later.");
            } else {
                outbox.remove(e.id);
                events.rejected(e, r);
            }
        }
        return -1;
    }

    /**
     * The network is back, or a new message arrived: try now instead of
     * waiting out the backoff. A wait the server asked for still holds.
     */
    public synchronized long retryNow(long now) {
        if (now >= serverHoldUntil) outbox.dueNow(now);
        return flush(now);
    }

    private long later(Outbox.Entry e, long now, long waitMs, String why) {
        long at = now + waitMs;
        outbox.retryAt(e.id, at);
        events.failed(why);
        return at;
    }

    /** 15 s, 30 s, 1 min … up to 15 min, each ±20 % so phones do not all come back at once. */
    long backoffMs(int attempt) {
        double base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * Math.pow(2, Math.max(0, attempt - 1)));
        return Math.min(BACKOFF_MAX_MS, Math.round(base * (0.8 + 0.4 * random.nextDouble())));
    }
}
