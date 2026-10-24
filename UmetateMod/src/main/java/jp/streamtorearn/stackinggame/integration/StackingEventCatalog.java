package jp.streamtorearn.stackinggame.integration;

import jp.streamtorearn.stackinggame.event.BlockInteractionMode;
import jp.streamtorearn.stackinggame.event.EventTargetMode;

import java.util.LinkedHashMap;
import java.util.Map;

/** GENERATED metadata from event-master/events.master.json by scripts/sync-event-master.cjs. */
public final class StackingEventCatalog {
    public record Meta(String eventKey, String encounterKey, String displayName, String tier, EventTargetMode targetMode, BlockInteractionMode blockMode, String encounterKind, String attackKind, int attackPriority) {}
    private static final Map<String, Meta> BY_KEY = new LinkedHashMap<>();
    static {
        add(new Meta(EventMasterKeys.AQUATOWER, EventMasterKeys.AQUATOWER_ENCOUNTER, "アクアタワー", "normal", EventTargetMode.PLAYER, BlockInteractionMode.TEMPORARY, "water_lift", "game_event", 45));
        add(new Meta(EventMasterKeys.MAGMATOWER, EventMasterKeys.MAGMATOWER_ENCOUNTER, "マグマタワー", "normal", EventTargetMode.PLAYER, BlockInteractionMode.TEMPORARY, "lava_tower_near", "game_event", 45));
        add(new Meta(EventMasterKeys.AQUARIUM, EventMasterKeys.AQUARIUM_ENCOUNTER, "アクアリウム", "normal", EventTargetMode.ARENA, BlockInteractionMode.TEMPORARY, "inside_aquarium", "game_event", 45));
        add(new Meta(EventMasterKeys.VOIDBOMB, EventMasterKeys.VOIDBOMB_ENCOUNTER, "ボイドボム", "normal", EventTargetMode.PLAYER, BlockInteractionMode.TERRAIN, "explosion", "explosion", 55));
        add(new Meta(EventMasterKeys.VOIDBOMB_RAIN, EventMasterKeys.VOIDBOMB_RAIN_ENCOUNTER, "ボイドボム連続", "major", EventTargetMode.ARENA, BlockInteractionMode.TERRAIN, "explosion", "explosion", 60));
        add(new Meta(EventMasterKeys.MEGABLAST, EventMasterKeys.MEGABLAST_ENCOUNTER, "メガブラスト", "major", EventTargetMode.PLAYER, BlockInteractionMode.TERRAIN, "explosion", "explosion", 60));
        add(new Meta(EventMasterKeys.NETHER_ARMY, EventMasterKeys.NETHER_ARMY_ENCOUNTER, "ネザー軍団", "normal", EventTargetMode.PLAYER, BlockInteractionMode.NONE, "enemy_close", "game_event", 50));
        add(new Meta(EventMasterKeys.VOID_SINGULARITY, EventMasterKeys.VOID_SINGULARITY_ENCOUNTER, "ボイド・シンギュラリティ", "major", EventTargetMode.ARENA, BlockInteractionMode.STACK_FALLING, "gravity_pull", "game_event", 65));
        add(new Meta(EventMasterKeys.METEOR_SHOWER, EventMasterKeys.METEOR_SHOWER_ENCOUNTER, "メテオシャワー", "major", EventTargetMode.PLAYER, BlockInteractionMode.TERRAIN, "meteor_impact", "explosion", 65));
        add(new Meta(EventMasterKeys.METEOR_PURGE, EventMasterKeys.METEOR_PURGE_ENCOUNTER, "メテオパージ", "major", EventTargetMode.ARENA, BlockInteractionMode.STACK_ONLY, "meteor_impact", "explosion", 65));
        add(new Meta(EventMasterKeys.TORNADO, EventMasterKeys.TORNADO_ENCOUNTER, "トルネード", "major", EventTargetMode.ARENA, BlockInteractionMode.STACK_FALLING, "tornado_catch", "game_event", 65));
        add(new Meta(EventMasterKeys.ORBITAL_LASER, EventMasterKeys.ORBITAL_LASER_ENCOUNTER, "オービタルレーザー", "major", EventTargetMode.ARENA, BlockInteractionMode.STACK_ONLY, "laser_hit", "game_event", 70));
        add(new Meta(EventMasterKeys.SHOCKWAVE_COLLAPSE, EventMasterKeys.SHOCKWAVE_COLLAPSE_ENCOUNTER, "ショックウェーブ・コラプス", "major", EventTargetMode.ARENA, BlockInteractionMode.STACK_FALLING, "shockwave_hit", "game_event", 65));
    }
    private static void add(Meta meta) { BY_KEY.put(meta.eventKey(), meta); }
    public static Meta get(String key) { Meta m=BY_KEY.get(key); if(m==null) throw new IllegalArgumentException("unknown eventKey: "+key); return m; }
    public static Map<String, Meta> all() { return java.util.Collections.unmodifiableMap(BY_KEY); }
    private StackingEventCatalog() {}
}
