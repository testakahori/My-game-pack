package jp.streamtorearn.obsmodule.core;

import jp.streamtorearn.obsmodule.config.*;
import jp.streamtorearn.obsmodule.encounter.*;
import jp.streamtorearn.obsmodule.http.ObsControllerClient;
import jp.streamtorearn.obsmodule.tier.TierStateStore;

public final class ObsRuntime {
    public final ObsConfigLoader loader=new ObsConfigLoader();
    public final EncounterRuleRegistry rules=new EncounterRuleRegistry();
    public final TierStateStore tiers=new TierStateStore();
    public final ObsControllerClient http=new ObsControllerClient();
    public final EventPublisher publisher=new EventPublisher(http);
    public final EncounterDeduplicator encounterDedupe=new EncounterDeduplicator();
    public final VanillaEncounterDetector detector=new VanillaEncounterDetector(rules,tiers,publisher,encounterDedupe);
    public void load(){
        ObsConfig c=loader.load();
        rules.setConfig(c);
        encounterDedupe.configure(c.encounterPolicy.exactDedupeMs, c.encounterPolicy.crossSourceDedupeMs, c.encounterPolicy.dedupeMaxEntries);
        tiers.reset(c.tierPolicy.startupDefaultTier);
        http.setEndpoint(c.controller.endpoint);
        http.healthAsync();
    }
}
