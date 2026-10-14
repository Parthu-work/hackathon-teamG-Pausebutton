package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.Configuration;
import androidx.work.testing.SynchronousExecutor;
import androidx.work.testing.WorkManagerTestInitHelper;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The message watcher on a real Android device (CI runs it on an emulator):
 * dedup and the offline queue across a restart, the Idempotency-Key on every
 * try, pairing, and both ways of being disconnected. The notification
 * listener itself needs a person to allow access, so these drive the
 * {@link Watcher} it hands messages to.
 */
@RunWith(AndroidJUnit4.class)
public class WatcherDeviceTest {
    private static final String INBOX = "/api/device/inbox";
    private Context ctx;
    private StubServer server;
    private Watcher watcher;

    /**
     * A connected phone that agreed, talking to {@code server}, with nothing
     * left from an earlier test, and a test WorkManager: the 30-minute sync
     * runs only when a test says so.
     */
    static Watcher fresh(Context ctx, StubServer server) {
        WorkManagerTestInitHelper.initializeTestWorkManager(ctx, new Configuration.Builder().setExecutor(new SynchronousExecutor()).build());
        Watcher.restart(ctx); // stops the previous test's watcher before its files go
        ctx.getSharedPreferences("pause_button", Context.MODE_PRIVATE).edit().clear().commit();
        new File(ctx.getNoBackupFilesDir(), "outbox.json").delete();
        new File(ctx.getNoBackupFilesDir(), "seen.json").delete();
        Prefs.setHost(ctx, server.url());
        Prefs.setConsent(ctx, System.currentTimeMillis());
        Prefs.setPaired(ctx, "token-1", "Mr Rao");
        return Watcher.restart(ctx);
    }

    @Before
    public void setUp() throws Exception {
        ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        server = new StubServer();
        watcher = fresh(ctx, server);
    }

    @After
    public void tearDown() throws Exception {
        server.close();
    }

    private void message(String sender, String text) throws InterruptedException {
        watcher.onMessage("com.whatsapp", "whatsapp", sender, text);
        watcher.awaitIdle();
    }

    private List<String> sentTexts() throws Exception {
        List<String> out = new ArrayList<>();
        for (StubServer.Request r : server.requests(INBOX)) out.add(new JSONObject(r.body).getString("text"));
        return out;
    }

    @Test
    public void aMessageGoesToTheServerWithTheTokenAndItsOwnIdempotencyKey() throws Exception {
        message("+91 90000 00001", "Sir this is CBI Mumbai");
        List<StubServer.Request> sent = server.requests(INBOX);
        assertEquals(1, sent.size());
        assertEquals("Bearer token-1", sent.get(0).authorization);
        JSONObject body = new JSONObject(sent.get(0).body);
        assertEquals("whatsapp", body.getString("channel"));
        assertEquals("+91 90000 00001", body.getString("sender"));
        assertFalse(body.getBoolean("fromContact"));
        assertNotNull(sent.get(0).idempotencyKey);
        assertEquals(sent.get(0).idempotencyKey, body.getString("messageId"));
        assertEquals(1, Prefs.today(ctx).get(DayCounts.SENT));
    }

    @Test
    public void aRetryCarriesTheSameIdempotencyKey_soTheServerChecksTheMessageOnce() throws Exception {
        server.respond(INBOX, 503, "{\"error\":\"Something went wrong. Please try again.\"}");
        message("+91 90000 00003", "Your KYC is expiring");
        assertEquals(1, watcher.waiting());
        watcher.kick(); // the network is back, or the app was opened
        watcher.awaitIdle();
        List<StubServer.Request> sent = server.requests(INBOX);
        assertEquals(2, sent.size());
        assertEquals(sent.get(0).idempotencyKey, sent.get(1).idempotencyKey);
        assertEquals(0, watcher.waiting());
    }

    @Test
    public void accepted202_theServerChecksItAgainItself_soThePhoneNeverResends() throws Exception {
        server.respond(INBOX, 202, "{\"id\":\"m1\",\"checkId\":null,\"status\":\"failed\",\"settings\":{\"watchSms\":true,\"watchWhatsapp\":true,\"unknownOnly\":true}}");
        message("+91 90000 00004", "Pay the electricity bill now or be cut off");
        assertEquals(0, watcher.waiting());
        assertEquals(1, Prefs.today(ctx).get(DayCounts.SENT));
        watcher.kick();
        watcher.awaitIdle();
        assertEquals(1, server.requests(INBOX).size());
    }

    @Test
    public void dedupSurvivesARestartAndKeepsNoText() throws Exception {
        message("+91 90000 00002", "Pay Rs 5000 now");
        watcher = Watcher.restart(ctx);
        message("+91 90000 00002", "Pay Rs 5000 now");
        assertEquals(Arrays.asList("Pay Rs 5000 now"), sentTexts());
        assertEquals(1, Prefs.today(ctx).get(DayCounts.REPEAT));
        assertEquals(DayCounts.whyNotSent(DayCounts.REPEAT, "whatsapp"), Prefs.lastSkip(ctx));
        String seen = new String(Files.readAllBytes(new File(ctx.getNoBackupFilesDir(), "seen.json").toPath()), StandardCharsets.UTF_8);
        assertFalse(seen.contains("Pay Rs"));
        assertFalse(seen.contains("+91"));
    }

    @Test
    public void offlineMessagesWaitOnDiskThroughARestartThenGoOldestFirst() throws Exception {
        Prefs.setHost(ctx, StubServer.deadUrl());
        message("+91 90000 00011", "first");
        message("+91 90000 00012", "second");
        message("+91 90000 00013", "third");
        assertEquals(3, watcher.waiting());
        assertTrue(Prefs.lastError(ctx).startsWith("Could not reach Pause Button"));

        watcher = Watcher.restart(ctx); // the app was killed meanwhile
        assertEquals(3, watcher.waiting());

        Prefs.setHost(ctx, server.url()); // the network is back
        watcher.kick();
        watcher.awaitIdle();
        assertEquals(Arrays.asList("first", "second", "third"), sentTexts());
        assertEquals(0, watcher.waiting());
        assertEquals(3, Prefs.today(ctx).get(DayCounts.SENT));
        // Each message its own key, kept through the restart.
        HashSet<String> keys = new HashSet<>();
        for (StubServer.Request r : server.requests(INBOX)) keys.add(r.idempotencyKey);
        assertEquals(3, keys.size());
    }

    @Test
    public void afterARebootTheBootReceiverSendsWhatWaited() throws Exception {
        Prefs.setHost(ctx, StubServer.deadUrl());
        message("+91 90000 00021", "waited through a reboot");
        watcher = Watcher.restart(ctx);
        Prefs.setHost(ctx, server.url());
        new BootReceiver().onReceive(ctx, new Intent(Intent.ACTION_BOOT_COMPLETED));
        watcher.awaitIdle();
        assertEquals(Arrays.asList("waited through a reboot"), sentTexts());
    }

    @Test
    public void pairingTradesTheCodeForAToken() throws Exception {
        Prefs.clearPairing(ctx);
        server.respond("/api/device/pair", 400, "{\"error\":\"That code did not work. Ask for a new one on the phone you are protecting.\"}");
        assertEquals("That code did not work. Ask for a new one on the phone you are protecting.", watcher.pair(server.url(), "WRONG1", "Test phone"));
        assertNull(Prefs.token(ctx));

        server.respond("/api/device/pair", 200, "{\"token\":\"token-2\",\"userName\":\"Mr Rao\"}");
        assertNull(watcher.pair(server.url(), "ABC234", "Test phone"));
        assertEquals("token-2", Prefs.token(ctx));
        assertEquals("Mr Rao", Prefs.userName(ctx));
        assertEquals(server.url(), Prefs.host(ctx));
        JSONObject body = new JSONObject(server.requests("/api/device/pair").get(1).body);
        assertEquals("ABC234", body.getString("code"));
        assertEquals("Test phone", body.getString("name"));
    }

    @Test
    public void removedOnTheWebApp_thePhoneUnpairsDropsWhatWaitsAndSaysSo() throws Exception {
        server.respond(INBOX, 401, "{\"error\":\"This phone is no longer connected. Connect it again.\"}");
        message("+91 90000 00031", "anything");
        assertNull(Prefs.token(ctx));
        assertEquals(0, watcher.waiting());
        assertTrue(Prefs.lastError(ctx).startsWith("This phone was disconnected from Pause Button"));
        // Nothing more leaves the phone.
        message("+91 90000 00032", "after");
        assertEquals(1, server.requests(INBOX).size());
    }

    @Test
    public void disconnectOnThePhoneTellsTheServer() throws Exception {
        watcher.disconnect(null);
        watcher.awaitIdle();
        assertNull(Prefs.token(ctx));
        List<StubServer.Request> revoked = server.requests("/api/device/disconnect");
        assertEquals(1, revoked.size());
        assertEquals("Bearer token-1", revoked.get(0).authorization);
        assertNull(Prefs.pendingRevoke(ctx));
    }

    @Test
    public void disconnectWhileOfflineReachesTheServerOnceTheNetworkIsBack() throws Exception {
        Prefs.setHost(ctx, StubServer.deadUrl());
        watcher.disconnect(null);
        watcher.awaitIdle();
        assertNull(Prefs.token(ctx));
        assertEquals("token-1", Prefs.pendingRevoke(ctx));

        Prefs.setHost(ctx, server.url());
        watcher.kick();
        watcher.awaitIdle();
        assertEquals("Bearer token-1", server.requests("/api/device/disconnect").get(0).authorization);
        assertNull(Prefs.pendingRevoke(ctx));
    }

    @Test
    public void nothingIsReadBeforeThePersonAgreed() throws Exception {
        Prefs.setConsent(ctx, 0);
        message("+91 90000 00041", "Sir this is CBI Mumbai");
        assertEquals(0, server.requests(INBOX).size());
        assertEquals(0, Prefs.today(ctx).get(DayCounts.SEEN));
        assertEquals(DayCounts.whyNotSent(DayCounts.NO_CONSENT, "whatsapp"), Prefs.lastSkip(ctx));
    }

    @Test
    public void aPhoneThatIsNotConnectedSaysSo() throws Exception {
        Prefs.clearPairing(ctx);
        message("+91 90000 00042", "Your KYC is blocked");
        assertEquals(0, server.requests(INBOX).size());
        assertEquals(DayCounts.whyNotSent(DayCounts.UNPAIRED, "whatsapp"), Prefs.lastSkip(ctx));
        assertTrue(Prefs.lastSkipAt(ctx) > 0);
    }

    @Test
    public void savedContactsStayOnThePhoneWhileOnlyUnknownSendersAreChecked() throws Exception {
        message("Arjun", "Dinner at 8?");
        assertEquals(0, server.requests(INBOX).size());
        assertEquals(1, Prefs.today(ctx).get(DayCounts.CONTACT));
        assertEquals(DayCounts.whyNotSent(DayCounts.CONTACT, "whatsapp"), Prefs.lastSkip(ctx));
        assertFalse(Prefs.lastSkip(ctx).contains("Arjun")); // never who sent it
        // The server's answer can switch it off; then contacts are checked too.
        Prefs.saveWatchRules(ctx, "{\"settings\":{\"watchSms\":true,\"watchWhatsapp\":true,\"unknownOnly\":false}}");
        message("Arjun", "Send me the OTP");
        assertEquals(1, server.requests(INBOX).size());
        assertTrue(new JSONObject(server.requests(INBOX).get(0).body).getBoolean("fromContact"));
    }
}
