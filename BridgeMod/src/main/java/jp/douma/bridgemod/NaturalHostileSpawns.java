package jp.douma.bridgemod;

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.entity.MobSpawnType;
import net.minecraftforge.event.entity.living.MobSpawnEvent;
import net.minecraftforge.event.village.VillageSiegeEvent;
import net.minecraftforge.eventbus.api.Event;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/** Block ambient monsters without disabling animals, fish or deliberate game summons. */
@Mod.EventBusSubscriber(modid = BridgeMod.MODID, bus = Mod.EventBusSubscriber.Bus.FORGE)
public final class NaturalHostileSpawns {
    private NaturalHostileSpawns() {}

    private static boolean blocked(EntityType<?> entity, MobSpawnType reason) {
        return entity.getCategory() == MobCategory.MONSTER && switch (reason) {
            case NATURAL, CHUNK_GENERATION, PATROL, REINFORCEMENT -> true;
            default -> false;
        };
    }

    @SubscribeEvent
    public static void checkPlacement(MobSpawnEvent.SpawnPlacementCheck event) {
        if (blocked(event.getEntityType(), event.getSpawnType())) event.setResult(Event.Result.DENY);
    }

    @SubscribeEvent
    public static void finalizeSpawn(MobSpawnEvent.FinalizeSpawn event) {
        // This also covers phantoms and patrols, which can bypass normal placement checks.
        // Canceling the event alone would only skip initialization, not the spawn itself.
        if (blocked(event.getEntity().getType(), event.getSpawnType())) event.setSpawnCancelled(true);
    }

    @SubscribeEvent
    public static void villageSiege(VillageSiegeEvent event) {
        // Cancel the automatic siege specifically; EVENT remains available to other game MODs.
        event.setCanceled(true);
    }
}
