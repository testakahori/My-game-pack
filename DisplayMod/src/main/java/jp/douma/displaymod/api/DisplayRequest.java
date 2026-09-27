package jp.douma.displaymod.api;

import java.util.Map;

/** Version 1 request. Text is literal, never JSON, a selector or a Minecraft command. */
public record DisplayRequest(String title, String subtitle, String listenerName, int count,
                             String sound, String particle) {
    public static DisplayRequest from(Map<String, ?> data) {
        if (data == null) throw new IllegalArgumentException("Display request is required");
        Object value = data.getOrDefault("count", null);
        int count = value == null ? 1 : value instanceof Number number ? number.intValue() : -1;
        if (count < 1 || count > 100000 || value instanceof Number n && n.doubleValue() != count)
            throw new IllegalArgumentException("count must be an integer from 1 to 100000");
        String listener = text(string(data, "listenerName", "viewer"), 60);
        String title = expand(string(data, "title", ""), listener, count, 60);
        if (title.isBlank()) throw new IllegalArgumentException("title is required");
        String subtitle = expand(string(data, "subtitle", "{ListenerName}"), listener, count, 120);
        return new DisplayRequest(title, subtitle, listener, count,
            resource(string(data, "sound", "minecraft:entity.experience_orb.pickup")),
            resource(string(data, "particle", "minecraft:happy_villager")));
    }

    private static String string(Map<String, ?> data, String key, String fallback) {
        Object value = data.get(key);
        if (value == null) return fallback;
        if (!(value instanceof String s) || s.length() > 4096) throw new IllegalArgumentException("Invalid " + key);
        return s;
    }

    private static String expand(String value, String listener, int count, int limit) {
        // Expand count before inserting the name: placeholders inside names remain literal.
        return text(value.replace("{Count}", Integer.toString(count)).replace("{ListenerName}", listener), limit);
    }

    private static String text(String value, int limit) {
        String clean = value.replaceAll("[\\p{Cntrl}§]", " ");
        return clean.substring(0, clean.offsetByCodePoints(0, Math.min(limit, clean.codePointCount(0, clean.length()))));
    }

    private static String resource(String value) {
        // An empty or invalid identifier disables only this optional decoration.
        if (value.isEmpty() || value.length() > 200 || !value.matches("(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+")) return "";
        return value.contains(":") ? value : "minecraft:" + value;
    }
}
