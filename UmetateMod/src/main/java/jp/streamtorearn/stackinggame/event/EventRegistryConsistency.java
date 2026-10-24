package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.integration.StackingEventCatalog;

import java.lang.reflect.Modifier;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/** Fail fast when Event Master metadata and executable event registrations drift apart. */
public final class EventRegistryConsistency {
    public static void validate(GameEventRegistry registry) {
        Set<String> master = new LinkedHashSet<>(StackingEventCatalog.all().keySet());
        Set<String> code = new LinkedHashSet<>(registry.keys());

        Set<String> missingImplementations = new LinkedHashSet<>(master);
        missingImplementations.removeAll(code);
        Set<String> extraImplementations = new LinkedHashSet<>(code);
        extraImplementations.removeAll(master);

        if (!missingImplementations.isEmpty() || !extraImplementations.isEmpty()) {
            throw new IllegalStateException(
                    "Event Master / implementation mismatch: missing=" + missingImplementations
                            + " extra=" + extraImplementations);
        }

        for (Map.Entry<String, EventDefinition> entry : registry.definitions().entrySet()) {
            String key = entry.getKey();
            EventDefinition definition = entry.getValue();
            StackingEventCatalog.Meta meta = StackingEventCatalog.get(key);
            if (definition.targetMode() != meta.targetMode()) {
                throw new IllegalStateException("targetMode mismatch for " + key + ": registry="
                        + definition.targetMode() + " master=" + meta.targetMode());
            }
            if (definition.blockInteractionMode() != meta.blockMode()) {
                throw new IllegalStateException("blockInteractionMode mismatch for " + key + ": registry="
                        + definition.blockInteractionMode() + " master=" + meta.blockMode());
            }
            Class<? extends ActiveEvent> impl = definition.implementationClass();
            if (impl == null || impl.isInterface() || Modifier.isAbstract(impl.getModifiers())) {
                throw new IllegalStateException("event implementation is not concrete: " + key + " -> " + impl);
            }
        }

        StackingGameMod.LOGGER.info("Event Master implementation check passed: {} events", code.size());
    }

    private EventRegistryConsistency() {}
}
