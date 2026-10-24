package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.EventContext;
import jp.streamtorearn.stackinggame.world.IntBox;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;

import java.util.List;

/** Arena型。指定した水槽領域は固定Arena内に収まる必要がある。 */
public final class AquariumEvent extends AbstractActiveEvent {
    private final IntBox box;
    private final int durationSeconds;

    public AquariumEvent(EventContext ctx, List<String> args) {
        super(ctx);
        if (args.size() != 7) {
            throw new IllegalArgumentException("aquarium args: x1 y1 z1 x2 y2 z2 durationSeconds");
        }
        try {
            box = IntBox.of(
                    OriginalEventSupport.parseInt(args.get(0), "x1"), OriginalEventSupport.parseInt(args.get(1), "y1"), OriginalEventSupport.parseInt(args.get(2), "z1"),
                    OriginalEventSupport.parseInt(args.get(3), "x2"), OriginalEventSupport.parseInt(args.get(4), "y2"), OriginalEventSupport.parseInt(args.get(5), "z2"));
            durationSeconds = OriginalEventSupport.parseInt(args.get(6), "durationSeconds");
        } catch (Exception exception) {
            throw new IllegalArgumentException("aquarium numeric args invalid", exception);
        }
        if (durationSeconds < 1 || durationSeconds > 600) throw new IllegalArgumentException("durationSeconds out of range");
        if (box.volume() > StackingConfig.AQUARIUM_MAX_BLOCKS.get()) {
            throw new IllegalArgumentException("aquarium volume exceeds max-blocks");
        }
        ctx.requireArenaBox(box);
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        for (int x = box.minX(); x <= box.maxX(); x++) {
            for (int y = box.minY(); y <= box.maxY(); y++) {
                for (int z = box.minZ(); z <= box.maxZ(); z++) {
                    BlockPos pos = new BlockPos(x, y, z);
                    if (!level.hasChunkAt(pos)) continue;
                    var oldState = level.getBlockState(pos);
                    if (oldState.isAir()) {
                        ctx.placeTemporary(
                                pos, Blocks.WATER.defaultBlockState(), oldState);
                    }
                }
            }
        }
        ctx.fluid().start(ctx.request().executionId(), level, box, Blocks.WATER);
    }

    @Override
    public void tick(long tick) {
        if (finished) return;
        BlockPos playerPos = ctx.player().blockPosition();
        if (playerPos.getX() >= box.minX() && playerPos.getX() <= box.maxX()
                && playerPos.getY() >= box.minY() && playerPos.getY() <= box.maxY()
                && playerPos.getZ() >= box.minZ() && playerPos.getZ() <= box.maxZ()) {
            ctx.encounter();
        }
        if (tick - startedTick >= durationSeconds * 20L) {
            ctx.fluid().stop(ctx.request().executionId(), true);
            ctx.tempBlocks().restoreRequest(ctx.server(), ctx.request().executionId());
            finish();
        }
    }

    @Override
    public long maxRuntimeTicks() {
        return durationSeconds * 20L + 200L;
    }
}
