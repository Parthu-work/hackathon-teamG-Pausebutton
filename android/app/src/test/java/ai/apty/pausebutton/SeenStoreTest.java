package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** Dedup that survives a restart, without keeping what the messages said. */
public class SeenStoreTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void aRepeatWithinTheWindowIsCaughtEvenAfterARestart() {
        File f = new File(tmp.getRoot(), "seen.json");
        SeenStore s = new SeenStore(f, "salt");
        assertTrue(s.firstTime("com.whatsapp", "~Ravi", "Pay Rs 5000 now", 1_000));
        assertFalse(s.firstTime("com.whatsapp", "~Ravi", "Pay Rs 5000 now", 2_000));

        SeenStore afterRestart = new SeenStore(f, "salt");
        assertFalse(afterRestart.firstTime("com.whatsapp", "~Ravi", "Pay Rs 5000 now", 3_000));
        // Another sender, app or text is a different message.
        assertTrue(afterRestart.firstTime("com.whatsapp", "~Ravi", "Pay Rs 6000 now", 3_000));
        assertTrue(afterRestart.firstTime("com.google.android.apps.messaging", "~Ravi", "Pay Rs 5000 now", 3_000));
    }

    @Test
    public void theSameMessageAfterTheWindowGoesAgain() {
        SeenStore s = new SeenStore(new File(tmp.getRoot(), "seen.json"), "salt");
        assertTrue(s.firstTime("sms", "VM-HDFCBK", "OTP 1234", 0));
        assertTrue(s.firstTime("sms", "VM-HDFCBK", "OTP 1234", SeenStore.WINDOW_MS));
    }

    @Test
    public void theFileHoldsNoSenderOrText() throws Exception {
        File f = new File(tmp.getRoot(), "seen.json");
        new SeenStore(f, "salt").firstTime("sms", "+91 98765 43210", "Sir this is CBI Mumbai", 0);
        String saved = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        assertFalse(saved.contains("CBI"));
        assertFalse(saved.contains("98765"));
    }

    @Test
    public void keepsAtMostMaxAndForgetsTheOldest() {
        File f = new File(tmp.getRoot(), "seen.json");
        SeenStore s = new SeenStore(f, "salt");
        for (int i = 0; i <= SeenStore.MAX; i++) s.firstTime("sms", "x", "m" + i, i);
        assertEquals(SeenStore.MAX, new SeenStore(f, "salt").size());
        // The oldest was forgotten, the newest is still known.
        SeenStore again = new SeenStore(f, "salt");
        assertTrue(again.firstTime("sms", "x", "m0", SeenStore.MAX + 1));
        assertFalse(again.firstTime("sms", "x", "m" + SeenStore.MAX, SeenStore.MAX + 1));
    }

    @Test
    public void anotherInstallsSaltDoesNotMatch() {
        File f = new File(tmp.getRoot(), "seen.json");
        new SeenStore(f, "salt-a").firstTime("sms", "x", "hello", 0);
        assertTrue(new SeenStore(f, "salt-b").firstTime("sms", "x", "hello", 1));
    }
}
