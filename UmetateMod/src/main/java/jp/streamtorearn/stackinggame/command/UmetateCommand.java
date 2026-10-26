package jp.streamtorearn.stackinggame.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

/**
 * 埋め立てのコマンド。ギフトで動くものは {@code umetate <名前> [回数] [送った人]} の1つの形（採掘の saikutu と同じ。埋め立て PR1）。
 * BridgeMOD はゲームのコマンドファイルの {@code umetate <名前> {Count} {ListenerName}} を、回数を入れて1回だけ打つ。
 */
public final class UmetateCommand {
    private UmetateCommand() {}

    /** 回数（1以上）と送った人（null なら手で打ったもの）を受ける動き。 */
    @FunctionalInterface
    private interface Action { int run(CommandSourceStack source, int count, String listener) throws CommandSyntaxException; }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher, StackingRuntime runtime) {
        var root = Commands.literal("umetate").requires(source -> source.hasPermission(2));
        // reset は配信者が打つもの。回数を取らず、ギフトには載せない。
        root.then(Commands.literal("reset").executes(ctx -> runtime.lab.reset(ctx.getSource())));
        // 研究室の5つを先に登録する（同じ名前のイベントができても、研究室の5つが勝つ）。
        for (String key : UmetateKeys.LAB) root.then(counted(key, (source, count, listener) -> repeatLab(source, runtime, key, count)));
        for (String key : UmetateKeys.EVENTS) {
            if (UmetateKeys.isLab(key) || !runtime.registry.contains(key)) continue;
            root.then(counted(key, (source, count, listener) -> StackGameCommand.submitEvent(source, runtime, key, count, listener)));
        }
        dispatcher.register(root);
    }

    private static LiteralArgumentBuilder<CommandSourceStack> counted(String key, Action action) {
        return Commands.literal(key)
                .executes(ctx -> action.run(ctx.getSource(), 1, null))
                .then(Commands.argument("count", IntegerArgumentType.integer(1, UmetateKeys.MAX_COUNT))
                        .executes(ctx -> action.run(ctx.getSource(), IntegerArgumentType.getInteger(ctx, "count"), null))
                        .then(Commands.argument("listener", StringArgumentType.greedyString())
                                .executes(ctx -> action.run(ctx.getSource(), IntegerArgumentType.getInteger(ctx, "count"),
                                        StringArgumentType.getString(ctx, "listener")))));
    }

    /**
     * 研究室の5つは、その場で回数の分だけ続けて動かす。2回目からの断りのことばは出さず、断られた分をまとめて1行だけ知らせる
     * （zigoku は2回目から「実行中」で断られる。同時には動かさない今の決まりどおり）。
     */
    private static int repeatLab(CommandSourceStack source, StackingRuntime runtime, String key, int count) throws CommandSyntaxException {
        if (count == 1) return runLab(source, runtime, key);
        int total = 0, refused = 0;
        for (int i = 0; i < count; i++) {
            int result;
            try {
                result = runLab(i == 0 ? source : source.withSuppressedOutput(), runtime, key);
            } catch (CommandSyntaxException refusedByMinecraft) {
                if (i == 0) source.sendFailure(Component.literal(refusedByMinecraft.getMessage()));
                result = 0;
            }
            if (result > 0) total += result; else refused++;
        }
        if (refused > 0) source.sendSystemMessage(Component.literal("umetate " + key + ": " + count + "回のうち" + refused + "回は実行できませんでした"));
        return total;
    }

    private static int runLab(CommandSourceStack source, StackingRuntime runtime, String key) throws CommandSyntaxException {
        return switch (key) {
            case "otasuke" -> otasuke(source);
            case "mofumofu" -> MofumofuCommand.execute(source);
            case "stamp" -> {
                var player = PlayerCommandTarget.resolve(source);
                yield player == null ? 0 : runtime.stamps.start(source, player);
            }
            case "atamahuttou" -> HeadLavaCommand.execute(source, runtime);
            case "zigoku" -> runtime.lab.zigoku(source);
            default -> throw new IllegalArgumentException("umetate の研究室の名前ではありません: " + key);
        };
    }

    private static int otasuke(CommandSourceStack source) throws CommandSyntaxException {
        // 実行者の階やディメンションによらず、オーバーワールドの3階を下から8段埋める。
        return source.getServer().getCommands().getDispatcher().execute(
                "fill -6 49 -6 6 56 6 minecraft:gold_block", source.withLevel(source.getServer().overworld()));
    }
}
