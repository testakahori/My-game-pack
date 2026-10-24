package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.EventContext;
import jp.streamtorearn.stackinggame.world.IntBox;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** Arena型。X/Zの降下範囲は固定Arena内に限定する。 */
public final class VoidBombRainEvent extends AbstractActiveEvent {
    private final List<BlockPos> impacts = new ArrayList<>();
    private final int x1, y1, z1, x2, y2, z2, count, intervalTicks;
    private int index;

    public VoidBombRainEvent(EventContext ctx, List<String> args) {
        super(ctx);
        if (args.size() != 8) {
            throw new IllegalArgumentException("voidbomb_rain args: x1 y1 z1 x2 y2 z2 count intervalTicks");
        }
        try {
            x1 = OriginalEventSupport.parseInt(args.get(0), "x1");
            y1 = OriginalEventSupport.parseInt(args.get(1), "y1");
            z1 = OriginalEventSupport.parseInt(args.get(2), "z1");
            x2 = OriginalEventSupport.parseInt(args.get(3), "x2");
            y2 = OriginalEventSupport.parseInt(args.get(4), "y2");
            z2 = OriginalEventSupport.parseInt(args.get(5), "z2");
            count = OriginalEventSupport.parseInt(args.get(6), "count");
            intervalTicks = OriginalEventSupport.parseInt(args.get(7), "intervalTicks");
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("voidbomb_rain numeric args invalid", exception);
        }
        if (count < 1 || count > StackingConfig.RAIN_MAX_COUNT.get()) {
            throw new IllegalArgumentException("count out of range");
        }
        if (intervalTicks < StackingConfig.RAIN_MIN_INTERVAL.get()) {
            throw new IllegalArgumentException("interval too small");
        }
        ctx.requireArenaHorizontalBox(IntBox.of(x1, y1, z1, x2, y2, z2));
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        Random random = new Random(ctx.request().executionId().getLeastSignificantBits());
        int minX = Math.min(x1, x2);
        int maxX = Math.max(x1, x2);
        int minZ = Math.min(z1, z2);
        int maxZ = Math.max(z1, z2);
        int top = Math.max(y1, y2);

        for (int i = 0; i < count; i++) {
            BlockPos ground = null;
            for (int attempt = 0; attempt < 20 && ground == null; attempt++) {
                int x = minX + random.nextInt(Math.max(1, maxX - minX + 1));
                int z = minZ + random.nextInt(Math.max(1, maxZ - minZ + 1));
                ground = ctx.ground().resolve(level, new BlockPos(x, top, z));
            }
            if (ground != null) impacts.add(ground);
        }
        if (impacts.isEmpty()) throw new IllegalArgumentException("no valid ground in rain area");
    }

    @Override
    public void tick(long tick) {
        if (finished) return;
        long elapsed = tick - startedTick;
        ServerLevel level = ctx.level();

        if (index < impacts.size()) {
            BlockPos next = impacts.get(index);
            if (elapsed % Math.max(1, intervalTicks) == 0) {
                if (ctx.player().position().distanceTo(next.getCenter().add(0, 1, 0)) <= StackingConfig.VOID_RADIUS.get() + 3.0) {
                    ctx.encounter();
                }
                ctx.explodeCrater(next, StackingConfig.VOID_RADIUS.get(), StackingConfig.VOID_DEPTH.get(), StackingConfig.VOID_DAMAGE.get(), StackingConfig.VOID_KNOCKBACK.get());
                ctx.spark().burst(level, next.getCenter().add(0, 1, 0), 2);
                index++;
            } else if (elapsed % 4 == 0) {
                level.sendParticles(
                        ParticleTypes.PORTAL,
                        next.getX() + 0.5, next.getY() + 1, next.getZ() + 0.5,
                        8, 0.7, 0.3, 0.7, 0.05);
            }
        }
        if (index >= impacts.size()) finish();
    }

    @Override
    public long maxRuntimeTicks() {
        return (long) count * Math.max(1, intervalTicks) + 400L;
    }
}
