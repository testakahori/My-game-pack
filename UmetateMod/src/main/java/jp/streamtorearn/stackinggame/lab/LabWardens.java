package jp.streamtorearn.stackinggame.lab;

import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.Unit;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobSpawnType;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.monster.warden.Warden;
import net.minecraft.world.level.block.Blocks;

/** このイベントで召喚した3体だけを管理する。タグはチャンク保存・再起動後にも残る。 */
final class LabWardens {
    private static final String TAG = "umetate_zigoku_warden";
    private final Set<UUID> active = new HashSet<>();
    private final Map<UUID, Warden> loaded = new HashMap<>();
    private final Queue<Warden> joined = new ConcurrentLinkedQueue<>();

    void joined(Entity entity) {
        // 読み込みコールバック内でワールドを変更せず、サーバーtickで片付ける。
        if (entity instanceof Warden w && !w.level().isClientSide && w.getTags().contains(TAG)) joined.add(w);
    }

    void recover(MinecraftServer server) {
        active.clear();
        for (ServerLevel world : server.getAllLevels()) for (Entity entity : world.getAllEntities()) joined(entity);
        tick();
    }

    void spawn(ServerLevel level) {
        List<BlockPos> positions = positions(level);
        for (BlockPos pos : positions) {
            Warden warden = EntityType.WARDEN.create(level, null, null, pos, MobSpawnType.COMMAND, false, false);
            if (warden == null) throw new IllegalStateException("ウォーデンを作成できませんでした。");
            warden.setPersistenceRequired();
            // 無人・静かな時間にも地中へ帰らず、5分間の相手として残す。
            warden.getBrain().setMemory(MemoryModuleType.DIG_COOLDOWN, Unit.INSTANCE);
            warden.addTag(TAG);
            active.add(warden.getUUID());
            loaded.put(warden.getUUID(), warden);
            if (!level.addFreshEntity(warden)) {
                warden.discard();
                throw new IllegalStateException("ウォーデンを召喚できませんでした。");
            }
        }
    }

    void validate(ServerLevel level) { positions(level); }

    private List<BlockPos> positions(ServerLevel level) {
        List<BlockPos> found = new ArrayList<>();
        for (int[] anchor : new int[][]{{-15, -15}, {15, -15}, {0, 15}}) {
            BlockPos chosen = null;
            search: for (int radius = 0; radius <= 40; radius++) {
                for (int dx = -radius; dx <= radius; dx++) for (int dz = -radius; dz <= radius; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) != radius) continue;
                    int x = anchor[0] + dx, z = anchor[1] + dz;
                    if (Math.abs(x) > 29 || Math.abs(z) > 29) continue;
                    BlockPos floor = new BlockPos(x, LabLayout.HELL_FLOOR, z), feet = floor.above();
                    var state = level.getBlockState(floor);
                    if (!state.isCollisionShapeFullBlock(level, floor) || state.is(Blocks.MAGMA_BLOCK)
                            || !level.getBlockState(feet).isAir() || !level.getBlockState(feet.above()).isAir()
                            || !level.getBlockState(feet.above(2)).isAir()) continue;
                    if (found.stream().anyMatch(p -> p.distSqr(feet) < 16)) continue;
                    chosen = feet; break search;
                }
            }
            if (chosen == null) throw new IllegalStateException("1階にウォーデン3体分の足場と高さ3ブロックの空間がありません。");
            found.add(chosen);
        }
        return found;
    }

    void tick() {
        Warden next;
        while ((next = joined.poll()) != null) loaded.put(next.getUUID(), next);
        for (Iterator<Warden> it = loaded.values().iterator(); it.hasNext();) {
            Warden warden = it.next();
            if (warden.isRemoved() || !warden.isAlive()) { it.remove(); continue; }
            if (!active.contains(warden.getUUID())) {
                warden.kill();
                it.remove();
            }
        }
    }

    void finish() {
        active.clear();
        tick();
    }
}
