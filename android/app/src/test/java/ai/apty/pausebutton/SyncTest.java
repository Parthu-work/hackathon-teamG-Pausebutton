package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The 30-minute sync: what waits goes first, then the settings, then the report, and what each answer means. */
public class SyncTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** Every call the phone made, in order. */
    private final List<String> calls = new ArrayList<>();
    /** Scripted answers to the inbox; none left means 200. */
    private final ArrayDeque<Integer> inbox = new ArrayDeque<>();
    private boolean online = true;
    private int getStatus = 200;
    private int postStatus = 200;
    private JSONObject reported;
    private Outbox outbox;
    private Sync sync;

    private final Courier.Events quiet = new Courier.Events() {
        @Override public void delivered(Outbox.Entry m, Courier.Reply r) { }
        @Override public void unpaired(Courier.Reply r) { }
        @Override public void rejected(Outbox.Entry m, Courier.Reply r) { }
        @Override public void failed(String why) { }
        @Override public void expired(int count) { }
    };

    private final Sync.Server server = new Sync.Server() {
        @Override
        public Courier.Reply getStatus() throws IOException {
            if (!online) throw new IOException("offline");
            calls.add("GET status");
            return new Courier.Reply(getStatus, "{}", -1);
        }

        @Override
        public Courier.Reply postStatus(JSONObject body) throws IOException {
            if (!online) throw new IOException("offline");
            calls.add("POST status");
            reported = body;
            return new Courier.Reply(postStatus, "{}", -1);
        }
    };

    @Before
    public void setUp() {
        outbox = new Outbox(new File(tmp.getRoot(), "outbox.json"));
        Courier.Transport transport = message -> {
            if (!online) throw new IOException("offline");
            calls.add("inbox " + message.text);
            Integer status = inbox.poll();
            return new Courier.Reply(status == null ? 200 : status, "{}", -1);
        };
        Courier courier = new Courier(outbox, transport, quiet, new Random() { @Override public double nextDouble() { return 0.5; } });
        sync = new Sync(courier, outbox, server);
    }

    @Test
    public void sendsWhatWaitsThenFetchesTheSettingsThenReportsIn() throws Exception {
        outbox.add("sms", "+91 90000 00001", false, "first", 0);
        outbox.add("sms", "+91 90000 00002", false, "second", 1);
        assertEquals(Sync.Outcome.DONE, sync.run(true, 10));
        assertEquals(List.of("inbox first", "inbox second", "GET status", "POST status"), calls);
        assertTrue(reported.getBoolean("sync"));
        assertTrue(reported.getBoolean("listenerOn"));
        assertEquals(0, reported.getInt("waiting"));
        assertEquals(0, outbox.size());
    }

    @Test
    public void aMessageWaitingOutItsBackoffGoesWithTheSync() {
        outbox.add("whatsapp", "~Ravi", false, "backing off", 0);
        outbox.retryAt(outbox.head().id, 10 * 60_000);
        assertEquals(Sync.Outcome.DONE, sync.run(false, 1_000));
        assertEquals(List.of("inbox backing off", "GET status", "POST status"), calls);
    }

    @Test
    public void whatTheServerCouldNotTakeYetIsReportedAsWaiting() throws Exception {
        inbox.add(503);
        outbox.add("sms", "a", false, "first", 0);
        outbox.add("sms", "b", false, "second", 1);
        assertEquals(Sync.Outcome.DONE, sync.run(false, 10));
        // Oldest first: the second never overtakes the first.
        assertEquals(List.of("inbox first", "GET status", "POST status"), calls);
        assertEquals(2, reported.getInt("waiting"));
        assertFalse(reported.getBoolean("listenerOn"));
    }

    @Test
    public void withNoNetworkTheSyncEndsForWorkManagerToTryAgain() {
        online = false;
        outbox.add("sms", "a", false, "first", 0);
        assertEquals(Sync.Outcome.OFFLINE, sync.run(true, 10));
        assertEquals(List.of(), calls);
        assertEquals(1, outbox.size());
    }

    @Test
    public void aPhoneTheServerNoLongerKnowsStopsAtOnce() {
        getStatus = 401;
        assertEquals(Sync.Outcome.UNPAIRED, sync.run(true, 10));
        assertEquals(List.of("GET status"), calls);
        assertNull(reported);

        calls.clear();
        getStatus = 200;
        postStatus = 401;
        assertEquals(Sync.Outcome.UNPAIRED, sync.run(true, 10));
        assertEquals(List.of("GET status", "POST status"), calls);
    }

    @Test
    public void aServerErrorOnTheSettingsStillReportsIn() {
        getStatus = 503;
        assertEquals(Sync.Outcome.DONE, sync.run(true, 10));
        assertEquals(List.of("GET status", "POST status"), calls);
    }
}
