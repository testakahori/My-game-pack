package jp.streamtorearn.stackinggame.config;

import net.minecraftforge.common.ForgeConfigSpec;
import java.util.List;

public final class StackingConfig {
    public static final ForgeConfigSpec SPEC;
    public static final ForgeConfigSpec.IntValue GROUND_DEPTH, MAX_CRATER_RADIUS, ORIGINAL_MAX_RADIUS;
    public static final ForgeConfigSpec.IntValue ARENA_MIN_X, ARENA_MIN_Y, ARENA_MIN_Z, ARENA_MAX_X, ARENA_MAX_Y, ARENA_MAX_Z;
    public static final ForgeConfigSpec.ConfigValue<String> ARENA_DIMENSION;
    public static final ForgeConfigSpec.ConfigValue<List<? extends String>> PROTECTED_BLOCKS;
    public static final ForgeConfigSpec.IntValue VOID_WARNING, VOID_DEPTH, RAIN_MAX_COUNT, RAIN_MIN_INTERVAL;
    public static final ForgeConfigSpec.DoubleValue VOID_RADIUS, VOID_DAMAGE, VOID_KNOCKBACK;
    public static final ForgeConfigSpec.IntValue MEGA_TRACK_SECONDS, MEGA_SAMPLE_TICKS, MEGA_MAX_POINTS, AQUA_HEIGHT, AQUA_RISE_TICKS, AQUA_HOLD_SECONDS, NETHER_LIFETIME_SECONDS;
    public static final ForgeConfigSpec.DoubleValue MEGA_MIN_DISTANCE, MEGA_DAMAGE, MEGA_KNOCKBACK, AQUA_RESTRAINT;
    public static final ForgeConfigSpec.IntValue MAGMA_DEFAULT_COUNT, MAGMA_HEIGHT, MAGMA_TELEGRAPH, MAGMA_DURATION, AQUARIUM_MAX_BLOCKS;

    // v2.5.0: six original large-scale events
    public static final ForgeConfigSpec.IntValue SINGULARITY_FORMATION_TICKS, SINGULARITY_EJECT_TICK, SINGULARITY_MAX_BLOCKS, SINGULARITY_BLOCKS_PER_BATCH, SINGULARITY_VERTICAL_RANGE;
    public static final ForgeConfigSpec.DoubleValue SINGULARITY_RADIUS, SINGULARITY_PULL_STRENGTH, SINGULARITY_SWIRL_STRENGTH, SINGULARITY_PLAYER_PULL, SINGULARITY_EJECT_POWER, SINGULARITY_DAMAGE;

    public static final ForgeConfigSpec.IntValue METEOR_FALL_HEIGHT, METEOR_FALL_TICKS, METEOR_SHOWER_DEFAULT_COUNT, METEOR_SHOWER_MAX_COUNT, METEOR_SHOWER_INTERVAL, METEOR_SHOWER_RADIUS, METEOR_SHOWER_DEPTH;
    public static final ForgeConfigSpec.DoubleValue METEOR_SHOWER_BLAST_RADIUS, METEOR_SHOWER_DAMAGE, METEOR_SHOWER_KNOCKBACK;

    public static final ForgeConfigSpec.IntValue METEOR_PURGE_DEFAULT_COUNT, METEOR_PURGE_MAX_COUNT, METEOR_PURGE_INTERVAL, METEOR_PURGE_RADIUS, METEOR_PURGE_VERTICAL_RANGE, METEOR_PURGE_MAX_BLOCKS_PER_IMPACT;
    public static final ForgeConfigSpec.DoubleValue METEOR_PURGE_BLAST_RADIUS, METEOR_PURGE_DAMAGE, METEOR_PURGE_KNOCKBACK;

    public static final ForgeConfigSpec.IntValue TORNADO_DURATION_SECONDS, TORNADO_RADIUS, TORNADO_MAX_BLOCKS, TORNADO_BLOCKS_PER_BATCH, TORNADO_VERTICAL_RANGE, TORNADO_VISUAL_HEIGHT;
    public static final ForgeConfigSpec.DoubleValue TORNADO_SWIRL_STRENGTH, TORNADO_PLAYER_SWIRL;

    public static final ForgeConfigSpec.IntValue ORBITAL_LASER_WARNING_TICKS, ORBITAL_LASER_BEAM_TICKS, ORBITAL_LASER_VERTICAL_RANGE, ORBITAL_LASER_MAX_BLOCKS;
    public static final ForgeConfigSpec.DoubleValue ORBITAL_LASER_RADIUS, ORBITAL_LASER_DAMAGE, ORBITAL_LASER_KNOCKBACK;

    public static final ForgeConfigSpec.IntValue SHOCKWAVE_RADIUS, SHOCKWAVE_INTERVAL_TICKS, SHOCKWAVE_VERTICAL_RANGE, SHOCKWAVE_MAX_BLOCKS, SHOCKWAVE_MAX_BLOCKS_PER_RING, SHOCKWAVE_MAX_ENTITIES_PER_RING;
    public static final ForgeConfigSpec.DoubleValue SHOCKWAVE_BLOCK_SPEED, SHOCKWAVE_DAMAGE, SHOCKWAVE_KNOCKBACK;

    static {
        ForgeConfigSpec.Builder b = new ForgeConfigSpec.Builder();

        // v2.6.2: fixed landfill/stacking arena discovered from the production map.
        // The defaults exactly match: fill 6 49 6 -6 56 -6 ...
        b.push("arena");
        ARENA_DIMENSION = b.define("dimension", "minecraft:overworld");
        ARENA_MIN_X = b.defineInRange("min-x", -6, -30000000, 30000000);
        ARENA_MIN_Y = b.defineInRange("min-y", 49, -2048, 2048);
        ARENA_MIN_Z = b.defineInRange("min-z", -6, -30000000, 30000000);
        ARENA_MAX_X = b.defineInRange("max-x", 6, -30000000, 30000000);
        ARENA_MAX_Y = b.defineInRange("max-y", 56, -2048, 2048);
        ARENA_MAX_Z = b.defineInRange("max-z", 6, -30000000, 30000000);
        b.pop();

        b.push("safety");
        GROUND_DEPTH = b.defineInRange("ground-search-depth", 32, 1, 128);
        MAX_CRATER_RADIUS = b.defineInRange("max-crater-radius", 12, 1, 32);
        ORIGINAL_MAX_RADIUS = b.defineInRange("original-event-max-radius", 20, 4, 32);
        PROTECTED_BLOCKS = b.defineListAllowEmpty("protected-blocks", List.of(
                "minecraft:bedrock", "minecraft:barrier", "minecraft:command_block", "minecraft:chain_command_block", "minecraft:repeating_command_block",
                "minecraft:structure_block", "minecraft:jigsaw", "minecraft:end_portal", "minecraft:end_portal_frame", "minecraft:end_gateway",
                "minecraft:obsidian", "minecraft:crying_obsidian"), o -> o instanceof String);
        b.pop();

        b.push("voidbomb");
        VOID_WARNING = b.defineInRange("warning-ticks", 40, 1, 200);
        VOID_RADIUS = b.defineInRange("crater-radius", 5D, 1D, 12D);
        VOID_DEPTH = b.defineInRange("crater-depth", 4, 1, 12);
        VOID_DAMAGE = b.defineInRange("damage", 12D, 0D, 100D);
        VOID_KNOCKBACK = b.defineInRange("knockback", 1.6D, 0D, 10D);
        b.pop();

        b.push("voidbomb-rain");
        RAIN_MAX_COUNT = b.defineInRange("max-count", 100, 1, 500);
        RAIN_MIN_INTERVAL = b.defineInRange("min-interval-ticks", 1, 1, 200);
        b.pop();

        b.push("megablast");
        MEGA_TRACK_SECONDS = b.defineInRange("tracking-seconds", 4, 1, 30);
        MEGA_SAMPLE_TICKS = b.defineInRange("sample-interval-ticks", 4, 1, 20);
        MEGA_MIN_DISTANCE = b.defineInRange("minimum-distance", 1D, 0.25D, 10D);
        MEGA_MAX_POINTS = b.defineInRange("max-points", 24, 1, 64);
        MEGA_DAMAGE = b.defineInRange("damage", 14D, 0D, 100D);
        MEGA_KNOCKBACK = b.defineInRange("knockback", 1.8D, 0D, 10D);
        b.pop();

        b.push("aquatower");
        AQUA_HEIGHT = b.defineInRange("height", 20, 1, 64);
        AQUA_RISE_TICKS = b.defineInRange("rise-interval-ticks", 3, 1, 20);
        AQUA_HOLD_SECONDS = b.defineInRange("hold-seconds", 8, 1, 60);
        AQUA_RESTRAINT = b.defineInRange("restraint-radius", 0.65D, 0.1D, 3D);
        b.pop();

        b.push("magmatower");
        MAGMA_DEFAULT_COUNT = b.defineInRange("default-count", 5, 1, 20);
        MAGMA_HEIGHT = b.defineInRange("height", 8, 1, 32);
        MAGMA_TELEGRAPH = b.defineInRange("telegraph-ticks", 20, 1, 200);
        MAGMA_DURATION = b.defineInRange("duration-seconds", 10, 1, 60);
        b.pop();

        b.push("aquarium");
        AQUARIUM_MAX_BLOCKS = b.defineInRange("max-blocks", 8000, 1, 50000);
        b.pop();

        b.push("nether-army");
        NETHER_LIFETIME_SECONDS = b.defineInRange("lifetime-seconds", 60, 1, 600);
        b.pop();

        b.push("void-singularity");
        SINGULARITY_FORMATION_TICKS = b.defineInRange("formation-ticks", 20, 5, 100);
        SINGULARITY_EJECT_TICK = b.defineInRange("eject-tick", 100, 40, 240);
        SINGULARITY_RADIUS = b.defineInRange("radius", 8D, 3D, 20D);
        SINGULARITY_MAX_BLOCKS = b.defineInRange("max-blocks", 180, 0, 600);
        SINGULARITY_BLOCKS_PER_BATCH = b.defineInRange("blocks-per-batch", 6, 1, 32);
        SINGULARITY_VERTICAL_RANGE = b.defineInRange("vertical-range", 12, 2, 32);
        SINGULARITY_PULL_STRENGTH = b.defineInRange("block-pull-strength", 0.18D, 0.01D, 1D);
        SINGULARITY_SWIRL_STRENGTH = b.defineInRange("block-swirl-strength", 0.20D, 0D, 1D);
        SINGULARITY_PLAYER_PULL = b.defineInRange("player-pull-strength", 0.13D, 0D, 1D);
        SINGULARITY_EJECT_POWER = b.defineInRange("eject-power", 2.2D, 0.1D, 6D);
        SINGULARITY_DAMAGE = b.defineInRange("damage", 8D, 0D, 100D);
        b.pop();

        b.push("meteor-common");
        METEOR_FALL_HEIGHT = b.defineInRange("fall-height", 32, 12, 96);
        METEOR_FALL_TICKS = b.defineInRange("fall-ticks", 34, 8, 120);
        b.pop();

        b.push("meteor-shower");
        METEOR_SHOWER_DEFAULT_COUNT = b.defineInRange("default-count", 7, 1, 30);
        METEOR_SHOWER_MAX_COUNT = b.defineInRange("max-count", 20, 1, 60);
        METEOR_SHOWER_INTERVAL = b.defineInRange("interval-ticks", 10, 1, 80);
        METEOR_SHOWER_RADIUS = b.defineInRange("target-radius", 10, 2, 20);
        METEOR_SHOWER_BLAST_RADIUS = b.defineInRange("blast-radius", 5.5D, 2D, 12D);
        METEOR_SHOWER_DEPTH = b.defineInRange("crater-depth", 3, 1, 8);
        METEOR_SHOWER_DAMAGE = b.defineInRange("damage", 14D, 0D, 100D);
        METEOR_SHOWER_KNOCKBACK = b.defineInRange("knockback", 2.0D, 0D, 8D);
        b.pop();

        b.push("meteor-purge");
        METEOR_PURGE_DEFAULT_COUNT = b.defineInRange("default-count", 5, 1, 30);
        METEOR_PURGE_MAX_COUNT = b.defineInRange("max-count", 16, 1, 40);
        METEOR_PURGE_INTERVAL = b.defineInRange("interval-ticks", 12, 1, 100);
        METEOR_PURGE_RADIUS = b.defineInRange("target-radius", 8, 2, 20);
        METEOR_PURGE_BLAST_RADIUS = b.defineInRange("purge-radius-per-impact", 6.5D, 2D, 16D);
        METEOR_PURGE_VERTICAL_RANGE = b.defineInRange("vertical-range", 28, 2, 64);
        METEOR_PURGE_MAX_BLOCKS_PER_IMPACT = b.defineInRange("max-blocks-per-impact", 800, 1, 6000);
        METEOR_PURGE_DAMAGE = b.defineInRange("damage", 8D, 0D, 100D);
        METEOR_PURGE_KNOCKBACK = b.defineInRange("knockback", 1.5D, 0D, 8D);
        b.pop();

        b.push("tornado");
        TORNADO_DURATION_SECONDS = b.defineInRange("duration-seconds", 10, 2, 60);
        TORNADO_RADIUS = b.defineInRange("radius", 8, 2, 20);
        TORNADO_MAX_BLOCKS = b.defineInRange("max-blocks", 180, 0, 600);
        TORNADO_BLOCKS_PER_BATCH = b.defineInRange("blocks-per-batch", 5, 1, 32);
        TORNADO_VERTICAL_RANGE = b.defineInRange("block-vertical-range", 10, 2, 32);
        TORNADO_VISUAL_HEIGHT = b.defineInRange("visual-height", 14, 6, 32);
        TORNADO_SWIRL_STRENGTH = b.defineInRange("block-swirl-strength", 0.35D, 0.05D, 1.5D);
        TORNADO_PLAYER_SWIRL = b.defineInRange("player-swirl-strength", 0.20D, 0.01D, 1D);
        b.pop();

        b.push("orbital-laser");
        ORBITAL_LASER_WARNING_TICKS = b.defineInRange("warning-ticks", 60, 20, 200);
        ORBITAL_LASER_BEAM_TICKS = b.defineInRange("beam-ticks", 24, 5, 100);
        ORBITAL_LASER_RADIUS = b.defineInRange("radius", 4.5D, 1D, 12D);
        ORBITAL_LASER_VERTICAL_RANGE = b.defineInRange("vertical-range", 48, 4, 96);
        ORBITAL_LASER_MAX_BLOCKS = b.defineInRange("max-blocks", 1800, 1, 12000);
        ORBITAL_LASER_DAMAGE = b.defineInRange("damage", 16D, 0D, 100D);
        ORBITAL_LASER_KNOCKBACK = b.defineInRange("knockback", 1.7D, 0D, 8D);
        b.pop();

        b.push("shockwave-collapse");
        SHOCKWAVE_RADIUS = b.defineInRange("radius", 12, 2, 20);
        SHOCKWAVE_INTERVAL_TICKS = b.defineInRange("ring-interval-ticks", 4, 1, 20);
        SHOCKWAVE_VERTICAL_RANGE = b.defineInRange("vertical-range", 22, 2, 48);
        SHOCKWAVE_MAX_BLOCKS = b.defineInRange("max-blocks", 1200, 1, 8000);
        SHOCKWAVE_MAX_BLOCKS_PER_RING = b.defineInRange("max-blocks-per-ring", 180, 1, 1000);
        SHOCKWAVE_MAX_ENTITIES_PER_RING = b.defineInRange("max-falling-entities-per-ring", 64, 0, 256);
        SHOCKWAVE_BLOCK_SPEED = b.defineInRange("block-speed", 1.15D, 0.1D, 4D);
        SHOCKWAVE_DAMAGE = b.defineInRange("damage", 7D, 0D, 100D);
        SHOCKWAVE_KNOCKBACK = b.defineInRange("knockback", 2.0D, 0D, 8D);
        b.pop();

        SPEC = b.build();
    }

    private StackingConfig() {}
}
