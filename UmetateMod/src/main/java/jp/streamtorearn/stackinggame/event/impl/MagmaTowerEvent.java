package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.EventContext;
import jp.streamtorearn.stackinggame.world.IntBox;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public final class MagmaTowerEvent extends AbstractActiveEvent {
    private final int count;
    private final List<BlockPos> bases = new ArrayList<>();
    private int layer;
    private long builtTick = -1;

    public MagmaTowerEvent(EventContext context, List<String> args) {
        super(context);
        int parsed = StackingConfig.MAGMA_DEFAULT_COUNT.get();
        if (!args.isEmpty()) {
            try {
                parsed = Integer.parseInt(args.get(0));
            } catch (NumberFormatException exception) {
                throw new IllegalArgumentException("magmatower count invalid");
            }
        }
        if (parsed < 1 || parsed > 20) {
            throw new IllegalArgumentException("count out of range");
        }
        count = parsed;
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        Vec3 look = ctx.player().getLookAngle();
        Vec3 back = new Vec3(-look.x, 0, -look.z);
        if (back.lengthSqr() < 0.001) {
            back = new Vec3(0, 0, 1);
        }
        back = back.normalize();
        Vec3 side = new Vec3(-back.z, 0, back.x);
        Random random = new Random();

        for (int i = 0; i < count; i++) {
            double distance = 3 + random.nextDouble() * 6;
            double lateral = random.nextDouble() * 8 - 4;
            int x = (int) Math.floor(ctx.player().getX() + back.x * distance + side.x * lateral);
            int z = (int) Math.floor(ctx.player().getZ() + back.z * distance + side.z * lateral);
            BlockPos ground = ctx.ground().resolve(
                    level,
                    new BlockPos(x, ctx.player().getBlockY() + 12, z));
            if (ground != null) {
                bases.add(ground.above());
            }
        }

        if (bases.isEmpty()) {
            throw new IllegalArgumentException("no valid magma tower ground");
        }

        // One containment session per column prevents lava from being considered valid simply
        // because it flowed through the empty area between far-apart columns.
        for (BlockPos base : bases) {
            ctx.fluid().start(
                    ctx.request().executionId(),
                    level,
                    IntBox.of(
                            base.getX(), base.getY(), base.getZ(),
                            base.getX(), base.getY() + StackingConfig.MAGMA_HEIGHT.get() - 1, base.getZ()),
                    Blocks.LAVA);
        }
    }

    @Override
    public void tick(long tick) {
        if (finished) {
            return;
        }
        ServerLevel level = ctx.level();
        long elapsed = tick - startedTick;

        if (elapsed < StackingConfig.MAGMA_TELEGRAPH.get()) {
            if (elapsed % 4 == 0) {
                for (BlockPos pos : bases) {
                    level.sendParticles(
                            DustParticleOptions.REDSTONE,
                            pos.getX() + 0.5,
                            pos.getY() + 0.05,
                            pos.getZ() + 0.5,
                            10,
                            0.3, 0.05, 0.3,
                            0);
                }
            }
            return;
        }

        if (layer < StackingConfig.MAGMA_HEIGHT.get()
                && (elapsed - StackingConfig.MAGMA_TELEGRAPH.get()) % 2 == 0) {
            for (BlockPos base : bases) {
                BlockPos pos = base.above(layer);
                if (level.getBlockState(pos).isAir()) {
                    ctx.placeTemporary(
                            pos,
                            Blocks.LAVA.defaultBlockState());
                }
            }
            layer++;
            for (BlockPos base : bases) {
                double dx = ctx.player().getX() - (base.getX() + 0.5);
                double dz = ctx.player().getZ() - (base.getZ() + 0.5);
                if (dx * dx + dz * dz <= 12.25) {
                    ctx.encounter();
                    break;
                }
            }
            if (layer >= StackingConfig.MAGMA_HEIGHT.get()) {
                builtTick = tick;
            }
        }

        if (builtTick >= 0 && tick - builtTick >= StackingConfig.MAGMA_DURATION.get() * 20L) {
            ctx.fluid().stop(ctx.request().executionId(), true);
            ctx.tempBlocks().restoreRequest(ctx.server(), ctx.request().executionId());
            finish();
        }
    }

    @Override
    public long maxRuntimeTicks() {
        return StackingConfig.MAGMA_TELEGRAPH.get()
                + StackingConfig.MAGMA_HEIGHT.get() * 2L
                + StackingConfig.MAGMA_DURATION.get() * 20L
                + 200L;
    }
}
