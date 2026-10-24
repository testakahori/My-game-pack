package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.world.MobLifetimeManager;
import jp.streamtorearn.stackinggame.world.StackBlockService;
import jp.streamtorearn.stackinggame.world.TemporaryBlockManager;

import java.util.UUID;

/**
 * Read-only execution ownership view for event-created resources.
 * Falling blocks are intentionally allowed to outlive normal END for a short visual tail.
 */
public final class EventResourceOwnership {
    public record Summary(int temporaryBlocks, int fallingBlocks, int mobs) {
        public int total() { return temporaryBlocks + fallingBlocks + mobs; }
    }

    private final TemporaryBlockManager tempBlocks;
    private final StackBlockService stackBlocks;
    private final MobLifetimeManager mobs;

    public EventResourceOwnership(TemporaryBlockManager tempBlocks, StackBlockService stackBlocks, MobLifetimeManager mobs) {
        this.tempBlocks = tempBlocks;
        this.stackBlocks = stackBlocks;
        this.mobs = mobs;
    }

    public Summary summary(UUID executionId) {
        return new Summary(
                tempBlocks.count(executionId),
                stackBlocks.managedCount(executionId),
                mobs.count(executionId));
    }
}
