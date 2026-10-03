package jp.douma.bridgemod.api;

import java.util.*;

/** Short-lived server-thread leases for game events; no user setting and no permanent override. */
public final class EnvironmentOverrides {
    private static final Map<Object, Map<String, Long>> WEATHER = new WeakHashMap<>();
    private EnvironmentOverrides() {}
    public static void holdWeather(Object level, String owner, long untilEpochMillis) {
        if (untilEpochMillis > System.currentTimeMillis() + 600_000L) throw new IllegalArgumentException("Weather override exceeds ten minutes");
        WEATHER.computeIfAbsent(level, ignored -> new HashMap<>()).merge(owner, untilEpochMillis, Math::max);
    }
    public static boolean hasWeather(Object level) {
        var owners = WEATHER.get(level);
        if (owners == null) return false;
        owners.values().removeIf(end -> end <= System.currentTimeMillis());
        return !owners.isEmpty();
    }
    public static boolean hasWeather(Object level, String owner) {
        return hasWeather(level) && WEATHER.get(level).containsKey(owner);
    }
    public static void releaseWeather(Object level, String owner) {
        var owners = WEATHER.get(level); if (owners != null) owners.remove(owner);
    }
    public static void clearWeather(Object level) { WEATHER.remove(level); }
    public static void reset() { WEATHER.clear(); }
}
