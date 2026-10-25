package jp.streamtorearn.stackinggame.command;

import jp.streamtorearn.stackinggame.core.StackingRuntime;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;

final class HeadLavaCommand {
    private HeadLavaCommand() {}
    static int execute(CommandSourceStack source, StackingRuntime runtime) {
        var player = PlayerCommandTarget.resolve(source);
        if (player == null) return 0;
        var level = player.serverLevel();
        BlockPos pos = BlockPos.containing(player.getX(), player.getBoundingBox().maxY + 1, player.getZ());
        if (runtime.lab.blocksEvents() || runtime.lab.isMaster(level, pos)) {
            source.sendFailure(Component.literal("復元・転送中、または2階の原本では実行できません。"));
            return 0;
        }
        if (level.isOutsideBuildHeight(pos) || !level.getBlockState(pos).isAir()) {
            source.sendFailure(Component.literal("頭の上に溶岩を出せる空間がありません。"));
            return 0;
        }
        if (!level.setBlock(pos, Blocks.LAVA.defaultBlockState(), Block.UPDATE_ALL)) return 0;
        level.playSound(null, pos, SoundEvents.BUCKET_EMPTY_LAVA, SoundSource.BLOCKS, 1, 1);
        source.sendSuccess(() -> Component.literal(player.getScoreboardName() + " の頭の1ブロック上から溶岩が流れます。"), true);
        return 1;
    }
}
