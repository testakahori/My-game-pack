package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.EventContext;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.phys.Vec3;

import java.util.List;

/**
 * 指定地点を赤い照準で予告し、上空から巨大レーザーを照射して積み上げブロックを蒸発させる。
 * args: なし / x y z
 */
public final class OrbitalLaserEvent extends AbstractActiveEvent {
    private final Integer x, y, z;
    private Vec3 center;
    private boolean fired;

    public OrbitalLaserEvent(EventContext ctx, List<String> args) {
        super(ctx);
        Integer[] pos = OriginalEventSupport.optionalPosition(args);
        x = pos[0]; y = pos[1]; z = pos[2];
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
        level.playSound(null, ground, SoundEvents.BEACON_POWER_SELECT, SoundSource.HOSTILE, 2.0F, 0.55F);
    }

    @Override
    public void tick(long tick) {
        if (finished) return;
        long age = tick - startedTick;
        ServerLevel level = ctx.level();
        int warning = StackingConfig.ORBITAL_LASER_WARNING_TICKS.get();
        double radius = StackingConfig.ORBITAL_LASER_RADIUS.get();

        if (age < warning) {
            if ((age & 1L) == 0L) {
                OriginalEventSupport.ring(level, center, radius, 38, DustParticleOptions.REDSTONE);
                OriginalEventSupport.ring(level, center, Math.max(1.0, radius * 0.5), 24, ParticleTypes.ELECTRIC_SPARK);
            }
            if (age % 6L == 0L) {
                for (int h = 4; h <= 28; h += 4) {
                    level.sendParticles(ParticleTypes.END_ROD, center.x, center.y + h, center.z, 2, 0.08, 0.4, 0.08, 0.0);
                }
            }
            return;
        }

        if (!fired) {
            fired = true;
            ctx.removeStackCylinder(
                    center, radius, 1, StackingConfig.ORBITAL_LASER_VERTICAL_RANGE.get(),
                    StackingConfig.ORBITAL_LASER_MAX_BLOCKS.get());
            level.playSound(null, new BlockPos((int)Math.floor(center.x), (int)Math.floor(center.y), (int)Math.floor(center.z)),
                    SoundEvents.GENERIC_EXPLODE, SoundSource.HOSTILE, 4.0F, 0.55F);
            level.sendParticles(ParticleTypes.EXPLOSION_EMITTER, center.x, center.y, center.z, 2, 0, 0, 0, 0);

            if (OriginalEventSupport.horizontalDistance(ctx.player(), center) <= radius + 1.0) {
                ctx.encounter();
                ctx.player().hurt(level.damageSources().explosion(null, null), StackingConfig.ORBITAL_LASER_DAMAGE.get().floatValue());
                OriginalEventSupport.pushAway(ctx.player(), center, StackingConfig.ORBITAL_LASER_KNOCKBACK.get(), 0.65);
            }
        }

        int beamTicks = StackingConfig.ORBITAL_LASER_BEAM_TICKS.get();
        if (age < warning + beamTicks) {
            for (int h = 0; h <= 34; h += 2) {
                level.sendParticles(ParticleTypes.END_ROD, center.x, center.y + h, center.z, 6, radius * 0.22, 0.3, radius * 0.22, 0.02);
                if ((h & 3) == 0) level.sendParticles(ParticleTypes.ELECTRIC_SPARK, center.x, center.y + h, center.z, 3, radius * 0.30, 0.25, radius * 0.30, 0.03);
            }
            OriginalEventSupport.ring(level, center, radius, 40, ParticleTypes.SMOKE);
        } else {
            finish();
        }
    }

    @Override
    public long maxRuntimeTicks() {
        return StackingConfig.ORBITAL_LASER_WARNING_TICKS.get() + StackingConfig.ORBITAL_LASER_BEAM_TICKS.get() + 200L;
    }
}
