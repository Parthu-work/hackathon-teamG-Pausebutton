package ai.apty.pausebutton;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Keeps a busy group chat from flooding the server. A message goes through
 * when its sender (a chat, a number) has sent fewer than {@link #PER_SENDER}
 * in the last minute, all senders together fewer than {@link #PER_MINUTE},
 * and the phone fewer than {@link #PER_DAY} in the last day. Beyond that it is
 * skipped and counted, not queued: a flood must not fill the outbox. One
 * chatty group cannot use up the minute's room of an unknown number, so a
 * scam from a stranger still goes through. The server has its own, higher
 * limits (30 a minute, 1000 a day per phone).
 */
public final class RateGate {
    public static final int PER_SENDER = 4;
    public static final int PER_MINUTE = 12;
    public static final int PER_DAY = 300;
    private static final long MINUTE = 60_000;
    private static final long DAY = 24 * 60 * MINUTE;

    private final Map<String, ArrayDeque<Long>> bySender = new HashMap<>();
    private final ArrayDeque<Long> minute = new ArrayDeque<>();
    private final ArrayDeque<Long> day = new ArrayDeque<>();

    /** True when a message from {@code sender} may go now (and it is counted). */
    public synchronized boolean allow(String sender, long now) {
        drop(minute, now - MINUTE);
        drop(day, now - DAY);
        for (Iterator<ArrayDeque<Long>> it = bySender.values().iterator(); it.hasNext(); ) {
            ArrayDeque<Long> q = it.next();
            drop(q, now - MINUTE);
            if (q.isEmpty()) it.remove();
        }
        ArrayDeque<Long> mine = bySender.get(sender);
        if ((mine != null && mine.size() >= PER_SENDER) || minute.size() >= PER_MINUTE || day.size() >= PER_DAY) return false;
        if (mine == null) bySender.put(sender, mine = new ArrayDeque<>());
        mine.addLast(now);
        minute.addLast(now);
        day.addLast(now);
        return true;
    }

    private static void drop(ArrayDeque<Long> q, long before) {
        while (!q.isEmpty() && q.peekFirst() <= before) q.removeFirst();
    }
}
