package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;

import org.json.JSONObject;
import org.junit.Test;

/** A push message as the app reads it: the same fields and the same rules as public/sw.js. */
public class PushAlertTest {
    private static final String HOLD = "6f1c2a9e-3b7d-4c55-9a10-2f8e4b7c1d33";

    private static Map<String, String> urgentHold() {
        Map<String, String> d = new HashMap<>();
        d.put("title", "Papa's payment is paused");
        d.put("body", "Rs 80,000 to an unknown account. Block it?");
        d.put("url", "/open/a1");
        d.put("tag", "check-c1");
        d.put("urgent", "1");
        d.put("kind", "hold");
        d.put("alertId", "a1");
        d.put("checkId", "c1");
        d.put("holdId", HOLD);
        d.put("who", "Papa");
        d.put("at", "2026-10-10T09:30:00.000Z");
        d.put("receipt", "0b6c2b0e-8f0f-4a41-9a5e-6f3b1f2d9c11");
        d.put("actions", "[{\"action\":\"block\",\"title\":\"Block payment\"},{\"action\":\"fine\",\"title\":\"It's fine\"},{\"action\":\"other\",\"title\":\"x\"}]");
        return d;
    }

    @Test
    public void anUrgentAlertAboutAPausedPaymentHasBlockAndItsFine() {
        PushAlert a = PushAlert.from(urgentHold());
        assertTrue(a.urgent);
        assertEquals("Papa's payment is paused", a.title);
        assertEquals("/open/a1", a.url);
        assertEquals(HOLD, a.holdId);
        assertEquals("c1", a.checkId);
        assertEquals(2, a.actions.size());
        assertEquals("block", a.actions.get(0).action);
        assertEquals("Block payment", a.actions.get(0).title);
        assertEquals("fine", a.actions.get(1).action);
        assertEquals(1791624600000L, a.at);
        // The same tag gives the same notification, so a newer one replaces it.
        assertEquals(PushAlert.from(urgentHold()).notificationId(), a.notificationId());
    }

    @Test
    public void nothingButATitleStillShowsLikeTheBrowserWould() {
        PushAlert a = PushAlert.from(new HashMap<>());
        assertEquals("Pause Button", a.title);
        assertEquals("", a.body);
        assertEquals("/family", a.url);
        assertEquals("pause-button", a.tag);
        assertFalse(a.urgent);
        assertTrue(a.actions.isEmpty());
        assertNull(a.receipt);
        assertEquals(0, a.at);
        assertFalse(PushAlert.from(null).urgent);
    }

    @Test
    public void buttonsNeedAPausedPaymentWithASafeId() {
        Map<String, String> d = urgentHold();
        d.remove("holdId");
        assertTrue(PushAlert.from(d).actions.isEmpty());
        d.put("holdId", "../../api/me");
        assertNull(PushAlert.from(d).holdId);
        assertTrue(PushAlert.from(d).actions.isEmpty());
        d.put("holdId", HOLD);
        d.put("actions", "not json");
        assertTrue(PushAlert.from(d).actions.isEmpty());
    }

    @Test
    public void onlyPagesOfTheAppsOwnSiteOpen() {
        assertTrue(PushAlert.isAppPath("/open/a1"));
        assertTrue(PushAlert.isAppPath("/family/hold/9?approve=1"));
        assertTrue(PushAlert.isAppPath("/share?text=Sir%20this%20is%20CBI&from=whatsapp"));
        assertFalse(PushAlert.isAppPath(null));
        assertFalse(PushAlert.isAppPath(""));
        assertFalse(PushAlert.isAppPath("https://evil.example/x"));
        assertFalse(PushAlert.isAppPath("//evil.example/x"));
        assertFalse(PushAlert.isAppPath("javascript:alert(1)"));
        assertFalse(PushAlert.isAppPath("/api/me/delete"));
        assertFalse(PushAlert.isAppPath("/a b"));
        assertFalse(PushAlert.isAppPath("/\\evil.example"));
        assertFalse(PushAlert.isAppPath("/café"));
        Map<String, String> d = urgentHold();
        d.put("url", "https://evil.example/");
        assertEquals("/family", PushAlert.from(d).url);
    }

    @Test
    public void blockFromTheLockScreenAnswersInTheBrowsersWords() {
        PushAlert.Notice ok = PushAlert.blocked(HOLD, "Papa", true, "{\"ok\":true}");
        assertEquals("You blocked it", ok.title);
        assertEquals("Papa's phone now shows “Payment cancelled”. Nothing left the account.", ok.body);
        assertEquals("/family/hold/" + HOLD + "?call=1", ok.url);
        assertEquals("Call Papa", ok.button);

        PushAlert.Notice refused = PushAlert.blocked(HOLD, "", false, "{\"error\":\"Arjun already approved it.\"}");
        assertEquals("Could not block it", refused.title);
        assertEquals("Arjun already approved it.", refused.body);
        assertEquals("/family/hold/" + HOLD, refused.url);
        assertEquals("Open", refused.button);

        assertEquals("Open Pause Button to block the payment.", PushAlert.blocked(HOLD, null, false, "<html>").body);
        assertEquals("Papa's phone now shows “Payment cancelled”. Nothing left the account.", PushAlert.blocked(HOLD, null, true, "").body);

        PushAlert.Notice offline = PushAlert.unreachable(HOLD);
        assertEquals("Could not reach Pause Button", offline.title);
        assertEquals("Open the app to block the payment. The money stays paused meanwhile.", offline.body);
        assertNull(offline.button);
    }

    @Test
    public void theReceiptQuotesTheDeliveryId() throws Exception {
        PushAlert a = PushAlert.from(urgentHold());
        JSONObject shown = a.receiptBody(true, null);
        assertEquals("0b6c2b0e-8f0f-4a41-9a5e-6f3b1f2d9c11", shown.getString("id"));
        assertTrue(shown.getBoolean("shown"));
        assertTrue(shown.isNull("error"));
        assertEquals("NotificationsOff", a.receiptBody(false, "NotificationsOff").getString("error"));
    }
}
