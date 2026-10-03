package example.game.integration;

import jp.douma.bridgemod.api.GameEvents;
import jp.douma.bridgemod.api.RequestLedger;
import java.util.*;
import java.util.function.Consumer;

/** Server-thread example. The game supplies startEvent and owns all gameplay/OBS/display timing. */
public final class SessionReceiver {
    private final String gameId;
    private final Consumer<Map<String,Object>> startEvent;
    private final Deque<Map<String,Object>> waiting = new ArrayDeque<>();
    private final RequestLedger requests = new RequestLedger(65536);
    private boolean paused;
    private volatile Map<String,Object> snapshot = Map.of("waiting", 0);
    public SessionReceiver(String gameId, Consumer<Map<String,Object>> startEvent) {
        this.gameId = gameId; this.startEvent = startEvent;
        GameEvents.register(gameId, this::offer, () -> snapshot);
    }
    public void beginRound() {
        waiting.clear(); requests.clear(); paused = false;
        GameEvents.beginSession(gameId); updateStatus();
    }
    public void endRound() {
        waiting.clear(); requests.clear(); GameEvents.endSession(gameId); updateStatus();
    }
    public void setPaused(boolean value) { paused = value; }
    private int offer(Map<String,Object> event) {
        if (!GameEvents.isCurrentSession(gameId, event.get("gameSessionId"))) return GameEvents.DISCARDED;
        String id = (String)event.get("requestId");
        // Stable field order; do not compare raw JSON whose object key order can vary.
        String fingerprint = List.of(event.get("key"), event.get("count"), event.get("listenerName"),
            event.get("type"), event.get("announce"), new TreeMap<>((Map<String,Object>)event.get("args"))).toString();
        if (requests.alreadyAccepted(id, fingerprint)) return GameEvents.ACCEPTED;
        if (waiting.size() >= 500) return GameEvents.WAIT;
        waiting.addLast(event); requests.accepted(id, fingerprint); updateStatus();
        return GameEvents.ACCEPTED;
    }
    /** Call only when this game can really begin the next event. Pause/death do not change round IDs. */
    public void beginNextEvent() {
        if (paused || waiting.isEmpty()) return;
        Map<String,Object> event = waiting.removeFirst();
        try { startEvent.accept(event); }
        finally { requests.completed((String)event.get("requestId")); updateStatus(); }
    }
    private void updateStatus() { snapshot = Map.of("waiting", waiting.size()); }
}
