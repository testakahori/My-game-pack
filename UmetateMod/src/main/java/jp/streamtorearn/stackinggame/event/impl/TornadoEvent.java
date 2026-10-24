package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.CancelReason;
import jp.streamtorearn.stackinggame.event.EventContext;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * 固定地点に巨大な竜巻を発生させ、積み上げブロックとプレイヤーを螺旋状に巻き上げる。
 * args: なし / durationSeconds radius
 */
public final class TornadoEvent extends AbstractActiveEvent {
    private final int durationSeconds;
    private final int radius;
    private final Random random;
    private final List<FallingBlockEntity> blocks = new ArrayList<>();
    private Vec3 center;
    private int lifted;

    public TornadoEvent(EventContext ctx, List<String> args) {
        super(ctx);
        if (args.isEmpty()) {
            durationSeconds = StackingConfig.TORNADO_DURATION_SECONDS.get();
            radius = StackingConfig.TORNADO_RADIUS.get();
        } else {
            if (args.size() != 2) throw new IllegalArgumentException("tornado args: durationSeconds radius");
            durationSeconds = OriginalEventSupport.parseInt(args.get(0), "durationSeconds");
            radius = OriginalEventSupport.parseInt(args.get(1), "radius");
        }
        if (durationSeconds < 1 || durationSeconds > 60) throw new IllegalArgumentException("durationSeconds out of range");
        if (radius < 2 || radius > StackingConfig.ORIGINAL_MAX_RADIUS.get()) throw new IllegalArgumentException("radius out of range");
        random = new Random(ctx.request().executionId().getMostSignificantBits() ^ 0xC0FFEE);
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        BlockPos ground = ctx.arena().floorCenterBlock();
        center = ctx.arenaFloorCenter();
        level.playSound(null, ground, SoundEvents.WITHER_SPAWN, SoundSource.HOSTILE, 1.6F, 1.3F);
    }

    @Override
    public void tick(long tick) {
        if (finished) return;
        long age = tick - startedTick;
        ServerLevel level = ctx.level();
        renderTornado(level, tick);

        if ((age & 3L) == 0L && lifted < StackingConfig.TORNADO_MAX_BLOCKS.get()) {
            int remaining = StackingConfig.TORNADO_MAX_BLOCKS.get() - lifted;
            int batch = Math.min(StackingConfig.TORNADO_BLOCKS_PER_BATCH.get(), remaining);
            List<FallingBlockEntity> newly = ctx.liftStackRandomBatch(
                    center, radius, StackingConfig.TORNADO_VERTICAL_RANGE.get(), batch, random);
            blocks.addAll(newly);
            lifted += newly.size();
        }

        updateBlocks();
        pullPlayer();

        if (age >= durationSeconds * 20L) {
            releaseBlocks();
            finish();
        }
    }

    private void renderTornado(ServerLevel level, long tick) {
        int height = StackingConfig.TORNADO_VISUAL_HEIGHT.get();
        for (int y = 0; y <= height; y += 2) {
            double fraction = y / (double) Math.max(1, height);
            double r = 1.0 + fraction * radius * 0.75;
            double angle = tick * 0.28 + y * 0.7;
            double x = center.x + Math.cos(angle) * r;
            double z = center.z + Math.sin(angle) * r;
            level.sendParticles(ParticleTypes.CLOUD, x, center.y + y, z, 4, 0.35, 0.25, 0.35, 0.015);
            level.sendParticles(ParticleTypes.LARGE_SMOKE, x, center.y + y, z, 2, 0.28, 0.20, 0.28, 0.01);
        }
    }

    private void updateBlocks() {
        var iterator = blocks.iterator();
        while (iterator.hasNext()) {
            FallingBlockEntity entity = iterator.next();
            if (entity.isRemoved()) { iterator.remove(); continue; }
            Vec3 rel = entity.position().subtract(center);
            Vec3 horizontal = new Vec3(rel.x, 0, rel.z);
            if (horizontal.lengthSqr() < 0.05) horizontal = new Vec3(1, 0, 0);
            if (entity.getY() > center.y + StackingConfig.TORNADO_VISUAL_HEIGHT.get()) {
                Vec3 away = horizontal.normalize().scale(0.9);
                ctx.releaseStackBlock(entity, new Vec3(away.x, 0.45, away.z));
                iterator.remove();
                continue;
            }
            Vec3 tangent = new Vec3(-horizontal.z, 0, horizontal.x).normalize();
            Vec3 inward = horizontal.normalize().scale(-0.06);
            double up = 0.12 + Math.min(0.14, horizontal.length() * 0.01);
            entity.setDeltaMovement(
                    tangent.x * StackingConfig.TORNADO_SWIRL_STRENGTH.get() + inward.x,
                    up,
                    tangent.z * StackingConfig.TORNADO_SWIRL_STRENGTH.get() + inward.z);
        }
    }

    private void pullPlayer() {
        Vec3 rel = ctx.player().position().subtract(center);
        Vec3 horizontal = new Vec3(rel.x, 0, rel.z);
        double d = horizontal.length();
        if (d > radius + 2.0 || d < 0.1) return;
        ctx.encounter();
        Vec3 tangent = new Vec3(-horizontal.z, 0, horizontal.x).normalize();
        Vec3 inward = horizontal.normalize().scale(-0.055);
        double swirl = StackingConfig.TORNADO_PLAYER_SWIRL.get();
        ctx.player().push(tangent.x * swirl + inward.x, 0.11, tangent.z * swirl + inward.z);
    }

    private void releaseBlocks() {
        for (FallingBlockEntity entity : blocks) {
            if (entity.isRemoved()) continue;
            Vec3 away = entity.position().subtract(center);
            away = new Vec3(away.x, 0, away.z);
            if (away.lengthSqr() < 0.01) away = new Vec3(1, 0, 0);
            away = away.normalize().scale(1.15);
            ctx.releaseStackBlock(entity, new Vec3(away.x, 0.55, away.z));
        }
    }

    @Override
    protected void onCancel(CancelReason reason) {
        releaseBlocks();
        super.onCancel(reason);
    }

    @Override
    public long maxRuntimeTicks() {
        return durationSeconds * 20L + 200L;
    }
}
