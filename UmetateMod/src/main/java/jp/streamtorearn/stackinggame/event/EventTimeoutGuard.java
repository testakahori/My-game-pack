package jp.streamtorearn.stackinggame.event;

/**
 * Central timeout tracker for the currently active event.
 * Event implementations only provide their expected maximum runtime; the manager performs
 * the actual timeout decision in one place.
 */
public final class EventTimeoutGuard {
    private long startedTick;
    private long budgetTicks;

    public void start(long startedTick, long requestedBudgetTicks) {
        this.startedTick = startedTick;
        // Keep the guard permissive: only enforce a tiny minimum, do not impose a global hard cap.
        this.budgetTicks = Math.max(20L, requestedBudgetTicks);
    }

    public boolean isTimedOut(long currentTick) {
        return currentTick - startedTick > budgetTicks;
    }

    public long elapsed(long currentTick) {
        return Math.max(0L, currentTick - startedTick);
    }

    public long budgetTicks() {
        return budgetTicks;
    }

    public void clear() {
        startedTick = 0L;
        budgetTicks = 0L;
    }
}
