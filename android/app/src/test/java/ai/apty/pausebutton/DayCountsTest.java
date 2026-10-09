package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** "What we saw today": counts that start again at midnight. */
public class DayCountsTest {
    @Test
    public void countsAndSavesToday() {
        DayCounts c = DayCounts.load(null, "2026-10-10").add(DayCounts.SEEN, 3).add(DayCounts.SENT, 1).add(DayCounts.CONTACT, 2);
        DayCounts again = DayCounts.load(c.save(), "2026-10-10");
        assertEquals(3, again.get(DayCounts.SEEN));
        assertEquals(1, again.get(DayCounts.SENT));
        assertEquals("3 messages read today\n· 1 sent to Pause Button to be checked\n· 2 waiting for the internet\n· 2 from saved contacts, not sent", again.describe(2));
    }

    @Test
    public void aNewDayStartsFromZero() {
        DayCounts yesterday = DayCounts.load(null, "2026-10-09").add(DayCounts.SEEN, 9);
        DayCounts today = DayCounts.load(yesterday.save(), "2026-10-10");
        assertEquals(0, today.get(DayCounts.SEEN));
        assertEquals("No messages read today.", today.describe(0));
    }

    @Test
    public void aDamagedSaveStartsFromZero() {
        assertEquals(0, DayCounts.load("{oops", "2026-10-10").get(DayCounts.SEEN));
    }
}
