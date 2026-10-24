package jp.streamtorearn.stackinggame.event;

/**
 * Event target origin.
 *
 * <p>PLAYER events follow/anchor to the target player and may run in the player's current dimension.
 * ARENA events are bound to the configured stacking arena and therefore require the player to be in
 * the arena dimension when the event is accepted/started.</p>
 */
public enum EventTargetMode {
    PLAYER,
    ARENA
}
