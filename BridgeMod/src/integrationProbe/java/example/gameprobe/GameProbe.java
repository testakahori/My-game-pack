package example.gameprobe;
import jp.douma.bridgemod.api.GameEvents;
import jp.douma.bridgemod.api.RequestLedger;
import net.minecraft.commands.Commands;
import net.minecraft.server.MinecraftServer;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import java.util.*;

/** Disposable integration receiver; never packaged into the product. */
@Mod("gameprobe")
public final class GameProbe {
    private final Deque<Map<String,Object>> queue = new ArrayDeque<>();
    private final List<Map<String,Object>> started = new ArrayList<>();
    private final RequestLedger ledger = new RequestLedger(1000);
    private boolean blocked, paused;
    private int duplicates, discarded;
    private volatile Map<String,Object> snapshot = Map.of();
    private MinecraftServer server;
    public GameProbe() {
        GameEvents.register("gameprobe", this::offer, () -> snapshot);
        MinecraftForge.EVENT_BUS.register(this);
    }
    private int offer(Map<String,Object> data) {
        if (!GameEvents.isCurrentSession("gameprobe", data.get("gameSessionId"))) { discarded++; return GameEvents.DISCARDED; }
        if (blocked) return GameEvents.WAIT;
        String id = (String)data.get("requestId");
        String fingerprint = List.of(data.get("key"), data.get("count"), data.get("listenerName"), data.get("args")).toString();
        if (ledger.alreadyAccepted(id, fingerprint)) { duplicates++; return GameEvents.ACCEPTED; }
        queue.addLast(data); ledger.accepted(id, fingerprint); return GameEvents.ACCEPTED;
    }
    private void reset() { queue.clear(); ledger.clear(); GameEvents.beginSession("gameprobe"); }
    @SubscribeEvent public void start(ServerStartedEvent event) { server = event.getServer(); reset(); }
    @SubscribeEvent public void commands(RegisterCommandsEvent event) {
        var root = Commands.literal("gameprobe").requires(s -> s.hasPermission(2));
        root.then(Commands.literal("reset").executes(c -> { reset(); return 1; }));
        root.then(Commands.literal("end").executes(c -> { queue.clear(); GameEvents.endSession("gameprobe"); return 1; }));
        root.then(Commands.literal("block").executes(c -> { blocked = true; return 1; }));
        root.then(Commands.literal("unblock").executes(c -> { blocked = false; return 1; }));
        root.then(Commands.literal("pause").executes(c -> { paused = true; return 1; }));
        root.then(Commands.literal("resume").executes(c -> { paused = false; return 1; }));
        event.getDispatcher().register(root);
    }
    @SubscribeEvent public void tick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || server == null) return;
        if (!paused && !queue.isEmpty()) {
            Map<String,Object> item = queue.removeFirst();
            Map<String,Object> record = new HashMap<>(item); record.remove("server");
            boolean shown = false;
            try {
                Object result = Class.forName("jp.douma.displaymod.api.DisplayApi").getMethod("show", Object.class, Map.class).invoke(null, server,
                    Map.of("title", "GAME-START", "subtitle", "{ListenerName} x{Count}", "listenerName", item.get("listenerName"), "count", item.get("count"),
                        "fadeInTicks", 0, "stayTicks", 120, "fadeOutTicks", 20, "sound", "", "particle", ""));
                shown = Boolean.TRUE.equals(result);
            } catch (ReflectiveOperationException | LinkageError ignored) { }
            record.put("shown", shown); started.add(Map.copyOf(record));
            ledger.completed((String)item.get("requestId"));
        }
        snapshot = Map.of("waiting", queue.size(), "started", List.copyOf(started), "duplicates", duplicates, "discarded", discarded);
    }
}
