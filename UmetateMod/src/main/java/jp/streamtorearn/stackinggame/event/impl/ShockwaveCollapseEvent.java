package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.EventContext;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.phys.Vec3;

import java.util.List;

/**
 * 中心から衝撃波リングを広げ、接触した積み上げブロックとプレイヤーを外側へ吹き飛ばす。
 * args: なし / x y z radius
 */
public final class ShockwaveCollapseEvent extends AbstractActiveEvent {
    private final Integer x, y, z;
    private final int maxRadius;
    private Vec3 center;
    private int lastRing;
    private int affectedBlocks;
    private boolean playerHit;

    public ShockwaveCollapseEvent(EventContext ctx, List<String> args) {
        super(ctx);
        if (args.isEmpty()) {
            x = y = z = null;
            maxRadius = StackingConfig.SHOCKWAVE_RADIUS.get();
        } else {
            if (args.size() != 4) throw new IllegalArgumentException("shockwave_collapse args: x y z radius");
            x = OriginalEventSupport.parseInt(args.get(0), "x");
            y = OriginalEventSupport.parseInt(args.get(1), "y");
            z = OriginalEventSupport.parseInt(args.get(2), "z");
            maxRadius = OriginalEventSupport.parseInt(args.get(3), "radius");
        }
        if (maxRadius < 2 || maxRadius > StackingConfig.ORIGINAL_MAX_RADIUS.get()) throw new IllegalArgumentException("radius out of range");
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        BlockPos ground;
        if (x == null) {
            ground = ctx.arena().floorCenterBlock();
            center = ctx.arenaFloorCenter();
        } else {
            ground = OriginalEventSupport.resolveGround(ctx, x, y, z);
            center = ground.getCenter().add(0, 1, 0);
        }
        level.playSound(null, ground, SoundEvents.GENERIC_EXPLODE, SoundSource.HOSTILE, 2.3F, 0.65F);
    }

    @Override
    public void tick(long tick) {
        if (finished) return;
        long age = tick - startedTick;
        int interval = StackingConfig.SHOCKWAVE_INTERVAL_TICKS.get();
        int ring = 1 + (int) (age / Math.max(1, interval));
        ServerLevel level = ctx.level();

        if (ring != lastRing && ring <= maxRadius) {
            lastRing = ring;
            OriginalEventSupport.ring(level, center, ring, 24 + ring * 2, ParticleTypes.CLOUD);
            OriginalEventSupport.ring(level, center, ring, 18 + ring, ParticleTypes.ELECTRIC_SPARK);

            int remaining = Math.max(0, StackingConfig.SHOCKWAVE_MAX_BLOCKS.get() - affectedBlocks);
            if (remaining > 0) {
                int affected = ctx.ejectStackRing(
                        center, ring, 0.75,
                        StackingConfig.SHOCKWAVE_VERTICAL_RANGE.get(),
                        Math.min(remaining, StackingConfig.SHOCKWAVE_MAX_BLOCKS_PER_RING.get()),
                        StackingConfig.SHOCKWAVE_MAX_ENTITIES_PER_RING.get(),
                        StackingConfig.SHOCKWAVE_BLOCK_SPEED.get());
                affectedBlocks += affected;
            }

            if (!playerHit) {
                double d = OriginalEventSupport.horizontalDistance(ctx.player(), center);
                if (Math.abs(d - ring) <= 1.2) {
                    playerHit = true;
                    ctx.encounter();
                    ctx.player().hurt(level.damageSources().explosion(null, null), StackingConfig.SHOCKWAVE_DAMAGE.get().floatValue());
                    OriginalEventSupport.pushAway(ctx.player(), center, StackingConfig.SHOCKWAVE_KNOCKBACK.get(), 0.60);
                }
            }
        }

        if (ring > maxRadius + 1) finish();
    }

    @Override
    public long maxRuntimeTicks() {
        return (long) (maxRadius + 3) * StackingConfig.SHOCKWAVE_INTERVAL_TICKS.get() + 200L;
    }
}
