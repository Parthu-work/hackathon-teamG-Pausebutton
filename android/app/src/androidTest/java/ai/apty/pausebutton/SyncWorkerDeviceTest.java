package ai.apty.pausebutton;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import androidx.work.testing.TestDriver;
import androidx.work.testing.WorkManagerTestInitHelper;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The 30-minute sync through WorkManager itself (its test driver stands in
 * for the clock and the network): scheduled the way the app schedules it,
 * it sends what waits, fetches the person's settings and reports in, and it
 * stops when the phone is disconnected.
 */
@RunWith(AndroidJUnit4.class)
public class SyncWorkerDeviceTest {
    private static final String INBOX = "POST /api/device/inbox";
    private static final String GET_STATUS = "GET /api/device/status";
    private static final String POST_STATUS = "POST /api/device/status";
    private Context ctx;
    private StubServer server;
    private Watcher watcher;

    @Before
    public void setUp() throws Exception {
        ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        server = new StubServer();
        watcher = WatcherDeviceTest.fresh(ctx, server);
    }

    @After
    public void tearDown() throws Exception {
        server.close();
    }

    private WorkInfo sync() throws Exception {
        // Schedules and cancels are handed to the main thread: let it catch up first.
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        List<WorkInfo> infos = WorkManager.getInstance(ctx).getWorkInfosForUniqueWork(SyncWorker.NAME).get();
        assertEquals(1, infos.size());
        return infos.get(0);
    }

    private JSONObject lastReport() throws Exception {
        List<StubServer.Request> posts = server.requests("/api/device/status");
        for (int i = posts.size() - 1; i >= 0; i--) if (posts.get(i).method.equals("POST")) return new JSONObject(posts.get(i).body);
        throw new AssertionError("no POST /api/device/status");
    }

    @Test
    public void everyThirtyMinutesThePhoneSendsWhatWaitsFetchesItsSettingsAndReportsIn() throws Exception {
        Prefs.setHost(ctx, StubServer.deadUrl());
        watcher.onMessage("com.whatsapp", "whatsapp", "+91 90000 00051", "waited for the sync");
        watcher.awaitIdle();
        assertEquals(1, watcher.waiting());
        Prefs.setHost(ctx, server.url());
        server.respond("/api/device/status", 200, "{\"ok\":true,\"settings\":{\"watchSms\":true,\"watchWhatsapp\":false,\"unknownOnly\":true}}");

        SyncWorker.schedule(ctx);
        UUID id = sync().getId();
        TestDriver driver = WorkManagerTestInitHelper.getTestDriver(ctx);
        driver.setAllConstraintsMet(id); // online: the first run goes now
        server.await(POST_STATUS, 1);

        assertEquals(Arrays.asList(INBOX, GET_STATUS, POST_STATUS), server.calls());
        JSONObject report = lastReport();
        assertTrue(report.getBoolean("sync"));
        assertEquals(0, report.getInt("waiting"));
        assertFalse(report.getBoolean("listenerOn")); // nobody allowed notification access on the test device
        assertEquals("Bearer token-1", server.requests("/api/device/status").get(0).authorization);
        assertEquals(0, watcher.waiting());
        assertFalse(Prefs.watchRules(ctx).whatsapp); // the settings it fetched are kept
        assertEquals(WorkInfo.State.ENQUEUED, sync().getState()); // and it comes back next period

        // Thirty minutes later, online again: it reports in again.
        driver.setPeriodDelayMet(id);
        driver.setAllConstraintsMet(id);
        server.await(POST_STATUS, 2);
        assertEquals(Arrays.asList(INBOX, GET_STATUS, POST_STATUS, GET_STATUS, POST_STATUS), server.calls());
    }

    @Test
    public void schedulingAgainKeepsTheOneScheduleItHas() throws Exception {
        SyncWorker.schedule(ctx);
        UUID first = sync().getId();
        SyncWorker.schedule(ctx); // the app opened again, or the phone restarted
        assertEquals(first, sync().getId());
    }

    @Test
    public void pairingStartsTheSyncAndDisconnectingStopsIt() throws Exception {
        Prefs.clearPairing(ctx);
        server.respond("/api/device/pair", 200, "{\"token\":\"token-2\",\"userName\":\"Mr Rao\"}");
        assertNull(watcher.pair(server.url(), "ABC234", "Test phone"));
        assertEquals(WorkInfo.State.ENQUEUED, sync().getState());

        watcher.disconnect(null);
        watcher.awaitIdle();
        assertEquals(WorkInfo.State.CANCELLED, sync().getState());
    }

    @Test
    public void aPhoneRemovedOnTheWebAppStopsSyncing() throws Exception {
        server.respond("/api/device/status", 401, "{\"error\":\"This phone is no longer connected. Connect it again.\"}");
        SyncWorker.schedule(ctx);
        UUID id = sync().getId();
        WorkManagerTestInitHelper.getTestDriver(ctx).setAllConstraintsMet(id);
        server.await(GET_STATUS, 1);
        watcher.awaitIdle();

        assertNull(Prefs.token(ctx));
        assertEquals(Arrays.asList(GET_STATUS), server.calls());
        assertEquals(WorkInfo.State.CANCELLED, sync().getState());
    }
}
