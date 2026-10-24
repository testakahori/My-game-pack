package jp.streamtorearn.obsmodule.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import jp.streamtorearn.obsmodule.ObsBridgeMod;
import jp.streamtorearn.obsmodule.catalog.EventMaster;
import net.minecraftforge.fml.loading.FMLPaths;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

public final class ObsConfigLoader {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    /** Generated from the shared Event Master. */
    private static final Map<String,EventMaster.Start> REQUIRED_STARTS = new LinkedHashMap<>();
    private static final Map<String,EventMaster.Encounter> REQUIRED_ENCOUNTERS = new LinkedHashMap<>();
    static {
        REQUIRED_STARTS.putAll(EventMaster.STACKING_STARTS);
        EventMaster.ENCOUNTERS.values().stream()
                .filter(e -> EventMaster.STACKING_STARTS.containsKey(e.parentStartKey()))
                .forEach(e -> REQUIRED_ENCOUNTERS.put(e.key(), e));
    }

    public ObsConfig load() {
        Path dir = FMLPaths.CONFIGDIR.get().resolve("minecraft_obs_bridge");
        Path file = dir.resolve("events.generated.json");
        try {
            Files.createDirectories(dir);
            if (!Files.exists(file)) Files.writeString(file, defaultJson(), StandardCharsets.UTF_8);
            ObsConfig config = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), ObsConfig.class);
            if (config == null) config = new ObsConfig();
            boolean changed = normalizeAndMigrate(config);
            if (changed) {
                Files.writeString(file, GSON.toJson(config), StandardCharsets.UTF_8);
                ObsBridgeMod.LOGGER.info("OBSMOD migrated events.generated.json with required StackingGame lifecycle/encounter keys");
            }
            return config;
        } catch (Exception ex) {
            ObsBridgeMod.LOGGER.error("Failed to load events.generated.json", ex);
            return new ObsConfig();
        }
    }

    private boolean normalizeAndMigrate(ObsConfig c) {
        boolean changed = false;
        if (c.controller == null) { c.controller = new ObsConfig.Controller(); changed = true; }
        if (c.tierPolicy == null) { c.tierPolicy = new ObsConfig.TierPolicy(); changed = true; }
        if (c.encounterPolicy == null) { c.encounterPolicy = new ObsConfig.EncounterPolicy(); changed = true; }
        if (c.encounterPolicy.exactDedupeMs < 0) { c.encounterPolicy.exactDedupeMs = 750L; changed = true; }
        if (c.encounterPolicy.crossSourceDedupeMs < 0) { c.encounterPolicy.crossSourceDedupeMs = 300L; changed = true; }
        if (c.encounterPolicy.dedupeMaxEntries < 16 || c.encounterPolicy.dedupeMaxEntries > 4096) { c.encounterPolicy.dedupeMaxEntries = 256; changed = true; }
        if (c.giftActions == null) { c.giftActions = new java.util.ArrayList<>(); changed = true; }
        if (c.encounterEvents == null) { c.encounterEvents = new java.util.ArrayList<>(); changed = true; }
        if (c.eventStartEvents == null) { c.eventStartEvents = new java.util.ArrayList<>(); changed = true; }
        if (c.obsPresentation == null) { c.obsPresentation = new java.util.ArrayList<>(); changed = true; }
        if (c.schemaVersion < 4) { c.schemaVersion = 4; changed = true; }

        java.util.Set<String> existing = new java.util.HashSet<>();
        for (ObsConfig.EventStartRule rule : c.eventStartEvents) {
            if (rule == null || rule.eventKey == null || rule.eventKey.isBlank()) continue;
            existing.add(rule.eventKey);
            EventMaster.Start master = REQUIRED_STARTS.get(rule.eventKey);
            // 既存ユーザーが明示したtrue/falseは上書きしない。nullだけEvent Master既定値で補完する。
            if (master != null && rule.encounterEnabled == null) {
                rule.encounterEnabled = master.encounterEnabledByDefault();
                changed = true;
            }
        }
        for (Map.Entry<String, EventMaster.Start> entry : REQUIRED_STARTS.entrySet()) {
            if (existing.contains(entry.getKey())) continue;
            EventMaster.Start master = entry.getValue();
            ObsConfig.EventStartRule rule = new ObsConfig.EventStartRule();
            rule.eventKey = entry.getKey();
            rule.enabled = true;
            rule.encounterEnabled = master.encounterEnabledByDefault();
            rule.defaultTier = master.tier();
            c.eventStartEvents.add(rule);
            changed = true;
        }

        java.util.Set<String> existingEncounters = new java.util.HashSet<>();
        for (ObsConfig.EncounterRule rule : c.encounterEvents) {
            if (rule == null || rule.eventKey == null || rule.eventKey.isBlank()) continue;
            existingEncounters.add(rule.eventKey);
            EventMaster.Encounter masterEncounter = REQUIRED_ENCOUNTERS.get(rule.eventKey);
            if (masterEncounter != null && rule.enabled == null) {
                EventMaster.Start parent = REQUIRED_STARTS.get(masterEncounter.parentStartKey());
                rule.enabled = parent == null || parent.encounterEnabledByDefault();
                changed = true;
            }
        }
        for (Map.Entry<String, EventMaster.Encounter> entry : REQUIRED_ENCOUNTERS.entrySet()) {
            if (existingEncounters.contains(entry.getKey())) continue;
            EventMaster.Encounter master = entry.getValue();
            EventMaster.Start parent = REQUIRED_STARTS.get(master.parentStartKey());
            ObsConfig.EncounterRule rule = new ObsConfig.EncounterRule();
            rule.eventKey = entry.getKey();
            // StackingGameはEvent Master既定が「発生のみ」ならEncounter自体も初期無効。
            rule.enabled = parent == null || parent.encounterEnabledByDefault();
            rule.entityId = master.entityId();
            rule.attackKind = master.attackKind();
            rule.attackPriority = master.priority();
            rule.defaultTier = master.tier();
            c.encounterEvents.add(rule);
            existingEncounters.add(rule.eventKey);
            changed = true;
        }
        java.util.Set<String> existingGifts = new java.util.HashSet<>();
        for (ObsConfig.GiftAction rule : c.giftActions) {
            if (rule == null || rule.eventKey == null || rule.eventKey.isBlank()) continue;
            existingGifts.add(rule.eventKey);
            EventMaster.Gift masterGift = EventMaster.SIMPLE_GIFTS.get(rule.eventKey);
            if (masterGift != null) {
                if (rule.implementationStatus == null || rule.implementationStatus.isBlank()) { rule.implementationStatus = masterGift.status(); changed = true; }
                if (rule.category == null || rule.category.isBlank()) { rule.category = masterGift.category(); changed = true; }
            }
        }
        for (EventMaster.Gift g : EventMaster.SIMPLE_GIFTS.values()) {
            if (existingGifts.contains(g.key())) continue;
            ObsConfig.GiftAction rule = new ObsConfig.GiftAction(); rule.eventKey=g.key(); rule.encounterKey=g.encounterKey(); rule.defaultTier=g.tier(); rule.defaultPriceTier=g.tier(); rule.implementationStatus=g.status(); rule.category=g.category(); c.giftActions.add(rule); changed=true;
        }
        java.util.Set<String> allEncounterKeys = new java.util.HashSet<>();
        for (ObsConfig.EncounterRule rule : c.encounterEvents) if (rule != null && rule.eventKey != null) allEncounterKeys.add(rule.eventKey);
        for (EventMaster.Encounter e : EventMaster.ENCOUNTERS.values()) {
            if (allEncounterKeys.contains(e.key())) continue;
            ObsConfig.EncounterRule rule = new ObsConfig.EncounterRule(); rule.eventKey=e.key(); rule.enabled=true; rule.entityId=e.entityId(); rule.attackKind=e.attackKind(); rule.attackPriority=e.priority(); rule.defaultTier=e.tier(); c.encounterEvents.add(rule); changed=true;
        }
        return changed;
    }

    private String defaultJson() {
        return """
        {
          "schemaVersion": 4,
          "controller": {"endpoint":"http://127.0.0.1:3000/event"},
          "tierPolicy": {"startupDefaultTier":"normal","memoryOnly":true,"minecraftExitForgets":true},
          "encounterPolicy": {"exactDedupeMs":750,"crossSourceDedupeMs":300,"dedupeMaxEntries":256},
          "giftActions": [
            {"eventKey":"gift_spawn_bubble","encounterKey":"bubble_trap","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_spawn_sumo","encounterKey":"sumo_hit","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_spawn_tornado","encounterKey":"tornado_catch","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_spawn_bomb_floor","encounterKey":"bomb_floor_explosion","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_spawn_enemy_mob","encounterKey":"","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_spawn_villager","encounterKey":"","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_grant_item","encounterKey":"","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_grant_equipment","encounterKey":"","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_grant_buff","encounterKey":"","defaultTier":"normal","defaultPriceTier":"normal"},
            {"eventKey":"gift_grant_debuff","encounterKey":"","defaultTier":"normal","defaultPriceTier":"normal"}
          ],
          "eventStartEvents": [],
          "encounterEvents": [],
          "obsPresentation": []
        }
        """;
    }
}
