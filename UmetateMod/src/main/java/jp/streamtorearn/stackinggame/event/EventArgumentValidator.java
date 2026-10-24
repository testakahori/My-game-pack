package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.integration.StackingBridgeContract;

import java.util.List;

/** Common shape/range validation for all 13 event argument lists. */
public final class EventArgumentValidator {
    private EventArgumentValidator() {}

    public static void validate(String eventKey, List<String> args) {
        List<String> a = args == null ? List.of() : args;
        switch (eventKey) {
            case StackingBridgeContract.AQUA_TOWER, StackingBridgeContract.VOID_BOMB, StackingBridgeContract.MEGA_BLAST -> exact(eventKey, a, 0);
            case StackingBridgeContract.MAGMA_TOWER -> optionalInt(eventKey, a, 1, 20, "count");
            case StackingBridgeContract.NETHER_ARMY -> optionalInt(eventKey, a, 1, 50, "count");
            case StackingBridgeContract.AQUARIUM -> {
                exact(eventKey, a, 7); ints(a, 0, 6); range(a, 6, 1, 600, "durationSeconds");
            }
            case StackingBridgeContract.VOID_BOMB_RAIN -> {
                exact(eventKey, a, 8); ints(a, 0, 8);
                range(a, 6, 1, StackingConfig.RAIN_MAX_COUNT.get(), "count");
                min(a, 7, StackingConfig.RAIN_MIN_INTERVAL.get(), "intervalTicks");
            }
            case StackingBridgeContract.VOID_SINGULARITY, StackingBridgeContract.ORBITAL_LASER -> optionalShape(eventKey, a, 3);
            case StackingBridgeContract.METEOR_SHOWER -> {
                if (a.isEmpty()) return; exact(eventKey, a, 3); ints(a, 0, 3);
                range(a, 0, 1, StackingConfig.METEOR_SHOWER_MAX_COUNT.get(), "count");
                range(a, 1, 1, 200, "intervalTicks");
                range(a, 2, 1, StackingConfig.ORIGINAL_MAX_RADIUS.get(), "radius");
            }
            case StackingBridgeContract.METEOR_PURGE -> {
                if (a.isEmpty()) return;
                if (a.size() != 3 && a.size() != 6) throw shape(eventKey, "none | x y z | x y z count intervalTicks radius");
                ints(a, 0, a.size());
                if (a.size() == 6) {
                    range(a, 3, 1, StackingConfig.METEOR_PURGE_MAX_COUNT.get(), "count");
                    range(a, 4, 1, 200, "intervalTicks");
                    range(a, 5, 1, StackingConfig.ORIGINAL_MAX_RADIUS.get(), "radius");
                }
            }
            case StackingBridgeContract.TORNADO -> {
                if (a.isEmpty()) return; exact(eventKey, a, 2); ints(a, 0, 2);
                range(a, 0, 1, 60, "durationSeconds");
                range(a, 1, 2, StackingConfig.ORIGINAL_MAX_RADIUS.get(), "radius");
            }
            case StackingBridgeContract.SHOCKWAVE_COLLAPSE -> {
                if (a.isEmpty()) return; exact(eventKey, a, 4); ints(a, 0, 4);
                range(a, 3, 2, StackingConfig.ORIGINAL_MAX_RADIUS.get(), "radius");
            }
            default -> throw new IllegalArgumentException("unknown eventKey: " + eventKey);
        }
    }

    private static void optionalInt(String key, List<String> a, int min, int max, String name) {
        if (a.isEmpty()) return; exact(key, a, 1); range(a, 0, min, max, name);
    }
    private static void optionalShape(String key, List<String> a, int size) { if (!a.isEmpty()) { exact(key, a, size); ints(a, 0, size); } }
    private static void exact(String key, List<String> a, int size) { if (a.size() != size) throw shape(key, "expected " + size + " args, got " + a.size()); }
    private static void ints(List<String> a, int from, int to) { for (int i=from;i<to;i++) integer(a,i,"arg"+i); }
    private static int integer(List<String> a, int index, String name) {
        try { return Integer.parseInt(a.get(index)); } catch (RuntimeException e) { throw new IllegalArgumentException(name + " must be integer"); }
    }
    private static void range(List<String> a, int index, int min, int max, String name) {
        int v=integer(a,index,name); if(v<min||v>max) throw new IllegalArgumentException(name+" out of range: "+v+" ("+min+".."+max+")");
    }
    private static void min(List<String> a, int index, int min, String name) {
        int v=integer(a,index,name); if(v<min) throw new IllegalArgumentException(name+" too small: "+v+" (min="+min+")");
    }
    private static IllegalArgumentException shape(String key, String expected) { return new IllegalArgumentException(key + " args invalid: " + expected); }
}
