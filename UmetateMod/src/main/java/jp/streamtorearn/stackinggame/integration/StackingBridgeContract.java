package jp.streamtorearn.stackinggame.integration;

/**
 * BridgeMOD 1.4.0 GameEvents API と StackingGame の固定契約。
 * 外部I/Fでは数値ordinalを使わず、文字列eventKeyを固定する。
 */
public final class StackingBridgeContract {
    private StackingBridgeContract() {}

    /** game.json の modId / GAME_MOD と一致させる。 */
    public static final String GAME_ID = "stackinggame_events";

    public static final String AQUA_TOWER = "aquatower";
    public static final String MAGMA_TOWER = "magmatower";
    public static final String AQUARIUM = EventMasterKeys.AQUARIUM;
    public static final String VOID_BOMB = "voidbomb";
    public static final String VOID_BOMB_RAIN = "voidbomb_rain";
    public static final String MEGA_BLAST = "megablast";
    public static final String NETHER_ARMY = EventMasterKeys.NETHER_ARMY;
    public static final String VOID_SINGULARITY = EventMasterKeys.VOID_SINGULARITY;
    public static final String METEOR_SHOWER = EventMasterKeys.METEOR_SHOWER;
    public static final String METEOR_PURGE = EventMasterKeys.METEOR_PURGE;
    public static final String TORNADO = EventMasterKeys.TORNADO;
    public static final String ORBITAL_LASER = EventMasterKeys.ORBITAL_LASER;
    public static final String SHOCKWAVE_COLLAPSE = EventMasterKeys.SHOCKWAVE_COLLAPSE;

    /** Canonical numeric quantity for an event. Preferred over event-specific count names. */
    public static final String COUNT = "count";

    /** Legacy aliases kept for Bridge/profile compatibility. */
    public static final String TOWER_COUNT = "towerCount";
    public static final String PAIRS = "pairs";
    public static final String X1 = "x1";
    public static final String Y1 = "y1";
    public static final String Z1 = "z1";
    public static final String X2 = "x2";
    public static final String Y2 = "y2";
    public static final String Z2 = "z2";
    /** Legacy alias. Prefer DURATION_SECONDS. */
    public static final String SECONDS = "seconds";
    /** Legacy alias. Prefer COUNT. */
    public static final String IMPACT_COUNT = "impactCount";
    public static final String INTERVAL_TICKS = "intervalTicks";
    public static final String TARGET_X = "targetX";
    public static final String TARGET_Y = "targetY";
    public static final String TARGET_Z = "targetZ";
    public static final String RADIUS = "radius";
    /** Legacy alias. Prefer COUNT. */
    public static final String METEOR_COUNT = "meteorCount";
    public static final String DURATION_SECONDS = "durationSeconds";
}
