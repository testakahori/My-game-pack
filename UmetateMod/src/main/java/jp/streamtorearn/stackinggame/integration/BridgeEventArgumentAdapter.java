package jp.streamtorearn.stackinggame.integration;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** BridgeMOD 1.4.0 の eventKey/args を StackingGame 内部の文字列引数へ変換する。 */
public final class BridgeEventArgumentAdapter {
    private BridgeEventArgumentAdapter() {}

    public static List<String> toEventArgs(String rawEventKey, Map<String, Object> args) {
        String event = rawEventKey == null ? "" : rawEventKey.trim().toLowerCase(Locale.ROOT);
        Map<String, Object> safe = args == null ? Map.of() : args;
        return switch (event) {
            case StackingBridgeContract.AQUA_TOWER,
                 StackingBridgeContract.VOID_BOMB,
                 StackingBridgeContract.MEGA_BLAST -> List.of();
            case StackingBridgeContract.MAGMA_TOWER -> optionalSingleIntAny(
                    safe, StackingBridgeContract.COUNT, StackingBridgeContract.TOWER_COUNT);
            case StackingBridgeContract.NETHER_ARMY -> optionalSingleIntAny(
                    safe, StackingBridgeContract.COUNT, StackingBridgeContract.PAIRS);
            case StackingBridgeContract.AQUARIUM -> List.of(
                    requiredInt(safe, StackingBridgeContract.X1), requiredInt(safe, StackingBridgeContract.Y1), requiredInt(safe, StackingBridgeContract.Z1),
                    requiredInt(safe, StackingBridgeContract.X2), requiredInt(safe, StackingBridgeContract.Y2), requiredInt(safe, StackingBridgeContract.Z2),
                    requiredIntAny(safe, StackingBridgeContract.DURATION_SECONDS, StackingBridgeContract.SECONDS));
            case StackingBridgeContract.VOID_BOMB_RAIN -> List.of(
                    requiredInt(safe, StackingBridgeContract.X1), requiredInt(safe, StackingBridgeContract.Y1), requiredInt(safe, StackingBridgeContract.Z1),
                    requiredInt(safe, StackingBridgeContract.X2), requiredInt(safe, StackingBridgeContract.Y2), requiredInt(safe, StackingBridgeContract.Z2),
                    requiredIntAny(safe, StackingBridgeContract.COUNT, StackingBridgeContract.IMPACT_COUNT),
                    requiredIntAny(safe, StackingBridgeContract.INTERVAL_TICKS, "interval"));
            case StackingBridgeContract.VOID_SINGULARITY,
                 StackingBridgeContract.ORBITAL_LASER -> optionalPosition(safe);
            case StackingBridgeContract.METEOR_SHOWER -> optionalTripleCount(
                    safe, StackingBridgeContract.INTERVAL_TICKS, StackingBridgeContract.RADIUS);
            case StackingBridgeContract.METEOR_PURGE -> meteorPurge(safe);
            case StackingBridgeContract.TORNADO -> optionalPair(
                    safe, StackingBridgeContract.DURATION_SECONDS, StackingBridgeContract.RADIUS);
            case StackingBridgeContract.SHOCKWAVE_COLLAPSE -> shockwave(safe);
            default -> throw new IllegalArgumentException("unknown StackingGame event key: " + rawEventKey);
        };
    }

    private static List<String> optionalSingleIntAny(Map<String, Object> args, String primary, String legacyAlias) {
        boolean any = args.containsKey(primary) || args.containsKey(legacyAlias);
        if (!any) return List.of();
        return List.of(requiredIntAny(args, primary, legacyAlias));
    }

    private static List<String> optionalPosition(Map<String, Object> args) {
        boolean any = args.containsKey(StackingBridgeContract.TARGET_X)
                || args.containsKey(StackingBridgeContract.TARGET_Y)
                || args.containsKey(StackingBridgeContract.TARGET_Z);
        if (!any) return List.of();
        return List.of(
                requiredInt(args, StackingBridgeContract.TARGET_X),
                requiredInt(args, StackingBridgeContract.TARGET_Y),
                requiredInt(args, StackingBridgeContract.TARGET_Z));
    }

    private static List<String> optionalPair(Map<String, Object> args, String a, String b) {
        boolean any = args.containsKey(a) || args.containsKey(b);
        if (!any) return List.of();
        return List.of(requiredInt(args, a), requiredInt(args, b));
    }

    private static List<String> optionalTripleCount(Map<String, Object> args, String intervalKey, String radiusKey) {
        boolean any = args.containsKey(StackingBridgeContract.COUNT)
                || args.containsKey(StackingBridgeContract.METEOR_COUNT)
                || args.containsKey(intervalKey)
                || args.containsKey(radiusKey);
        if (!any) return List.of();
        return List.of(
                requiredIntAny(args, StackingBridgeContract.COUNT, StackingBridgeContract.METEOR_COUNT),
                requiredInt(args, intervalKey),
                requiredInt(args, radiusKey));
    }

    private static List<String> meteorPurge(Map<String, Object> args) {
        List<String> pos = optionalPosition(args);
        boolean anySettings = args.containsKey(StackingBridgeContract.COUNT)
                || args.containsKey(StackingBridgeContract.METEOR_COUNT)
                || args.containsKey(StackingBridgeContract.INTERVAL_TICKS)
                || args.containsKey(StackingBridgeContract.RADIUS);
        if (pos.isEmpty() && !anySettings) return List.of();
        if (pos.isEmpty()) throw new IllegalArgumentException("meteor_purge targetX/targetY/targetZ are required when custom settings are supplied");
        if (!anySettings) return pos;
        List<String> result = new ArrayList<>(pos);
        result.add(requiredIntAny(args, StackingBridgeContract.COUNT, StackingBridgeContract.METEOR_COUNT));
        result.add(requiredInt(args, StackingBridgeContract.INTERVAL_TICKS));
        result.add(requiredInt(args, StackingBridgeContract.RADIUS));
        return List.copyOf(result);
    }

    private static List<String> shockwave(Map<String, Object> args) {
        List<String> pos = optionalPosition(args);
        boolean hasRadius = args.containsKey(StackingBridgeContract.RADIUS);
        if (pos.isEmpty() && !hasRadius) return List.of();
        if (pos.isEmpty() || !hasRadius) {
            throw new IllegalArgumentException("shockwave_collapse requires targetX/targetY/targetZ/radius together");
        }
        List<String> result = new ArrayList<>(pos);
        result.add(requiredInt(args, StackingBridgeContract.RADIUS));
        return List.copyOf(result);
    }

    private static String requiredIntAny(Map<String, Object> args, String primary, String alias) {
        if (args.containsKey(primary)) return requiredInt(args, primary);
        if (args.containsKey(alias)) return requiredInt(args, alias);
        throw new IllegalArgumentException("missing args." + primary);
    }

    private static String requiredInt(Map<String, Object> args, String key) {
        Object value = args.get(key);
        if (value == null) throw new IllegalArgumentException("missing args." + key);
        if (value instanceof Number number) {
            double d = number.doubleValue();
            if (!Double.isFinite(d) || Math.rint(d) != d) throw new IllegalArgumentException("args." + key + " must be integer");
            long l = number.longValue();
            if (l < Integer.MIN_VALUE || l > Integer.MAX_VALUE) throw new IllegalArgumentException("args." + key + " is out of int range");
            return Long.toString(l);
        }
        if (value instanceof String text) {
            try { return Integer.toString(Integer.parseInt(text.trim())); }
            catch (NumberFormatException exception) { throw new IllegalArgumentException("args." + key + " must be integer"); }
        }
        throw new IllegalArgumentException("args." + key + " must be integer");
    }
}
