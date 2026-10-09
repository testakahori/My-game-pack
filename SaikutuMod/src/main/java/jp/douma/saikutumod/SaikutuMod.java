package jp.douma.saikutumod;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import jp.douma.bridgemod.api.GameEvents;
import jp.douma.bridgemod.api.RequestLedger;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Mod(SaikutuMod.MODID)
public final class SaikutuMod {
    public static final String MODID = "saikutumod";
    private static final List<String> KEYS = List.of("randomtp", "skytrap", "cataclysm", "iceage", "flood", "maguma_jigoku", "fissure", "otosiana", "tntdaibakuhatu", "get_ender_pearl", "get_iron_pickaxe", "get_tree", "get_water_backet", "pikkerubossyuu");
    private record Script(Map<String, String> metadata, List<String> commands) {}
    private static final Map<String, Script> SCRIPTS = loadScripts();
    private final Map<String, Deque<Request>> queues = new LinkedHashMap<>();
    private final Map<String, SaikutuEffects> effects = new LinkedHashMap<>();
    private MinecraftServer server;
    private long started, completed, failed, duplicates;
    private final RequestLedger requests = new RequestLedger(65536);
    private final Map<String, Long> startedByKey = new TreeMap<>();
    private volatile Map<String, Object> snapshot = Map.of("active", false);
    private static final class Request {
        final String key, listener, requestId, fingerprint; final int total; int remaining, line;
        final UUID player; final SaikutuEffects.Protection protection; final boolean announce;
        boolean announced, counted;
        Request(Map<String, Object> data) {
            key = String.valueOf(data.get("key")); listener = String.valueOf(data.getOrDefault("listenerName", "console"));
            total = ((Number)data.getOrDefault("count", 1)).intValue(); remaining = total;
            player = data.get("player") instanceof UUID id ? id : null;
            protection = new SaikutuEffects.Protection(Boolean.TRUE.equals(data.get("protectionEnabled")),
                number(data,"protectX1"), number(data,"protectX2"), number(data,"protectZ1"), number(data,"protectZ2"));
            announce = !Boolean.FALSE.equals(data.get("announce"));
            requestId = String.valueOf(data.getOrDefault("requestId", UUID.randomUUID().toString()));
            fingerprint = List.of(key, listener, total, String.valueOf(data.getOrDefault("type", "other")),
                String.valueOf(player), announce, protection).toString();
        }
    }
    private static double number(Map<String, Object> data, String key) {
        return data.get(key) instanceof Number n ? n.doubleValue() : 0;
    }
    public SaikutuMod() {
        for (String type : List.of("gift", "other", "like")) {
            queues.put(type, new ArrayDeque<>()); effects.put(type, new SaikutuEffects(type));
        }
        GameEvents.register(MODID, this::offer, () -> snapshot);
        MinecraftForge.EVENT_BUS.register(this);
    }
    private int offer(Map<String, Object> data) {
        if (server == null) return GameEvents.WAIT;
        Request request = new Request(data);
        if (!SCRIPTS.containsKey(request.key) || request.total < 1 || request.total > 100000)
            throw new IllegalArgumentException("Unknown saikutu command or invalid count");
        if (requests.alreadyAccepted(request.requestId, request.fingerprint)) { duplicates++; return GameEvents.ACCEPTED; }
        String type = String.valueOf(data.getOrDefault("type", "other"));
        if (!queues.containsKey(type)) type = "other";
        var queue = queues.get(type); int limit = type.equals("gift") ? 600 : type.equals("like") ? 120 : 280;
        if (queue.size() >= limit) return GameEvents.WAIT;
        if (!SaikutuEffects.KEYS.contains(request.key)) {
            // スクリプトは count 回くり返す。TNT大爆発などは回数を抑える（大技の倍率は SaikutuEffects.start で抑える）。
            // 待ち列が満杯の間は Bridge が同じ要求を再送するので、受け付けると決まってから抑えてログを出す。
            int limited = SaikutuLimits.scriptRepeat(request.key, request.total);
            if (limited != request.total) System.out.println("[saikutu] " + request.key + " のくり返しを " + request.total + " 回から上限の " + limited + " 回に抑えました");
            request.remaining = limited;
        }
        queue.addLast(request); requests.accepted(request.requestId, request.fingerprint); return GameEvents.ACCEPTED;
    }
    @SubscribeEvent public void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("saikutu").requires(source -> source.hasPermission(2))
            .then(Commands.argument("key", StringArgumentType.word())
                .suggests((ctx, builder) -> { KEYS.forEach(builder::suggest); return builder.buildFuture(); })
                .executes(ctx -> manual(ctx.getSource(), StringArgumentType.getString(ctx,"key"), 1, null))
                .then(Commands.argument("count", IntegerArgumentType.integer(1, 100000))
                    .executes(ctx -> manual(ctx.getSource(), StringArgumentType.getString(ctx,"key"), IntegerArgumentType.getInteger(ctx,"count"), null))
                    .then(Commands.argument("listener", StringArgumentType.greedyString())
                        .executes(ctx -> manual(ctx.getSource(), StringArgumentType.getString(ctx,"key"), IntegerArgumentType.getInteger(ctx,"count"), StringArgumentType.getString(ctx,"listener")))))));
    }
    private int manual(CommandSourceStack source, String key, int count, String listener) {
        Map<String, Object> data = new HashMap<>();
        data.put("key",key); data.put("count",count); data.put("type","other");
        data.put("requestId", UUID.randomUUID().toString());
        data.put("listenerName",listener == null ? source.getTextName() : listener);
        if (source.getPlayer() != null) data.put("player",source.getPlayer().getUUID());
        try {
            int result = offer(data);
            if (result == GameEvents.WAIT) source.sendFailure(Component.literal("saikutuMODの待ち列が満杯です。処理完了後に再実行してください。"));
            return result;
        } catch (Exception error) { source.sendFailure(Component.literal(error.getMessage())); return 0; }
    }
    @SubscribeEvent public void start(ServerStartedEvent event) { server = event.getServer(); updateStatus(); }
    @SubscribeEvent public void stop(ServerStoppingEvent event) {
        effects.values().forEach(SaikutuEffects::stop); queues.values().forEach(Deque::clear);
        server = null; started = completed = failed = duplicates = 0; requests.clear(); startedByKey.clear(); updateStatus();
    }
    @SubscribeEvent public void tick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || server == null) return;
        int budget = 52;
        budget -= process("gift", budget); process("other", budget); process("like", 8);
        effects.get("gift").tick(server, 12, 384);
        effects.get("other").tick(server, 2, 64);
        effects.get("like").tick(server, 2, 64);
        updateStatus();
    }
    private int process(String type, int budget) {
        var queue = queues.get(type); var engine = effects.get(type); int used = 0;
        while (used < budget && !queue.isEmpty()) {
            Request request = queue.peekFirst();
            ServerPlayer player = request.player == null ? server.getPlayerList().getPlayers().stream().filter(p -> p.isAlive() && !p.isSpectator()).findFirst().orElse(null)
                : server.getPlayerList().getPlayer(request.player);
            if (player == null || !player.isAlive()) break;
            Script script = SCRIPTS.get(request.key);
            if (SaikutuEffects.KEYS.contains(request.key) && engine.pendingJobs() >= 96) break;
            CommandSourceStack source = player.createCommandSourceStack().withPermission(4).withSuppressedOutput();
            try {
                boolean ran;
                if (SaikutuEffects.KEYS.contains(request.key)) {
                    ran = engine.start(source, request.key, request.remaining, request.protection) > 0;
                    request.remaining = 0;
                } else {
                    String command = script.commands.get(request.line++);
                    ran = server.getCommands().performPrefixedCommand(source, command) > 0;
                    if (request.line >= script.commands.size()) { request.line = 0; request.remaining--; }
                }
                if (!request.counted) { started++; startedByKey.merge(request.key, 1L, Long::sum); request.counted = true; }
                if (ran && request.announce && !request.announced) {
                    request.announced = true;
                    OptionalDisplay.show(server, Map.of("title", script.metadata.getOrDefault("TITLE",request.key),
                        "subtitle", script.metadata.getOrDefault("SUBTITLE","{ListenerName}"),
                        "listenerName",request.listener,"count",request.total,
                        "sound",script.metadata.getOrDefault("SOUND","entity.experience_orb.pickup"),
                        "particle",script.metadata.getOrDefault("PARTICLE","minecraft:happy_villager")));
                }
            } catch (Exception error) {
                failed++; request.remaining = 0;
                System.err.println("[saikutu] " + request.key + ": " + error);
            }
            used++;
            if (request.remaining == 0) { queue.removeFirst(); requests.completed(request.requestId); completed++; }
        }
        return used;
    }
    private void updateStatus() {
        Map<String,Object> data = new LinkedHashMap<>(); data.put("active",server != null);
        queues.forEach((type, queue) -> data.put(type,queue.size()));
        data.put("duplicates",duplicates); data.put("started",started); data.put("completed",completed); data.put("failed",failed);
        data.put("startedByKey",Map.copyOf(startedByKey));
        data.put("effectsPending",effects.values().stream().mapToInt(SaikutuEffects::pendingJobs).sum());
        data.put("effectsFailed",effects.values().stream().mapToInt(SaikutuEffects::failures).sum());
        snapshot = Map.copyOf(data);
    }
    private static Map<String, Script> loadScripts() {
        Map<String, Script> result = new LinkedHashMap<>();
        for (String key : KEYS) {
            try (InputStream input = SaikutuMod.class.getResourceAsStream("/commands/" + key + ".txt")) {
                if (input == null) throw new IOException("Missing command: " + key);
                Map<String, String> metadata = new HashMap<>(); List<String> commands = new ArrayList<>();
                for (String raw : new String(input.readAllBytes(),StandardCharsets.UTF_8).split("\\R")) {
                    String line = raw.trim(); if (line.isEmpty() || line.startsWith("//")) continue;
                    if (line.startsWith("#")) {
                        int colon = line.indexOf(':'); if (colon > 1) metadata.put(line.substring(1,colon).trim(),line.substring(colon+1).trim());
                    } else commands.add(line);
                }
                if (commands.isEmpty() && !SaikutuEffects.KEYS.contains(key)) throw new IOException("Empty command: " + key);
                result.put(key,new Script(Map.copyOf(metadata),List.copyOf(commands)));
            } catch (IOException error) { throw new IllegalStateException("Cannot load saikutu command",error); }
        }
        return Map.copyOf(result);
    }
}
