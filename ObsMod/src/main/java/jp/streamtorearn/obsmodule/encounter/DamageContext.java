package jp.streamtorearn.obsmodule.encounter;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;

/** Raw values observed from Forge LivingDamageEvent. */
public record DamageContext(
        ServerPlayer victim,
        Entity attacker,
        Entity directEntity,
        AttackKind kind,
        String damageType,
        float damageAmount,
        long tick) {}
