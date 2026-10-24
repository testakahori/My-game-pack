package jp.streamtorearn.stackinggame.world;

import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public final class MobLifetimeManager {
    private record Entry(UUID executionId, ResourceKey<Level> dimension, UUID entityId, long expiresAt) {}

    private final List<Entry> entries = new ArrayList<>();

    public void register(UUID executionId, ServerLevel level, Entity entity, long expiresAt) {
        entries.add(new Entry(executionId, level.dimension(), entity.getUUID(), expiresAt));
    }

    /** Compatibility overload for non-event callers. */
    public void register(ServerLevel level, Entity entity, long expiresAt) {
        register(null, level, entity, expiresAt);
    }

    public void tick(MinecraftServer server, long tick) {
        Iterator<Entry> iterator = entries.iterator();
        while (iterator.hasNext()) {
            Entry entry = iterator.next();
            if (tick < entry.expiresAt) continue;
            ServerLevel level = server.getLevel(entry.dimension);
            if (level != null) {
                Entity entity = level.getEntity(entry.entityId);
                if (entity != null) entity.discard();
            }
            iterator.remove();
        }
    }

    /** イベント側でMobを全滅/中止処理した場合、寿命管理の古い記録も取り除く。 */
    public void unregister(Collection<UUID> entityIds) {
        if (entityIds == null || entityIds.isEmpty()) return;
        Set<UUID> ids = new HashSet<>(entityIds);
        entries.removeIf(entry -> ids.contains(entry.entityId));
    }

    public void unregisterExecution(UUID executionId) {
        if (executionId == null) return;
        entries.removeIf(entry -> executionId.equals(entry.executionId));
    }

    /** 強制終了時に、そのexecutionIdが生成したMobだけを安全に削除する。 */
    public void discardExecution(MinecraftServer server, UUID executionId) {
        if (executionId == null) return;
        Iterator<Entry> iterator = entries.iterator();
        while (iterator.hasNext()) {
            Entry entry = iterator.next();
            if (!executionId.equals(entry.executionId)) continue;
            ServerLevel level = server.getLevel(entry.dimension);
            if (level != null) {
                Entity entity = level.getEntity(entry.entityId);
                if (entity != null && !entity.isRemoved()) entity.discard();
            }
            iterator.remove();
        }
    }

    public int count(UUID executionId) {
        if (executionId == null) return 0;
        int count = 0;
        for (Entry entry : entries) if (executionId.equals(entry.executionId)) count++;
        return count;
    }

    public void clear() { entries.clear(); }
    public int size() { return entries.size(); }
}
