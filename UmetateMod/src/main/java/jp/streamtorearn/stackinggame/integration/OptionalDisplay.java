package jp.streamtorearn.stackinggame.integration;

import java.lang.reflect.Method;
import java.util.Map;

/**
 * DisplayMOD（標準装備。MOD ID displaymod）の表示を、リフレクションで呼ぶ。DisplayMOD が無くても動く
 * （採掘の SaikutuMod の OptionalDisplay と同じ形。埋め立て PR1）。
 */
public final class OptionalDisplay {
    private static final Method SHOW = find();
    private OptionalDisplay() {}

    private static Method find() {
        try {
            return Class.forName("jp.douma.displaymod.api.DisplayApi").getMethod("show", Object.class, Map.class);
        } catch (ReflectiveOperationException | LinkageError | RuntimeException unavailable) { return null; }
    }

    public static boolean available() { return SHOW != null; }

    public static boolean show(Object server, Map<String, ?> payload) {
        if (SHOW == null) return false;
        try { return Boolean.TRUE.equals(SHOW.invoke(null, server, payload)); }
        catch (ReflectiveOperationException | LinkageError | RuntimeException unavailable) { return false; }
    }
}
