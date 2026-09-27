package jp.douma.displaymod.api;
import java.util.Map;
// Classpath fixture, never packaged into either MOD.
public final class DisplayApi {
    public static boolean show(Object server, Map<String, ?> payload) {
        if (System.getProperty("display.test.mode").equals("throwing")) throw new IllegalStateException("display failed");
        if (System.getProperty("display.test.mode").equals("linkage")) throw new NoClassDefFoundError("incompatible display");
        return server != null && payload.get("title").equals("ゾンビ襲来") && payload.get("count").equals(3);
    }
}
