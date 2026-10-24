package jp.streamtorearn.obsmodule.encounter;

import jp.streamtorearn.obsmodule.ObsBridgeMod;
import jp.streamtorearn.obsmodule.config.ObsConfig;
import jp.streamtorearn.obsmodule.catalog.EventMaster;
import jp.streamtorearn.obsmodule.catalog.EventMasterPolicy;

import java.util.*;

public final class EncounterRuleRegistry {
    private ObsConfig config=new ObsConfig();
    private final AttackEventResolver attackResolver=new AttackEventResolver();
    private final Map<String,ObsConfig.EventStartRule> starts=new LinkedHashMap<>();
    private final Map<String,ObsConfig.GiftAction> gifts=new LinkedHashMap<>();
    private static final Set<String> REQUIRED_STARTS = EventMaster.STACKING_STARTS.keySet();
    private static final Map<String,String> START_TIERS = EventMaster.STACKING_STARTS.entrySet().stream().collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, e -> e.getValue().tier(), (a,b)->a, LinkedHashMap::new));

    public void setConfig(ObsConfig c){
        config=c; starts.clear(); gifts.clear();
        for(var s:c.eventStartEvents) if(s!=null&&!s.eventKey.isBlank()) starts.put(s.eventKey,s);
        for(var g:c.giftActions) if(g!=null&&!g.eventKey.isBlank()) gifts.put(g.eventKey,g);
        if(c.schemaVersion>=2){ Set<String> missing=new TreeSet<>(REQUIRED_STARTS); missing.removeAll(starts.keySet()); if(!missing.isEmpty()) ObsBridgeMod.LOGGER.warn("OBSMOD missing StackingGame eventStartEvents: {}",missing); }
    }

    public ObsConfig config(){return config;}
    public ObsConfig.GiftAction gift(String key){return gifts.get(key);}
    public boolean knownStart(String key){ return key!=null && (starts.containsKey(key) || EventMaster.STACKING_STARTS.containsKey(key)); }
    public boolean knownEncounter(String key){
        if(key==null) return false;
        if(EventMaster.ENCOUNTERS.containsKey(key)) return true;
        for(var r:config.encounterEvents) if(r!=null && key.equals(r.eventKey)) return true;
        return false;
    }
    public boolean knownGift(String key){ return key!=null && (gifts.containsKey(key) || EventMaster.SIMPLE_GIFTS.containsKey(key)); }
    public boolean candidateGift(String key){ return EventMasterPolicy.isCandidateGift(key); }
    public String implementationStatus(String key){ return EventMasterPolicy.implementationStatus(key); }
    public String category(String key){ return EventMasterPolicy.category(key); }
    public boolean startAllowed(String key){
        if(config.schemaVersion<2 && REQUIRED_STARTS.contains(key)) return true;
        if(config.schemaVersion<2 || starts.isEmpty()) return knownAnywhere(key) || REQUIRED_STARTS.contains(key);
        var r=starts.get(key); return r!=null&&r.isEnabled();
    }
    public String startTier(String key){
        var r=starts.get(key);
        if(r!=null && r.defaultTier!=null && !r.defaultTier.isBlank()) return r.defaultTier;
        return START_TIERS.getOrDefault(key,"normal");
    }

    public String encounterTier(String key){ for(var r:config.encounterEvents) if(r!=null && key.equals(r.eventKey) && r.isEnabled()) return (r.defaultTier==null||r.defaultTier.isBlank())?"normal":r.defaultTier; return "normal"; }
    public boolean encounterAllowed(String key){
        if(key!=null && key.endsWith("_encounter")){
            String parent=key.substring(0,key.length()-"_encounter".length());
            var start=starts.get(parent);
            if(start!=null && !start.isEncounterEnabled()) return false;
        }
        for(var r:config.encounterEvents){
            if(r!=null && key.equals(r.eventKey)) return r.isEnabled();
        }
        return false;
    }

    private boolean knownAnywhere(String key){ if(starts.containsKey(key)||gifts.containsKey(key))return true; for(var r:config.encounterEvents)if(r!=null && key.equals(r.eventKey))return true; return false; }

    public ObsConfig.EncounterRule match(DamageContext dc){
        return attackResolver.resolve(dc, config.encounterEvents);
    }
}
