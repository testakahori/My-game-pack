package jp.douma.saikutumod;

import jp.douma.bridgemod.api.GameEvents;
import jp.douma.bridgemod.api.EnvironmentOverrides;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.network.protocol.game.ClientboundSetEntityMotionPacket;
import net.minecraft.network.protocol.game.ClientboundTeleportEntityPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.entity.boss.wither.WitherBoss;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.entity.projectile.Arrow;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.LiquidBlock;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.function.IntConsumer;

/** Mining terrain effects, with separate instances and budgets for gift / like / other. */
final class SaikutuEffects {
    static final Set<String> KEYS = Set.of("skytrap", "cataclysm", "iceage", "flood");
    private final String owner;
    private final List<Job> jobs = new ArrayList<>();
    private final Map<String, Blizzard> blizzards = new HashMap<>();
    private final Map<UUID, IcePrison> icePrisons = new HashMap<>();
    private final Set<ServerLevel> weatherLevels = new HashSet<>();
    private long ticks;
    private int failures;
    SaikutuEffects(String type) { owner = "saikutumod:" + type; }
    int pendingJobs() { return jobs.size(); }
    int failures() { return failures; }
    private void fail(Exception error) { failures++; System.err.println("[saikutu effects] " + error); }
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
        List<Job> prerequisites = List.of();
        Job(int total, int interval, int perTick, long next, IntConsumer action) {
            this.total = total; this.interval = interval; this.perTick = perTick; this.next = next; this.action = action;
        }
    }
    private record Blizzard(Origin origin, long ends) {}
    private record IcePrison(Origin origin, BlockPos centre, long ends) {}
    private Job job(int total, int interval, int perTick, IntConsumer action) {
        Job next = new Job(total, interval, perTick, ticks, action); jobs.add(next); return next;
    }
    void stop() {
        weatherLevels.forEach(level -> EnvironmentOverrides.releaseWeather(level, owner));
        weatherLevels.clear(); jobs.clear(); blizzards.clear(); icePrisons.clear(); ticks = 0; failures = 0;
    }
    int start(CommandSourceStack source, String key, int count, Protection protection) throws Exception {
        Origin o = new Origin(source.getLevel(), source.getPosition(), protection == null ? NONE : protection);
        switch (key) {
            case "skytrap" -> skytrap(source.getPlayerOrException());
            case "flood" -> flood(o, 30 * count);
            case "iceage" -> { iceage(o); fallingIce(o, source.getPlayerOrException(), count); }
            case "cataclysm" -> cataclysm(o, count, source.getPlayerOrException());
            default -> throw new IllegalArgumentException("Unknown mining effect: " + key);
        }
        return 1;
    }
    void tick(MinecraftServer server, int entityBudget, int blockBudget) {
        ticks++;
        for (Iterator<Job> it = jobs.iterator(); it.hasNext();) {
            Job j = it.next();
            if (j.next > ticks || j.prerequisites.stream().anyMatch(p -> p.index < p.total)) continue;
            boolean blocks = j.perTick > 16;
            int n = Math.min(j.perTick, Math.min(j.total - j.index, blocks ? blockBudget : entityBudget));
            for (int i = 0; i < n; i++) {
                try { j.action.accept(j.index++); } catch (Exception e) { fail(e); j.index = j.total; break; }
            }
            if (blocks) blockBudget -= n; else entityBudget -= n;
            if (n > 0) j.next = ticks + j.interval;
            if (j.index >= j.total) it.remove();
        }
        tickIcePrisons(server);
        long now = System.currentTimeMillis();
        blizzards.values().removeIf(b -> now >= b.ends || !EnvironmentOverrides.hasWeather(b.origin.level, owner));
        if (ticks % 4 == 0) for (Blizzard b : blizzards.values()) {
            Origin o = b.origin;
            o.level.sendParticles(ParticleTypes.SNOWFLAKE, o.pos.x, o.pos.y + 8, o.pos.z, 300, 48, 10, 48, 0.2);
            o.level.sendParticles(ParticleTypes.CLOUD, o.pos.x, o.pos.y + 2, o.pos.z, 50, 32, 3, 32, 0.3);
        }
    }
    private void rain(ServerLevel level, int seconds) {
        level.setWeatherParameters(0, seconds * 20, true, true);
        EnvironmentOverrides.holdWeather(level, owner, System.currentTimeMillis() + seconds * 1000L);
        weatherLevels.add(level);
    }
    private void common(Origin o, ServerPlayer target, String key, int count) {
        GameEvents.commonEffect(target.createCommandSourceStack().withLevel(o.level).withPosition(o.pos).withPermission(4).withSuppressedOutput(), key, count,
            Map.of("protectionEnabled", o.protection.enabled, "protectX1", o.protection.x1, "protectX2", o.protection.x2,
                "protectZ1", o.protection.z1, "protectZ2", o.protection.z2));
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

    private void flood(Origin o, int drowned) {
        int top = (int)high(o, 48), bottom = Math.max(o.level.getMinBuildHeight(), (int)Math.floor(o.pos.y));
        if (top <= bottom) return;
        int centreX = (int)Math.floor(o.pos.x), centreZ = (int)Math.floor(o.pos.z);
        // Lay down the waterfall from top to bottom at the shared block budget (~3 seconds).
        // Animals wait for the water column and are placed inside it, with no downward impulse.
        Job water = job((top - bottom + 1) * 625, 1, 512, i -> {
            BlockPos p = new BlockPos(centreX + i % 25 - 12, top - i / 625, centreZ + i / 25 % 25 - 12);
            if (o.level.getBlockState(p).canBeReplaced()) set(o, p, i < 625 ? Blocks.WATER.defaultBlockState()
                : Blocks.WATER.defaultBlockState().setValue(LiquidBlock.LEVEL, 8));
        });
        String[] types = {"drowned", "cod", "salmon", "tropical_fish", "pufferfish", "squid", "glow_squid", "dolphin", "turtle", "axolotl", "guardian", "elder_guardian"};
        int[] quantities = {30, 24, 24, 30, 12, 12, 9, 9, 9, 9, 12, 3};
        int perGift = Arrays.stream(quantities).sum();
        Job animals = job(perGift * (drowned / 30), 2, 4, i -> {
            int slot = i % perGift, species = 0;
            while (slot >= quantities[species]) slot -= quantities[species++];
            for (int attempt = 0; attempt < 40; attempt++) {
                int x = centreX + o.level.random.nextInt(19) - 9, z = centreZ + o.level.random.nextInt(19) - 9;
                int y = Math.min(top - 2, bottom + 2 + o.level.random.nextInt(Math.max(1, Math.min(17, top - bottom - 3))));
                BlockPos p = new BlockPos(x, y, z);
                if (!o.allowed(p) || !o.level.getFluidState(p).is(FluidTags.WATER)
                        || !o.level.getFluidState(p.above()).is(FluidTags.WATER)) continue;
                String extra = types[species].equals("tropical_fish")
                    ? ",Variant:" + new int[]{0, 65536, 16777216, 67108865, 117506305, 117899265}[i % 6] : "";
                summon(o, types[species], x + 0.5, y + 0.2, z + 0.5,
                    "{Tags:[\"douma_flood\"],Motion:[0.0,0.0,0.0]" + extra + "}");
                return;
            }
        });
        animals.prerequisites = List.of(water);
    }
    private void lightning(Origin o, int total) {
        job(total, 2, 1, i -> {
            int x = (int)Math.floor(o.pos.x + random(o, 24)), z = (int)Math.floor(o.pos.z + random(o, 24));
            if (loaded(o, x, z)) summon(o, "lightning_bolt", x, surface(o, x, z), z, "{Tags:[\"douma_lightning\"]}");
        });
    }
    private Job iceage(Origin o) {
        rain(o.level, 120);
        blizzards.put(o.level.dimension().location().toString(), new Blizzard(o, System.currentTimeMillis() + 120000));
        for (ServerPlayer p : o.level.players()) if (p.position().distanceTo(o.pos) <= 72) {
            p.addEffect(new MobEffectInstance(MobEffects.DARKNESS, 2400, 0, false, false));
        }
        // 97 x 97 terrain surface; ice/snow intentionally remain after the two-minute blizzard.
        return job(97 * 97, 1, 256, i -> {
            int x = (int)Math.floor(o.pos.x) + i % 97 - 48, z = (int)Math.floor(o.pos.z) + i / 97 - 48;
            if (!loaded(o, x, z)) return;
            int y = surface(o, x, z);
            BlockPos ground = new BlockPos(x, y - 1, z);
            if (!o.level.getBlockState(ground).isAir()) set(o, ground, Blocks.PACKED_ICE.defaultBlockState());
            BlockPos snow = ground.above();
            if (o.level.getBlockState(snow).isAir()) set(o, snow, Blocks.SNOW.defaultBlockState());
        });
    }
    private void fallingIce(Origin o, ServerPlayer player, int count) {
        BlockPos centre = player.blockPosition();
        if (!o.allowed(centre) || !o.allowed(centre.above())) return;
        // A 5x5 slab, three layers thick, falls before any confinement damage begins.
        job(75 * count, 1, 15, i -> {
            int layer = i / 25, x = centre.getX() + i % 5 - 2, z = centre.getZ() + i / 5 % 5 - 2;
            summon(o, "falling_block", x + 0.5, Math.min(o.level.getMaxBuildHeight()-2, centre.getY()+24+layer*3), z + 0.5,
                "{Tags:[\"douma_icefall\"],BlockState:{Name:\"minecraft:packed_ice\"},Time:1,DropItem:0b,HurtEntities:1b,FallHurtAmount:4.0f,FallHurtMax:60,Motion:[0.0,-2.8,0.0]}");
        });
        icePrisons.put(player.getUUID(), new IcePrison(o, centre, System.currentTimeMillis() + 120000));
    }
    private boolean insidePrison(ServerPlayer player, BlockPos centre) {
        return Math.abs(player.getX() - (centre.getX() + 0.5)) < 2.8
            && Math.abs(player.getZ() - (centre.getZ() + 0.5)) < 2.8
            && player.getY() >= centre.getY() - 1 && player.getY() < centre.getY() + 4;
    }
    private boolean intersectsIce(ServerPlayer player) {
        return BlockPos.betweenClosedStream(player.getBoundingBox().deflate(0.05))
            .anyMatch(pos -> player.serverLevel().getBlockState(pos).is(Blocks.PACKED_ICE));
    }
    private void tickIcePrisons(MinecraftServer server) {
        if (ticks % 10 != 0) return;
        long now = System.currentTimeMillis();
        for (Iterator<Map.Entry<UUID, IcePrison>> it = icePrisons.entrySet().iterator(); it.hasNext();) {
            var entry = it.next(); IcePrison prison = entry.getValue();
            ServerPlayer player = server.getPlayerList().getPlayer(entry.getKey());
            if (now >= prison.ends || player == null || !player.isAlive()
                    || player.serverLevel() != prison.origin.level || !insidePrison(player, prison.centre)) {
                if (player != null) player.setTicksFrozen(0);
                it.remove(); continue;
            }
            if (intersectsIce(player)) {
                player.setTicksFrozen(300);
                player.hurt(prison.origin.level.damageSources().freeze(), 2.0f);
            } else {
                player.setTicksFrozen(0);
            }
        }
    }

    private Job earthquakeCrater(Origin o) {
        int centreX = (int)Math.floor(o.pos.x), centreZ = (int)Math.floor(o.pos.z);
        int top = (int)Math.floor(o.pos.y) + 1;
        int bottom = Math.max(o.level.getMinBuildHeight() + 1, (int)Math.floor(o.pos.y) - 48);
        int[] floors = new int[13 * 13];
        for (int i = 0; i < floors.length; i++) {
            int x = i % 13 - 6, z = i / 13 - 6;
            int ring = Math.max(Math.abs(x), Math.abs(z));
            // A deep central shaft surrounded by uneven, broken crater walls.
            int depth = ring <= 3 ? 48 : 48 - (ring - 3) * 6 - o.level.random.nextInt(5);
            floors[i] = Math.max(bottom, (int)Math.floor(o.pos.y) - depth);
        }
        return job((top - bottom + 1) * floors.length, 1, 256, i -> {
            int column = i % floors.length;
            int dx = column % 13 - 6, dz = column / 13 - 6;
            int y = top - i / floors.length;
            if (dx * dx + dz * dz <= 43 && y >= floors[column])
                set(o, new BlockPos(centreX + dx, y, centreZ + dz), Blocks.AIR.defaultBlockState());
        });
    }

    private void cataclysm(Origin o, int count, ServerPlayer target) {
        Job crater = earthquakeCrater(o);
        Job frost = iceage(o); rain(o.level, 180); lightning(o, 20);
        // Jagged fissures cross a broad area. Each cut is small enough to keep a tick bounded.
        Job fissures = job(120, 1, 2, i -> {
            double direction = (i / 20) * Math.PI / 3;
            double distance = (i % 20) * 3;
            if (distance < 12) return; // Keep repeated surface cuts out of the central shaft.
            int x = (int)Math.floor(o.pos.x + Math.cos(direction) * distance + random(o, 2));
            int z = (int)Math.floor(o.pos.z + Math.sin(direction) * distance + random(o, 2));
            if (!loaded(o, x, z)) return;
            int top = surface(o, x, z), depth = 5 + o.level.random.nextInt(14);
            for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) for (int y = top; y >= top - depth; y--)
                set(o, new BlockPos(x + dx, y, z + dz), Blocks.AIR.defaultBlockState());
        });
        UUID targetId = target.getUUID();
        // Start pouring only after excavation/freezing; neither may erase the lava sources.
        // Refresh for 30 seconds, aiming at the player while they remain in the crater.
        Job lava = job(30, 20, 1, i -> {
            ServerPlayer player = o.level.getServer().getPlayerList().getPlayer(targetId);
            int x = (int)Math.floor(o.pos.x), z = (int)Math.floor(o.pos.z);
            if (player != null && player.isAlive() && player.serverLevel() == o.level
                    && Math.abs(player.getX() - o.pos.x) <= 6 && Math.abs(player.getZ() - o.pos.z) <= 6) {
                x = player.getBlockX(); z = player.getBlockZ();
            }
            int y = (int)high(o, 12);
            for (int dx = -2; dx <= 2; dx++) for (int dz = -2; dz <= 2; dz++) {
                BlockPos p = new BlockPos(x + dx, y, z + dz);
                if (o.level.getBlockState(p).canBeReplaced() || o.level.getBlockState(p).is(Blocks.LAVA))
                    set(o, p, Blocks.LAVA.defaultBlockState());
            }
        });
        lava.prerequisites = List.of(crater, frost, fissures);
        Job apocalypseSky = job(1, 1, 1, i -> common(o, target, "meteorshower", count));
        apocalypseSky.prerequisites = List.of(crater, frost, fissures);
        o.level.playSound(null, o.pos.x, o.pos.y, o.pos.z, SoundEvents.WITHER_SPAWN, SoundSource.HOSTILE, 2.0f, 0.6f);
        int streamTop = (int)high(o, 12) - 1;
        int streamBottom = Math.max(o.level.getMinBuildHeight() + 1, (int)Math.floor(o.pos.y) - 48);
        // Advance a falling liquid column from the sky into the pit. Vanilla lava alone
        // takes over a minute to descend this far, losing the impact of the earthquake.
        Job stream = job(Math.max(0, streamTop - streamBottom + 1) * 25, 4, 25, i -> {
            int x = (int)Math.floor(o.pos.x) + i % 5 - 2;
            int z = (int)Math.floor(o.pos.z) + (i % 25) / 5 - 2;
            BlockPos p = new BlockPos(x, streamTop - i / 25, z);
            if (o.level.getBlockState(p).canBeReplaced())
                set(o, p, Blocks.LAVA.defaultBlockState().setValue(LiquidBlock.LEVEL, 8));
        });
        stream.prerequisites = List.of(crater, frost, fissures);
        job(100 * count, 2, 4, i -> summon(o, "tnt", o.pos.x + random(o, 28), high(o, 40 + i % 10), o.pos.z + random(o, 28), "{Tags:[\"douma_cataclysm\"],Fuse:70s,Motion:[0.0,-1.0,0.0]}"));
        job(50 * count, 1, 5, i -> {
            int x = (int)Math.floor(o.pos.x + random(o, 18)), z = (int)Math.floor(o.pos.z + random(o, 18));
            if (loaded(o, x, z)) summon(o, "zombified_piglin", x + 0.5, surface(o, x, z), z + 0.5, "{Tags:[\"douma_cataclysm\"]}");
        });
        summon(o, "wither", o.pos.x + 10, Math.min(o.level.getMaxBuildHeight()-2, o.pos.y + 10), o.pos.z, "{Tags:[\"douma_cataclysm\"],Invul:100}");
        common(o, target, "witherhunt", 1);
    }

    private void motion(ServerPlayer p, double y) {
        p.setOnGround(false);
        p.setDeltaMovement(p.getDeltaMovement().x, y, p.getDeltaMovement().z);
        p.hurtMarked = true;
        p.connection.send(new ClientboundSetEntityMotionPacket(p));
    }
    private void skytrap(ServerPlayer p) {
        GameEvents.commonEffect(p.createCommandSourceStack(), "cancel_jump", 1, Map.of());
        p.removeEffect(MobEffects.SLOW_FALLING); p.removeEffect(MobEffects.LEVITATION);
        int top = p.serverLevel().getHeight(Heightmap.Types.MOTION_BLOCKING, p.getBlockX(), p.getBlockZ());
        if (!p.serverLevel().dimensionType().hasCeiling()) {
            p.teleportTo(p.getX(), Math.min(p.serverLevel().getMaxBuildHeight()-2, top + 85), p.getZ());
            p.fallDistance = 0;
            motion(p, -3.8);
        }
    }
}
