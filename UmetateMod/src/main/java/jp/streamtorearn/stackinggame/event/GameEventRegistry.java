package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.event.impl.*;
import jp.streamtorearn.stackinggame.integration.StackingBridgeContract;
import jp.streamtorearn.stackinggame.integration.StackingEventCatalog;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Central registry for all StackingGame events.
 *
 * <p>v2.6.6: every event is classified exactly once by target mode and block-interaction intent.
 * The block mode is intentionally descriptive/lightweight; the safety gate only enforces protected
 * blocks and ARENA boundaries, so event behavior is not over-constrained.</p>
 */
public final class GameEventRegistry {
    private final Map<String, EventDefinition> definitions = new LinkedHashMap<>();

    public GameEventRegistry() {
        // PLAYER: the effect is anchored to / tracks the target player.
        registerMaster(StackingBridgeContract.AQUA_TOWER, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, AquaTowerEvent.class, (c, a) -> new AquaTowerEvent(c));
        registerMaster(StackingBridgeContract.MAGMA_TOWER, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, MagmaTowerEvent.class, MagmaTowerEvent::new);
        registerMaster(StackingBridgeContract.VOID_BOMB, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, VoidBombEvent.class, (c, a) -> new VoidBombEvent(c));
        registerMaster(StackingBridgeContract.MEGA_BLAST, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, MegaBlastEvent.class, (c, a) -> new MegaBlastEvent(c));
        registerMaster(StackingBridgeContract.NETHER_ARMY, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, NetherArmyEvent.class, NetherArmyEvent::new);
        registerMaster(StackingBridgeContract.METEOR_SHOWER, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, MeteorShowerEvent.class, MeteorShowerEvent::new);

        // ARENA: the effect is bound to the fixed landfill/stacking arena.
        registerMaster(StackingBridgeContract.AQUARIUM, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, AquariumEvent.class, AquariumEvent::new);
        registerMaster(StackingBridgeContract.VOID_BOMB_RAIN, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, VoidBombRainEvent.class, VoidBombRainEvent::new);
        registerMaster(StackingBridgeContract.VOID_SINGULARITY, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, VoidSingularityEvent.class, VoidSingularityEvent::new);
        registerMaster(StackingBridgeContract.METEOR_PURGE, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, MeteorPurgeEvent.class, MeteorPurgeEvent::new);
        registerMaster(StackingBridgeContract.TORNADO, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, TornadoEvent.class, TornadoEvent::new);
        registerMaster(StackingBridgeContract.ORBITAL_LASER, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, OrbitalLaserEvent.class, OrbitalLaserEvent::new);
        registerMaster(StackingBridgeContract.SHOCKWAVE_COLLAPSE, EventExecutionPolicy.SERIAL_ALLOW_DUPLICATES, ShockwaveCollapseEvent.class, ShockwaveCollapseEvent::new);
    }

    private void registerMaster(String key, EventExecutionPolicy executionPolicy, Class<? extends ActiveEvent> implementationClass, GameEventFactory factory) {
        StackingEventCatalog.Meta meta = StackingEventCatalog.get(key);
        register(key, meta.targetMode(), meta.blockMode(), executionPolicy, implementationClass, factory);
    }

    public void register(String key, EventTargetMode targetMode, BlockInteractionMode blockInteractionMode, EventExecutionPolicy executionPolicy, Class<? extends ActiveEvent> implementationClass, GameEventFactory factory) {
        if (definitions.putIfAbsent(key, new EventDefinition(key, targetMode, blockInteractionMode, executionPolicy, implementationClass, factory)) != null) {
            throw new IllegalStateException("duplicate eventKey: " + key);
        }
    }

    public EventDefinition definition(String key) {
        EventDefinition definition = definitions.get(key);
        if (definition == null) throw new IllegalArgumentException("unknown eventKey: " + key);
        return definition;
    }

    public EventTargetMode targetMode(String key) {
        return definition(key).targetMode();
    }

    public BlockInteractionMode blockInteractionMode(String key) {
        return definition(key).blockInteractionMode();
    }

    public EventExecutionPolicy executionPolicy(String key) {
        return definition(key).executionPolicy();
    }

    public ActiveEvent create(EventContext ctx, java.util.List<String> args) {
        EventDefinition definition = definition(ctx.request().eventKey());
        if (ctx.targetMode() != definition.targetMode()) {
            throw new IllegalStateException(
                    "event target mode mismatch: key=" + definition.key()
                            + " expected=" + definition.targetMode()
                            + " actual=" + ctx.targetMode());
        }
        return definition.factory().create(ctx, args);
    }

    public boolean contains(String key) {
        return definitions.containsKey(key);
    }

    public Map<String, EventDefinition> definitions() {
        return Collections.unmodifiableMap(definitions);
    }

    public Set<String> keys() {
        return Collections.unmodifiableSet(definitions.keySet());
    }

    public Set<String> keys(EventTargetMode mode) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (EventDefinition definition : definitions.values()) {
            if (definition.targetMode() == mode) result.add(definition.key());
        }
        return Collections.unmodifiableSet(result);
    }
}
