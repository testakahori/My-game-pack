package jp.streamtorearn.stackinggame.event;

/**
 * Policy for a second request with the same eventKey but a different requestId.
 *
 * <p>ALLOW keeps the current gift-friendly behavior: repeated gifts are queued in FIFO order.
 * DENY_PENDING is available for a future event that must not have another copy active/queued.</p>
 */
public enum DuplicateQueuePolicy {
    ALLOW,
    DENY_PENDING
}
