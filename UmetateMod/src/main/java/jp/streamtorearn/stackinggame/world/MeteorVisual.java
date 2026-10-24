package jp.streamtorearn.stackinggame.world;

import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;

/**
 * クライアント専用Entityを増やさず、炎・煙・溶岩粒子を束ねて
 * 「大きめのファイヤーチャージ風隕石」を表現するサーバー側演出。
 */
public final class MeteorVisual {
    private final BlockPos impact;
    private final Vec3 start;
    private final long launchTick;
    private final int fallTicks;
    private boolean impacted;

    public MeteorVisual(BlockPos impact, Vec3 start, long launchTick, int fallTicks) {
        this.impact = impact;
        this.start = start;
        this.launchTick = launchTick;
        this.fallTicks = Math.max(1, fallTicks);
    }

    public BlockPos impact() {
        return impact;
    }

    public boolean isImpacted() {
        return impacted;
    }

    /** @return このtickで初めて着弾した場合true */
    public boolean tick(ServerLevel level, long tick) {
        if (impacted || tick < launchTick) return false;
        double progress = Math.min(1.0, (tick - launchTick) / (double) fallTicks);
        Vec3 end = impact.getCenter().add(0, 1.0, 0);
        double x = start.x + (end.x - start.x) * progress;
        double y = start.y + (end.y - start.y) * progress;
        double z = start.z + (end.z - start.z) * progress;

        // 1.3〜1.8ブロック程度の火球に見えるよう複数粒子を束ねる。
        level.sendParticles(ParticleTypes.FLAME, x, y, z, 18, 0.48, 0.48, 0.48, 0.02);
        level.sendParticles(ParticleTypes.LARGE_SMOKE, x, y + 0.15, z, 10, 0.55, 0.55, 0.55, 0.025);
        if (((tick - launchTick) & 1L) == 0L) {
            level.sendParticles(ParticleTypes.LAVA, x, y, z, 4, 0.32, 0.32, 0.32, 0.0);
        }

        if (progress >= 1.0) {
            impacted = true;
            return true;
        }
        return false;
    }
}
