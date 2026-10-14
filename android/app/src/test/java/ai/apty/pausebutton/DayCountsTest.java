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

    @Test
    public void eachGateSaysWhyAMessageStayedOnThePhone() {
        assertEquals("Not read: message reading was not agreed to on this phone yet", DayCounts.whyNotSent(DayCounts.NO_CONSENT, "sms"));
        assertEquals("Not sent: this phone is not connected yet", DayCounts.whyNotSent(DayCounts.UNPAIRED, "sms"));
        assertEquals("Seen again, not sent twice: the same message was already handled", DayCounts.whyNotSent(DayCounts.REPEAT, "whatsapp"));
        assertEquals("Not sent: from a saved contact, and only unknown senders are checked", DayCounts.whyNotSent(DayCounts.CONTACT, "sms"));
        assertEquals("Not sent: SMS is switched off in Watch my messages", DayCounts.whyNotSent(DayCounts.OFF, "sms"));
        assertEquals("Not sent: WhatsApp is switched off in Watch my messages", DayCounts.whyNotSent(DayCounts.OFF, "whatsapp"));
        assertEquals("Not sent: too many messages at once from one chat", DayCounts.whyNotSent(DayCounts.BUSY, "whatsapp"));
        assertEquals("Not read: the SMS notification showed no sender or text", DayCounts.whyNotSent(DayCounts.NO_TEXT, "sms"));
    }
}
