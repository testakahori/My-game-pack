package jp.streamtorearn.stackinggame.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import jp.streamtorearn.stackinggame.event.CancelReason;
import jp.streamtorearn.stackinggame.event.EventRequest;
import jp.streamtorearn.stackinggame.event.SubmitStatus;
import jp.streamtorearn.stackinggame.integration.TargetPlayerResolver;
import jp.streamtorearn.stackinggame.util.CommandTail;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class StackGameCommand {
    private static final TargetPlayerResolver TARGETS = new TargetPlayerResolver();

    private StackGameCommand() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher, StackingRuntime runtime) {
        var root = Commands.literal("stackgame").requires(source -> source.hasPermission(2));

        // 推奨: /stackgame run <eventKey> [イベント固有引数...] [--sender 名前]
        root.then(Commands.literal("run")
                .then(Commands.argument("tail", StringArgumentType.greedyString())
                        .executes(context -> submit(
                                context.getSource(),
                                runtime,
                                StringArgumentType.getString(context, "tail")))));

        // 旧Bridgeコマンド互換。新BridgeMOD 1.4.0ではGameEvents API経路を使用する。
        root.then(Commands.literal("bridge")
                .then(Commands.argument("tail", StringArgumentType.greedyString())
                        .executes(context -> submitLegacyBridge(
                                context.getSource(),
                                runtime,
                                StringArgumentType.getString(context, "tail")))));

        root.then(Commands.literal("status")
                .executes(context -> status(context.getSource(), runtime)));

        root.then(Commands.literal("reset")
                .executes(context -> reset(context.getSource(), runtime)));

        root.then(Commands.literal("cancel")
                .then(Commands.argument("target", StringArgumentType.word())
                        .executes(context -> cancel(
                                context.getSource(),
                                runtime,
                                StringArgumentType.getString(context, "target")))));

        root.then(Commands.literal("test")
                .then(Commands.literal("integration")
                        .executes(context -> integration(context.getSource(), runtime)))
                .then(Commands.literal("display")
                        .then(Commands.argument("tail", StringArgumentType.greedyString())
                                .executes(context -> testDisplay(
                                        context.getSource(), runtime,
                                        StringArgumentType.getString(context, "tail")))))
                .then(Commands.literal("obs")
                        .then(Commands.argument("tail", StringArgumentType.greedyString())
                                .executes(context -> testObs(
                                        context.getSource(), runtime,
                                        StringArgumentType.getString(context, "tail"))))));

        dispatcher.register(root);
    }

    private static int submit(CommandSourceStack source, StackingRuntime runtime, String raw) {
        CommandTail.Parsed parsed = CommandTail.parse(raw);
        List<String> tokens = parsed.tokens();
        if (tokens.isEmpty()) {
            return fail(source, "usage: /stackgame run <eventKey> [args...] [--sender name]");
        }

        String key = tokens.get(0).toLowerCase(Locale.ROOT);
        List<String> args = tokens.size() > 1
                ? new ArrayList<>(tokens.subList(1, tokens.size()))
                : List.of();

        TargetPlayerResolver.Result target = TARGETS.resolve(source.getServer());
        if (!target.ok()) {
            return fail(source, "target player unavailable: " + target.message());
        }

        EventRequest request = EventRequest.local(
                key,
                target.player().getUUID(),
                parsed.sender(),
                args,
                source.getServer().getTickCount());

        var result = runtime.events.submit(source.getServer(), request);
        if (result.status() != SubmitStatus.ACCEPTED) {
            return fail(source, result.status() + ": " + result.message());
        }

        source.sendSuccess(
                () -> Component.literal(key + ": " + result.message()),
                false);
        return 1;
    }

    /**
     * v2.2以前の "<eventKey> <player> <queue|parallel> ..." をテスト互換として受ける。
     * queue/parallelの指定は無視し、どちらも新しいFIFO待機列へ入れる。
     */
    private static int submitLegacyBridge(CommandSourceStack source, StackingRuntime runtime, String raw) {
        CommandTail.Parsed parsed = CommandTail.parse(raw);
        List<String> tokens = parsed.tokens();
        if (tokens.size() < 3) {
            return fail(source, "legacy usage: <eventKey> <player> <queue|parallel> [args...] [--sender name]");
        }

        String key = tokens.get(0).toLowerCase(Locale.ROOT);
        String playerName = tokens.get(1);
        String oldMode = tokens.get(2).toLowerCase(Locale.ROOT);
        if (!oldMode.equals("queue") && !oldMode.equals("parallel")) {
            return fail(source, "legacy mode must be queue or parallel");
        }

        ServerPlayer player = source.getServer().getPlayerList().getPlayerByName(playerName);
        if (player == null) {
            return fail(source, "player not found: " + playerName);
        }

        List<String> args = tokens.size() > 3
                ? new ArrayList<>(tokens.subList(3, tokens.size()))
                : List.of();

        EventRequest request = EventRequest.local(
                key,
                player.getUUID(),
                parsed.sender(),
                args,
                source.getServer().getTickCount());

        var result = runtime.events.submit(source.getServer(), request);
        if (result.status() != SubmitStatus.ACCEPTED) {
            return fail(source, result.status() + ": " + result.message());
        }

        source.sendSuccess(
                () -> Component.literal(
                        key + ": " + result.message()
                                + " (legacy mode '" + oldMode + "' is ignored; all events are FIFO)"),
                false);
        return 1;
    }

    private static int status(CommandSourceStack source, StackingRuntime runtime) {
        String message = "StackingGame active=" + runtime.events.activeKey()
                + " request=" + runtime.events.activeExternalRequestId()
                + " targetMode=" + runtime.events.activeTargetMode()
                + " waiting=" + runtime.events.waitingCount() + "/" + runtime.events.queueCapacity()
                + " next=" + runtime.events.nextKey()
                + " ledger=" + runtime.events.ledgerSize()
                + " timedMobs=" + runtime.mobLifetime.size()
                + " managedFalling=" + runtime.stackBlocks.managedCount()
                + " bridgeApi=" + (runtime.bridgeApi.available() ? "FOUND" : "NOT FOUND")
                + " bridgeRegistered=" + runtime.bridgeApi.registered()
                + " session=" + runtime.bridgeApi.currentSessionId()
                + " arena=" + runtime.arena.summary()
                + " obsApi=" + (runtime.integration.hasObsLifecycleApi() ? "FOUND" : "NOT FOUND");
        source.sendSuccess(() -> Component.literal(message), false);
        return 1;
    }

    private static int reset(CommandSourceStack source, StackingRuntime runtime) {
        runtime.reset(source.getServer());
        source.sendSuccess(
                () -> Component.literal("StackingGame reset: active/queue cleared and session rotated"),
                false);
        return 1;
    }

    private static int cancel(CommandSourceStack source, StackingRuntime runtime, String target) {
        if (target.equalsIgnoreCase("all")) {
            // cancel all はテスト用途。gameSessionIdを切り替える本番リセットは /stackgame reset を使う。
            runtime.events.cancelAll(source.getServer(), CancelReason.COMMAND);
            source.sendSuccess(() -> Component.literal("all events cancelled (session unchanged)"), false);
            return 1;
        }

        ServerPlayer player = source.getServer().getPlayerList().getPlayerByName(target);
        if (player == null) {
            return fail(source, "player not found");
        }
        runtime.events.cancelPlayer(source.getServer(), player.getUUID(), CancelReason.COMMAND, true);
        source.sendSuccess(() -> Component.literal("events cancelled for " + target), false);
        return 1;
    }

    private static int integration(CommandSourceStack source, StackingRuntime runtime) {
        source.sendSuccess(
                () -> Component.literal(
                        "Legacy Gifts-Display=" + (runtime.integration.hasDisplay() ? "FOUND" : "NOT FOUND")
                                + " / OBSMOD=" + (runtime.integration.hasObs() ? "FOUND" : "NOT FOUND")
                                + " / OBS lifecycle API=" + (runtime.integration.hasObsLifecycleApi() ? "FOUND" : "NOT FOUND")
                                + " / BridgeGameApi=" + (runtime.bridgeApi.available() ? "FOUND" : "NOT FOUND")),
                false);
        return 1;
    }

    private static int testDisplay(CommandSourceStack source, StackingRuntime runtime, String raw) {
        CommandTail.Parsed parsed = CommandTail.parse(raw);
        if (parsed.tokens().isEmpty()) return fail(source, "eventKey required");
        ServerPlayer player = source.getPlayer();
        if (player == null) return fail(source, "player source required for display test");
        runtime.integration.testDisplay(source.getServer(), player, parsed.tokens().get(0), parsed.sender());
        return 1;
    }

    private static int testObs(CommandSourceStack source, StackingRuntime runtime, String raw) {
        CommandTail.Parsed parsed = CommandTail.parse(raw);
        if (parsed.tokens().isEmpty()) return fail(source, "eventKey required");
        runtime.integration.testObs(source.getServer(), parsed.tokens().get(0), parsed.sender());
        return 1;
    }

    private static int fail(CommandSourceStack source, String message) {
        source.sendFailure(Component.literal(message));
        return 0;
    }
}
