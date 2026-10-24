package jp.streamtorearn.stackinggame.event;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * 通信再送による同一要求の二重登録を防ぐためのメモリ内台帳。
 *
 * <p>eventKey が同じという理由では重複扱いしない。
 * 同じ externalRequestId のときだけ同一要求として判定する。</p>
 */
public final class RequestLedger {
    // 参考実装と同じく、直近 65,536 件を保持する。
    // サーバー再起動をまたぐ永続化は今回の対象外。
    private static final int MAX_ENTRIES = 65_536;

    private final LinkedHashMap<String, Fingerprint> accepted = new LinkedHashMap<>();
    private final LinkedHashMap<String, String> terminalFailures = new LinkedHashMap<>();

    public synchronized Check check(EventRequest request) {
        Fingerprint old = accepted.get(request.externalRequestId());
        if (old == null) {
            return Check.NEW;
        }
        if (!old.equals(Fingerprint.of(request))) {
            return Check.CONFLICT;
        }
        return terminalFailures.containsKey(request.externalRequestId()) ? Check.FAILED : Check.DUPLICATE;
    }

    /**
     * 待機列へ実際に受け入れた後だけ記録する。
     * WAIT を返す要求は記録しないこと。
     */
    public synchronized void remember(EventRequest request) {
        accepted.put(request.externalRequestId(), Fingerprint.of(request));
        terminalFailures.remove(request.externalRequestId());
        trim();
    }

    /** ACCEPTED後に恒久的な開始失敗が確定した要求を記録する。 */
    public synchronized void markFailed(EventRequest request, String reason) {
        accepted.put(request.externalRequestId(), Fingerprint.of(request));
        terminalFailures.put(request.externalRequestId(), reason == null ? "terminal start failure" : reason);
        trim();
    }

    public synchronized String failureReason(String externalRequestId) {
        return terminalFailures.getOrDefault(externalRequestId, "terminal start failure");
    }

    private void trim() {
        while (accepted.size() > MAX_ENTRIES) {
            String oldest = accepted.keySet().iterator().next();
            accepted.remove(oldest);
            terminalFailures.remove(oldest);
        }
    }

    public synchronized void clear() {
        accepted.clear();
        terminalFailures.clear();
    }

    public synchronized int size() {
        return accepted.size();
    }

    public enum Check {
        NEW,
        DUPLICATE,
        CONFLICT,
        FAILED
    }

    private record Fingerprint(
            String eventKey,
            int rawCount,
            String listenerName,
            String type,
            String gameSessionId,
            Map<String, Object> args,
            boolean announce) {
        static Fingerprint of(EventRequest request) {
            return new Fingerprint(
                    request.eventKey(),
                    request.rawCount(),
                    request.listenerName(),
                    request.type(),
                    request.gameSessionId(),
                    request.args(),
                    request.announce());
        }

        @Override
        public boolean equals(Object obj) {
            if (this == obj) return true;
            if (!(obj instanceof Fingerprint other)) return false;
            return rawCount == other.rawCount
                    && Objects.equals(eventKey, other.eventKey)
                    && Objects.equals(listenerName, other.listenerName)
                    && Objects.equals(type, other.type)
                    && Objects.equals(gameSessionId, other.gameSessionId)
                    && Objects.equals(args, other.args)
                    && announce == other.announce;
        }
    }
}
