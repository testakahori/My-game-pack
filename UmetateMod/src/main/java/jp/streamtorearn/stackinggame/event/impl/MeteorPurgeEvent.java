package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.EventContext;
import jp.streamtorearn.stackinggame.world.MeteorVisual;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * 指定地点へ複数隕石を落とし、積み上げ対象ブロックだけを広範囲に消去する。
 * args: なし / x y z / x y z count intervalTicks radius
 */
public final class MeteorPurgeEvent extends AbstractActiveEvent {
    private final Integer x, y, z;
    private final int count, intervalTicks, radius;
    private final Random random;
    private final List<MeteorVisual> meteors = new ArrayList<>();
    private int impacted;

    public MeteorPurgeEvent(EventContext ctx, List<String> args) {
        super(ctx);
        if (args.isEmpty()) {
            x = y = z = null;
            count = StackingConfig.METEOR_PURGE_DEFAULT_COUNT.get();
            intervalTicks = StackingConfig.METEOR_PURGE_INTERVAL.get();
            radius = StackingConfig.METEOR_PURGE_RADIUS.get();
        } else if (args.size() == 3 || args.size() == 6) {
            x = OriginalEventSupport.parseInt(args.get(0), "x");
            y = OriginalEventSupport.parseInt(args.get(1), "y");
            z = OriginalEventSupport.parseInt(args.get(2), "z");
            if (args.size() == 6) {
                count = OriginalEventSupport.parseInt(args.get(3), "count");
                intervalTicks = OriginalEventSupport.parseInt(args.get(4), "intervalTicks");
                radius = OriginalEventSupport.parseInt(args.get(5), "radius");
            } else {
                count = StackingConfig.METEOR_PURGE_DEFAULT_COUNT.get();
                intervalTicks = StackingConfig.METEOR_PURGE_INTERVAL.get();
                radius = StackingConfig.METEOR_PURGE_RADIUS.get();
            }
        } else {
            throw new IllegalArgumentException("meteor_purge args: none | x y z | x y z count intervalTicks radius");
        }
        if (count < 1 || count > StackingConfig.METEOR_PURGE_MAX_COUNT.get()) throw new IllegalArgumentException("count out of range");
        if (intervalTicks < 1 || intervalTicks > 200) throw new IllegalArgumentException("intervalTicks out of range");
        if (radius < 1 || radius > StackingConfig.ORIGINAL_MAX_RADIUS.get()) throw new IllegalArgumentException("radius out of range");
        random = new Random(ctx.request().executionId().getLeastSignificantBits() ^ 0x5DEECE66DL);
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        BlockPos center = OriginalEventSupport.resolveArenaGround(ctx, x, y, z);
        for (int i = 0; i < count; i++) {
            double angle = random.nextDouble() * Math.PI * 2.0;
            double d = random.nextDouble() * radius;
            int tx = center.getX() + (int) Math.round(Math.cos(angle) * d);
            int tz = center.getZ() + (int) Math.round(Math.sin(angle) * d);
            if (x == null) {
                tx = ctx.arena().clampX(tx);
                tz = ctx.arena().clampZ(tz);
            }
            BlockPos impact = ctx.ground().resolve(level, new BlockPos(tx, center.getY() + 18, tz));
            if (impact == null) continue;
            Vec3 start = impact.getCenter().add(
                    random.nextDouble() * 4.0 - 2.0,
                    StackingConfig.METEOR_FALL_HEIGHT.get() + random.nextInt(8),
                    random.nextDouble() * 4.0 - 2.0);
            meteors.add(new MeteorVisual(impact, start, tick + (long) i * intervalTicks, StackingConfig.METEOR_FALL_TICKS.get()));
        }
        if (meteors.isEmpty()) throw new IllegalArgumentException("no valid meteor purge positions");
    }

    @Override
    public void tick(long tick) {
        if (finished) return;
        ServerLevel level = ctx.level();
        for (MeteorVisual meteor : meteors) {
            if (!meteor.tick(level, tick)) continue;
            BlockPos p = meteor.impact();
            Vec3 c = p.getCenter().add(0, 1, 0);
            level.sendParticles(ParticleTypes.EXPLOSION_EMITTER, c.x, c.y, c.z, 1, 0, 0, 0, 0);
            level.playSound(null, p, SoundEvents.GENERIC_EXPLODE, SoundSource.BLOCKS, 4.0F, 0.75F);
            // Purge the fixed stack volume from its base upward; the meteor visual still impacts the top surface.
            Vec3 purgeCenter = new Vec3(c.x, ctx.arenaFloorCenter().y, c.z);
            ctx.removeStackCylinder(
                    purgeCenter,
                    StackingConfig.METEOR_PURGE_BLAST_RADIUS.get(),
                    0, StackingConfig.METEOR_PURGE_VERTICAL_RANGE.get(),
                    StackingConfig.METEOR_PURGE_MAX_BLOCKS_PER_IMPACT.get());
            ctx.spark().burst(level, c, 2);

            if (ctx.player().position().distanceTo(c) <= StackingConfig.METEOR_PURGE_BLAST_RADIUS.get() + 2.0) {
                ctx.encounter();
                ctx.player().hurt(level.damageSources().explosion(null, null), StackingConfig.METEOR_PURGE_DAMAGE.get().floatValue());
                OriginalEventSupport.pushAway(ctx.player(), c, StackingConfig.METEOR_PURGE_KNOCKBACK.get(), 0.45);
            }
            impacted++;
        }
        if (impacted >= meteors.size()) finish();
    }

    @Override
    public long maxRuntimeTicks() {
        return (long) count * intervalTicks + StackingConfig.METEOR_FALL_TICKS.get() + 300L;
    }
}
