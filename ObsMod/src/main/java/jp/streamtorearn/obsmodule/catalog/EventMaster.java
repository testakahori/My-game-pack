package jp.streamtorearn.obsmodule.catalog;

import java.util.LinkedHashMap;
import java.util.Map;

/** GENERATED from event-master/events.master.json by scripts/sync-event-master.cjs. */
public final class EventMaster {
    public static final String CATALOG_VERSION = "2026.10.10-1";
    public record Start(String key, String displayName, String tier, String encounterKey, boolean encounterEnabledByDefault) {}
    public record Encounter(String key, String displayName, String entityId, String attackKind, int priority, String tier, String parentStartKey) {}
    public record Gift(String key, String displayName, String encounterKey, String tier, String category, String status) {}
    public static final Map<String,Start> STACKING_STARTS = new LinkedHashMap<>();
    public static final Map<String,Encounter> ENCOUNTERS = new LinkedHashMap<>();
    public static final Map<String,Gift> SIMPLE_GIFTS = new LinkedHashMap<>();
    static {
        STACKING_STARTS.put("aquatower", new Start("aquatower", "アクアタワー", "normal", "aquatower_encounter", false));
        ENCOUNTERS.put("aquatower_encounter", new Encounter("aquatower_encounter", "アクアタワー：遭遇", "", "game_event", 45, "normal", "aquatower"));
        STACKING_STARTS.put("magmatower", new Start("magmatower", "マグマタワー", "normal", "magmatower_encounter", false));
        ENCOUNTERS.put("magmatower_encounter", new Encounter("magmatower_encounter", "マグマタワー：遭遇", "", "game_event", 45, "normal", "magmatower"));
        STACKING_STARTS.put("aquarium", new Start("aquarium", "アクアリウム", "normal", "aquarium_encounter", false));
        ENCOUNTERS.put("aquarium_encounter", new Encounter("aquarium_encounter", "アクアリウム：遭遇", "", "game_event", 45, "normal", "aquarium"));
        STACKING_STARTS.put("voidbomb", new Start("voidbomb", "ボイドボム", "normal", "voidbomb_encounter", false));
        ENCOUNTERS.put("voidbomb_encounter", new Encounter("voidbomb_encounter", "ボイドボム：遭遇", "", "explosion", 55, "normal", "voidbomb"));
        STACKING_STARTS.put("voidbomb_rain", new Start("voidbomb_rain", "ボイドボム連続", "major", "voidbomb_rain_encounter", false));
        ENCOUNTERS.put("voidbomb_rain_encounter", new Encounter("voidbomb_rain_encounter", "ボイドボム連続：遭遇", "", "explosion", 60, "major", "voidbomb_rain"));
        STACKING_STARTS.put("megablast", new Start("megablast", "メガブラスト", "major", "megablast_encounter", false));
        ENCOUNTERS.put("megablast_encounter", new Encounter("megablast_encounter", "メガブラスト：遭遇", "", "explosion", 60, "major", "megablast"));
        STACKING_STARTS.put("nether_army", new Start("nether_army", "ネザー軍団", "normal", "nether_army_encounter", false));
        ENCOUNTERS.put("nether_army_encounter", new Encounter("nether_army_encounter", "ネザー軍団：遭遇", "", "game_event", 50, "normal", "nether_army"));
        STACKING_STARTS.put("void_singularity", new Start("void_singularity", "ボイド・シンギュラリティ", "major", "void_singularity_encounter", false));
        ENCOUNTERS.put("void_singularity_encounter", new Encounter("void_singularity_encounter", "ボイド・シンギュラリティ：遭遇", "", "game_event", 65, "major", "void_singularity"));
        STACKING_STARTS.put("meteor_shower", new Start("meteor_shower", "メテオシャワー", "major", "meteor_shower_encounter", false));
        ENCOUNTERS.put("meteor_shower_encounter", new Encounter("meteor_shower_encounter", "メテオシャワー：遭遇", "", "explosion", 65, "major", "meteor_shower"));
        STACKING_STARTS.put("meteor_purge", new Start("meteor_purge", "メテオパージ", "major", "meteor_purge_encounter", false));
        ENCOUNTERS.put("meteor_purge_encounter", new Encounter("meteor_purge_encounter", "メテオパージ：遭遇", "", "explosion", 65, "major", "meteor_purge"));
        STACKING_STARTS.put("tornado", new Start("tornado", "トルネード", "major", "tornado_encounter", false));
        ENCOUNTERS.put("tornado_encounter", new Encounter("tornado_encounter", "トルネード：遭遇", "", "game_event", 65, "major", "tornado"));
        STACKING_STARTS.put("orbital_laser", new Start("orbital_laser", "オービタルレーザー", "major", "orbital_laser_encounter", false));
        ENCOUNTERS.put("orbital_laser_encounter", new Encounter("orbital_laser_encounter", "オービタルレーザー：遭遇", "", "game_event", 70, "major", "orbital_laser"));
        STACKING_STARTS.put("shockwave_collapse", new Start("shockwave_collapse", "ショックウェーブ・コラプス", "major", "shockwave_collapse_encounter", false));
        ENCOUNTERS.put("shockwave_collapse_encounter", new Encounter("shockwave_collapse_encounter", "ショックウェーブ・コラプス：遭遇", "", "game_event", 65, "major", "shockwave_collapse"));
        SIMPLE_GIFTS.put("gift_spawn_zombie", new Gift("gift_spawn_zombie", "ゾンビ召喚", "zombie_hit", "normal", "mob", "candidate"));
        ENCOUNTERS.put("zombie_hit", new Encounter("zombie_hit", "ゾンビ召喚：攻撃", "minecraft:zombie", "melee", 20, "normal", "gift_spawn_zombie"));
        SIMPLE_GIFTS.put("gift_spawn_creeper", new Gift("gift_spawn_creeper", "クリーパー召喚", "creeper_blast", "major", "mob", "candidate"));
        ENCOUNTERS.put("creeper_blast", new Encounter("creeper_blast", "クリーパー召喚：攻撃", "minecraft:creeper", "explosion", 50, "major", "gift_spawn_creeper"));
        SIMPLE_GIFTS.put("gift_spawn_skeleton", new Gift("gift_spawn_skeleton", "スケルトン召喚", "skeleton_arrow", "normal", "mob", "candidate"));
        ENCOUNTERS.put("skeleton_arrow", new Encounter("skeleton_arrow", "スケルトン召喚：攻撃", "minecraft:skeleton", "projectile", 25, "normal", "gift_spawn_skeleton"));
        SIMPLE_GIFTS.put("gift_buff_speed", new Gift("gift_buff_speed", "移動速度アップ", "", "normal", "buff", "candidate"));
        SIMPLE_GIFTS.put("gift_buff_strength", new Gift("gift_buff_strength", "攻撃力アップ", "", "normal", "buff", "candidate"));
        SIMPLE_GIFTS.put("gift_buff_resistance", new Gift("gift_buff_resistance", "耐性アップ", "", "normal", "buff", "candidate"));
        SIMPLE_GIFTS.put("gift_debuff_slowness", new Gift("gift_debuff_slowness", "移動速度ダウン", "", "normal", "debuff", "candidate"));
        SIMPLE_GIFTS.put("gift_debuff_weakness", new Gift("gift_debuff_weakness", "攻撃力ダウン", "", "normal", "debuff", "candidate"));
        SIMPLE_GIFTS.put("gift_debuff_blindness", new Gift("gift_debuff_blindness", "盲目", "", "normal", "debuff", "candidate"));
        SIMPLE_GIFTS.put("gift_debuff_nausea", new Gift("gift_debuff_nausea", "吐き気", "", "normal", "debuff", "candidate"));
    }
    private EventMaster() {}
}
