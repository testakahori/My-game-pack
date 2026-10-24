package jp.streamtorearn.obsmodule.encounter;

import jp.streamtorearn.obsmodule.config.ObsConfig;
import net.minecraftforge.registries.ForgeRegistries;

/** Minecraft attack facts -> configured OBS encounter eventKey mapping. */
public final class AttackEventResolver {
    public ObsConfig.EncounterRule resolve(DamageContext dc, Iterable<ObsConfig.EncounterRule> rules) {
        if (dc == null || dc.attacker() == null) return null;
        var id = ForgeRegistries.ENTITY_TYPES.getKey(dc.attacker().getType());
        if (id == null) return null;
        String entityId = id.toString();
        String attackKind = dc.kind().name();
        ObsConfig.EncounterRule best = null;
        for (ObsConfig.EncounterRule r : rules) {
            if (r == null || !r.isEnabled()) continue;
            if (!entityId.equals(r.entityId)) continue;
            if (!attackKind.equalsIgnoreCase(r.attackKind)) continue;
            if (best == null || r.attackPriority > best.attackPriority) best = r;
        }
        return best;
    }
}
