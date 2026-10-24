package jp.streamtorearn.stackinggame.event;

/**
 * Event-level block interaction contract.
 *
 * <p>This is descriptive policy, not a hard global lock. It makes each event's intent explicit
 * while keeping PLAYER events free to affect ordinary terrain outside the fixed arena.</p>
 */
public enum BlockInteractionMode {
    /** No deliberate block mutation. */
    NONE,
    /** Temporary block placement/restore (water/lava etc.). */
    TEMPORARY,
    /** Ordinary terrain may be permanently removed/changed. */
    TERRAIN,
    /** Only configured stack blocks (gold/diamond by default) are removed. */
    STACK_ONLY,
    /** Only stack blocks are converted to FallingBlock / ejected. */
    STACK_FALLING
}
