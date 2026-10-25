package jp.streamtorearn.obsmodule.core;

import jp.streamtorearn.obsmodule.config.*;
import jp.streamtorearn.obsmodule.encounter.*;
import jp.streamtorearn.obsmodule.ObsBridgeMod;
import jp.streamtorearn.obsmodule.http.ObsControllerClient;
import net.minecraftforge.fml.loading.FMLPaths;
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
        // OBS ツールへ送るかは、MyGamePack が書く obs-send.properties で決める。無ければ送らない（2026-10-25）。
        ObsSendSettings send=ObsSendSettings.read(FMLPaths.CONFIGDIR.get().resolve("minecraft_obs_bridge").resolve(ObsSendSettings.FILE_NAME), c.controller.endpoint);
        http.setEndpoint(send.endpoint());
        http.setEnabled(send.enabled());
        if(send.enabled()){ObsBridgeMod.LOGGER.info("OBSMOD sends events to the OBS tool: {}", send.endpoint());http.healthAsync();}
        else ObsBridgeMod.LOGGER.info("OBSMOD does not send events to the OBS tool (turn it on in MyGamePack)");
    }
}
