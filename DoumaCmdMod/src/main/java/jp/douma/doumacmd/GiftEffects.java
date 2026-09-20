package jp.douma.doumacmd;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.protocol.game.ClientboundSetEntityMotionPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.projectile.Arrow;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.function.IntConsumer;

/** Server-thread effects. Large gifts are spread across ticks instead of spawning everything in one tick. */
final class GiftEffects {
    static final Set<String> KEYS = Set.of("flood", "bullettime", "anvildrop", "chickenrain", "meteor",
        "skytrap", "superjump", "volcano", "zombiewave", "iceage", "storm", "clearweather", "cataclysm");
    static final int JUMP_HEIGHT = 32;
    private final List<Job> jobs = new ArrayList<>();
    private final Map<UUID, Jump> jumps = new HashMap<>();
    private final Map<String, Long> weatherEnds = new HashMap<>();
    private final Map<String, Blizzard> blizzards = new HashMap<>();
    private long ticks;
    private Path weatherFile;
    private int failures;
    private String lastError = "";

    record Protection(boolean enabled, double x1, double x2, double z1, double z2) {
        boolean contains(double x, double z) {
            return enabled && x >= Math.min(x1, x2) && x <= Math.max(x1, x2)
                && z >= Math.min(z1, z2) && z <= Math.max(z1, z2);
        }
    }
    private static final Protection NONE = new Protection(false, 0, 0, 0, 0);
    private record Origin(ServerLevel level, Vec3 pos, Protection protection) {
        boolean allowed(BlockPos p) {
            return p.getY() >= level.getMinBuildHeight() && p.getY() < level.getMaxBuildHeight()
                && level.hasChunkAt(p) && !protection.contains(p.getX(), p.getZ());
        }
    }
    private static final class Job {
        int index; final int total, interval, perTick; long next;
        final IntConsumer action;
        Job(int total, int interval, int perTick, long next, IntConsumer action) {
            this.total = total; this.interval = interval; this.perTick = perTick; this.next = next; this.action = action;
        }
    }
    private static final class Jump {
        final ServerLevel level; double target, liftY; boolean coasting; int age;
        Jump(ServerPlayer p) { level = p.serverLevel(); target = liftY = p.getY(); }
    }
    private record Blizzard(Origin origin, long ends) {}

    void load(MinecraftServer server) {
        weatherFile = server.getServerDirectory().toPath().resolve("douma-weather-timers.properties");
        if (!Files.isRegularFile(weatherFile)) return;
        try (InputStream in = Files.newInputStream(weatherFile)) {
            Properties data = new Properties(); data.load(in);
            for (String dimension : data.stringPropertyNames()) weatherEnds.put(dimension, Long.parseLong(data.getProperty(dimension)));
        } catch (Exception e) { fail(e); }
    }
    private void saveWeather() {
        if (weatherFile == null) return;
        try (OutputStream out = Files.newOutputStream(weatherFile)) {
            Properties data = new Properties(); weatherEnds.forEach((k, v) -> data.setProperty(k, v.toString()));
            data.store(out, "Gift weather expiry (epoch milliseconds; independent of doWeatherCycle)");
        } catch (Exception e) { fail(e); }
    }
    void stop() { saveWeather(); jobs.clear(); jumps.clear(); blizzards.clear(); weatherEnds.clear(); }
    int pendingJobs() { return jobs.size(); }
    int failures() { return failures; }
    String lastError() { return lastError; }
    private void fail(Exception e) { failures++; lastError = e.toString(); System.err.println("[Douma effects] " + lastError); }
    private void job(int total, int interval, int perTick, IntConsumer action) {
        jobs.add(new Job(total, interval, perTick, ticks, action));
    }

    int start(CommandSourceStack source, String key, int count, Protection protection) throws Exception {
        if (!KEYS.contains(key)) throw new IllegalArgumentException("Unknown effect: " + key);
        ServerLevel level = source.getLevel();
        Origin o = new Origin(level, source.getPosition(), protection == null ? NONE : protection);
        switch (key) {
            case "clearweather" -> clearWeather(level);
            case "storm" -> { rain(level, 180); lightning(o, 20); }
            case "iceage" -> iceage(o);
            case "superjump" -> jump(source.getPlayerOrException(), count);
            case "skytrap" -> skytrap(source.getPlayerOrException());
            case "flood" -> flood(o);
            case "bullettime" -> bullets(o, 240 * count);
            case "anvildrop" -> anvils(o, 100 * count);
            case "chickenrain" -> chickens(o, 200 * count);
            case "meteor" -> meteors(o, 100 * count);
            case "volcano" -> volcano(o, 50 * count);
            case "zombiewave" -> zombies(o, 50 * count);
            case "cataclysm" -> cataclysm(o, count);
        }
        return 1;
    }

    void tick(MinecraftServer server) {
        ticks++;
        // One global budget includes all concurrently received gifts. No command loses its requested count.
        int entityBudget = 16, blockBudget = 512;
        for (Iterator<Job> it = jobs.iterator(); it.hasNext();) {
            Job j = it.next();
            if (j.next > ticks) continue;
            boolean blocks = j.perTick > 16;
            int n = Math.min(j.perTick, Math.min(j.total - j.index, blocks ? blockBudget : entityBudget));
            for (int i = 0; i < n; i++) {
                try { j.action.accept(j.index++); } catch (Exception e) { fail(e); j.index = j.total; break; }
            }
            if (blocks) blockBudget -= n; else entityBudget -= n;
            if (n > 0) j.next = ticks + j.interval;
            if (j.index >= j.total) it.remove();
        }
        tickJumps(server);
        long now = System.currentTimeMillis();
        for (ServerLevel level : server.getAllLevels()) {
            String id = level.dimension().location().toString();
            Long end = weatherEnds.get(id);
            if (end != null && now >= end) clearWeather(level);
        }
        blizzards.values().removeIf(b -> now >= b.ends);
        if (ticks % 4 == 0) for (Blizzard b : blizzards.values()) {
            Origin o = b.origin;
            o.level.sendParticles(ParticleTypes.SNOWFLAKE, o.pos.x, o.pos.y + 8, o.pos.z, 300, 48, 10, 48, 0.2);
            o.level.sendParticles(ParticleTypes.CLOUD, o.pos.x, o.pos.y + 2, o.pos.z, 50, 32, 3, 32, 0.3);
        }
    }

    private void rain(ServerLevel level, int seconds) {
        level.getServer().getCommands().performPrefixedCommand(level.getServer().createCommandSourceStack().withSuppressedOutput(),
            "execute if score #storm douma_storm matches 1.. run scoreboard players set #storm douma_storm 0");
        level.setWeatherParameters(0, seconds * 20, true, true);
        weatherEnds.put(level.dimension().location().toString(), System.currentTimeMillis() + seconds * 1000L);
        saveWeather();
    }
    private void clearWeather(ServerLevel level) {
        level.setWeatherParameters(6000, 0, false, false);
        weatherEnds.remove(level.dimension().location().toString());
        blizzards.remove(level.dimension().location().toString());
        saveWeather();
        // Retire the old datapack timer as well, so it cannot interrupt a later weather gift.
        level.getServer().getCommands().performPrefixedCommand(level.getServer().createCommandSourceStack().withSuppressedOutput(),
            "execute if score #storm douma_storm matches 1.. run scoreboard players set #storm douma_storm 0");
    }
    private int surface(Origin o, int x, int z) {
        return o.level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
    }
    private boolean loaded(Origin o, int x, int z) { return o.level.hasChunkAt(new BlockPos(x, 0, z)); }
    private void set(Origin o, BlockPos p, net.minecraft.world.level.block.state.BlockState state) {
        if (o.allowed(p) && o.level.getBlockEntity(p) == null && !o.level.getBlockState(p).is(Blocks.BEDROCK)) o.level.setBlock(p, state, 3);
    }
    private void summon(Origin o, String entity, double x, double y, double z, String nbt) {
        BlockPos p = BlockPos.containing(x, y, z);
        if (!o.allowed(p)) return;
        String command = String.format(Locale.ROOT, "summon minecraft:%s %.3f %.3f %.3f %s", entity, x, y, z, nbt);
        int result = o.level.getServer().getCommands().performPrefixedCommand(o.level.getServer().createCommandSourceStack()
            .withLevel(o.level).withPermission(4).withSuppressedOutput(), command);
        if (result == 0) throw new IllegalStateException("Effect summon failed: " + entity);
    }
    private double high(Origin o, int height) { return Math.min(o.level.getMaxBuildHeight() - 2, o.pos.y + height); }
    private double random(Origin o, double radius) { return (o.level.random.nextDouble() * 2 - 1) * radius; }

    private void flood(Origin o) {
        int y = (int) high(o, 48);
        job(25 * 25, 1, 128, i -> {
            BlockPos p = BlockPos.containing(o.pos.x + i % 25 - 12, y, o.pos.z + i / 25 - 12);
            if (o.level.getBlockState(p).canBeReplaced()) set(o, p, Blocks.WATER.defaultBlockState());
        });
    }
    private void anvils(Origin o, int total) {
        job(total, 1, 10, i -> summon(o, "falling_block", o.pos.x + i % 10 - 4.5, high(o, 35 + i / 100),
            o.pos.z + (i / 10) % 10 - 4.5,
            "{Tags:[\"douma_anvildrop\"],BlockState:{Name:\"minecraft:anvil\"},Time:1,DropItem:0b,HurtEntities:1b,FallHurtAmount:4.0f,FallHurtMax:80,Motion:[0.0,-2.8,0.0]}"));
    }
    private void chickens(Origin o, int total) {
        job(total, 1, 10, i -> summon(o, "chicken", o.pos.x + random(o, 12), high(o, 24 + i % 10), o.pos.z + random(o, 12),
            "{Tags:[\"douma_chickenrain\"],Motion:[0.0,-0.5,0.0]}"));
    }
    private void meteors(Origin o, int total) {
        job(total, 2, 4, i -> summon(o, "fireball", o.pos.x + random(o, 24), high(o, 40 + i % 12), o.pos.z + random(o, 24),
            "{Tags:[\"douma_meteor\"],ExplosionPower:2b,power:[0.0,-0.25,0.0],Motion:[0.0,-1.8,0.0]}"));
    }
    private void volcano(Origin o, int total) {
        job(total, 2, 2, i -> {
            double angle = o.level.random.nextDouble() * Math.PI * 2;
            int x = (int)Math.floor(o.pos.x + Math.cos(angle) * 5), z = (int)Math.floor(o.pos.z + Math.sin(angle) * 5);
            if (!loaded(o, x, z)) return;
            int y = surface(o, x, z);
            set(o, new BlockPos(x, y - 1, z), Blocks.MAGMA_BLOCK.defaultBlockState());
            String nbt = String.format(Locale.ROOT, "{Tags:[\"douma_volcano\"],BlockState:{Name:\"minecraft:magma_block\"},Time:1,DropItem:0b,HurtEntities:1b,FallHurtAmount:3.0f,FallHurtMax:60,Motion:[%.3f,1.8,%.3f]}", Math.cos(angle)*0.65, Math.sin(angle)*0.65);
            summon(o, "falling_block", x + 0.5, y + 1, z + 0.5, nbt);
            o.level.sendParticles(ParticleTypes.LAVA, x + 0.5, y + 1, z + 0.5, 24, 0.5, 2, 0.5, 0.1);
            o.level.sendParticles(ParticleTypes.FLAME, x + 0.5, y + 2, z + 0.5, 40, 0.5, 3, 0.5, 0.2);
        });
    }
    private void zombies(Origin o, int each) {
        String[] types = {"zombie", "husk", "drowned", "zombie_villager", "zoglin"};
        job(each * types.length, 1, 10, i -> {
            double angle = o.level.random.nextDouble() * Math.PI * 2, radius = 8 + o.level.random.nextDouble() * 12;
            int x = (int)Math.floor(o.pos.x + Math.cos(angle)*radius), z = (int)Math.floor(o.pos.z + Math.sin(angle)*radius);
            if (loaded(o, x, z)) summon(o, types[i % types.length], x + 0.5, surface(o, x, z), z + 0.5, "{Tags:[\"douma_zombiewave\"]}");
        });
    }
    private void bullets(Origin o, int total) {
        job(total, 3, 4, i -> {
            double angle = o.level.random.nextDouble() * Math.PI * 2;
            Vec3 start = new Vec3(o.pos.x + Math.cos(angle)*16, o.pos.y + 1 + o.level.random.nextDouble()*7, o.pos.z + Math.sin(angle)*16);
            if (!o.allowed(BlockPos.containing(start))) return;
            List<LivingEntity> targets = o.level.getEntitiesOfClass(LivingEntity.class, new AABB(o.pos, o.pos).inflate(18), e -> e.isAlive() && !e.isSpectator());
            Vec3 target = targets.isEmpty() ? o.pos.add(random(o, 8), 1, random(o, 8))
                : targets.get(o.level.random.nextInt(targets.size())).getEyePosition();
            Vec3 direction = target.subtract(start);
            Arrow arrow = new Arrow(EntityType.ARROW, o.level);
            arrow.setPos(start); arrow.setBaseDamage(4); arrow.setPierceLevel((byte)2);
            arrow.addTag("douma_bullettime");
            arrow.shoot(direction.x, direction.y, direction.z, 2.8f, 5);
            o.level.addFreshEntity(arrow); // No owner/team: players, allies and enemies can all be hit.
        });
    }
    private void lightning(Origin o, int total) {
        job(total, 2, 1, i -> {
            int x = (int)Math.floor(o.pos.x + random(o, 24)), z = (int)Math.floor(o.pos.z + random(o, 24));
            if (loaded(o, x, z)) summon(o, "lightning_bolt", x, surface(o, x, z), z, "{Tags:[\"douma_lightning\"]}");
        });
    }
    private void iceage(Origin o) {
        rain(o.level, 120);
        blizzards.put(o.level.dimension().location().toString(), new Blizzard(o, System.currentTimeMillis() + 120000));
        for (ServerPlayer p : o.level.players()) if (p.position().distanceTo(o.pos) <= 72) {
            p.addEffect(new MobEffectInstance(MobEffects.DARKNESS, 2400, 0, false, false));
        }
        // 97 x 97 terrain surface; ice/snow intentionally remain after the two-minute blizzard.
        job(97 * 97, 1, 256, i -> {
            int x = (int)Math.floor(o.pos.x) + i % 97 - 48, z = (int)Math.floor(o.pos.z) + i / 97 - 48;
            if (!loaded(o, x, z)) return;
            int y = surface(o, x, z);
            BlockPos ground = new BlockPos(x, y - 1, z);
            if (!o.level.getBlockState(ground).isAir()) set(o, ground, Blocks.PACKED_ICE.defaultBlockState());
            BlockPos snow = ground.above();
            if (o.level.getBlockState(snow).isAir()) set(o, snow, Blocks.SNOW.defaultBlockState());
        });
    }
    private void cataclysm(Origin o, int count) {
        iceage(o); rain(o.level, 180); lightning(o, 20);
        // Jagged fissures cross a broad area. Each cut is small enough to keep a tick bounded.
        job(120, 1, 2, i -> {
            double direction = (i / 20) * Math.PI / 3;
            double distance = (i % 20) * 3;
            int x = (int)Math.floor(o.pos.x + Math.cos(direction) * distance + random(o, 2));
            int z = (int)Math.floor(o.pos.z + Math.sin(direction) * distance + random(o, 2));
            if (!loaded(o, x, z)) return;
            int top = surface(o, x, z), depth = 5 + o.level.random.nextInt(14);
            for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) for (int y = top; y >= top - depth; y--)
                set(o, new BlockPos(x + dx, y, z + dz), Blocks.AIR.defaultBlockState());
        });
        job(41 * 41, 1, 64, i -> {
            BlockPos p = BlockPos.containing(o.pos.x + i % 41 - 20, high(o, 30), o.pos.z + i / 41 - 20);
            if (o.level.getBlockState(p).canBeReplaced()) set(o, p, Blocks.LAVA.defaultBlockState());
        });
        job(100 * count, 2, 4, i -> summon(o, "tnt", o.pos.x + random(o, 28), high(o, 40 + i % 10), o.pos.z + random(o, 28), "{Tags:[\"douma_cataclysm\"],Fuse:70s,Motion:[0.0,-1.0,0.0]}"));
        job(50 * count, 1, 5, i -> {
            int x = (int)Math.floor(o.pos.x + random(o, 18)), z = (int)Math.floor(o.pos.z + random(o, 18));
            if (loaded(o, x, z)) summon(o, "zombified_piglin", x + 0.5, surface(o, x, z), z + 0.5, "{Tags:[\"douma_cataclysm\"]}");
        });
        summon(o, "wither", o.pos.x + 10, Math.min(o.level.getMaxBuildHeight()-2, o.pos.y + 10), o.pos.z, "{Tags:[\"douma_cataclysm\"],Invul:100}");
    }
    private void motion(ServerPlayer p, double y) {
        p.setOnGround(false);
        p.setDeltaMovement(p.getDeltaMovement().x, y, p.getDeltaMovement().z);
        p.hurtMarked = true;
        p.connection.send(new ClientboundSetEntityMotionPacket(p));
    }
    private void skytrap(ServerPlayer p) {
        jumps.remove(p.getUUID());
        p.removeEffect(MobEffects.SLOW_FALLING); p.removeEffect(MobEffects.LEVITATION);
        int top = p.serverLevel().getHeight(Heightmap.Types.MOTION_BLOCKING, p.getBlockX(), p.getBlockZ());
        if (!p.serverLevel().dimensionType().hasCeiling()) {
            p.teleportTo(p.getX(), Math.min(p.serverLevel().getMaxBuildHeight()-2, top + 85), p.getZ());
            p.fallDistance = 0;
            motion(p, -3.8);
        }
    }
    private void jump(ServerPlayer p, int count) {
        Jump j = jumps.computeIfAbsent(p.getUUID(), id -> new Jump(p));
        if (j.level != p.serverLevel()) { j = new Jump(p); jumps.put(p.getUUID(), j); }
        j.target += JUMP_HEIGHT * (double)count; j.liftY = p.getY(); j.coasting = false; j.age = 0;
        p.removeEffect(MobEffects.JUMP); p.removeEffect(MobEffects.LEVITATION);
        p.addEffect(new MobEffectInstance(MobEffects.SLOW_FALLING, (int)Math.min(120000, Math.max(800, (j.target - p.getY()) * 10 + 400)), 0, false, false));
        p.setOnGround(false);
    }
    private void tickJumps(MinecraftServer server) {
        for (Iterator<Map.Entry<UUID, Jump>> it = jumps.entrySet().iterator(); it.hasNext();) {
            var entry = it.next(); Jump j = entry.getValue(); ServerPlayer p = server.getPlayerList().getPlayer(entry.getKey());
            if (p == null || !p.isAlive() || p.serverLevel() != j.level || (j.age++ > 5 && p.onGround())) { it.remove(); continue; }
            if (!j.coasting) {
                // Drive ascent from the server's trajectory, so latency and packet velocity caps
                // cannot change the promised height. Horizontal steering stays with the player.
                double left = Math.max(0, j.target - j.liftY);
                double step = Math.min(left, Math.min(3.2, Math.max(0.12, JumpPhysics.velocityForHeight(left))));
                j.liftY += step;
                p.teleportTo(p.getX(), j.liftY, p.getZ());
                motion(p, 0);
                p.fallDistance = 0;
                if (j.liftY >= j.target) j.coasting = true;
            }
        }
    }
}
