package jp.streamtorearn.obsmodule.api;

import jp.streamtorearn.obsmodule.ObsBridgeMod;
import jp.streamtorearn.obsmodule.util.InputSanitizer;
import jp.streamtorearn.obsmodule.catalog.EventMaster;
import net.minecraft.server.MinecraftServer;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 他MODからOBSMODへゲームイベントのライフサイクルを通知する公開API。
 *
 * <p>StackingGame-EventsなどのゲームMODは、イベントを「受け付けた時」ではなく、
 * 実際に開始した時点でSTARTを通知する。終了・中止・リセットも同じexecutionIdで
 * 通知することで、OBSTool側が同じ1回のイベントとして扱えるようにする。</p>
 *
 * <p>このAPIはOBS側の成否をゲーム進行へ返すためのものではない。
 * falseが返ってもゲーム本体はそのまま続行すること。</p>
 */
public final class ObsApi {
    private static final Set<String> VERSION_WARNED = ConcurrentHashMap.newKeySet();
    private ObsApi() {}

    public static boolean publishLifecycle(Object serverObject, Map<String, ?> payload) {
        // OBS ツールへの送信がオフなら、何もせずに受け付けたことにする（MyGamePack に同梱した OBSMOD。2026-10-25）。
        if (!ObsBridgeMod.RUNTIME.http.enabled()) return true;
        if (!(serverObject instanceof MinecraftServer)) {
            ObsBridgeMod.LOGGER.warn("ObsApi rejected: server is not MinecraftServer");
            return false;
        }
        if (payload == null) {
            ObsBridgeMod.LOGGER.warn("ObsApi rejected: payload is null");
            return false;
        }

        try {
            String phase = text(payload.get("phase"), 16).toUpperCase(Locale.ROOT);
            String eventKey = firstNonBlank(
                    text(payload.get("eventKey"), 128),
                    text(payload.get("key"), 128)).toLowerCase(Locale.ROOT);

            if (phase.isBlank() || eventKey.isBlank()) {
                ObsBridgeMod.LOGGER.warn("ObsApi rejected: phase/eventKey is missing");
                return false;
            }
            warnEventMasterVersion(payload, "lifecycle", eventKey);
            boolean knownStart = ObsBridgeMod.RUNTIME.rules.knownStart(eventKey);
            if (knownStart && !ObsBridgeMod.RUNTIME.rules.startAllowed(eventKey)) {
                ObsBridgeMod.LOGGER.warn("ObsApi rejected disabled lifecycle event: {}", eventKey);
                return false;
            }
            if (!knownStart) {
                ObsBridgeMod.LOGGER.warn("ObsApi received unknown lifecycle eventKey; passing through: {}", eventKey);
            }

            String eventType = switch (phase) {
                case "START" -> "event_start";
                case "END" -> "event_end";
                case "CANCEL" -> "event_cancel";
                case "RESET" -> "event_reset";
                default -> "";
            };
            if (eventType.isBlank()) {
                ObsBridgeMod.LOGGER.warn("ObsApi rejected unknown phase: {}", phase);
                return false;
            }

            Map<String, Object> extra = new LinkedHashMap<>();
            copyText(payload, extra, "eventMasterVersion", 64);
            copyText(payload, extra, "requestId", 128);
            copyText(payload, extra, "eventId", 128);
            copyText(payload, extra, "executionId", 64);
            copyText(payload, extra, "eventInstanceId", 64);
            copyText(payload, extra, "playerId", 64);
            copyText(payload, extra, "type", 32);
            copyText(payload, extra, "gameSessionId", 128);
            copyText(payload, extra, "reason", 64);

            String listenerName = firstNonBlank(
                    text(payload.get("listenerName"), 60),
                    text(payload.get("senderName"), 60),
                    text(payload.get("sender"), 60));
            if (!listenerName.isBlank()) {
                extra.put("listenerName", listenerName);
                extra.put("sender", listenerName);
            }

            Integer count = integer(payload.get("count"));
            if (payload.containsKey("count") && count == null) {
                ObsBridgeMod.LOGGER.warn("ObsApi rejected invalid count: {}", payload.get("count"));
                return false;
            }
            if (count != null) {
                if (count < 1 || count > 100_000) {
                    ObsBridgeMod.LOGGER.warn("ObsApi rejected count out of range: {}", count);
                    return false;
                }
                extra.put("count", count);
            }

            Object announce = payload.get("announce");
            if (announce instanceof Boolean value) {
                extra.put("announce", value);
            }

            if (!extra.containsKey("eventId") && extra.containsKey("requestId")) {
                extra.put("eventId", extra.get("requestId"));
            }
            if (!extra.containsKey("eventInstanceId") && extra.containsKey("executionId")) {
                extra.put("eventInstanceId", extra.get("executionId"));
            }

            extra.put("phase", phase);
            extra.put("priceTier", ObsBridgeMod.RUNTIME.rules.startTier(eventKey));
            ObsBridgeMod.RUNTIME.publisher.publish(eventType, eventKey, extra);
            return true;
        } catch (RuntimeException exception) {
            ObsBridgeMod.LOGGER.warn("ObsApi lifecycle publish failed: {}", exception.toString());
            return false;
        }
    }


    /**
     * Public API for game MODs to publish a meaningful player encounter.
     * The encounter key must be enabled in encounterEvents.
     */
    public static boolean publishEncounter(Object serverObject, Map<String, ?> payload) {
        if (!ObsBridgeMod.RUNTIME.http.enabled()) return true;
        if (!(serverObject instanceof MinecraftServer)) {
            ObsBridgeMod.LOGGER.warn("ObsApi encounter rejected: server is not MinecraftServer");
            return false;
        }
        if (payload == null) {
            ObsBridgeMod.LOGGER.warn("ObsApi encounter rejected: payload is null");
            return false;
        }
        try {
            String encounterKey = firstNonBlank(
                    text(payload.get("encounterKey"), 128),
                    text(payload.get("key"), 128)).toLowerCase(Locale.ROOT);
            if (encounterKey.isBlank()) {
                ObsBridgeMod.LOGGER.warn("ObsApi encounter rejected: encounterKey is missing");
                return false;
            }
            warnEventMasterVersion(payload, "encounter", encounterKey);
            boolean knownEncounter = ObsBridgeMod.RUNTIME.rules.knownEncounter(encounterKey);
            if (knownEncounter && !ObsBridgeMod.RUNTIME.rules.encounterAllowed(encounterKey)) {
                ObsBridgeMod.LOGGER.warn("ObsApi encounter rejected disabled encounter: {}", encounterKey);
                return false;
            }
            if (!knownEncounter) {
                ObsBridgeMod.LOGGER.warn("ObsApi received unknown encounter eventKey; passing through: {}", encounterKey);
            }

            Map<String, Object> extra = new LinkedHashMap<>();
            copyText(payload, extra, "eventMasterVersion", 64);
            // Do not overwrite EventPublisher.eventKey (the encounter key).
            // Game MODs may send their base event as eventKey; expose it as parentEventKey instead.
            String parentEventKey = firstNonBlank(
                    text(payload.get("parentEventKey"), 128),
                    text(payload.get("eventKey"), 128));
            if (!parentEventKey.isBlank()) extra.put("parentEventKey", parentEventKey);
            extra.put("encounterKey", encounterKey);
            copyText(payload, extra, "requestId", 128);
            copyText(payload, extra, "eventId", 128);
            copyText(payload, extra, "executionId", 64);
            copyText(payload, extra, "eventInstanceId", 64);
            copyText(payload, extra, "playerId", 64);
            copyText(payload, extra, "type", 32);
            copyText(payload, extra, "gameSessionId", 128);
            copyText(payload, extra, "encounterKind", 64);
            copyText(payload, extra, "source", 32);
            copyText(payload, extra, "detection", 96);
            copyText(payload, extra, "attackKind", 64);
            copyText(payload, extra, "attackerEntityId", 128);
            copyText(payload, extra, "attackerEntityUuid", 64);
            copyText(payload, extra, "directEntityId", 128);
            copyText(payload, extra, "directEntityUuid", 64);
            copyText(payload, extra, "damageType", 128);

            String listenerName = firstNonBlank(
                    text(payload.get("listenerName"), 60),
                    text(payload.get("senderName"), 60),
                    text(payload.get("sender"), 60));
            if (!listenerName.isBlank()) {
                extra.put("listenerName", listenerName);
                extra.put("sender", listenerName);
            }
            Integer count = integer(payload.get("count"));
            if (payload.containsKey("count") && count == null) return false;
            if (count != null) {
                if (count < 1 || count > 100_000) return false;
                extra.put("count", count);
            }
            Object announce = payload.get("announce");
            if (announce instanceof Boolean value) extra.put("announce", value);
            if (!extra.containsKey("eventId") && extra.containsKey("requestId")) extra.put("eventId", extra.get("requestId"));
            if (!extra.containsKey("eventInstanceId") && extra.containsKey("executionId")) extra.put("eventInstanceId", extra.get("executionId"));

            Object damageAmount = payload.get("damageAmount");
            if (damageAmount instanceof Number n && Double.isFinite(n.doubleValue())) extra.put("damageAmount", n.doubleValue());

            extra.putIfAbsent("source", "game_mod");
            extra.putIfAbsent("detection", "ObsApi.publishEncounter");
            String playerId = String.valueOf(extra.getOrDefault("playerId", ""));
            String source = String.valueOf(extra.getOrDefault("source", ""));
            String attackKind = String.valueOf(extra.getOrDefault("attackKind", extra.getOrDefault("encounterKind", "game_event")));
            if (!ObsBridgeMod.RUNTIME.encounterDedupe.shouldPublish(playerId, encounterKey, source, attackKind, System.currentTimeMillis())) {
                ObsBridgeMod.LOGGER.debug("ObsApi encounter de-duplicated: key={} player={} source={} kind={}", encounterKey, playerId, source, attackKind);
                return true;
            }

            extra.put("priceTier", ObsBridgeMod.RUNTIME.rules.encounterTier(encounterKey));
            ObsBridgeMod.RUNTIME.publisher.publish("encounter", encounterKey, extra);
            return true;
        } catch (RuntimeException exception) {
            ObsBridgeMod.LOGGER.warn("ObsApi encounter publish failed: {}", exception.toString());
            return false;
        }
    }


    private static void warnEventMasterVersion(Map<String, ?> payload, String channel, String eventKey) {
        String remote = text(payload.get("eventMasterVersion"), 64);
        if (remote.isBlank() || EventMaster.CATALOG_VERSION.equals(remote)) return;
        String signature = channel + "|" + remote + "|" + EventMaster.CATALOG_VERSION;
        if (VERSION_WARNED.add(signature)) {
            ObsBridgeMod.LOGGER.warn(
                    "Event Master version mismatch (continuing): channel={} eventKey={} sender={} OBSMOD={}",
                    channel, eventKey, remote, EventMaster.CATALOG_VERSION);
        }
    }

    private static void copyText(Map<String, ?> source, Map<String, Object> target, String key, int max) {
        String value = text(source.get(key), max);
        if (!value.isBlank()) target.put(key, value);
    }

    private static String text(Object value, int max) {
        return value == null ? "" : InputSanitizer.text(String.valueOf(value), max);
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) return value;
        }
        return "";
    }

    private static Integer integer(Object value) {
        if (value == null) return null;
        if (value instanceof Number number) {
            double d = number.doubleValue();
            if (!Double.isFinite(d) || Math.rint(d) != d || d < Integer.MIN_VALUE || d > Integer.MAX_VALUE) {
                return null;
            }
            return (int) d;
        }
        try {
            return Integer.parseInt(String.valueOf(value).trim());
        } catch (NumberFormatException exception) {
            return null;
        }
    }
}
