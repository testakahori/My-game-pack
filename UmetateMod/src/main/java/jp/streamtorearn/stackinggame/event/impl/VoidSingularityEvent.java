package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.CancelReason;
import jp.streamtorearn.stackinggame.event.EventContext;
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
 * 巨大な紫色の重力球が積み上げブロックとプレイヤーを吸引し、最後に外へ弾き飛ばす。
 * args: なし（固定Arena中心） / x y z（球体中心）
 */
public final class VoidSingularityEvent extends AbstractActiveEvent {
    private final Integer x;
    private final Integer y;
    private final Integer z;
    private final Random random;
    private final List<FallingBlockEntity> capturedBlocks = new ArrayList<>();
    private Vec3 center;
    private int capturedCount;
    private boolean ejected;

    public VoidSingularityEvent(EventContext ctx, List<String> args) {
        super(ctx);
        Integer[] pos = OriginalEventSupport.optionalPosition(args);
        x = pos[0]; y = pos[1]; z = pos[2];
        random = new Random(ctx.request().executionId().getLeastSignificantBits());
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        center = OriginalEventSupport.exactOrArenaVolumeCenter(ctx, x, y, z);
        level.playSound(null, ctx.player().blockPosition(), SoundEvents.END_PORTAL_SPAWN, SoundSource.HOSTILE, 2.0F, 0.65F);
    }

    @Override
    public void tick(long tick) {
        if (finished) return;
        long age = tick - startedTick;
        ServerLevel level = ctx.level();
        double radius = StackingConfig.SINGULARITY_RADIUS.get();

        OriginalEventSupport.sphere(level, center, Math.max(1.2, radius * 0.32), tick, 34, ParticleTypes.PORTAL);
        OriginalEventSupport.sphere(level, center, Math.max(0.8, radius * 0.22), -tick, 20, ParticleTypes.DRAGON_BREATH);

        if (age >= StackingConfig.SINGULARITY_FORMATION_TICKS.get()
                && age < StackingConfig.SINGULARITY_EJECT_TICK.get()) {
            if ((age & 3L) == 0L && capturedCount < StackingConfig.SINGULARITY_MAX_BLOCKS.get()) {
                int remaining = StackingConfig.SINGULARITY_MAX_BLOCKS.get() - capturedCount;
                int batch = Math.min(StackingConfig.SINGULARITY_BLOCKS_PER_BATCH.get(), remaining);
                List<FallingBlockEntity> newly = ctx.liftStackRandomBatch(
                        center, radius, StackingConfig.SINGULARITY_VERTICAL_RANGE.get(), batch, random);
                capturedBlocks.addAll(newly);
                capturedCount += newly.size();
            }

            pullCapturedBlocks(radius);
            pullPlayer(radius);
        }

        if (!ejected && age >= StackingConfig.SINGULARITY_EJECT_TICK.get()) {
            ejected = true;
            ejectAll();
            level.sendParticles(ParticleTypes.EXPLOSION_EMITTER, center.x, center.y, center.z, 2, 0, 0, 0, 0);
            level.playSound(null, ctx.player().blockPosition(), SoundEvents.GENERIC_EXPLODE, SoundSource.HOSTILE, 4.0F, 0.7F);
        }

        if (ejected && age >= StackingConfig.SINGULARITY_EJECT_TICK.get() + 24L) {
            finish();
        }
    }

    private void pullCapturedBlocks(double radius) {
        double pull = StackingConfig.SINGULARITY_PULL_STRENGTH.get();
        double swirl = StackingConfig.SINGULARITY_SWIRL_STRENGTH.get();
        capturedBlocks.removeIf(FallingBlockEntity::isRemoved);
        for (FallingBlockEntity entity : capturedBlocks) {
            Vec3 toCenter = center.subtract(entity.position());
            if (toCenter.lengthSqr() < 0.04) {
                entity.setDeltaMovement(0, 0.02, 0);
                continue;
            }
            Vec3 inward = toCenter.normalize().scale(pull);
            Vec3 tangent = new Vec3(-toCenter.z, 0, toCenter.x);
            if (tangent.lengthSqr() > 0.01) tangent = tangent.normalize().scale(swirl);
            double up = entity.position().y < center.y ? 0.08 : -0.02;
            entity.setDeltaMovement(inward.x + tangent.x, inward.y + up, inward.z + tangent.z);
        }
    }

    private void pullPlayer(double radius) {
        Vec3 toCenter = center.subtract(ctx.player().position());
        double distance = toCenter.length();
        if (distance > radius + 4.0 || distance < 0.05) return;
        ctx.encounter();
        double strength = StackingConfig.SINGULARITY_PLAYER_PULL.get();
        Vec3 inward = toCenter.normalize().scale(strength);
        Vec3 tangent = new Vec3(-toCenter.z, 0, toCenter.x);
        if (tangent.lengthSqr() > 0.01) tangent = tangent.normalize().scale(strength * 0.45);
        ctx.player().push(inward.x + tangent.x, inward.y * 0.5 + 0.03, inward.z + tangent.z);
    }

    private void ejectAll() {
        double power = StackingConfig.SINGULARITY_EJECT_POWER.get();
        for (FallingBlockEntity entity : capturedBlocks) {
            if (entity.isRemoved()) continue;
            Vec3 away = entity.position().subtract(center);
            if (away.lengthSqr() < 0.01) away = new Vec3(random.nextDouble() - 0.5, 0.1, random.nextDouble() - 0.5);
            away = away.normalize().scale(power);
            ctx.releaseStackBlock(entity, new Vec3(
                    away.x,
                    0.75 + random.nextDouble() * 0.65,
                    away.z));
        }
        OriginalEventSupport.pushAway(ctx.player(), center, power * 0.95, 0.85);
        if (ctx.player().position().distanceTo(center) <= StackingConfig.SINGULARITY_RADIUS.get() + 4.0) {
            ctx.player().hurt(ctx.level().damageSources().explosion(null, null),
                    StackingConfig.SINGULARITY_DAMAGE.get().floatValue());
        }
    }

    @Override
    protected void onCancel(CancelReason reason) {
        for (FallingBlockEntity entity : capturedBlocks) {
            if (!entity.isRemoved()) ctx.releaseStackBlock(entity);
        }
        super.onCancel(reason);
    }

    @Override
    public long maxRuntimeTicks() {
        return StackingConfig.SINGULARITY_EJECT_TICK.get() + 160L;
    }
}
