package jp.streamtorearn.stackinggame.world;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraftforge.registries.ForgeRegistries;

import java.util.HashSet;
import java.util.Set;

/**
 * イベントによる永久破壊から守るブロック判定。
 *
 * <p>黒曜石フレームに加え、BridgeMODを通らないStackingGame固有処理の保険として
 * 3種類のコマンドブロックも常時保護する。プレイヤー採掘そのものは制限しない。</p>
 */
public final class ProtectedBlockPolicy {
    private static final Set<String> ALWAYS_PROTECTED = Set.of(
            // StackingGame can mutate blocks without going through BridgeMOD, so command blocks
            // are kept as a small local failsafe as well.
            "minecraft:command_block",
            "minecraft:chain_command_block",
            "minecraft:repeating_command_block",
            "minecraft:obsidian",
            "minecraft:crying_obsidian");

    public boolean isProtected(BlockState state) {
        var key = ForgeRegistries.BLOCKS.getKey(state.getBlock());
        if (key == null) return false;
        String id = key.toString();
        if (ALWAYS_PROTECTED.contains(id)) return true;
        Set<String> configured = new HashSet<>(StackingConfig.PROTECTED_BLOCKS.get());
        return configured.contains(id);
    }
}
