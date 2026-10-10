package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** A busy group chat cannot flood the server, and cannot crowd out a stranger. */
public class RateGateTest {
    private static int allowed(RateGate g, String sender, int tries, long at) {
        int n = 0;
        for (int i = 0; i < tries; i++) if (g.allow(sender, at)) n++;
        return n;
    }

    @Test
    public void oneChatGetsAFewAMinute() {
        RateGate g = new RateGate();
        assertEquals(RateGate.PER_SENDER, allowed(g, "Family group", 50, 0));
        // A minute later it may go again.
        assertTrue(g.allow("Family group", 60_001));
    }

    @Test
    public void aStrangerStillGetsThroughWhileAGroupIsBusy() {
        RateGate g = new RateGate();
        allowed(g, "Family group", 50, 0);
        assertTrue(g.allow("+91 90000 00001", 1));
    }

    @Test
    public void allSendersTogetherAreCappedPerMinuteAndPerDay() {
        RateGate g = new RateGate();
        int n = 0;
        for (int i = 0; i < 100; i++) if (g.allow("sender " + i, 0)) n++;
        assertEquals(RateGate.PER_MINUTE, n);
        assertFalse(g.allow("one more", 30_000));

        RateGate day = new RateGate();
        int total = 0;
        for (int minute = 0; minute < 24 * 60; minute++) {
            for (int i = 0; i < RateGate.PER_MINUTE; i++) if (day.allow("s" + minute + "-" + i, minute * 60_000L + i)) total++;
        }
        assertEquals(RateGate.PER_DAY, total);
    }
}
