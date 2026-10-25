package jp.streamtorearn.stackinggame.lab;

import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.Clearable;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.structure.BoundingBox;

/** 2階を読み取ってから3階へ書く。空気・収納・コマンドも複製し、毎tickの処理量を制限する。 */
public final class LabRestoreJob {
    private final ServerLevel level;
    private final BlockState[] states = new BlockState[LabLayout.VOLUME];
    private final java.util.Map<Integer, CompoundTag> tags = new java.util.HashMap<>();
    private int cursor;
    private boolean writing;
    private boolean done;
    public LabRestoreJob(ServerLevel level) { this.level = level; }
    public boolean tick() {
        if (done) return true;
        long limit = System.nanoTime() + 6_000_000L;
        for (int budget = 0; budget < 4096 && System.nanoTime() < limit; budget++) {
            BlockPos source = new BlockPos(LabLayout.x(cursor), LabLayout.y(cursor), LabLayout.z(cursor));
            if (!writing) {
                states[cursor] = level.getBlockState(source);
                BlockEntity be = level.getBlockEntity(source);
                if (be != null) tags.put(cursor, be.saveWithoutMetadata().copy());
            } else {
                BlockPos target = source.above(LabLayout.TOP_BASE);
                BlockState state = states[cursor];
                BlockEntity old = level.getBlockEntity(target);
                if (old != null) {
                    Clearable.tryClear(old);
                    level.removeBlockEntity(target);
                    level.setBlock(target, Blocks.AIR.defaultBlockState(), 18);
                }
                // 隣接更新による松明・ツタの脱落を避け、保存された接続状態をそのまま再現する。
                level.setBlock(target, state, 18);
                CompoundTag tag = tags.get(cursor);
                if (tag != null) {
                    BlockEntity be = level.getBlockEntity(target);
                    if (be == null) throw new IllegalStateException("ブロックエンティティの復元に失敗: " + target);
                    be.load(tag.copy()); be.setChanged();
                    level.sendBlockUpdated(target, state, state, 2);
                }
            }
            if (++cursor == LabLayout.VOLUME) {
                cursor = 0;
                if (!writing) {
                    BoundingBox target = new BoundingBox(-32, 42, -32, 32, 83, 32);
                    level.getBlockTicks().clearArea(target);
                    level.getFluidTicks().clearArea(target);
                    writing = true;
                } else {
                    BoundingBox sourceBox = new BoundingBox(-32, 0, -32, 32, 41, 32);
                    BlockPos offset = new BlockPos(0, 42, 0);
                    level.getBlockTicks().copyAreaFrom(level.getBlockTicks(), sourceBox, offset);
                    level.getFluidTicks().copyAreaFrom(level.getFluidTicks(), sourceBox, offset);
                    done = true; return true;
                }
            }
        }
        return false;
    }
}
