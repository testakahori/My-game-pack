package jp.streamtorearn.obsmodule.config;

import java.util.*;

public final class ObsConfig {
    public int schemaVersion=4;
    public Controller controller=new Controller();
    public TierPolicy tierPolicy=new TierPolicy();
    public EncounterPolicy encounterPolicy=new EncounterPolicy();
    public List<GiftAction> giftActions=new ArrayList<>();
    public List<EncounterRule> encounterEvents=new ArrayList<>();
    public List<EventStartRule> eventStartEvents=new ArrayList<>();
    public List<Presentation> obsPresentation=new ArrayList<>();

    public static final class Controller { public String endpoint="http://127.0.0.1:3000/event"; }
    public static final class TierPolicy { public String startupDefaultTier="normal"; public boolean memoryOnly=true; public boolean minecraftExitForgets=true; }
    public static final class EncounterPolicy { public long exactDedupeMs=750L; public long crossSourceDedupeMs=300L; public int dedupeMaxEntries=256; }
    public static final class GiftAction {
        public String eventKey=""; public String encounterKey=""; public String defaultTier="normal"; public String defaultPriceTier="normal";
        /** Event Master metadata: implemented / candidate / unknown. */
        public String implementationStatus="";
        public String category="";
    }
    public static final class EncounterRule {
        public String eventKey=""; public Boolean enabled; public String entityId=""; public String attackKind=""; public int attackPriority=0; public String defaultTier="normal";
        public boolean isEnabled(){return enabled==null||enabled;}
    }
    public static final class EventStartRule {
        public String eventKey=""; public Boolean enabled; public Boolean encounterEnabled; public String defaultTier="normal";
        public boolean isEnabled(){return enabled==null||enabled;}
        public boolean isEncounterEnabled(){return encounterEnabled==null||encounterEnabled;}
    }
    public static final class Presentation { public String eventKey=""; public Boolean enabled; }
}
