package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.world.FluidContainmentService;
import jp.streamtorearn.stackinggame.world.MobLifetimeManager;
import jp.streamtorearn.stackinggame.world.StackBlockService;
import jp.streamtorearn.stackinggame.world.TemporaryBlockManager;
import net.minecraft.server.MinecraftServer;

import java.util.UUID;

/**
 * Event-owned resource cleanup in one place.
 * Temporary blocks/fluid and owned mobs are cleaned at terminal phases. Normal END preserves only the short FallingBlock visual tail; forced termination removes it too.
 */
public final class EventLifecycleCleanup {
    public enum Mode { NORMAL_END, FORCED_END, RESET_FLUID_ONLY }

    private final FluidContainmentService fluid;
    private final TemporaryBlockManager tempBlocks;
    private final StackBlockService stackBlocks;
    private final MobLifetimeManager mobs;

    public EventLifecycleCleanup(FluidContainmentService fluid, TemporaryBlockManager tempBlocks,
                                 StackBlockService stackBlocks, MobLifetimeManager mobs) {
        this.fluid = fluid;
        this.tempBlocks = tempBlocks;
        this.stackBlocks = stackBlocks;
        this.mobs = mobs;
    }

    public void cleanupExecution(MinecraftServer server, UUID executionId, String phase, Mode mode) {
        if (executionId == null) return;
        try {
            fluid.stop(executionId, true);
        } catch (Exception exception) {
            StackingGameMod.LOGGER.error("Fluid cleanup failed: executionId={} phase={}", executionId, phase, exception);
        }
        try {
            tempBlocks.restoreRequest(server, executionId);
        } catch (Exception exception) {
            StackingGameMod.LOGGER.error("Temporary block cleanup failed: executionId={} phase={}", executionId, phase, exception);
        }
        // RESETはユーザー方針どおり「イベントが置いた水・溶岩だけ」を戻す。
        // TemporaryBlockManagerの利用箇所はAqua/Magma/Aquariumの一時流体だけなので、
        // Mob/FallingBlock/積み上げブロック/地形はここでは触らない。
        if (mode == Mode.RESET_FLUID_ONLY) {
            return;
        }
        // Mobはイベント終了後に残さない。Nether Armyも通常はMob消滅後にENDするため挙動は維持される。
        try {
            mobs.discardExecution(server, executionId);
        } catch (Exception exception) {
            StackingGameMod.LOGGER.error("Mob cleanup failed: executionId={} phase={}", executionId, phase, exception);
        }
        // FallingBlockだけは正常END時の短い演出残りを許可し、強制終了時だけ即時削除する。
        if (mode == Mode.FORCED_END) {
            try {
                stackBlocks.discardExecution(executionId);
            } catch (Exception exception) {
                StackingGameMod.LOGGER.error("FallingBlock cleanup failed: executionId={} phase={}", executionId, phase, exception);
            }
        }
    }
}
