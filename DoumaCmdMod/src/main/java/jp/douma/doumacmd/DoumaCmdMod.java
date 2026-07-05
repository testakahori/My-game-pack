package jp.douma.doumacmd;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
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

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Mod(DoumaCmdMod.MODID)
public class DoumaCmdMod {
    public static final String MODID = "doumacmd";

    // count 上限（安全）
    private static final int MAX_COUNT = 100;
    private static final int MAX_HTTP_BODY_BYTES = 8192;
    // キュー上限は種別ごとに分離：いいねが溜まってもギフトは拒否されない
    private static final int MAX_GIFT_QUEUE = 600;
    private static final int MAX_LIKE_QUEUE = 120;
    private static final int MAX_OTHER_QUEUE = 280;
    // 1tickあたりの実行コマンド予算：repeat大のギフトも複数tickへ分割してTPS低下を防ぐ
    private static final int MAX_COMMANDS_PER_TICK = 60;
    // ギフト連続時でも、いいねが完全に止まらないように予約する予算
    private static final int LIKE_RESERVED_COMMANDS_PER_TICK = 8;

    private final Deque<BridgeEvent> giftQueue = new ArrayDeque<>();
    private final Deque<BridgeEvent> likeQueue = new ArrayDeque<>();
    private final Deque<BridgeEvent> otherQueue = new ArrayDeque<>();

    private HttpServer bridgeServer;
    private MinecraftServer activeServer;
    private ServerSocket webSocketServer;
    private final Set<Socket> webSocketClients = Collections.synchronizedSet(new HashSet<>());
    private int statusBroadcastTicks = 0;
    private long executedCommands = 0;
    private long failedCommands = 0;
    private volatile String lastError = "";
    private long protectedSkips = 0;

    public DoumaCmdMod() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterCommandsEvent event) {
        register(event.getDispatcher());
    }

    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        activeServer = event.getServer();
        startBridgeHttpServer(event.getServer());
        startWebSocketServer();
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        stopBridgeHttpServer();
        stopWebSocketServer();
        activeServer = null;
        synchronized (this) {
            giftQueue.clear();
            likeQueue.clear();
            otherQueue.clear();
        }
    }

    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || activeServer == null) return;

        // ギフト最優先。ただし、いいね用に最低予算を予約して飢餓を防ぐ
        int budget = MAX_COMMANDS_PER_TICK - LIKE_RESERVED_COMMANDS_PER_TICK;
        budget -= processQueue(activeServer, giftQueue, budget);
        budget -= processQueue(activeServer, otherQueue, budget);
        processQueue(activeServer, likeQueue, budget + LIKE_RESERVED_COMMANDS_PER_TICK);
        if (++statusBroadcastTicks >= 20) {
            statusBroadcastTicks = 0;
            broadcastWebSocket(buildStatusJson());
        }
    }

    private void register(CommandDispatcher<CommandSourceStack> d) {
        SuggestionProvider<CommandSourceStack> keySuggest = (ctx, b) -> {
            for (String k : listKeys(ctx.getSource().getServer())) b.suggest(k);
            return b.buildFuture();
        };

        d.register(
            Commands.literal("douma")
                .requires(src -> src.hasPermission(0)) // 誰でもOK。OP限定なら 2
                .then(Commands.argument("key", StringArgumentType.word())
                    .suggests(keySuggest)
                    .then(Commands.argument("count", IntegerArgumentType.integer(1, MAX_COUNT))
                        .executes(ctx -> {
                            String key = StringArgumentType.getString(ctx, "key");
                            int count = IntegerArgumentType.getInteger(ctx, "count");
                            return runKey(ctx.getSource(), key, count, true);
                        })
                    )
                )
        );
    }

    private int runKey(CommandSourceStack source, String key, int count, boolean announce) {
        MinecraftServer server = source.getServer();
        ServerPlayer player = source.getPlayer();

        String listenerName = (player != null) ? player.getGameProfile().getName() : "console";

        // 手動実行もキュー経由に統一：tick予算で分割実行され、TPSスパイクを起こさない
        BridgeEvent event = new BridgeEvent("other", key, count, listenerName, announce);

        Path file;
        try {
            file = resolveCommandFile(server, event.key);
        } catch (RuntimeException e) {
            source.sendFailure(Component.literal("[Douma] " + e.getMessage()));
            return 0;
        }
        if (file == null) {
            source.sendFailure(Component.literal(
                "[Douma] file not found: bridge/commands/minecraft/" + event.key + ".txt"
            ));
            return 0;
        }

        if (!enqueueBridgeEvent(event)) {
            source.sendFailure(Component.literal("[Douma] queue is full, try again later"));
            return 0;
        }
        return 1;
    }

    private void startBridgeHttpServer(MinecraftServer server) {
        if (bridgeServer != null) return;

        int port = getBridgePort();
        try {
            bridgeServer = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 32);
            bridgeServer.createContext("/douma/event", exchange -> handleBridgeEvent(server, exchange));
            bridgeServer.createContext("/douma/status", this::handleBridgeStatus);
            bridgeServer.setExecutor(Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "DoumaCmdMod-BridgeHttp");
                t.setDaemon(true);
                return t;
            }));
            bridgeServer.start();
            System.out.println("[Douma] Bridge HTTP listening on 127.0.0.1:" + port);
        } catch (IOException e) {
            bridgeServer = null;
            System.out.println("[Douma] Bridge HTTP start failed: " + e.getMessage());
        }
    }

    private void stopBridgeHttpServer() {
        if (bridgeServer == null) return;
        bridgeServer.stop(1);
        bridgeServer = null;
        System.out.println("[Douma] Bridge HTTP stopped");
    }

    private int getBridgePort() {
        String fromProp = System.getProperty("doumacmd.bridgePort");
        String fromEnv = System.getenv("DOUMA_BRIDGE_PORT");
        String raw = (fromProp != null && !fromProp.isBlank()) ? fromProp : fromEnv;
        try {
            int port = Integer.parseInt(raw);
            if (port > 0 && port <= 65535) return port;
        } catch (Exception ignored) {
        }
        return 25576;
    }

    private void handleBridgeEvent(MinecraftServer server, HttpExchange exchange) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendHttp(exchange, 405, "{\"ok\":false,\"error\":\"method_not_allowed\"}");
            return;
        }

        String path = exchange.getRequestURI().getPath();
        if (!"/douma/event".equals(path)) {
            sendHttp(exchange, 404, "{\"ok\":false,\"error\":\"not_found\"}");
            return;
        }

        String body = readHttpBody(exchange);
        BridgeEvent event = BridgeEvent.fromJson(body);
        if (event == null || event.key.isBlank()) {
            sendHttp(exchange, 400, "{\"ok\":false,\"error\":\"bad_request\"}");
            return;
        }

        boolean accepted = enqueueBridgeEvent(event);
        if (!accepted) {
            sendHttp(exchange, 429, "{\"ok\":false,\"error\":\"queue_full\"}");
            return;
        }

        sendHttp(exchange, 202, "{\"ok\":true,\"queued\":true}");
    }

    private String readHttpBody(HttpExchange exchange) throws IOException {
        InputStream in = exchange.getRequestBody();
        byte[] buf = in.readNBytes(MAX_HTTP_BODY_BYTES + 1);
        if (buf.length > MAX_HTTP_BODY_BYTES) return "";
        return new String(buf, StandardCharsets.UTF_8);
    }

    // キュー滞留の可視化用（Bridge側の診断ログやデバッグで使用）
    private void handleBridgeStatus(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendHttp(exchange, 405, "{\"ok\":false,\"error\":\"method_not_allowed\"}");
            return;
        }
        int gift, like, other;
        synchronized (this) {
            gift = giftQueue.size();
            like = likeQueue.size();
            other = otherQueue.size();
        }
        sendHttp(exchange, 200, buildStatusJson(gift, like, other));
    }

    private String buildStatusJson() {
        int gift, like, other;
        synchronized (this) {
            gift = giftQueue.size(); like = likeQueue.size(); other = otherQueue.size();
        }
        return buildStatusJson(gift, like, other);
    }

    private String buildStatusJson(int gift, int like, int other) {
        ServerPlayer player = activeServer == null || activeServer.getPlayerList().getPlayers().isEmpty()
            ? null : activeServer.getPlayerList().getPlayers().get(0);
        double x = player == null ? 0 : player.getX();
        double y = player == null ? 0 : player.getY();
        double z = player == null ? 0 : player.getZ();
        double tickMs = activeServer == null ? 0 : activeServer.getAverageTickTime();
        double tps = tickMs <= 0 ? 20.0 : Math.min(20.0, 1000.0 / tickMs);
        return "{\"ok\":true,\"gift\":" + gift + ",\"like\":" + like + ",\"other\":" + other
            + ",\"executed\":" + executedCommands + ",\"failed\":" + failedCommands
            + ",\"protectedSkips\":" + protectedSkips
            + ",\"lastError\":\"" + jsonEscape(lastError) + "\",\"tps\":" + String.format(Locale.ROOT, "%.2f", tps)
            + ",\"tickMs\":" + String.format(Locale.ROOT, "%.2f", tickMs)
            + ",\"player\":{\"online\":" + (player != null) + ",\"x\":" + String.format(Locale.ROOT, "%.2f", x)
            + ",\"y\":" + String.format(Locale.ROOT, "%.2f", y) + ",\"z\":" + String.format(Locale.ROOT, "%.2f", z) + "}}";
    }

    private void startWebSocketServer() {
        try {
            webSocketServer = new ServerSocket();
            webSocketServer.bind(new InetSocketAddress("127.0.0.1", getBridgePort() + 1));
            Thread accept = new Thread(() -> {
                while (webSocketServer != null && !webSocketServer.isClosed()) {
                    try {
                        Socket socket = webSocketServer.accept();
                        Thread client = new Thread(() -> handleWebSocketClient(socket), "DoumaCmdMod-WebSocketClient");
                        client.setDaemon(true); client.start();
                    } catch (IOException ignored) {}
                }
            }, "DoumaCmdMod-WebSocket");
            accept.setDaemon(true); accept.start();
            System.out.println("[Douma] WebSocket listening on 127.0.0.1:" + (getBridgePort() + 1));
        } catch (IOException e) {
            System.out.println("[Douma] WebSocket start failed: " + e.getMessage());
        }
    }

    private void stopWebSocketServer() {
        try { if (webSocketServer != null) webSocketServer.close(); } catch (IOException ignored) {}
        synchronized (webSocketClients) {
            for (Socket client : webSocketClients) try { client.close(); } catch (IOException ignored) {}
            webSocketClients.clear();
        }
        webSocketServer = null;
    }

    private void handleWebSocketClient(Socket socket) {
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String line;
            String key = null;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                if (line.toLowerCase(Locale.ROOT).startsWith("sec-websocket-key:")) key = line.substring(line.indexOf(':') + 1).trim();
            }
            if (key == null) { socket.close(); return; }
            String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
                .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.UTF_8)));
            OutputStream out = socket.getOutputStream();
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            webSocketClients.add(socket);
            sendWebSocket(socket, buildStatusJson());
            InputStream in = socket.getInputStream();
            while (!socket.isClosed()) {
                String message = readWebSocketText(in);
                if (message == null) break;
                BridgeEvent event = BridgeEvent.fromJson(message);
                boolean accepted = event != null && !event.key.isBlank() && enqueueBridgeEvent(event);
                sendWebSocket(socket, "{\"type\":\"ack\",\"ok\":" + accepted + "}");
            }
        } catch (Exception ignored) {
        } finally {
            webSocketClients.remove(socket);
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private String readWebSocketText(InputStream in) throws IOException {
        int first = in.read(); if (first < 0) return null;
        int second = in.read(); if (second < 0) return null;
        int opcode = first & 0x0f;
        long length = second & 0x7f;
        if (length == 126) length = (in.read() << 8) | in.read();
        else if (length == 127) return null;
        byte[] mask = (second & 0x80) != 0 ? in.readNBytes(4) : null;
        byte[] payload = in.readNBytes((int) length);
        if (mask != null) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        if (opcode == 8) return null;
        return opcode == 1 ? new String(payload, StandardCharsets.UTF_8) : "";
    }

    private void sendWebSocket(Socket socket, String text) throws IOException {
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        OutputStream out = socket.getOutputStream();
        synchronized (out) {
            out.write(0x81);
            if (payload.length < 126) out.write(payload.length);
            else { out.write(126); out.write((payload.length >> 8) & 0xff); out.write(payload.length & 0xff); }
            out.write(payload); out.flush();
        }
    }

    private void broadcastWebSocket(String text) {
        synchronized (webSocketClients) {
            Iterator<Socket> iterator = webSocketClients.iterator();
            while (iterator.hasNext()) {
                Socket socket = iterator.next();
                try { sendWebSocket(socket, text); }
                catch (IOException e) { iterator.remove(); try { socket.close(); } catch (IOException ignored) {} }
            }
        }
    }

    private void sendHttp(HttpExchange exchange, int status, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private synchronized boolean enqueueBridgeEvent(BridgeEvent event) {
        if ("gift".equals(event.type)) {
            // ギフトはギフトキューが満杯のときだけ拒否（いいねの滞留に影響されない）
            if (giftQueue.size() >= MAX_GIFT_QUEUE) return false;
            giftQueue.addLast(event);
            return true;
        }

        if ("like".equals(event.type)) {
            // 連打圧縮：同じkeyの末尾いいねに合流（先頭=実行中のイベントには触らない）
            BridgeEvent last = likeQueue.peekLast();
            if (likeQueue.size() >= 2 && last != null && last.key.equals(event.key)
                    && last.remaining + event.remaining <= MAX_COUNT) {
                last.remaining += event.remaining;
                return true;
            }
            // 満杯なら一番古いいいねを捨てて新しいものを受け入れる（いいねは損失許容）
            if (likeQueue.size() >= MAX_LIKE_QUEUE) {
                likeQueue.pollFirst();
            }
            likeQueue.addLast(event);
            return true;
        }

        if (otherQueue.size() >= MAX_OTHER_QUEUE) return false;
        otherQueue.addLast(event);
        return true;
    }

    /**
     * キューを処理してこのtickで実行したコマンド数を返す。
     * イベントの残countが予算を超える場合は途中で止め、次tickで先頭から続きを実行する。
     */
    private int processQueue(MinecraftServer server, Deque<BridgeEvent> queue, int commandBudget) {
        int used = 0;
        while (used < commandBudget) {
            BridgeEvent event;
            synchronized (this) {
                event = queue.peekFirst();
            }
            if (event == null) break;

            used += executeEventSlice(server, event, commandBudget - used);

            if (event.remaining <= 0) {
                synchronized (this) {
                    queue.pollFirst();
                }
            } else {
                break; // 予算切れ：次tickで続きから
            }
        }
        return used;
    }

    /**
     * イベントを予算内で部分実行する。ファイル1周分（全行）を最小実行単位とし、
     * 実行したコマンド数を返す。event.remaining / event.announced を更新する。
     */
    private int executeEventSlice(MinecraftServer server, BridgeEvent event, int commandBudget) {
        Path file;
        try {
            file = resolveCommandFile(server, event.key);
        } catch (RuntimeException e) {
            System.out.println("[Douma] " + e.getMessage());
            recordFailure(event.key + ": " + e.getMessage());
            event.remaining = 0;
            return 0;
        }
        if (file == null) {
            System.out.println("[Douma] file not found: bridge/commands/minecraft/" + event.key + ".txt");
            recordFailure(event.key + ": file not found");
            event.remaining = 0;
            return 0;
        }

        ParsedFile parsed;
        try {
            parsed = parseFile(file);
        } catch (Exception e) {
            System.out.println("[Douma] read failed (" + event.key + "): " + e.getMessage());
            recordFailure(event.key + ": " + e.getMessage());
            event.remaining = 0;
            return 0;
        }
        if (parsed.commands.isEmpty()) {
            recordFailure(event.key + ": no commands");
            event.remaining = 0;
            return 0;
        }
        if (event.protectionEnabled && isDestructive(parsed, event)
                && isPlayerInsideProtection(server, event)) {
            protectedSkips++;
            System.out.println("[Douma] protected area: skipped destructive event " + event.key);
            event.remaining = 0;
            return 0;
        }

        CommandSourceStack silent = server.createCommandSourceStack().withPermission(4).withSuppressedOutput();
        int used = 0;

        // アナウンスはイベント全体で1回だけ（分割実行でも重複しない）
        if (event.announce && !event.announced) {
            String title = parsed.meta.getOrDefault("TITLE", event.key);
            String subtitleRaw = parsed.meta.getOrDefault("SUBTITLE", "{ListenerName}");
            String subtitleText = subtitleRaw.replace("{ListenerName}", event.listenerName);

            String titleJson    = "{\"text\":\"" + mcJsonStringEscape(title, 60) + "\",\"color\":\"yellow\",\"bold\":true}";
            String subtitleJson = "{\"text\":\"" + mcJsonStringEscape(subtitleText, 60) + "\",\"color\":\"green\"}";

            performSilent(server, silent, "title @a times 10 70 10");
            performSilent(server, silent, "title @a title "    + titleJson);
            performSilent(server, silent, "title @a subtitle " + subtitleJson);
            String sound = parsed.meta.getOrDefault("SOUND", "entity.experience_orb.pickup");
            String particle = parsed.meta.getOrDefault("PARTICLE", "minecraft:happy_villager");
            performSilent(server, silent, "playsound " + sound + " master @a ~ ~ ~ 0.8 1");
            performSilent(server, silent, "execute at @a run particle " + particle + " ~ ~1 ~ 0.6 0.8 0.6 0.05 18 force");
            event.announced = true;
            used += 5;
        }

        // 1周分は必ず実行して前進を保証しつつ、予算内で繰り返す
        while (event.remaining > 0 && (used == 0 || used + parsed.commands.size() <= commandBudget)) {
            for (String raw : parsed.commands) {
                String cmd = applyPlaceholdersMinecraft(raw, event.listenerName);
                performSilent(server, silent, cmd);
                used++;
            }
            event.remaining--;
        }
        return used;
    }

    private static class BridgeEvent {
        final String type;
        final String key;
        final int count;
        final String listenerName;
        final boolean announce;
        final boolean protectionEnabled;
        final double protectX1, protectX2, protectZ1, protectZ2;
        // 分割実行用の状態（tickスレッドのみが更新。enqueue時の合流は未着手イベントに限る）
        int remaining;
        boolean announced;

        BridgeEvent(String type, String key, int count, String listenerName, boolean announce) {
            this(type, key, count, listenerName, announce, false, 0, 0, 0, 0);
        }

        BridgeEvent(String type, String key, int count, String listenerName, boolean announce,
                    boolean protectionEnabled, double protectX1, double protectX2,
                    double protectZ1, double protectZ2) {
            this.type = normalizeType(type);
            this.key = sanitizeKey(key);
            this.count = Math.max(1, Math.min(MAX_COUNT, count));
            this.listenerName = listenerName == null || listenerName.isBlank() ? "viewer" : listenerName;
            this.announce = announce;
            this.protectionEnabled = protectionEnabled;
            this.protectX1 = protectX1;
            this.protectX2 = protectX2;
            this.protectZ1 = protectZ1;
            this.protectZ2 = protectZ2;
            this.remaining = this.count;
            this.announced = false;
        }

        static BridgeEvent fromJson(String json) {
            if (json == null || json.isBlank()) return null;
            String type = jsonString(json, "type", "other");
            String key = jsonString(json, "key", "");
            int count = jsonInt(json, "count", 1);
            String listenerName = jsonString(json, "listenerName", "viewer");
            boolean announce = jsonBool(json, "announce", true);
            boolean protectionEnabled = jsonBool(json, "protectionEnabled", false);
            double x1 = jsonDouble(json, "protectX1", 0);
            double x2 = jsonDouble(json, "protectX2", 0);
            double z1 = jsonDouble(json, "protectZ1", 0);
            double z2 = jsonDouble(json, "protectZ2", 0);
            return new BridgeEvent(type, key, count, listenerName, announce,
                protectionEnabled, x1, x2, z1, z2);
        }

        private static String normalizeType(String type) {
            String v = type == null ? "other" : type.toLowerCase(Locale.ROOT).trim();
            if (v.equals("gift") || v.equals("like")) return v;
            return "other";
        }

        private static String sanitizeKey(String key) {
            String v = key == null ? "" : key.trim();
            if (v.toLowerCase(Locale.ROOT).endsWith(".txt")) {
                v = v.substring(0, v.length() - 4);
            }
            return v.replaceAll("[^A-Za-z0-9_.-]", "");
        }

        private static String jsonString(String json, String name, String fallback) {
            Pattern p = Pattern.compile("\"" + Pattern.quote(name) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
            Matcher m = p.matcher(json);
            return m.find() ? unescapeJsonString(m.group(1)) : fallback;
        }

        private static int jsonInt(String json, String name, int fallback) {
            Pattern p = Pattern.compile("\"" + Pattern.quote(name) + "\"\\s*:\\s*(-?\\d+)");
            Matcher m = p.matcher(json);
            if (!m.find()) return fallback;
            try {
                return Integer.parseInt(m.group(1));
            } catch (NumberFormatException e) {
                return fallback;
            }
        }

        private static boolean jsonBool(String json, String name, boolean fallback) {
            Pattern p = Pattern.compile("\"" + Pattern.quote(name) + "\"\\s*:\\s*(true|false)");
            Matcher m = p.matcher(json);
            return m.find() ? Boolean.parseBoolean(m.group(1)) : fallback;
        }

        private static double jsonDouble(String json, String name, double fallback) {
            Pattern p = Pattern.compile("\"" + Pattern.quote(name) + "\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)");
            Matcher m = p.matcher(json);
            if (!m.find()) return fallback;
            try { return Double.parseDouble(m.group(1)); }
            catch (NumberFormatException e) { return fallback; }
        }

        private static String unescapeJsonString(String value) {
            return value
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
                .replace("\\n", " ")
                .replace("\\r", " ")
                .replace("\\t", " ");
        }
    }

    /**
     * コマンドを「出力を抑制」して実行（赤ログを出さない）
     */
    private boolean performSilent(MinecraftServer server, CommandSourceStack silentSource, String commandLine) {
        try {
            int result = server.getCommands().performPrefixedCommand(silentSource, commandLine);
            executedCommands++;
            if (result == 0) {
                recordFailure(commandLine + ": command returned 0");
                return false;
            }
            return true;
        } catch (Exception e) {
            // 失敗時だけは最低限プレイヤーに知らせたいなら、ここで sendFailure してもOK
            // 今回は「赤文字ゼロ優先」なので silent のまま false を返す
            recordFailure(commandLine + ": " + e.getMessage());
            return false;
        }
    }

    private synchronized void recordFailure(String message) {
        failedCommands++;
        lastError = message == null ? "unknown error" : message;
    }

    private static String jsonEscape(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\r", " ").replace("\n", " ");
    }

    /**
     * セットアップフォルダ内の bridge/commands/minecraft/ を絶対パスで返す。
     *
     * 本番: serverDir = セットアップフォルダ (例: D:\新しいフォルダー\)
     *   → D:\新しいフォルダー\bridge\commands\minecraft\  ← 直下で発見
     *
     * 開発時フォールバック: serverDir = ui\server\Douma_Craft\
     *   → ui\bridge\commands\minecraft\  ← 2階層上で発見
     */
    private Path findCommandsBase(MinecraftServer server) {
        Path serverDir = server.getServerDirectory().toPath().toAbsolutePath().normalize();

        // 本番: セットアップフォルダ直下を最優先で確認
        Path direct = serverDir.resolve("bridge").resolve("commands").resolve("minecraft");
        if (Files.isDirectory(direct)) return direct;

        // 開発時フォールバック: 最大2階層上まで探索
        Path dir = serverDir.getParent();
        for (int i = 0; i < 2 && dir != null; i++) {
            Path candidate = dir.resolve("bridge").resolve("commands").resolve("minecraft");
            if (Files.isDirectory(candidate)) return candidate;
            dir = dir.getParent();
        }
        return null;
    }

    private Path resolveCommandFile(MinecraftServer server, String key) {
        Path serverDir = server.getServerDirectory().toPath().toAbsolutePath().normalize();
        Path base = findCommandsBase(server);
        if (base == null) {
            // デバッグ: serverDir と検索候補を返す
            throw new RuntimeException("serverDir=" + serverDir + " | searched up to 4 levels, bridge/commands/minecraft/ not found");
        }

        String fileName = key.toLowerCase(Locale.ROOT).endsWith(".txt") ? key : (key + ".txt");
        Path p = base.resolve(fileName).normalize();

        // 念のため、base外参照を禁止
        if (!p.startsWith(base)) return null;
        if (!Files.exists(p)) return null;

        return p;
    }

    private List<String> listKeys(MinecraftServer server) {
        Path base = findCommandsBase(server);
        if (base == null) return List.of();

        try {
            return Files.list(base)
                .filter(f -> f.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".txt"))
                .map(f -> {
                    String n = f.getFileName().toString();
                    return n.substring(0, n.length() - 4);
                })
                .sorted()
                .collect(Collectors.toList());
        } catch (IOException e) {
            return List.of();
        }
    }

    // ===== parsing =====
    private static class ParsedFile {
        final Map<String, String> meta;
        final List<String> commands;
        ParsedFile(Map<String, String> meta, List<String> commands) {
            this.meta = meta;
            this.commands = commands;
        }
    }

    private boolean isDestructive(ParsedFile parsed, BridgeEvent event) {
        if ("true".equalsIgnoreCase(parsed.meta.getOrDefault("DESTRUCTIVE", "false"))) return true;
        String key = event.key.toLowerCase(Locale.ROOT);
        if (key.contains("tnt") || key.contains("maguma") || key.contains("otosiana") || key.contains("fall_sand")) {
            return true;
        }
        for (String command : parsed.commands) {
            String lower = command.toLowerCase(Locale.ROOT);
            if (lower.contains("summon tnt") || lower.matches(".*\\b(fill|setblock)\\b.*\\b(lava|tnt|fire)\\b.*")) {
                return true;
            }
        }
        return false;
    }

    private boolean isPlayerInsideProtection(MinecraftServer server, BridgeEvent event) {
        if (server.getPlayerList().getPlayers().isEmpty()) return false;
        ServerPlayer player = server.getPlayerList().getPlayers().get(0);
        double minX = Math.min(event.protectX1, event.protectX2);
        double maxX = Math.max(event.protectX1, event.protectX2);
        double minZ = Math.min(event.protectZ1, event.protectZ2);
        double maxZ = Math.max(event.protectZ1, event.protectZ2);
        return player.getX() >= minX && player.getX() <= maxX
            && player.getZ() >= minZ && player.getZ() <= maxZ;
    }

    private ParsedFile parseFile(Path file) throws IOException {
        List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);

        Map<String, String> meta = new HashMap<>();
        List<String> commands = new ArrayList<>();

        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty()) continue;

            if (line.startsWith("#")) {
                // # TITLE: xxx
                String s = line.substring(1).trim();
                int idx = s.indexOf(':');
                if (idx > 0) {
                    String k = s.substring(0, idx).trim().toUpperCase(Locale.ROOT);
                    String v = s.substring(idx + 1).trim();
                    if (!k.isEmpty() && !v.isEmpty()) meta.put(k, v);
                }
                continue;
            }

            if (line.startsWith("//")) continue;

            commands.add(line);
        }

        return new ParsedFile(meta, commands);
    }

    // ===== placeholders =====
    private String applyPlaceholdersMinecraft(String cmd, String listenerName) {
        // {ListenerName} は「JSON文字列の中身」として安全化（\" と \\ を処理）
        String safe = mcJsonStringEscape(listenerName, 40);
        return cmd.replace("{ListenerName}", safe);
    }

    private String mcJsonStringEscape(String s, int maxLen) {
        String v = (s == null) ? "" : s;
        v = v.replace("\r", " ").replace("\n", " ").replace("\t", " ");
        v = v.replaceAll("[\\u0000-\\u001F\\u007F]", "");
        if (v.length() > maxLen) v = v.substring(0, maxLen);

        // JSON string の中身として使える形にする（" を \", \ を \\）
        v = v.replace("\\", "\\\\").replace("\"", "\\\"");
        return v;
    }

    private String snbtString(String s, int maxLen) {
        String v = (s == null) ? "" : s;
        v = v.replace("\r", " ").replace("\n", " ").replace("\t", " ");
        v = v.replaceAll("[\\u0000-\\u001F\\u007F]", "");
        if (v.length() > maxLen) v = v.substring(0, maxLen);
        v = v.replace("\\", "\\\\").replace("\"", "\\\"");
        return "\"" + v + "\"";
    }
}
