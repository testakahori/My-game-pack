package jp.streamtorearn.stackinggame.world;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.EventTargetMode;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.phys.Vec3;

import java.util.Random;

/** Permanent crater/block removal routed through the shared safety gate. */
public final class CraterService {
    private final BlockSafetyService safety;
    private final Random random = new Random();

    public CraterService(BlockSafetyService safety) {
        this.safety = safety;
    }

    public void explode(
            ServerLevel level,
            BlockPos ground,
            double radius,
            int depth,
            double damage,
            double knockback,
            ServerPlayer target,
            EventTargetMode targetMode) {
        double r = Math.min(radius, StackingConfig.MAX_CRATER_RADIUS.get());
        Vec3 center = new Vec3(ground.getX() + 0.5, ground.getY() + 1.0, ground.getZ() + 0.5);
        level.sendParticles(ParticleTypes.EXPLOSION_EMITTER, center.x, center.y, center.z, 1, 0, 0, 0, 0);
        level.playSound(null, ground, SoundEvents.GENERIC_EXPLODE, SoundSource.BLOCKS,
                4F, 0.9F + random.nextFloat() * 0.2F);

        int ir = (int) Math.ceil(r);
        for (int dx = -ir; dx <= ir; dx++) {
            for (int dz = -ir; dz <= ir; dz++) {
                double dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > r) continue;
                int local = Math.max(1,
                        (int) Math.round(depth * (1D - dist / r) + random.nextDouble() * 1.2));
                for (int dy = 0; dy < local; dy++) {
                    safety.remove(level, ground.offset(dx, -dy, dz), targetMode);
                }
            }
        }

        if (target != null && target.serverLevel() == level && target.position().distanceTo(center) <= r + 3) {
            target.hurt(level.damageSources().explosion(null, null), (float) damage);
            Vec3 away = target.position().subtract(center);
            if (away.lengthSqr() < 0.01) away = new Vec3(0, 0, 1);
            away = away.normalize().scale(knockback);
            target.push(away.x, Math.max(0.35, knockback * 0.35), away.z);
        }
    }
}
