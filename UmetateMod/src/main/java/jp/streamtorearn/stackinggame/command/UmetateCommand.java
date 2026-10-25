package jp.streamtorearn.stackinggame.command;

import com.mojang.brigadier.CommandDispatcher;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;

public final class UmetateCommand {
    private UmetateCommand() {}
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher, StackingRuntime runtime) {
        dispatcher.register(Commands.literal("umetate").requires(source -> source.hasPermission(2))
                .then(Commands.literal("reset").executes(ctx -> runtime.lab.reset(ctx.getSource())))
                .then(Commands.literal("zigoku").executes(ctx -> runtime.lab.zigoku(ctx.getSource()))));
    }
}
