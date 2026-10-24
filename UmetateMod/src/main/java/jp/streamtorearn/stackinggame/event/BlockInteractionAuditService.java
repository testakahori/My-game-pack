package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.StackingGameMod;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Lightweight audit for event block-operation intent.
 *
 * <p>This deliberately does not hard-block gameplay. It warns once per execution/operation when
 * an event performs a block operation that does not match Event Master's BlockInteractionMode.
 * Protected blocks and arena boundaries remain enforced by BlockSafetyService.</p>
 */
public final class BlockInteractionAuditService {
    public enum Operation {
        TERRAIN_REMOVE,
        TEMPORARY_PLACE,
        STACK_REMOVE,
        STACK_FALLING
    }

    private final Set<String> warned = ConcurrentHashMap.newKeySet();

    public void audit(EventRequest request, BlockInteractionMode mode, Operation operation) {
        if (request == null || mode == null || operation == null) return;
        if (isExpected(mode, operation)) return;

        String key = request.executionId() + "|" + operation;
        if (!warned.add(key)) return;

        StackingGameMod.LOGGER.warn(
                "Block interaction differs from Event Master intent: eventKey={} requestId={} executionId={} mode={} operation={}. "
                        + "Operation is allowed, but review the event definition if this is intentional.",
                request.eventKey(), request.externalRequestId(), request.executionId(), mode, operation);
    }

    public void clear(UUID executionId) {
        if (executionId == null) return;
        String prefix = executionId + "|";
        warned.removeIf(value -> value.startsWith(prefix));
    }

    static boolean isExpected(BlockInteractionMode mode, Operation operation) {
        return switch (mode) {
            case NONE -> false;
            // Temporary events may remove a replaceable block immediately before placing/restoring
            // water/lava; keep this permissive and warning-free.
            case TEMPORARY -> operation == Operation.TEMPORARY_PLACE || operation == Operation.TERRAIN_REMOVE;
            case TERRAIN -> operation == Operation.TERRAIN_REMOVE;
            case STACK_ONLY -> operation == Operation.STACK_REMOVE;
            case STACK_FALLING -> operation == Operation.STACK_FALLING || operation == Operation.STACK_REMOVE;
        };
    }
}
