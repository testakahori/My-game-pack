package jp.streamtorearn.obsmodule.encounter;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.projectile.AbstractHurtingProjectile;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.entity.projectile.ThrownPotion;
import net.minecraft.world.entity.projectile.WitherSkull;

/** Single source of truth for Forge damage -> attack kind classification. */
public final class AttackClassifier {
    public DamageContext classify(ServerPlayer victim, DamageSource source, float amount, long tick){
        Entity direct=source.getDirectEntity();
        Entity causing=source.getEntity();
        Entity attacker=resolveAttacker(causing,direct);
        AttackKind kind=classifyKind(source,direct);
        String damageType;
        try { damageType=source.getMsgId(); } catch (RuntimeException ignored) { damageType="unknown"; }
        return new DamageContext(victim,attacker,direct,kind,damageType,amount,tick);
    }

    private static Entity resolveAttacker(Entity causing, Entity direct){
        if(direct instanceof Projectile p && p.getOwner()!=null) return p.getOwner();
        return causing;
    }

    private static AttackKind classifyKind(DamageSource source, Entity direct){
        if(source.is(DamageTypeTags.IS_EXPLOSION)) return AttackKind.EXPLOSION;
        if(direct instanceof ThrownPotion) return AttackKind.POTION;
        if(direct instanceof WitherSkull) return AttackKind.SKULL;
        if(direct instanceof AbstractHurtingProjectile) return AttackKind.FIREBALL;
        if(direct instanceof Projectile) return AttackKind.PROJECTILE;
        return AttackKind.MELEE;
    }
}
