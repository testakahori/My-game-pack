package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.EventContext;
import jp.streamtorearn.stackinggame.world.IntBox;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;

public final class AquaTowerEvent extends AbstractActiveEvent {
    private BlockPos base;
    private int layer;
    private long holdStart = -1;

    public AquaTowerEvent(EventContext context) {
        super(context);
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        BlockPos ground = ctx.playerGround(8);
        base = ground.above();
        ctx.fluid().start(
                ctx.request().executionId(),
                level,
                IntBox.of(
                        base.getX(), base.getY(), base.getZ(),
                        base.getX(), base.getY() + StackingConfig.AQUA_HEIGHT.get() - 1, base.getZ()),
                Blocks.WATER);
    }

    @Override
    public void tick(long tick) {
        if (finished) {
            return;
        }

        ServerLevel level = ctx.level();
        restrain();

        if (layer < StackingConfig.AQUA_HEIGHT.get()
                && (tick - startedTick) % StackingConfig.AQUA_RISE_TICKS.get() == 0) {
            BlockPos pos = base.above(layer++);
            var oldState = level.getBlockState(pos);

            if (!oldState.is(Blocks.WATER)) {
                if (ctx.protectedBlocks().isProtected(oldState)) {
                    // Protected technical blocks are never overwritten.  The tower simply skips
                    // this cell and continues upward instead of aborting the whole event.
                } else if (!oldState.isAir()) {
                    // PLAYER event: ordinary terrain may still be destroyed, but protected blocks
                    // are skipped through the shared StackingGame safety gate.
                    if (ctx.removeBlock(pos)) {
                        // Removal can be denied by the existing safety policy.
                        // Skip water placement but keep the tick/hold timer running.
                        ctx.placeTemporary(
                                pos,
                                Blocks.WATER.defaultBlockState(),
                                Blocks.AIR.defaultBlockState());
                    }
                } else {
                    ctx.placeTemporary(
                            pos,
                            Blocks.WATER.defaultBlockState(),
                            oldState);
                }
            }

            ctx.player().push(0, 0.12, 0);
            ctx.encounter();
            if (layer >= StackingConfig.AQUA_HEIGHT.get()) {
                holdStart = tick;
            }
        }

        if (holdStart >= 0 && tick - holdStart >= StackingConfig.AQUA_HOLD_SECONDS.get() * 20L) {
            ctx.fluid().stop(ctx.request().executionId(), true);
            ctx.tempBlocks().restoreRequest(ctx.server(), ctx.request().executionId());
            finish();
        }
    }

    private void restrain() {
        double centerX = base.getX() + 0.5;
        double centerZ = base.getZ() + 0.5;
        double dx = ctx.player().getX() - centerX;
        double dz = ctx.player().getZ() - centerZ;
        double radius = StackingConfig.AQUA_RESTRAINT.get();
        if (dx * dx + dz * dz > radius * radius) {
            ctx.player().teleportTo(
                    ctx.level(),
                    centerX,
                    ctx.player().getY(),
                    centerZ,
                    ctx.player().getYRot(),
                    ctx.player().getXRot());
        }
    }

    @Override
    public long maxRuntimeTicks() {
        return (long) StackingConfig.AQUA_HEIGHT.get() * StackingConfig.AQUA_RISE_TICKS.get()
                + StackingConfig.AQUA_HOLD_SECONDS.get() * 20L
                + 200L;
    }
}
