package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** What each server answer means for the waiting messages. */
public class CourierTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** Scripted answers; null means "no network". */
    private final ArrayDeque<Courier.Reply> replies = new ArrayDeque<>();
    private final List<String> sent = new ArrayList<>();
    /** Every try, whether or not the server answered. */
    private final List<Outbox.Entry> tries = new ArrayList<>();
    private final List<String> log = new ArrayList<>();
    /** Jitter fixed at its middle: backoff is exactly 15 s, 30 s, 1 min … */
    private final Random middle = new Random() { @Override public double nextDouble() { return 0.5; } };
    private Outbox outbox;
    private Courier courier;

    private final Courier.Transport transport = message -> {
        tries.add(message);
        Courier.Reply r = replies.poll();
        if (r == null) throw new IOException("offline");
        sent.add(message.text);
        return r;
    };

    private final Courier.Events events = new Courier.Events() {
        @Override public void delivered(Outbox.Entry m, Courier.Reply r) { log.add("delivered " + m.text); }
        @Override public void unpaired(Courier.Reply r) { log.add("unpaired"); }
        @Override public void rejected(Outbox.Entry m, Courier.Reply r) { log.add("rejected " + m.text); }
        @Override public void failed(String why) { log.add("failed"); }
        @Override public void expired(int count) { log.add("expired " + count); }
    };

    private static Courier.Reply status(int s) { return new Courier.Reply(s, "{}", -1); }

    @Before
    public void setUp() {
        outbox = new Outbox(new File(tmp.getRoot(), "outbox.json"));
        courier = new Courier(outbox, transport, events, middle);
        outbox.add("sms", "a", false, "one", 0);
        outbox.add("sms", "b", false, "two", 1);
        outbox.add("sms", "c", false, "three", 2);
    }

    @Test
    public void sendsEverythingOldestFirst() {
        replies.add(status(200)); replies.add(status(201)); replies.add(status(200));
        assertEquals(-1, courier.flush(10));
        assertEquals(List.of("one", "two", "three"), sent);
        assertEquals(0, outbox.size());
    }

    @Test
    public void offlineKeepsEverythingAndBacksOffInsteadOfSpinning() {
        long next = courier.flush(1_000);
        assertEquals(1_000 + 15_000, next);
        assertEquals(3, outbox.size());
        // Not due yet: nothing is tried, and nothing newer overtakes the oldest.
        assertEquals(next, courier.flush(5_000));
        assertEquals(List.of("failed"), log);
        // Each failure waits twice as long, up to 15 minutes.
        assertEquals(next + 30_000, courier.flush(next));
        long t = next + 30_000;
        for (int i = 0; i < 10; i++) t = courier.flush(t); // each call is due, and fails again
        assertEquals(Courier.BACKOFF_MAX_MS, courier.flush(t) - t);
    }

    @Test
    public void whenTheNetworkComesBackEverythingGoesAtOnce() {
        courier.flush(1_000); // offline: backs off
        replies.add(status(200)); replies.add(status(200)); replies.add(status(200));
        assertEquals(-1, courier.retryNow(2_000));
        assertEquals(List.of("one", "two", "three"), sent);
    }

    @Test
    public void aServerErrorIsRetriedLaterAndKeepsTheOrder() {
        replies.add(status(200)); replies.add(status(503));
        assertEquals(10 + 15_000, courier.flush(10));
        assertEquals(List.of("two", "three"), List.of(outbox.all().get(0).text, outbox.all().get(1).text));
        replies.add(status(200)); replies.add(status(200));
        assertEquals(-1, courier.flush(10 + 15_000));
        assertEquals(List.of("one", "two", "two", "three"), sent);
    }

    @Test
    public void tooManyRequestsWaitsAsLongAsTheServerSaysEvenWhenANewMessageArrives() {
        replies.add(new Courier.Reply(429, "{}", 120_000));
        assertEquals(10 + 120_000, courier.flush(10));
        // A new message (retryNow) does not cut the server's wait short.
        assertEquals(10 + 120_000, courier.retryNow(60_000));
        assertEquals(List.of("one"), sent);
        replies.add(status(200)); replies.add(status(200)); replies.add(status(200));
        assertEquals(-1, courier.flush(10 + 120_000));
        assertEquals(0, outbox.size());
    }

    @Test
    public void unauthorizedMeansDisconnected_dropEverythingAndSaySo() {
        replies.add(status(401));
        assertEquals(-1, courier.flush(10));
        assertEquals(0, outbox.size());
        assertEquals(List.of("unpaired"), log);
        assertEquals(List.of("one"), sent);
    }

    @Test
    public void accepted202_theServerKeptItAndChecksItItself_isDeliveredAndNeverSentAgain() {
        replies.add(status(202)); replies.add(status(200)); replies.add(status(200));
        assertEquals(-1, courier.flush(10));
        assertEquals(List.of("delivered one", "delivered two", "delivered three"), log);
        assertEquals(0, outbox.size());
        assertEquals(-1, courier.retryNow(20));
        assertEquals(3, tries.size());
    }

    @Test
    public void everyTryOfAMessageCarriesTheSameIdempotencyKeyThroughRetriesAndARestart() throws Exception {
        String id = outbox.head().id;
        long next = courier.flush(10); // no network
        replies.add(status(503));
        next = courier.flush(next); // the server had a problem
        // The app is killed and starts again: the outbox is read back from its file.
        Outbox reloaded = new Outbox(new File(tmp.getRoot(), "outbox.json"));
        Courier again = new Courier(reloaded, transport, events, middle);
        replies.add(status(200)); replies.add(status(200)); replies.add(status(200));
        assertEquals(-1, again.flush(next));

        List<String> keys = new ArrayList<>();
        for (Outbox.Entry e : tries) if (e.text.equals("one")) keys.add(e.headers().get("Idempotency-Key"));
        assertEquals(List.of(id, id, id), keys);
        // The body says the same, for a server that reads it there.
        assertEquals(id, tries.get(tries.size() - 3).body().getString("messageId"));
        // Each message has its own key.
        assertEquals(3, new HashSet<>(List.of(tries.get(2).id, tries.get(3).id, tries.get(4).id)).size());
    }

    @Test
    public void aMessageTheServerWillNeverTakeIsDroppedAndTheRestGoOn() {
        replies.add(status(400)); replies.add(status(200)); replies.add(status(200));
        assertEquals(-1, courier.flush(10));
        assertEquals(List.of("rejected one", "delivered two", "delivered three"), log);
    }

    @Test
    public void messagesOlderThanADayAreDroppedAndCounted() {
        replies.add(status(200));
        outbox.add("sms", "d", false, "fresh", Outbox.MAX_AGE_MS + 5);
        assertEquals(-1, courier.flush(Outbox.MAX_AGE_MS + 10));
        assertEquals("expired 3", log.get(0));
        assertEquals(List.of("fresh"), sent);
    }

    @Test
    public void backoffStaysWithinItsBoundsWhateverTheJitter() {
        Courier lo = new Courier(outbox, transport, events, new Random() { @Override public double nextDouble() { return 0.0; } });
        Courier hi = new Courier(outbox, transport, events, new Random() { @Override public double nextDouble() { return 0.999; } });
        assertEquals(12_000, lo.backoffMs(1));
        assertTrue(hi.backoffMs(1) <= 18_000);
        assertEquals(Courier.BACKOFF_MAX_MS, hi.backoffMs(30));
        assertTrue(lo.backoffMs(30) >= Courier.BACKOFF_MAX_MS * 8 / 10);
    }
}
