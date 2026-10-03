package jp.douma.saikutumod;

import java.lang.reflect.Method;
import java.util.Map;

/** No compile/runtime dependency on BridgeMOD or DisplayMOD. */
public final class OptionalDisplay {
    private static final Method SHOW = find();
    private OptionalDisplay() {}

    private static Method find() {
        try {
            return Class.forName("jp.douma.displaymod.api.DisplayApi").getMethod("show", Object.class, Map.class);
        } catch (ReflectiveOperationException | LinkageError | RuntimeException unavailable) { return null; }
    }

    public static boolean show(Object server, Map<String, ?> payload) {
        if (SHOW == null) return false;
        try { return Boolean.TRUE.equals(SHOW.invoke(null, server, payload)); }
        catch (ReflectiveOperationException | LinkageError | RuntimeException unavailable) { return false; }
    }
}
