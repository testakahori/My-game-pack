package jp.douma.bridgemod;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.animal.Cod;
import net.minecraftforge.event.entity.EntityJoinLevelEvent;

/** Limits only cod spawned by a like event. Gifts and ordinary world fish are untouched. */
final class LikeCodLimiter {
    static final int MAX_ACTIVE = 64;
    static final int INTERVAL_TICKS = 2;
    static final int LIFETIME_TICKS = 20 * 20;
    private static final String EXPIRY = "bridge_like_cod_expires";
    private final Map<UUID, Cod> active = new HashMap<>();
    private long tick;
    private long nextSpawnTick;
    private boolean capturing;
    private volatile int activeCount;
    private volatile long spawned;

    void tick() {
        tick++;
        Iterator<Cod> iterator = active.values().iterator();
        while (iterator.hasNext()) {
            Cod cod = iterator.next();
            if (cod.isAlive() && cod.level().getGameTime() >= cod.getPersistentData().getLong(EXPIRY)) cod.discard();
            if (cod.isRemoved() || !cod.isAlive() || ((ServerLevel) cod.level()).getEntity(cod.getUUID()) != cod) iterator.remove();
        }
        activeCount = active.size();
    }

    boolean canSpawn(MinecraftServer server) {
        return !server.getPlayerList().getPlayers().isEmpty() && tick >= nextSpawnTick && active.size() < MAX_ACTIVE;
    }

    void begin() { capturing = true; nextSpawnTick = tick + INTERVAL_TICKS; }
    void end() { capturing = false; }

    void joined(EntityJoinLevelEvent event) {
        if (!(event.getLevel() instanceof ServerLevel level) || !(event.getEntity() instanceof Cod cod)) return;
        // The deadline is saved with the entity, so unloading/reloading a chunk does not reset its life.
        if (capturing) {
            cod.getPersistentData().putLong(EXPIRY, level.getGameTime() + LIFETIME_TICKS);
        }
        if (!cod.getPersistentData().contains(EXPIRY)) return;
        if (level.getGameTime() >= cod.getPersistentData().getLong(EXPIRY)
                || (!active.containsKey(cod.getUUID()) && active.size() >= MAX_ACTIVE)) {
            // Returning to an unloaded area cannot exceed the cap with old temporary fish.
            event.setCanceled(true); return;
        }
        if (capturing) spawned++;
        active.put(cod.getUUID(), cod);
        activeCount = active.size();
    }

    int activeCount() { return activeCount; }
    long spawned() { return spawned; }
    void reset() { active.clear(); activeCount = 0; tick = 0; nextSpawnTick = 0; capturing = false; spawned = 0; }
}
