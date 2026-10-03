package jp.douma.bridgemod;

import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.level.GameRules;

/** Product rules, deliberately not user-configurable. Gift effects own temporary overrides. */
final class FixedEnvironment {
    void apply(MinecraftServer server, GiftEffects effects) {
        for (ServerLevel level : server.getAllLevels()) {
            GameRules rules = level.getGameRules();
            rules.getRule(GameRules.RULE_KEEPINVENTORY).set(true, server);
            rules.getRule(GameRules.RULE_DAYLIGHT).set(false, server);
            rules.getRule(GameRules.RULE_WEATHER_CYCLE).set(false, server);
            if (!effects.hasNightOverride()) {
                long day = level.getDayTime();
                level.setDayTime(day - Math.floorMod(day, 24000L) + 1000L);
            }
            if (!effects.hasWeatherOverride(level) && !jp.douma.bridgemod.api.EnvironmentOverrides.hasWeather(level) && (level.isRaining() || level.isThundering())) {
                level.setWeatherParameters(6000, 0, false, false);
            }
        }
        // Check each tick so milk, death/respawn and joining cannot leave night vision off.
        // Refresh only when necessary; do not send an effect packet every tick.
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player.isSpectator()) continue;
            MobEffectInstance current = player.getEffect(MobEffects.NIGHT_VISION);
            if (current == null || (!current.isInfiniteDuration() && current.getDuration() < 1200)) {
                player.addEffect(new MobEffectInstance(MobEffects.NIGHT_VISION, 12000, 0, false, false));
            }
        }
    }
}
