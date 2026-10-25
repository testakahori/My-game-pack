package jp.streamtorearn.stackinggame.world;

import jp.streamtorearn.stackinggame.event.EventTargetMode;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Small, permissive safety gate for StackingGame-owned block mutations.
 *
 * <p>It intentionally does not globally lock terrain. PLAYER events can still modify ordinary
 * terrain. ARENA events are limited to the configured arena, and protected technical/frame blocks
 * are skipped for both modes.</p>
 */
public final class BlockSafetyService {
    private final ProtectedBlockPolicy protectedBlocks;
    private final ArenaService arena;
    private java.util.function.BiPredicate<ServerLevel, BlockPos> reserved = (level, pos) -> false;

    public void setReservedRegion(java.util.function.BiPredicate<ServerLevel, BlockPos> reserved) { this.reserved = reserved; }

    public BlockSafetyService(ProtectedBlockPolicy protectedBlocks, ArenaService arena) {
        this.protectedBlocks = protectedBlocks;
        this.arena = arena;
    }

    public boolean canModify(ServerLevel level, BlockPos pos, EventTargetMode targetMode) {
        if (level == null || pos == null || !level.hasChunkAt(pos)) return false;
        if (reserved.test(level, pos)) return false;
        if (targetMode == EventTargetMode.ARENA && !arena.contains(level, pos)) return false;
        return !protectedBlocks.isProtected(level.getBlockState(pos));
    }

    public boolean remove(ServerLevel level, BlockPos pos, EventTargetMode targetMode) {
        if (!canModify(level, pos, targetMode)) return false;
        BlockState current = level.getBlockState(pos);
        if (current.isAir()) return false;
        return level.setBlock(pos, Blocks.AIR.defaultBlockState(), 3);
    }

    public boolean canPlaceTemporary(ServerLevel level, BlockPos pos, EventTargetMode targetMode) {
        return canModify(level, pos, targetMode);
    }
}
