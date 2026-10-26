package jp.streamtorearn.stackinggame.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import jp.streamtorearn.stackinggame.lab.LabActionLanes;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;

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
        // reset は配信者が打つもの。回数を取らず、ギフトには載せない。受け付けたら、研究室の5つの順番待ちも捨てる。
        root.then(Commands.literal("reset").executes(ctx -> {
            int result = runtime.lab.reset(ctx.getSource());
            if (result > 0) runtime.labLanes.clear();
            return result;
        }));
        // 研究室の5つを先に登録する（同じ名前のイベントができても、研究室の5つが勝つ）。
        for (String key : UmetateKeys.LAB) root.then(counted(key, (source, count, listener) -> labGift(source, runtime, key, count, listener)));
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
     * 研究室の5つは、順番待ち（LabActionLanes）に並べる。列が空なら1回目はすぐ、呼んだ人の source で起こす（断りのことばもその人に届く）。
     * 残りは1秒おきに、StackingRuntime の tick から起こす（黒曜石スタンプ・頭沸騰は、毎回その時のプレイヤーの位置をねらう）。
     * 地獄は、いまの地獄が終わってから。復元・地震・光のあいだは待つ（最後のレビュー 重要4。2026-10-26 ユーザーの決定）。
     */
    private static int labGift(CommandSourceStack source, StackingRuntime runtime, String key, int count, String listener) throws CommandSyntaxException {
        Object ticket = runtime.labLanes.offer(key, count, listener);
        int result = 0;
        boolean ranMine = false;
        for (LabActionLanes.Run run : runtime.labLanes.due(source.getServer().getTickCount(), runtime.lab.blocksEvents(), runtime.lab.idle())) {
            if (!run.isFor(ticket)) { runQueued(source.getServer(), runtime, run); continue; }
            ranMine = true;
            result = runLab(source, runtime, key);
            if (result > 0 && run.claimDisplay()) runtime.integration.showStarted(source.getServer(), key, listener, count);
        }
        int queued = count - (ranMine ? 1 : 0);
        if (queued > 0) source.sendSystemMessage(Component.literal("umetate " + key + ": あと" + queued + "回は順番に起こします"));
        return ranMine ? result : 1;
    }

    /** 順番待ちの1回を起こす（StackingRuntime の tick から）。出力は出さず、起こせなかったらログに残す。 */
    public static void runQueued(MinecraftServer server, StackingRuntime runtime, LabActionLanes.Run run) {
        try {
            int result = runLab(server.createCommandSourceStack().withSuppressedOutput(), runtime, run.key());
            if (result > 0 && run.claimDisplay()) runtime.integration.showStarted(server, run.key(), run.listener(), run.count());
            if (result <= 0) StackingGameMod.LOGGER.info("umetate {}: 順番待ちの1回を起こせませんでした（変える物が無い・相手がいないなど）", run.key());
        } catch (CommandSyntaxException | RuntimeException error) {
            StackingGameMod.LOGGER.info("umetate {}: 順番待ちの1回を起こせませんでした: {}", run.key(), error.getMessage());
        }
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
