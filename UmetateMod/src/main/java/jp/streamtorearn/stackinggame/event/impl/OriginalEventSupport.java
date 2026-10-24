package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.event.EventContext;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;

import java.util.List;

final class OriginalEventSupport {
    private OriginalEventSupport() {}

    static Integer[] optionalPosition(List<String> args) {
        if (args.isEmpty()) return new Integer[]{null, null, null};
        if (args.size() != 3) throw new IllegalArgumentException("expected no args or: x y z");
        return new Integer[]{parseInt(args.get(0), "x"), parseInt(args.get(1), "y"), parseInt(args.get(2), "z")};
    }

    static int parseInt(String value, String name) {
        try { return Integer.parseInt(value); }
        catch (NumberFormatException ex) { throw new IllegalArgumentException(name + " must be integer"); }
    }

    static BlockPos resolveGround(EventContext ctx, Integer x, Integer y, Integer z) {
        ServerLevel level = ctx.level();
        if (x != null && ctx.targetMode() == jp.streamtorearn.stackinggame.event.EventTargetMode.ARENA) {
            ctx.requireArenaHorizontal(x, z);
        }
        BlockPos start = x == null
                ? ctx.player().blockPosition().above(12)
                : new BlockPos(x, y, z);
        BlockPos ground = ctx.ground().resolve(level, start);
        if (ground == null) throw new IllegalArgumentException("no valid ground near target");
        return ground;
    }

    static Vec3 exactOrPlayerCenter(EventContext ctx, Integer x, Integer y, Integer z, double playerYOffset) {
        if (x != null) return new Vec3(x + 0.5, y + 0.5, z + 0.5);
        return ctx.player().position().add(0, playerYOffset, 0);
    }

    /** 引数省略時は固定Arena最下段の中心を返す。 */
    static Vec3 exactOrArenaFloorCenter(EventContext ctx, Integer x, Integer y, Integer z) {
        if (x != null) {
            ctx.requireArenaHorizontal(x, z);
            return new Vec3(x + 0.5, y + 0.5, z + 0.5);
        }
        return ctx.arenaFloorCenter();
    }

    /** 引数省略時は固定Arena空間の幾何中心を返す。 */
    static Vec3 exactOrArenaVolumeCenter(EventContext ctx, Integer x, Integer y, Integer z) {
        if (x != null) {
            ctx.requireArenaHorizontal(x, z);
            return new Vec3(x + 0.5, y + 0.5, z + 0.5);
        }
        return ctx.arenaVolumeCenter();
    }

    /** 引数省略時はArena中心列を上方から地表検索する。 */
    static BlockPos resolveArenaGround(EventContext ctx, Integer x, Integer y, Integer z) {
        return x == null ? ctx.arenaGround() : resolveGround(ctx, x, y, z);
    }

    static void ring(ServerLevel level, Vec3 center, double radius, int points, ParticleOptions particle) {
        int count = Math.max(8, points);
        for (int i = 0; i < count; i++) {
            double angle = Math.PI * 2.0 * i / count;
            double x = center.x + Math.cos(angle) * radius;
            double z = center.z + Math.sin(angle) * radius;
            level.sendParticles(particle, x, center.y, z, 1, 0.03, 0.03, 0.03, 0.0);
        }
    }

    static void sphere(ServerLevel level, Vec3 center, double radius, long tick, int points, ParticleOptions particle) {
        int count = Math.max(12, points);
        for (int i = 0; i < count; i++) {
            double a = (i * 2.399963229728653 + tick * 0.12);
            double v = -1.0 + 2.0 * (i + 0.5) / count;
            double h = Math.sqrt(Math.max(0.0, 1.0 - v * v));
            double x = center.x + Math.cos(a) * h * radius;
            double y = center.y + v * radius;
            double z = center.z + Math.sin(a) * h * radius;
            level.sendParticles(particle, x, y, z, 1, 0.02, 0.02, 0.02, 0.0);
        }
    }

    static double horizontalDistance(ServerPlayer player, Vec3 center) {
        double dx = player.getX() - center.x;
        double dz = player.getZ() - center.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    static void pushAway(ServerPlayer player, Vec3 center, double power, double y) {
        Vec3 away = player.position().subtract(center);
        away = new Vec3(away.x, 0, away.z);
        if (away.lengthSqr() < 0.01) away = new Vec3(1, 0, 0);
        away = away.normalize().scale(power);
        player.push(away.x, y, away.z);
    }
}
