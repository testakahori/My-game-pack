package jp.douma.bridgemod.api;

import java.util.*;

/** Game-owned, server-thread duplicate guard. Pending IDs never expire; completed IDs are bounded. */
public final class RequestLedger {
    private final Map<String, String> pending = new HashMap<>();
    private final LinkedHashMap<String, String> completed = new LinkedHashMap<>();
    private final int limit;
    public RequestLedger(int completedLimit) {
        if (completedLimit < 1) throw new IllegalArgumentException("completedLimit must be positive");
        limit = completedLimit;
    }
    public boolean alreadyAccepted(String id, String fingerprint) {
        if (id == null || !id.matches("[A-Za-z0-9_.:-]{1,128}")) throw new IllegalArgumentException("Invalid requestId");
        String previous = pending.containsKey(id) ? pending.get(id) : completed.get(id);
        if (previous != null && !previous.equals(fingerprint)) throw new IllegalArgumentException("requestId reused with a different event: " + id);
        return previous != null;
    }
    /** Call only after queue admission succeeds. WAIT must not record an ID. */
    public void accepted(String id, String fingerprint) {
        if (!alreadyAccepted(id, fingerprint)) pending.put(id, fingerprint);
    }
    public void completed(String id) {
        String fingerprint = pending.remove(id);
        if (fingerprint == null) return;
        completed.put(id, fingerprint);
        while (completed.size() > limit) completed.remove(completed.keySet().iterator().next());
    }
    public void clear() { pending.clear(); completed.clear(); }
}
