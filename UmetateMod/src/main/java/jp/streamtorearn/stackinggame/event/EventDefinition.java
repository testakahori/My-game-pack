package jp.streamtorearn.stackinggame.event;

import java.util.Objects;

/** Registry metadata kept beside the event factory so policy cannot drift from the event key. */
public record EventDefinition(
        String key,
        EventTargetMode targetMode,
        BlockInteractionMode blockInteractionMode,
        EventExecutionPolicy executionPolicy,
        Class<? extends ActiveEvent> implementationClass,
        GameEventFactory factory) {
    public EventDefinition {
        key = Objects.requireNonNull(key, "key");
        targetMode = Objects.requireNonNull(targetMode, "targetMode");
        blockInteractionMode = Objects.requireNonNull(blockInteractionMode, "blockInteractionMode");
        executionPolicy = Objects.requireNonNull(executionPolicy, "executionPolicy");
        implementationClass = Objects.requireNonNull(implementationClass, "implementationClass");
        factory = Objects.requireNonNull(factory, "factory");
    }
}
