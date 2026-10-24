package jp.streamtorearn.obsmodule.encounter;

import jp.streamtorearn.obsmodule.config.ObsConfig;
import jp.streamtorearn.obsmodule.core.EventPublisher;
import jp.streamtorearn.obsmodule.tier.TierStateStore;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraftforge.event.entity.living.LivingDamageEvent;
import net.minecraftforge.registries.ForgeRegistries;

import java.util.*;

public final class VanillaEncounterDetector {
    private final AttackClassifier classifier=new AttackClassifier();
    private final EncounterRuleRegistry rules;
    private final TierStateStore tiers;
    private final EventPublisher publisher;
    private final EncounterDeduplicator dedupe;

    public VanillaEncounterDetector(EncounterRuleRegistry rules,TierStateStore tiers,EventPublisher publisher,EncounterDeduplicator dedupe){
        this.rules=rules;this.tiers=tiers;this.publisher=publisher;this.dedupe=dedupe;
    }

    public void onDamage(LivingDamageEvent event,long tick){
        if(!(event.getEntity() instanceof ServerPlayer player)||event.getAmount()<=0)return;
        DamageContext dc=classifier.classify(player,event.getSource(),event.getAmount(),tick);
        ObsConfig.EncounterRule r=rules.match(dc);
        if(r==null)return;

        String playerId=player.getUUID().toString();
        String attackKind=dc.kind().name().toLowerCase(Locale.ROOT);
        if(!dedupe.shouldPublish(playerId,r.eventKey,"forge",attackKind,System.currentTimeMillis()))return;

        Map<String,Object> x=new LinkedHashMap<>();
        x.put("playerId",playerId);
        x.put("priceTier",tiers.consume(r.eventKey,r.defaultTier));
        x.put("source","forge");
        x.put("detection","Forge LivingDamageEvent");
        x.put("attackKind",attackKind);
        x.put("damageType",dc.damageType());
        x.put("damageAmount",dc.damageAmount());
        putEntity(x,"attacker",dc.attacker());
        putEntity(x,"direct",dc.directEntity());
        publisher.publish("encounter",r.eventKey,x);
    }

    private static void putEntity(Map<String,Object> out,String prefix,Entity entity){
        if(entity==null)return;
        var typeId=ForgeRegistries.ENTITY_TYPES.getKey(entity.getType());
        if(typeId!=null) out.put(prefix+"EntityId",typeId.toString());
        out.put(prefix+"EntityUuid",entity.getUUID().toString());
        if(prefix.equals("attacker")) out.put("attackerId",entity.getUUID().toString()); // legacy alias
    }
}
