package jp.douma.displaymod.api;

import com.mojang.logging.LogUtils;
import jp.douma.displaymod.DisplayRenderer;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/** Independent server API. No BridgeMOD or game MOD types appear in this contract. */
public final class DisplayApi {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final AtomicBoolean WARNED = new AtomicBoolean();
    private DisplayApi() {}

    /**
     * Returns true when accepted, not a guarantee that a player saw the title.
     * Object/Map are intentional: optional callers can resolve this method without
     * linking any DisplayMOD or mapped Minecraft classes in the method signature.
     */
    public static boolean show(Object serverObject, Map<String, ?> payload) {
        if (!(serverObject instanceof MinecraftServer server) || server.isStopped()) return false;
        try {
            DisplayRequest request = DisplayRequest.from(payload);
            if (server.isSameThread()) return render(server, request);
            server.execute(() -> render(server, request));
            return true;
        } catch (RuntimeException | LinkageError error) {
            warn(error);
            return false;
        }
    }

    private static boolean render(MinecraftServer server, DisplayRequest request) {
        try {
            DisplayRenderer.show(server, request);
            return true;
        } catch (RuntimeException | LinkageError error) {
            warn(error);
            return false;
        }
    }

    private static void warn(Throwable error) {
        if (WARNED.compareAndSet(false, true)) LOGGER.warn("[DisplayMOD] Display skipped; gameplay continues", error);
    }
}
