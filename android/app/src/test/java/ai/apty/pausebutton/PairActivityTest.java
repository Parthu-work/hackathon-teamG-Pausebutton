package ai.apty.pausebutton;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * A pausebutton://pair link can come from anyone: the Connect screen warns
 * when it names another server than the app's own site or the address the
 * person chose before.
 */
public class PairActivityTest {
    private static final String SITE = "https://pause.example";

    @Test
    public void theAppsOwnSiteOrThePersonsEarlierChoiceIsKnown() {
        assertTrue(PairActivity.knownHost(SITE, SITE, SITE));
        assertTrue(PairActivity.knownHost(" https://pause.example/ ", SITE, SITE));
        assertTrue(PairActivity.knownHost("https://PAUSE.example", SITE, SITE));
        assertTrue(PairActivity.knownHost(null, SITE, SITE)); // no host in the link: the address field keeps the person's own
        assertTrue(PairActivity.knownHost("", SITE, SITE));
        assertTrue(PairActivity.knownHost("http://10.0.2.2:3000", SITE, "http://10.0.2.2:3000"));
    }

    @Test
    public void anyOtherServerIsNamedAsOneToCheck() {
        assertFalse(PairActivity.knownHost("https://evil.example", SITE, SITE));
        assertFalse(PairActivity.knownHost("https://pause.example.evil.example", SITE, SITE));
        assertFalse(PairActivity.knownHost("https://pause.example@evil.example", SITE, SITE));
        assertFalse(PairActivity.knownHost("http://pause.example", SITE, SITE));
    }
}
