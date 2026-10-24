package jp.streamtorearn.stackinggame.world;

import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.event.EventTargetMode;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.TagKey;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;

/**
 * 大型オリジナルイベントが「積み上げ対象ブロック」だけを扱うための共通サービス。
 * 対象は data/stackinggame_events/tags/blocks/stack_blocks.json で追加・変更できる。
 *
 * <p>v2.6.3から、このサービスがFallingBlock化した積み上げブロックを追跡する。
 * イベント演出中(CAPTURED)はArena上空で自由に動かせるが、放出(RELEASED)後に
 * ArenaのX/Z外へ出たブロックは消滅させる。これにより金/ダイヤが会場外へ
 * 再配置されて回収可能になる事故を防ぐ。</p>
 */
public final class StackBlockService {
    public static final TagKey<Block> STACK_BLOCKS = TagKey.create(
            Registries.BLOCK, new ResourceLocation(StackingGameMod.MOD_ID, "stack_blocks"));

    /** 放出後の見た目を残す最大時間。6秒を超えたFallingBlockは安全側で消す。 */
    private static final int RELEASED_MAX_TICKS = 120;

    private enum FlightPhase { CAPTURED, RELEASED }

    private static final class ManagedFlight {
        private final UUID executionId;
        private FlightPhase phase;
        private int remainingTicks;

        private ManagedFlight(UUID executionId, FlightPhase phase, int remainingTicks) {
            this.executionId = executionId;
            this.phase = phase;
            this.remainingTicks = remainingTicks;
        }
    }

    private final ProtectedBlockPolicy protectedBlocks;
    private final ArenaService arena;
    private final BlockSafetyService safety;
    private final Map<FallingBlockEntity, ManagedFlight> managed = new IdentityHashMap<>();

    public StackBlockService(ProtectedBlockPolicy protectedBlocks, ArenaService arena, BlockSafetyService safety) {
        this.protectedBlocks = protectedBlocks;
        this.arena = arena;
        this.safety = safety;
    }

    public boolean isStackBlock(BlockState state) {
        return !state.isAir() && state.is(STACK_BLOCKS) && !protectedBlocks.isProtected(state);
    }

    /** 円柱範囲の積み上げ対象ブロックを上限付きで消去する。 */
    public int removeCylinder(
            ServerLevel level, Vec3 center, double radius,
            int below, int above, int maxBlocks) {
        if (maxBlocks <= 0 || !arena.isArenaLevel(level)) return 0;
        int removed = 0;
        int r = (int) Math.ceil(radius);
        int cx = (int) Math.floor(center.x);
        int cy = (int) Math.floor(center.y);
        int cz = (int) Math.floor(center.z);
        int minY = Math.max(level.getMinBuildHeight(), cy - Math.max(0, below));
        int maxY = Math.min(level.getMaxBuildHeight() - 1, cy + Math.max(0, above));
        double r2 = radius * radius;

        for (int y = minY; y <= maxY && removed < maxBlocks; y++) {
            for (int dx = -r; dx <= r && removed < maxBlocks; dx++) {
                for (int dz = -r; dz <= r && removed < maxBlocks; dz++) {
                    if (dx * dx + dz * dz > r2) continue;
                    BlockPos pos = new BlockPos(cx + dx, y, cz + dz);
                    if (!arena.contains(pos)) continue;
                    if (!level.hasChunkAt(pos)) continue;
                    BlockState state = level.getBlockState(pos);
                    if (!isStackBlock(state)) continue;
                    if (safety.remove(level, pos, EventTargetMode.ARENA)) removed++;
                }
            }
        }
        return removed;
    }

    /**
     * 範囲内からランダムに積み上げブロックをFallingBlock化して吸引演出へ渡す。
     * 1tickで大量走査しないよう、ランダム試行数を制限する。
     */
    public List<FallingBlockEntity> liftRandomBatch(
            UUID executionId, ServerLevel level, Vec3 center, double radius, int verticalRange,
            int limit, Random random) {
        List<FallingBlockEntity> result = new ArrayList<>();
        if (limit <= 0 || !arena.isArenaLevel(level)) return result;
        int cx = (int) Math.floor(center.x);
        int cy = (int) Math.floor(center.y);
        int cz = (int) Math.floor(center.z);
        int r = Math.max(1, (int) Math.ceil(radius));
        int vr = Math.max(1, verticalRange);
        int attempts = Math.max(32, limit * 24);
        double r2 = radius * radius;
        IntBox arenaBounds = arena.bounds();
        int sampleMinY = Math.max(arenaBounds.minY(), cy - Math.max(1, vr / 2));
        int sampleMaxY = Math.min(arenaBounds.maxY(), cy + vr);
        if (sampleMinY > sampleMaxY) return result;

        for (int i = 0; i < attempts && result.size() < limit; i++) {
            int dx = random.nextInt(r * 2 + 1) - r;
            int dz = random.nextInt(r * 2 + 1) - r;
            if (dx * dx + dz * dz > r2) continue;
            int y = sampleMinY + random.nextInt(sampleMaxY - sampleMinY + 1);
            BlockPos pos = new BlockPos(cx + dx, y, cz + dz);
            if (!arena.contains(pos)) continue;
            if (!level.hasChunkAt(pos)) continue;
            BlockState state = level.getBlockState(pos);
            if (!isStackBlock(state) || !safety.canModify(level, pos, EventTargetMode.ARENA)) continue;
            FallingBlockEntity entity = FallingBlockEntity.fall(level, pos, state);
            entity.setNoGravity(true);
            managed.put(entity, new ManagedFlight(executionId, FlightPhase.CAPTURED, Integer.MAX_VALUE));
            result.add(entity);
        }
        return result;
    }

    /**
     * 演出で捕捉したFallingBlockを放出する。
     * 放出後はArena外再配置を防ぐ監視対象になる。
     */
    public void release(UUID executionId, FallingBlockEntity entity, Vec3 velocity) {
        if (entity == null || entity.isRemoved()) return;
        entity.setNoGravity(false);
        entity.setDeltaMovement(velocity.x, velocity.y, velocity.z);
        ManagedFlight flight = managed.computeIfAbsent(
                entity, ignored -> new ManagedFlight(executionId, FlightPhase.RELEASED, RELEASED_MAX_TICKS));
        flight.phase = FlightPhase.RELEASED;
        flight.remainingTicks = RELEASED_MAX_TICKS;
    }

    /** 現在速度を維持して放出状態へ切り替える。 */
    public void release(UUID executionId, FallingBlockEntity entity) {
        if (entity == null || entity.isRemoved()) return;
        release(executionId, entity, entity.getDeltaMovement());
    }

    /** 衝撃波リングに接触した積み上げブロックを外側へ飛ばす。 */
    public int ejectRing(
            UUID executionId, ServerLevel level, Vec3 center, double radius, double width,
            int above, int maxBlocks, int maxEntities, double speed) {
        if (maxBlocks <= 0 || !arena.isArenaLevel(level)) return 0;
        int affected = 0;
        int entities = 0;
        int r = (int) Math.ceil(radius + width);
        int cx = (int) Math.floor(center.x);
        int cy = (int) Math.floor(center.y);
        int cz = (int) Math.floor(center.z);
        int maxY = Math.min(level.getMaxBuildHeight() - 1, cy + Math.max(1, above));
        double minR = Math.max(0.0, radius - width);
        double maxR = radius + width;
        double min2 = minR * minR;
        double max2 = maxR * maxR;

        for (int y = Math.max(level.getMinBuildHeight(), cy - 1); y <= maxY && affected < maxBlocks; y++) {
            for (int dx = -r; dx <= r && affected < maxBlocks; dx++) {
                for (int dz = -r; dz <= r && affected < maxBlocks; dz++) {
                    double d2 = dx * dx + dz * dz;
                    if (d2 < min2 || d2 > max2) continue;
                    BlockPos pos = new BlockPos(cx + dx, y, cz + dz);
                    if (!arena.contains(pos)) continue;
                    if (!level.hasChunkAt(pos)) continue;
                    BlockState state = level.getBlockState(pos);
                    if (!isStackBlock(state) || !safety.canModify(level, pos, EventTargetMode.ARENA)) continue;

                    if (entities < maxEntities) {
                        FallingBlockEntity entity = FallingBlockEntity.fall(level, pos, state);
                        Vec3 away = new Vec3(dx, 0, dz);
                        if (away.lengthSqr() < 0.01) away = new Vec3(1, 0, 0);
                        away = away.normalize().scale(speed);
                        release(executionId, entity, new Vec3(
                                away.x,
                                0.55 + Math.min(0.8, speed * 0.25),
                                away.z));
                        entities++;
                    } else {
                        safety.remove(level, pos, EventTargetMode.ARENA);
                    }
                    affected++;
                }
            }
        }
        return affected;
    }

    /**
     * Entity tickより前に呼ぶ安全監視。
     * CAPTURED中は演出を優先し、RELEASED後だけArena外・異常滞留を消去する。
     */
    public void beforeEntityTick() {
        Iterator<Map.Entry<FallingBlockEntity, ManagedFlight>> iterator = managed.entrySet().iterator();
        IntBox bounds = arena.bounds();

        while (iterator.hasNext()) {
            Map.Entry<FallingBlockEntity, ManagedFlight> entry = iterator.next();
            FallingBlockEntity entity = entry.getKey();
            ManagedFlight flight = entry.getValue();

            if (entity == null || entity.isRemoved()) {
                iterator.remove();
                continue;
            }

            if (flight.phase == FlightPhase.CAPTURED) {
                continue;
            }

            if (--flight.remainingTicks <= 0) {
                entity.discard();
                iterator.remove();
                continue;
            }

            if (!(entity.level() instanceof ServerLevel level) || !arena.isArenaLevel(level)) {
                entity.discard();
                iterator.remove();
                continue;
            }

            Vec3 position = entity.position();
            if (!arena.containsHorizontal(position)) {
                entity.discard();
                iterator.remove();
                continue;
            }

            // Arena底面より下へ落ちた場合は会場外扱い。
            if (position.y < bounds.minY() - 0.25) {
                entity.discard();
                iterator.remove();
                continue;
            }

            // 上空へ吹き上げる演出は許可するが、下降してArena上端へ戻ってきた時点で
            // Y=maxY+1以上への再配置を防ぐため消去する。
            if (position.y > bounds.maxY() + 1.0
                    && position.y <= bounds.maxY() + 2.5
                    && entity.getDeltaMovement().y <= 0.0) {
                entity.discard();
                iterator.remove();
            }
        }
    }

    /** executionIdごとのFallingBlock所有数。短い演出残りも所有元を追跡できる。 */
    public int managedCount(UUID executionId) {
        if (executionId == null) return 0;
        int count = 0;
        for (ManagedFlight flight : managed.values()) {
            if (executionId.equals(flight.executionId)) count++;
        }
        return count;
    }

    /** reset/強制 cleanup 用。通常ENDでは呼ばず、短いFallingBlock演出を残す。 */
    public void discardExecution(UUID executionId) {
        if (executionId == null) return;
        Iterator<Map.Entry<FallingBlockEntity, ManagedFlight>> iterator = managed.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<FallingBlockEntity, ManagedFlight> entry = iterator.next();
            if (!executionId.equals(entry.getValue().executionId)) continue;
            FallingBlockEntity entity = entry.getKey();
            if (entity != null && !entity.isRemoved()) entity.discard();
            iterator.remove();
        }
    }

    /** reset/server stopで前ラウンドの演出Entityを残さない。 */
    public void discardAllManaged() {
        for (FallingBlockEntity entity : new ArrayList<>(managed.keySet())) {
            if (entity != null && !entity.isRemoved()) entity.discard();
        }
        managed.clear();
    }

    public int managedCount() {
        return managed.size();
    }
}
