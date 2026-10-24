package jp.streamtorearn.stackinggame.world;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;

/**
 * 埋め立てゲームの固定積み上げ領域。
 *
 * <p>本番MAPで確認した範囲は X=-6..6, Y=49..56, Z=-6..6 (13x8x13=1352 blocks)。
 * さらに v2.6.3 から Arena を dimension まで含めて固定し、既定値は minecraft:overworld とする。</p>
 */
public final class ArenaService {

    public String dimensionId() {
        String value = StackingConfig.ARENA_DIMENSION.get();
        if (value == null || value.isBlank()) return "minecraft:overworld";
        return value.trim().toLowerCase(java.util.Locale.ROOT);
    }

    public boolean isArenaLevel(ServerLevel level) {
        return level != null && level.dimension().location().toString().equals(dimensionId());
    }

    public void requireArenaLevel(ServerLevel level) {
        if (!isArenaLevel(level)) {
            String actual = level == null ? "<null>" : level.dimension().location().toString();
            throw new IllegalArgumentException(
                    "Stacking arena is in " + dimensionId() + " but player/event is in " + actual);
        }
    }

    public IntBox bounds() {
        return IntBox.of(
                StackingConfig.ARENA_MIN_X.get(),
                StackingConfig.ARENA_MIN_Y.get(),
                StackingConfig.ARENA_MIN_Z.get(),
                StackingConfig.ARENA_MAX_X.get(),
                StackingConfig.ARENA_MAX_Y.get(),
                StackingConfig.ARENA_MAX_Z.get());
    }

    public boolean contains(BlockPos pos) {
        IntBox b = bounds();
        return pos.getX() >= b.minX() && pos.getX() <= b.maxX()
                && pos.getY() >= b.minY() && pos.getY() <= b.maxY()
                && pos.getZ() >= b.minZ() && pos.getZ() <= b.maxZ();
    }

    public boolean contains(ServerLevel level, BlockPos pos) {
        return isArenaLevel(level) && contains(pos);
    }

    /** イベント領域全体が固定Arena内に収まっているか。 */
    public boolean contains(IntBox box) {
        IntBox b = bounds();
        return box.minX() >= b.minX() && box.maxX() <= b.maxX()
                && box.minY() >= b.minY() && box.maxY() <= b.maxY()
                && box.minZ() >= b.minZ() && box.maxZ() <= b.maxZ();
    }

    /** 高さを問わず、X/ZがArena平面内か。 */
    public boolean containsHorizontal(int x, int z) {
        IntBox b = bounds();
        return x >= b.minX() && x <= b.maxX()
                && z >= b.minZ() && z <= b.maxZ();
    }

    /** FallingBlockの着地先判定用。Yは飛翔中にArena上空へ出るためX/Zだけを見る。 */
    public boolean containsHorizontal(Vec3 pos) {
        IntBox b = bounds();
        return pos.x >= b.minX() && pos.x < b.maxX() + 1.0
                && pos.z >= b.minZ() && pos.z < b.maxZ() + 1.0;
    }

    public int clampX(int x) {
        IntBox b = bounds();
        return Math.max(b.minX(), Math.min(b.maxX(), x));
    }

    public int clampZ(int z) {
        IntBox b = bounds();
        return Math.max(b.minZ(), Math.min(b.maxZ(), z));
    }

    /** X/Z中心・積み上げ領域の最下段。衝撃波/レーザー/竜巻の基準点。 */
    public BlockPos floorCenterBlock() {
        IntBox b = bounds();
        return new BlockPos(center(b.minX(), b.maxX()), b.minY(), center(b.minZ(), b.maxZ()));
    }

    public Vec3 floorCenter() {
        BlockPos p = floorCenterBlock();
        return new Vec3(p.getX() + 0.5, p.getY() + 0.5, p.getZ() + 0.5);
    }

    /** 領域の幾何中心。重力球など空間全体へ作用する演出の基準点。 */
    public Vec3 volumeCenter() {
        IntBox b = bounds();
        return new Vec3(
                (b.minX() + b.maxX() + 1) / 2.0,
                (b.minY() + b.maxY() + 1) / 2.0,
                (b.minZ() + b.maxZ() + 1) / 2.0);
    }

    /** 地表検索を始めるため、領域上端より十分上に置いた中心座標。 */
    public BlockPos centerSearchStart() {
        IntBox b = bounds();
        return new BlockPos(center(b.minX(), b.maxX()), b.maxY() + 16, center(b.minZ(), b.maxZ()));
    }

    public String summary() {
        IntBox b = bounds();
        return dimensionId() + " [" + b.minX() + "," + b.minY() + "," + b.minZ() + ".."
                + b.maxX() + "," + b.maxY() + "," + b.maxZ() + "] volume=" + b.volume();
    }

    private static int center(int min, int max) {
        return min + (max - min) / 2;
    }
}
