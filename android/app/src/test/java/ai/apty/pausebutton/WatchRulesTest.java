package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** What stays on the phone: unwatched apps, and saved contacts when only strangers are checked. */
public class WatchRulesTest {
    @Test
    public void aSavedContactShowsANameAStrangerDoesNot() {
        assertTrue(WatchRules.isSavedContact("whatsapp", "Arjun"));
        assertTrue(WatchRules.isSavedContact("sms", "Papa"));
        assertTrue(WatchRules.isSavedContact("sms", "MUMMY"));
        assertFalse(WatchRules.isSavedContact("sms", "+91 98765 43210"));
        assertFalse(WatchRules.isSavedContact("whatsapp", "+91 98765 43210"));
        assertFalse(WatchRules.isSavedContact("whatsapp", "~ Ravi Kumar"));
        assertFalse(WatchRules.isSavedContact("sms", "98XXXX4321"));
        assertFalse(WatchRules.isSavedContact("sms", "56161"));
        assertFalse(WatchRules.isSavedContact("sms", ""));
    }

    @Test
    public void anSmsHeaderIsABusinessNeverAContact() {
        // Bank-impersonation SMS come from headers: they must be checked even with "only unknown senders".
        assertFalse(WatchRules.isSavedContact("sms", "VM-HDFCBK"));
        assertFalse(WatchRules.isSavedContact("sms", "JD-ICICIT-S"));
        assertFalse(WatchRules.isSavedContact("sms", "AX-SBIINB"));
        assertFalse(WatchRules.isSavedContact("sms", "HDFCBK"));
        // On WhatsApp the same text is just a name.
        assertTrue(WatchRules.isSavedContact("whatsapp", "HDFCBK"));
    }

    @Test
    public void skipReasonFollowsWhatThePersonChose() {
        WatchRules all = WatchRules.DEFAULT;
        assertEquals("contact", all.skipReason("whatsapp", "Arjun"));
        assertNull(all.skipReason("sms", "VM-HDFCBK"));
        assertNull(new WatchRules(true, true, false).skipReason("whatsapp", "Arjun"));
        assertEquals("off", new WatchRules(false, true, false).skipReason("sms", "+91 98765 43210"));
        assertEquals("off", new WatchRules(true, false, false).skipReason("whatsapp", "+91 98765 43210"));
    }

    @Test
    public void readsTheServersSettingsAndDefaultsToChecking() throws Exception {
        WatchRules r = WatchRules.fromJson(new JSONObject("{\"watchSms\":false,\"watchWhatsapp\":true,\"unknownOnly\":false}"));
        assertFalse(r.sms);
        assertTrue(r.whatsapp);
        assertFalse(r.unknownOnly);
        WatchRules back = WatchRules.fromJson(new JSONObject(r.toJson().toString()));
        assertFalse(back.sms);
        assertTrue(WatchRules.fromJson(null).unknownOnly);
    }
}
