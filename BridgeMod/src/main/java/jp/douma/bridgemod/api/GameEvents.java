package jp.douma.bridgemod.api;

import java.util.*;
import java.util.function.Function;
import java.util.function.Supplier;

/** Server-thread handoff. ACCEPTED transfers ownership; WAIT leaves the event in Bridge's queue. */
public final class GameEvents {
    public static final int WAIT = 0, ACCEPTED = 1;
    private static final Map<String, Function<Map<String, Object>, Integer>> RECEIVERS = new HashMap<>();
    private static final Map<String, Supplier<Map<String, Object>>> STATUS = new HashMap<>();
    private static Function<Map<String, Object>, Integer> commonEffects;
    private GameEvents() {}
    public static void register(String id, Function<Map<String, Object>, Integer> receiver,
                                Supplier<Map<String, Object>> status) {
        if (!id.matches("[a-z][a-z0-9_]{1,63}") || RECEIVERS.containsKey(id))
            throw new IllegalArgumentException("Duplicate or invalid game MOD: " + id);
        RECEIVERS.put(id, Objects.requireNonNull(receiver));
        STATUS.put(id, Objects.requireNonNull(status));
    }
    public static int offer(String id, Map<String, Object> event) {
        Object requestId = event.get("requestId");
        if (!(requestId instanceof String text) || !text.matches("[A-Za-z0-9_.:-]{1,128}"))
            throw new IllegalArgumentException("A stable requestId is required for each game request");
        var receiver = RECEIVERS.get(id);
        if (receiver == null) throw new IllegalStateException("Game MOD is not loaded: " + id);
        int result = receiver.apply(Collections.unmodifiableMap(new HashMap<>(event)));
        if (result != WAIT && result != ACCEPTED) throw new IllegalStateException("Invalid game handoff result");
        return result;
    }
    public static Map<String, Object> status() {
        Map<String, Object> result = new TreeMap<>();
        STATUS.forEach((id, supplier) -> result.put(id, supplier.get()));
        return result;
    }
    /** Common meteor / wither behaviour remains owned by BridgeMOD. No notification is emitted here. */
    public static void registerCommonEffects(Function<Map<String, Object>, Integer> receiver) {
        commonEffects = Objects.requireNonNull(receiver);
    }
    public static int commonEffect(Object source, String key, int count, Map<String, Object> protection) {
        if (commonEffects == null) throw new IllegalStateException("Bridge common effects are not ready");
        Map<String, Object> request = new HashMap<>(protection);
        request.put("source", source); request.put("key", key); request.put("count", count);
        return commonEffects.apply(request);
    }
}
