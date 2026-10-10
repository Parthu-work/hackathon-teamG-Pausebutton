package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The offline queue: kept on disk, oldest first, capped, and never older than a day. */
public class OutboxTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private List<String> texts(Outbox o) {
        List<String> out = new ArrayList<>();
        for (Outbox.Entry e : o.all()) out.add(e.text);
        return out;
    }

    @Test
    public void survivesARestartInOrder() throws Exception {
        File f = new File(tmp.getRoot(), "outbox.json");
        Outbox o = new Outbox(f);
        o.add("sms", "+91 98765 43210", false, "first", 1_000);
        o.add("whatsapp", "~Ravi", false, "second", 2_000);
        String id = o.head().id;
        o.retryAt(id, 60_000);

        Outbox again = new Outbox(f);
        assertEquals(List.of("first", "second"), texts(again));
        // The same id after a retry and a restart: the server's Idempotency-Key for this message.
        assertEquals(id, again.head().id);
        assertEquals(id, again.head().headers().get("Idempotency-Key"));
        assertEquals(id, again.head().body().getString("messageId"));
        assertEquals(1, again.head().attempts);
        assertEquals(60_000, again.head().nextAttemptAt);
        assertEquals("sms", again.head().body().getString("channel"));
        assertEquals("+91 98765 43210", again.head().body().getString("sender"));
        assertEquals(false, again.head().body().getBoolean("fromContact"));
        assertEquals("first", again.head().body().getString("text"));
    }

    @Test
    public void dropsTheOldestBeyondTheCap() {
        Outbox o = new Outbox(new File(tmp.getRoot(), "outbox.json"));
        int dropped = 0;
        for (int i = 0; i < Outbox.MAX + 3; i++) dropped += o.add("sms", "x", false, "m" + i, i);
        assertEquals(3, dropped);
        assertEquals(Outbox.MAX, o.size());
        assertEquals("m3", o.head().text);
    }

    @Test
    public void nothingWaitsLongerThanADay() {
        Outbox o = new Outbox(new File(tmp.getRoot(), "outbox.json"));
        o.add("sms", "x", false, "old", 0);
        o.add("sms", "x", false, "new", Outbox.MAX_AGE_MS);
        assertEquals(1, o.expire(Outbox.MAX_AGE_MS + 1));
        assertEquals(List.of("new"), texts(o));
    }

    @Test
    public void dueNowCancelsTheBackoffAndClearEmptiesTheFile() throws Exception {
        File f = new File(tmp.getRoot(), "outbox.json");
        Outbox o = new Outbox(f);
        o.add("sms", "x", false, "a", 0);
        o.retryAt(o.head().id, 999_999);
        o.dueNow(5);
        assertEquals(5, o.head().nextAttemptAt);
        o.clear();
        assertNull(new Outbox(f).head());
        assertEquals("[]", new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
    }

    @Test
    public void aDamagedFileStartsEmptyInsteadOfStoppingTheWatcher() throws Exception {
        File f = new File(tmp.getRoot(), "outbox.json");
        Files.write(f.toPath(), "{not json".getBytes(StandardCharsets.UTF_8));
        Outbox o = new Outbox(f);
        assertEquals(0, o.size());
        o.add("sms", "x", false, "after", 1);
        assertEquals(1, new Outbox(f).size());
    }
}
