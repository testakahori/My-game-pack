package jp.streamtorearn.stackinggame.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;

public final class UmetateCommand {
    private UmetateCommand() {}
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher, StackingRuntime runtime) {
        dispatcher.register(Commands.literal("umetate").requires(source -> source.hasPermission(2))
                .then(Commands.literal("otasuke").executes(ctx -> otasuke(ctx.getSource())))
                .then(Commands.literal("reset").executes(ctx -> runtime.lab.reset(ctx.getSource())))
                .then(Commands.literal("zigoku").executes(ctx -> runtime.lab.zigoku(ctx.getSource()))));
    }

    private static int otasuke(CommandSourceStack source) throws CommandSyntaxException {
        // 実行者の階やディメンションによらず、オーバーワールドの3階を下から8段埋める。
        return source.getServer().getCommands().getDispatcher().execute(
                "fill -6 49 -6 6 56 6 minecraft:gold_block", source.withLevel(source.getServer().overworld()));
    }
}
