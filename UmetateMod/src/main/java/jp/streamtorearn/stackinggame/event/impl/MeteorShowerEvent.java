package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.EventContext;
import jp.streamtorearn.stackinggame.world.MeteorVisual;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * プレイヤー周辺へ複数の巨大火球風隕石を降らせ、着弾時に地形を大きく破壊する。
 * args: なし / count intervalTicks radius
 */
public final class MeteorShowerEvent extends AbstractActiveEvent {
    private final int count;
    private final int intervalTicks;
    private final int radius;
    private final List<MeteorVisual> meteors = new ArrayList<>();
    private final Random random;
    private int impacted;

    public MeteorShowerEvent(EventContext ctx, List<String> args) {
        super(ctx);
        if (args.isEmpty()) {
            count = StackingConfig.METEOR_SHOWER_DEFAULT_COUNT.get();
            intervalTicks = StackingConfig.METEOR_SHOWER_INTERVAL.get();
            radius = StackingConfig.METEOR_SHOWER_RADIUS.get();
        } else {
            if (args.size() != 3) throw new IllegalArgumentException("meteor_shower args: count intervalTicks radius");
            count = OriginalEventSupport.parseInt(args.get(0), "count");
            intervalTicks = OriginalEventSupport.parseInt(args.get(1), "intervalTicks");
            radius = OriginalEventSupport.parseInt(args.get(2), "radius");
        }
        if (count < 1 || count > StackingConfig.METEOR_SHOWER_MAX_COUNT.get()) throw new IllegalArgumentException("count out of range");
        if (intervalTicks < 1 || intervalTicks > 200) throw new IllegalArgumentException("intervalTicks out of range");
        if (radius < 1 || radius > StackingConfig.ORIGINAL_MAX_RADIUS.get()) throw new IllegalArgumentException("radius out of range");
        random = new Random(ctx.request().executionId().getMostSignificantBits());
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        BlockPos base = ctx.player().blockPosition().above(16);
        for (int i = 0; i < count; i++) {
            BlockPos impact = null;
            for (int attempt = 0; attempt < 20 && impact == null; attempt++) {
                int dx = random.nextInt(radius * 2 + 1) - radius;
                int dz = random.nextInt(radius * 2 + 1) - radius;
                impact = ctx.ground().resolve(level, base.offset(dx, 0, dz));
            }
            if (impact == null) continue;
            Vec3 start = impact.getCenter().add(
                    random.nextDouble() * 6.0 - 3.0,
                    StackingConfig.METEOR_FALL_HEIGHT.get() + random.nextInt(10),
                    random.nextDouble() * 6.0 - 3.0);
            meteors.add(new MeteorVisual(
                    impact, start, tick + (long) i * intervalTicks, StackingConfig.METEOR_FALL_TICKS.get()));
        }
        if (meteors.isEmpty()) throw new IllegalArgumentException("no valid meteor impact positions");
    }

    @Override
    public void tick(long tick) {
        if (finished) return;
        ServerLevel level = ctx.level();
        for (MeteorVisual meteor : meteors) {
            if (meteor.tick(level, tick)) {
                BlockPos p = meteor.impact();
                if (ctx.player().position().distanceTo(p.getCenter().add(0, 1, 0)) <= StackingConfig.METEOR_SHOWER_BLAST_RADIUS.get() + 3.0) {
                    ctx.encounter();
                }
                ctx.explodeCrater(p, StackingConfig.METEOR_SHOWER_BLAST_RADIUS.get(), StackingConfig.METEOR_SHOWER_DEPTH.get(), StackingConfig.METEOR_SHOWER_DAMAGE.get(), StackingConfig.METEOR_SHOWER_KNOCKBACK.get());
                ctx.spark().burst(level, p.getCenter().add(0, 1, 0), 2);
                impacted++;
            }
        }
        if (impacted >= meteors.size()) finish();
    }

    @Override
    public long maxRuntimeTicks() {
        return (long) count * intervalTicks + StackingConfig.METEOR_FALL_TICKS.get() + 300L;
    }
}
