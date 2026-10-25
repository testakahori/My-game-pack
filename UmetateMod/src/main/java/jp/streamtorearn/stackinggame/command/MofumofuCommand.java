package jp.streamtorearn.stackinggame.command;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;

/** 3階の金・ダイヤを、色とりどりの羊毛へ置き換える。 */
final class MofumofuCommand {
    private static final Block[] WOOL = {
            Blocks.WHITE_WOOL, Blocks.ORANGE_WOOL, Blocks.MAGENTA_WOOL, Blocks.LIGHT_BLUE_WOOL,
            Blocks.YELLOW_WOOL, Blocks.LIME_WOOL, Blocks.PINK_WOOL, Blocks.GRAY_WOOL,
            Blocks.LIGHT_GRAY_WOOL, Blocks.CYAN_WOOL, Blocks.PURPLE_WOOL, Blocks.BLUE_WOOL,
            Blocks.BROWN_WOOL, Blocks.GREEN_WOOL, Blocks.RED_WOOL, Blocks.BLACK_WOOL
    };

    private MofumofuCommand() {}

    static int execute(CommandSourceStack source) {
        var level = source.getServer().overworld();
        // 対象の4チャンクだけを読み込む。実行者の位置・ディメンションには依存しない。
        for (int x = -1; x <= 0; x++) for (int z = -1; z <= 0; z++) level.getChunk(x, z);
        int changed = 0;
        for (BlockPos pos : BlockPos.betweenClosed(-6, 49, -6, 6, 64, 6)) {
            var state = level.getBlockState(pos);
            if (!state.is(Blocks.GOLD_BLOCK) && !state.is(Blocks.DIAMOND_BLOCK)) continue;
            Block wool = WOOL[level.random.nextInt(WOOL.length)];
            if (level.setBlock(pos, wool.defaultBlockState(), Block.UPDATE_ALL)) changed++;
        }
        int count = changed;
        source.sendSuccess(() -> Component.literal(count == 0
                ? "3階の枠内に金ブロック・ダイヤブロックがありません。"
                : "3階の金・ダイヤ " + count + "個を、色とりどりの羊毛に変えました。"), true);
        return count;
    }
}
