package jp.streamtorearn.stackinggame.event;

import java.util.Objects;

/**
 * Lightweight execution policy kept beside each event definition.
 *
 * <p>StackingGame intentionally remains serial: one active event plus a FIFO queue.
 * This avoids overlapping long-running world changes without rejecting repeated gifts.
 * Duplicate handling is explicit so a future special event can opt out without changing
 * the queue implementation.</p>
 */
public record EventExecutionPolicy(
        boolean serial,
        DuplicateQueuePolicy duplicateQueuePolicy) {

    public static final EventExecutionPolicy SERIAL_ALLOW_DUPLICATES =
            new EventExecutionPolicy(true, DuplicateQueuePolicy.ALLOW);

    public EventExecutionPolicy {
        duplicateQueuePolicy = Objects.requireNonNull(duplicateQueuePolicy, "duplicateQueuePolicy");
    }
}
