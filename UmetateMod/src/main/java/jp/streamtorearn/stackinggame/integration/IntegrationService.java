package jp.streamtorearn.stackinggame.integration;

import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.event.CancelReason;
import jp.streamtorearn.stackinggame.event.EventRequest;
import jp.streamtorearn.stackinggame.util.CommandTail;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.fml.ModList;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** StackingGameから外部演出MODへ通知する任意連携。OBSMOD失敗でもゲームは継続する。 */
public final class IntegrationService {
    private static final String OBS_API_CLASS = "jp.streamtorearn.obsmodule.api.ObsApi";
    private static final String OBS_API_METHOD = "publishLifecycle";
    private static final String OBS_ENCOUNTER_API_METHOD = "publishEncounter";
    private final ForgeCommandGateway commands = new ForgeCommandGateway();
    private volatile Method obsLifecycleMethod;
    private volatile Method obsEncounterMethod;
    private volatile boolean obsApiLookupDone;
    private volatile boolean obsEncounterLookupDone;
    private final Set<String> sentEncounters = ConcurrentHashMap.newKeySet();

    public boolean hasDisplay() { return ModList.get().isLoaded("giftsdisplay"); }
    public boolean hasObs() { return ModList.get().isLoaded("minecraft_obs_bridge"); }
    public boolean hasObsLifecycleApi() { return hasObs() && findObsLifecycleMethod() != null; }
    public boolean notifyObsStart(MinecraftServer server, EventRequest request) { return notifyObs(server, "START", request, ""); }
    public boolean notifyObsEnd(MinecraftServer server, EventRequest request) {
        try { return notifyObs(server, "END", request, "NORMAL"); }
        finally { clearEncounterState(request); }
    }
    public boolean notifyObsCancelled(MinecraftServer server, EventRequest request, CancelReason reason) {
        try { return notifyObs(server, reason == CancelReason.RESET ? "RESET" : "CANCEL", request, reason.name()); }
        finally { clearEncounterState(request); }
    }

    /**
     * Notify OBSMOD once for a meaningful player encounter during one execution.
     * Repeated impacts/pulls from the same event do not spam OBS.
     */
    public boolean notifyObsEncounter(MinecraftServer server, EventRequest request, String encounterKey, String encounterKind) {
        return notifyObsEncounter(server, request, encounterKey, encounterKind, broadAttackKind(encounterKind));
    }

    public boolean notifyObsEncounter(MinecraftServer server, EventRequest request, String encounterKey, String encounterKind, String attackKind) {
        if (encounterKey == null || encounterKey.isBlank()) return false;
        String dedupeKey = request.executionId() + "|" + encounterKey;
        if (!sentEncounters.add(dedupeKey)) return false;
        if (!hasObs()) return false;

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("encounterKey", encounterKey);
        payload.put("eventMasterVersion", EventMasterKeys.CATALOG_VERSION);
        payload.put("eventKey", request.eventKey());
        payload.put("parentEventKey", request.eventKey());
        payload.put("requestId", request.externalRequestId());
        payload.put("eventId", request.externalRequestId());
        payload.put("executionId", request.executionId().toString());
        payload.put("eventInstanceId", request.executionId().toString());
        payload.put("playerId", request.playerId().toString());
        payload.put("listenerName", request.listenerName());
        payload.put("senderName", request.listenerName());
        payload.put("count", request.rawCount());
        payload.put("type", request.type());
        payload.put("gameSessionId", request.gameSessionId());
        payload.put("announce", request.announce());
        if (encounterKind != null && !encounterKind.isBlank()) payload.put("encounterKind", encounterKind);
        payload.put("source", "stackinggame");
        payload.put("detection", "StackingGame publishEncounter");
        payload.put("attackKind", attackKind == null || attackKind.isBlank() ? "game_event" : attackKind);

        Method method = findObsEncounterMethod();
        if (method != null) {
            try {
                Object result = method.invoke(null, server, payload);
                return result instanceof Boolean value ? value : result != null;
            } catch (ReflectiveOperationException | RuntimeException exception) {
                StackingGameMod.LOGGER.warn("OBSMOD encounter notification failed: key={} eventKey={} requestId={} -> {}",
                        encounterKey, request.eventKey(), request.externalRequestId(), exception.toString());
                return false;
            }
        }

        // Compatibility fallback for OBSMOD 2.4.0: its command path already supports encounter.
        // This succeeds only when that OBSMOD configuration already contains the encounter key.
        String command = "obsevent encounter " + CommandTail.sanitize(encounterKey)
                + " --sender " + CommandTail.sanitize(request.listenerName())
                + " requestId=" + CommandTail.sanitize(request.externalRequestId())
                + " executionId=" + request.executionId();
        try {
            return commands.execute(server, command) > 0;
        } catch (Exception exception) {
            StackingGameMod.LOGGER.warn("OBSMOD encounter compatibility command failed: {} -> {}", encounterKey, exception.toString());
            return false;
        }
    }

    private static String broadAttackKind(String encounterKind) {
        if (encounterKind == null) return "game_event";
        return switch (encounterKind) {
            case "explosion", "meteor_impact", "shockwave_hit" -> "explosion";
            case "laser_hit" -> "energy";
            case "water_lift", "inside_aquarium", "tornado_catch", "gravity_pull", "lava_tower_near", "enemy_close" -> "game_event";
            default -> "game_event";
        };
    }

    private void clearEncounterState(EventRequest request) {
        String prefix = request.executionId() + "|";
        sentEncounters.removeIf(value -> value.startsWith(prefix));
    }

    private boolean notifyObs(MinecraftServer server, String phase, EventRequest request, String reason) {
        if (!hasObs()) return false;
        Method method = findObsLifecycleMethod();
        if (method == null) {
            StackingGameMod.LOGGER.warn("OBSMOD is loaded but ObsApi.publishLifecycle was not found. Game continues.");
            return false;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("phase", phase); payload.put("eventKey", request.eventKey()); payload.put("key", request.eventKey());
        payload.put("eventMasterVersion", EventMasterKeys.CATALOG_VERSION);
        payload.put("requestId", request.externalRequestId()); payload.put("eventId", request.externalRequestId());
        payload.put("executionId", request.executionId().toString()); payload.put("eventInstanceId", request.executionId().toString());
        payload.put("playerId", request.playerId().toString()); payload.put("listenerName", request.listenerName());
        payload.put("senderName", request.listenerName()); payload.put("count", request.rawCount()); payload.put("type", request.type());
        payload.put("gameSessionId", request.gameSessionId()); payload.put("announce", request.announce());
        if (reason != null && !reason.isBlank()) payload.put("reason", reason);
        try {
            Object result = method.invoke(null, server, payload);
            return result instanceof Boolean value ? value : result != null;
        } catch (ReflectiveOperationException | RuntimeException exception) {
            StackingGameMod.LOGGER.warn("OBSMOD lifecycle notification failed: phase={} key={} requestId={} -> {}",
                    phase, request.eventKey(), request.externalRequestId(), exception.toString());
            return false;
        }
    }

    private Method findObsEncounterMethod() {
        if (obsEncounterLookupDone) return obsEncounterMethod;
        synchronized (this) {
            if (obsEncounterLookupDone) return obsEncounterMethod;
            try {
                Class<?> apiClass = Class.forName(OBS_API_CLASS);
                for (Method method : apiClass.getMethods()) {
                    if (method.getName().equals(OBS_ENCOUNTER_API_METHOD) && Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 2) {
                        obsEncounterMethod = method; break;
                    }
                }
            } catch (ClassNotFoundException | LinkageError exception) { obsEncounterMethod = null; }
            finally { obsEncounterLookupDone = true; }
            return obsEncounterMethod;
        }
    }

    private Method findObsLifecycleMethod() {
        if (obsApiLookupDone) return obsLifecycleMethod;
        synchronized (this) {
            if (obsApiLookupDone) return obsLifecycleMethod;
            try {
                Class<?> apiClass = Class.forName(OBS_API_CLASS);
                for (Method method : apiClass.getMethods()) {
                    if (method.getName().equals(OBS_API_METHOD) && Modifier.isStatic(method.getModifiers()) && method.getParameterCount() == 2) {
                        obsLifecycleMethod = method; break;
                    }
                }
            } catch (ClassNotFoundException | LinkageError exception) { obsLifecycleMethod = null; }
            finally { obsApiLookupDone = true; }
            return obsLifecycleMethod;
        }
    }

    public void testDisplay(MinecraftServer server, ServerPlayer player, String key, String sender) {
        if (hasDisplay()) bestEffort(server, "giftsdisplay sync " + player.getGameProfile().getName() + " " + key
                + (sender.isBlank() ? "" : " --sender " + CommandTail.sanitize(sender)));
    }
    public void testObs(MinecraftServer server, String key, String sender) {
        if (hasObs()) bestEffort(server, "obsevent test " + key + (sender.isBlank() ? "" : " --sender " + CommandTail.sanitize(sender)));
    }
    private void bestEffort(MinecraftServer server, String command) {
        try {
            int result = commands.execute(server, command);
            if (result <= 0) StackingGameMod.LOGGER.warn("Integration command returned {}: {}", result, command);
        } catch (Exception exception) {
            StackingGameMod.LOGGER.warn("Integration command failed: {} -> {}", command, exception.toString());
        }
    }
}
