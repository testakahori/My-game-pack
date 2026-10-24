package jp.streamtorearn.obsmodule.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import jp.streamtorearn.obsmodule.ObsBridgeMod;
import jp.streamtorearn.obsmodule.config.ObsConfig;
import jp.streamtorearn.obsmodule.core.ObsRuntime;
import jp.streamtorearn.obsmodule.util.CommandArgs;
import jp.streamtorearn.obsmodule.util.InputSanitizer;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * OBSMODの診断・互換用コマンド。
 *
 * <p>ゲームMOD本体からの連携は /obsevent コマンドではなく、
 * jp.streamtorearn.obsmodule.api.ObsApi の任意呼び出しを推奨する。</p>
 */
public final class ObsEventCommand {
    private ObsEventCommand() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher, ObsRuntime runtime) {
        var root = Commands.literal("obsevent").requires(source -> source.hasPermission(2));

        for (String type : List.of(
                "event_start", "event_end", "event_cancel", "event_reset",
                "gift_action", "encounter", "test")) {
            root.then(Commands.literal(type)
                    .then(Commands.argument("tail", StringArgumentType.greedyString())
                            .executes(context -> handle(
                                    context.getSource(), runtime, type,
                                    StringArgumentType.getString(context, "tail")))));
        }

        for (String type : List.of("like_small", "like_combo", "like_fever")) {
            root.then(Commands.literal(type)
                    .executes(context -> handle(context.getSource(), runtime, type, ""))
                    .then(Commands.argument("tail", StringArgumentType.greedyString())
                            .executes(context -> handle(
                                    context.getSource(), runtime, type,
                                    StringArgumentType.getString(context, "tail")))));
        }
        dispatcher.register(root);
    }

    private static int handle(CommandSourceStack source, ObsRuntime runtime, String type, String raw) {
        CommandArgs.Parsed parsed = CommandArgs.parse(raw);
        String key = parsed.positional().isEmpty() ? type : parsed.positional().get(0);
        Map<String, Object> extra = new LinkedHashMap<>();

        for (var entry : parsed.kv().entrySet()) {
            extra.put(entry.getKey(), InputSanitizer.text(entry.getValue(), 256));
        }
        if (!parsed.sender().isBlank()) {
            extra.put("sender", parsed.sender());
            extra.put("listenerName", parsed.sender());
        }

        switch (type) {
            case "event_start", "event_end", "event_cancel", "event_reset" -> {
                if (parsed.positional().isEmpty()) return fail(source, "eventKey required");
                if (runtime.rules.knownStart(key) && !runtime.rules.startAllowed(key)) {
                    return fail(source, "disabled lifecycle event: " + key);
                }
                if (!runtime.rules.knownStart(key)) {
                    ObsBridgeMod.LOGGER.warn("/obsevent unknown lifecycle eventKey; passing through: {}", key);
                    source.sendSuccess(() -> Component.literal("[WARN] unknown eventKey; passed through: " + key), false);
                }
                String phase = switch (type) {
                    case "event_start" -> "START";
                    case "event_end" -> "END";
                    case "event_cancel" -> "CANCEL";
                    case "event_reset" -> "RESET";
                    default -> "";
                };
                extra.put("phase", phase);
                extra.putIfAbsent("priceTier", runtime.rules.startTier(key));
                runtime.publisher.publish(type, key, extra);
            }
            case "gift_action" -> {
                if (parsed.positional().isEmpty()) return fail(source, "eventKey required");
                ObsConfig.GiftAction gift = runtime.rules.gift(key);
                if (gift == null) {
                    ObsBridgeMod.LOGGER.warn("/obsevent unknown gift_action eventKey; passing through: {}", key);
                    source.sendSuccess(() -> Component.literal("[WARN] unknown gift_action; passed through: " + key), false);
                }
                String tier = parsed.kv().getOrDefault(
                        "priceTier",
                        gift == null ? "normal" : (gift.defaultPriceTier == null ? gift.defaultTier : gift.defaultPriceTier));
                String encounter = parsed.kv().getOrDefault("encounterKey", gift == null ? "" : gift.encounterKey);
                String status = runtime.rules.implementationStatus(key);
                String category = runtime.rules.category(key);
                extra.put("implementationStatus", status);
                if (!category.isBlank()) extra.put("category", category);
                if (runtime.rules.candidateGift(key)) {
                    extra.put("candidate", true);
                    ObsBridgeMod.LOGGER.warn("Candidate event received (presentation/definition only; Minecraft action may not be implemented): {} category={}", key, category);
                    source.sendSuccess(() -> Component.literal("[CANDIDATE] Minecraft-side action may not be implemented: " + key), false);
                }
                if (encounter != null && !encounter.isBlank()) runtime.tiers.put(encounter, tier);
                extra.put("priceTier", tier);
                runtime.publisher.publish("gift_action", key, extra);
            }
            case "encounter" -> {
                if (parsed.positional().isEmpty()) return fail(source, "eventKey required");
                if (runtime.rules.knownEncounter(key) && !runtime.rules.encounterAllowed(key)) {
                    return fail(source, "disabled encounter: " + key);
                }
                if (!runtime.rules.knownEncounter(key)) {
                    ObsBridgeMod.LOGGER.warn("/obsevent unknown encounter eventKey; passing through: {}", key);
                    source.sendSuccess(() -> Component.literal("[WARN] unknown encounter; passed through: " + key), false);
                }
                String tier = parsed.kv().containsKey("priceTier")
                        ? parsed.kv().get("priceTier")
                        : runtime.tiers.consume(key, "normal");
                extra.put("priceTier", tier);
                runtime.publisher.publish("encounter", key, extra);
            }
            case "test" -> {
                if (parsed.positional().isEmpty()) return fail(source, "eventKey required");
                extra.put("test", true);
                runtime.publisher.publish("test", key, extra);
            }
            default -> runtime.publisher.publish(type, type, extra);
        }

        source.sendSuccess(
                () -> Component.literal("OBSMOD accepted: " + type + " / " + key),
                false);
        return 1;
    }

    private static int fail(CommandSourceStack source, String message) {
        source.sendFailure(Component.literal(message));
        return 0;
    }
}
