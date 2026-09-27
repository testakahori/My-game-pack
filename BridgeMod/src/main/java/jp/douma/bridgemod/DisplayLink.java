package jp.douma.bridgemod;

import java.lang.reflect.Method;
import java.util.Map;

/** Optional integration only: all rendering belongs to the standalone DisplayMOD. */
final class DisplayLink {
    private static final Method SHOW = find();
    private DisplayLink() {}

    private static Method find() {
        try {
            return Class.forName("jp.douma.displaymod.api.DisplayApi").getMethod("show", Object.class, Map.class);
        } catch (ReflectiveOperationException | LinkageError | RuntimeException unavailable) { return null; }
    }

    static boolean available() { return SHOW != null; }

    static boolean show(Object server, Map<String, ?> payload) {
        if (SHOW == null) return false;
        try { return Boolean.TRUE.equals(SHOW.invoke(null, server, payload)); }
        catch (ReflectiveOperationException | LinkageError | RuntimeException unavailable) { return false; }
    }

    static boolean shouldAnnounce(boolean requested, boolean announced, String owner) {
        return requested && !announced && !"game".equalsIgnoreCase(owner) && !"none".equalsIgnoreCase(owner);
    }
}
