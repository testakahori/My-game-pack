package jp.streamtorearn.obsmodule.encounter;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Objects;

/** Lightweight configurable encounter de-duplication shared by Forge/game-MOD notifications. */
public final class EncounterDeduplicator {
    private volatile long exactWindowMs = 750L;
    private volatile long crossSourceWindowMs = 300L;
    private volatile int maxEntries = 256;
    private final Deque<Entry> recent = new ArrayDeque<>();

    public synchronized void configure(long exactMs, long crossSourceMs, int maxEntries) {
        this.exactWindowMs = Math.max(0L, exactMs);
        this.crossSourceWindowMs = Math.max(0L, crossSourceMs);
        this.maxEntries = Math.max(16, Math.min(maxEntries, 4096));
        while (recent.size() > this.maxEntries) recent.removeLast();
    }

    public synchronized boolean shouldPublish(String playerId, String eventKey, String source, String attackKind, long nowMs) {
        String p=text(playerId), k=text(eventKey), src=text(source), kind=text(attackKind);
        prune(nowMs);
        for (Entry e : recent) {
            if (!Objects.equals(p, e.playerId)) continue;
            long age = nowMs - e.atMs;
            if (Objects.equals(k, e.eventKey) && age <= exactWindowMs) return false;
            boolean crossSource=!src.isBlank()&&!e.source.isBlank()&&!Objects.equals(src,e.source);
            boolean sameKind=!kind.isBlank()&&Objects.equals(kind,e.attackKind);
            if(crossSource&&sameKind&&age<=crossSourceWindowMs)return false;
        }
        recent.addFirst(new Entry(p,k,src,kind,nowMs));
        while(recent.size()>maxEntries)recent.removeLast();
        return true;
    }
    private void prune(long nowMs){ long keep=Math.max(exactWindowMs,crossSourceWindowMs); while(!recent.isEmpty()&&nowMs-recent.peekLast().atMs>keep)recent.removeLast(); }
    private static String text(String v){return v==null?"":v.trim().toLowerCase();}
    private record Entry(String playerId,String eventKey,String source,String attackKind,long atMs){}
}
