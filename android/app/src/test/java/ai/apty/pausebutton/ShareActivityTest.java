package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.net.URLDecoder;

import org.junit.Test;

/** F1 · Forward to Pause: the page a shared message opens, however long it is. */
public class ShareActivityTest {
    private static String sharedText(String page) throws Exception {
        return URLDecoder.decode(page.substring("/share?text=".length(), page.indexOf("&from=")), "UTF-8");
    }

    @Test
    public void theTextAndTheAppItCameFromGoToTheSharePage() throws Exception {
        String page = ShareActivity.page("  Sir this is CBI — pay Rs 5,000 now & tell no one\n", "whatsapp");
        assertEquals("/share?text=Sir%20this%20is%20CBI%20%E2%80%94%20pay%20Rs%205%2C000%20now%20%26%20tell%20no%20one&from=whatsapp", page);
        assertEquals("Sir this is CBI — pay Rs 5,000 now & tell no one", sharedText(page));
        assertTrue(PushAlert.isAppPath(page));
        assertEquals("/share?from=other", ShareActivity.page("   ", "other"));
        assertEquals("/share?from=sms", ShareActivity.page(null, "sms"));
    }

    @Test
    public void anEnglishMessageAsLongAsTheServerChecksIsKeptWhole() throws Exception {
        String text = "Sir this is CBI Mumbai. ".repeat(166).trim(); // about 4,000 letters, the most the server checks
        String page = ShareActivity.page(text, "whatsapp");
        assertTrue(PushAlert.isAppPath(page));
        assertEquals(text, sharedText(page));
    }

    @Test
    public void aLongMessageInHindiIsCutToFitInsteadOfNotOpening() throws Exception {
        // Each Devanagari letter takes 9 characters in the address: 2,000 letters would be 18,000.
        String text = "आपका बिजली कनेक्शन आज रात काट दिया जाएगा, तुरंत भुगतान करें। ".repeat(40).trim();
        String page = ShareActivity.page(text, "sms");
        assertTrue(page.length() <= PushAlert.MAX_PATH);
        assertTrue(PushAlert.isAppPath(page));
        assertTrue(page.endsWith("&from=sms"));
        String kept = sharedText(page);
        assertTrue(kept.length() > 700);
        assertTrue(text.startsWith(kept));
    }

    @Test
    public void aCutNeverSplitsAnEmojiInHalf() throws Exception {
        String text = "🙏".repeat(1_000);
        String kept = sharedText(ShareActivity.page(text, "whatsapp"));
        assertTrue(kept.length() > 0);
        assertEquals("", kept.replace("🙏", ""));
    }
}
