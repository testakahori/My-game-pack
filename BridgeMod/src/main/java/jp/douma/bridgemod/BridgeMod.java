package jp.douma.bridgemod;

import com.mojang.brigadier.CommandDispatcher;
import jp.douma.bridgemod.api.GameEvents;
import jp.douma.bridgemod.api.EnvironmentOverrides;
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
import net.minecraftforge.event.entity.EntityJoinLevelEvent;
import net.minecraftforge.event.entity.living.LivingDeathEvent;
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
import java.util.stream.Collectors;

@Mod(BridgeMod.MODID)
public class BridgeMod {
    public static final String MODID = "bridgemod";

    // count 上限（安全）
    private static final int MAX_COUNT = 100;
    private static final int MAX_GAME_COUNT = 100000;
    private long discardedGameRequests;
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
    private final LikeCodLimiter likeCod = new LikeCodLimiter();

    private HttpServer bridgeServer;
    // サーバー起動ごとに作り直す。null の間は HTTP・WebSocket をすべて拒否する。
    private volatile BridgeAuth auth;
    private MinecraftServer activeServer;
    private ServerSocket webSocketServer;
    private final Set<Socket> webSocketClients = Collections.synchronizedSet(new HashSet<>());
    private int statusBroadcastTicks = 0;
    private long executedCommands = 0;
    private long failedCommands = 0;
    private volatile String lastError = "";
    private long protectedSkips = 0;
    private long playerDeaths = 0;
    private final GiftEffects giftEffects = new GiftEffects();
    private final FixedEnvironment environment = new FixedEnvironment();
    private GiftEffects.Protection currentEffectProtection;

    public BridgeMod() {
        GameEvents.registerCommonEffects(data -> {
            CommandSourceStack source = (CommandSourceStack)data.get("source");
            String key = String.valueOf(data.get("key"));
            if ("cancel_jump".equals(key)) { giftEffects.cancelJump(source.getPlayer()); return 1; }
            try { return giftEffects.start(source, key, ((Number)data.get("count")).intValue(),
                new GiftEffects.Protection(Boolean.TRUE.equals(data.get("protectionEnabled")),
                    gameNumber(data,"protectX1"), gameNumber(data,"protectX2"), gameNumber(data,"protectZ1"), gameNumber(data,"protectZ2")));
            } catch (Exception error) { throw new IllegalStateException(error); }
        });
        MinecraftForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterCommandsEvent event) {
        register(event.getDispatcher());
    }

    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        activeServer = event.getServer();
        giftEffects.load(activeServer);
        environment.apply(activeServer, giftEffects);
        issueAuthToken(event.getServer());
        startBridgeHttpServer(event.getServer());
        startWebSocketServer();
    }

    // Bridge とアプリはこのファイルを読んで X-Bridge-Token に付ける。書けなければ受付は閉じたまま（安全側）。
    private void issueAuthToken(MinecraftServer server) {
        String token = BridgeAuth.newToken();
        Path file = BridgeAuth.tokenPath(server.getServerDirectory().toPath().toAbsolutePath().normalize());
        try {
            BridgeAuth.writeToken(file, token);
            auth = new BridgeAuth(token);
        } catch (IOException e) {
            auth = null;
            System.out.println("[Bridge] 認証トークンを書き込めません。Bridge からの要求はすべて拒否されます: " + file + " (" + e.getMessage() + ")");
        }
    }

    // 0 なら処理を続ける。拒否した要求には 403（ブラウザー・別ホスト・トークン違い）か 415 を返す。
    private boolean authorize(HttpExchange exchange) throws IOException {
        BridgeAuth current = auth;
        int status = current == null ? 403
            : current.checkHttp(exchange.getRequestMethod(), getBridgePort(), name -> exchange.getRequestHeaders().getFirst(name));
        if (status == BridgeAuth.ALLOWED) return true;
        sendHttp(exchange, status, status == 415 ? "{\"ok\":false,\"error\":\"json_required\"}" : "{\"ok\":false,\"error\":\"forbidden\"}");
        return false;
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        GameEvents.clearSessions(); discardedGameRequests = 0;
        giftEffects.stop();
        EnvironmentOverrides.reset();
        stopBridgeHttpServer();
        stopWebSocketServer();
        auth = null;
        activeServer = null;
        synchronized (this) {
            giftQueue.clear();
            likeQueue.clear();
            otherQueue.clear();
        }
        likeCod.reset();
    }

    @SubscribeEvent
    public void onEntityJoin(EntityJoinLevelEvent event) { likeCod.joined(event); }

    // プレイヤー死亡の検知（デスルーレット用）。累計死亡数を WS で Bridge へ通知する。
    @SubscribeEvent
    public void onLivingDeath(LivingDeathEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        playerDeaths++;
        broadcastWebSocket("{\"type\":\"death\",\"player\":\""
            + jsonEscape(player.getGameProfile().getName())
            + "\",\"deaths\":" + playerDeaths + "}");
    }

    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || activeServer == null) return;

        likeCod.tick();
        // Gift work is independent. Likes cannot borrow unused gift budget and cause a burst.
        int budget = MAX_COMMANDS_PER_TICK - LIKE_RESERVED_COMMANDS_PER_TICK;
        budget -= processQueue(activeServer, giftQueue, budget);
        budget -= processQueue(activeServer, otherQueue, budget);
        processQueue(activeServer, likeQueue, LIKE_RESERVED_COMMANDS_PER_TICK);
        giftEffects.tick(activeServer);
        environment.apply(activeServer, giftEffects);
        if (++statusBroadcastTicks >= 20) {
            statusBroadcastTicks = 0;
            broadcastWebSocket(buildStatusJson());
        }
    }

    private void register(CommandDispatcher<CommandSourceStack> d) {
        d.register(Commands.literal("bridgeeffect").requires(src -> src.hasPermission(2))
            .then(Commands.argument("effect", StringArgumentType.word())
                .suggests((ctx, b) -> { GiftEffects.KEYS.forEach(b::suggest); return b.buildFuture(); })
                .then(Commands.argument("count", IntegerArgumentType.integer(1, MAX_COUNT))
                    .executes(ctx -> {
                        try { return giftEffects.start(ctx.getSource(), StringArgumentType.getString(ctx, "effect"),
                            IntegerArgumentType.getInteger(ctx, "count"), currentEffectProtection); }
                        catch (Exception e) { ctx.getSource().sendFailure(Component.literal(e.getMessage())); return 0; }
                    }))));
        SuggestionProvider<CommandSourceStack> keySuggest = (ctx, b) -> {
            for (String k : listKeys(ctx.getSource().getServer())) b.suggest(k);
            return b.buildFuture();
        };

        d.register(
            Commands.literal("bridge")
                .requires(src -> src.hasPermission(0)) // 誰でもOK。OP限定なら 2
                .then(Commands.argument("key", StringArgumentType.word())
                    .suggests(keySuggest)
                    .then(Commands.argument("count", IntegerArgumentType.integer(1, MAX_GAME_COUNT))
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
            source.sendFailure(Component.literal("[Bridge] " + e.getMessage()));
            return 0;
        }
        if (file == null) {
            source.sendFailure(Component.literal(
                "[Bridge] file not found: bridge/commands/minecraft/" + event.key + ".txt"
            ));
            return 0;
        }

        try {
            event.parsed = parseFile(file);
            String gameId = event.parsed.meta.get("GAME_MOD");
            if (gameId != null) event.gameSessionId = GameEvents.sessionId(gameId);
        } catch (IOException error) { source.sendFailure(Component.literal("[Bridge] " + error.getMessage())); return 0; }
        if (!enqueueBridgeEvent(event)) {
            source.sendFailure(Component.literal("[Bridge] queue is full, try again later"));
            return 0;
        }
        return 1;
    }

    private void startBridgeHttpServer(MinecraftServer server) {
        if (bridgeServer != null) return;

        int port = getBridgePort();
        try {
            bridgeServer = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 32);
            bridgeServer.createContext("/bridge/event", exchange -> { if (authorize(exchange)) handleBridgeEvent(server, exchange); });
            bridgeServer.createContext("/bridge/exec", exchange -> { if (authorize(exchange)) handleBridgeExec(server, exchange); });
            bridgeServer.createContext("/bridge/status", exchange -> { if (authorize(exchange)) handleBridgeStatus(exchange); });
            bridgeServer.setExecutor(Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "BridgeMod-BridgeHttp");
                t.setDaemon(true);
                return t;
            }));
            bridgeServer.start();
            System.out.println("[Bridge] Bridge HTTP listening on 127.0.0.1:" + port);
        } catch (IOException e) {
            bridgeServer = null;
            System.out.println("[Bridge] Bridge HTTP start failed: " + e.getMessage());
        }
    }

    private void stopBridgeHttpServer() {
        if (bridgeServer == null) return;
        bridgeServer.stop(1);
        bridgeServer = null;
        System.out.println("[Bridge] Bridge HTTP stopped");
    }

    private int getBridgePort() {
        String fromProp = System.getProperty("bridgemod.bridgePort");
        String fromEnv = System.getenv("BRIDGE_MOD_PORT");
        if (fromEnv == null || fromEnv.isBlank()) fromEnv = System.getenv("DOUMA_BRIDGE_PORT");
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
        if (!"/bridge/event".equals(path)) {
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

    // 生コマンド配列の実行（ルーレット演出などBridge側でタイミング制御するフレーム用）。
    // 127.0.0.1 バインドのHTTPのみ。otherキュー経由・出力抑制・失敗は統計に計上しない。
    private static final int MAX_EXEC_COMMANDS = 40;
    private static final int MAX_EXEC_COMMAND_LENGTH = 500;

    private void handleBridgeExec(MinecraftServer server, HttpExchange exchange) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendHttp(exchange, 405, "{\"ok\":false,\"error\":\"method_not_allowed\"}");
            return;
        }
        String body = readHttpBody(exchange);
        List<String> commands = new ArrayList<>();
        String listenerName = "viewer";
        // 正規表現ではなく JSON として読む。commands は文字列の配列、listenerName は文字列だけを受け付ける。
        try {
            com.google.gson.JsonObject data = com.google.gson.JsonParser.parseString(body).getAsJsonObject();
            com.google.gson.JsonElement list = data.get("commands");
            if (list == null || !list.isJsonArray()) throw new IllegalArgumentException("commands must be an array");
            for (com.google.gson.JsonElement item : list.getAsJsonArray()) {
                // 以前の読み取りと同じく、文字列以外の要素は飛ばす（演出フレーム全体を捨てない）。
                if (!item.isJsonPrimitive() || !item.getAsJsonPrimitive().isString()) continue;
                // 改行・タブは空白にして1行のコマンドとして扱う。
                commands.add(item.getAsString().replace('\r', ' ').replace('\n', ' ').replace('\t', ' '));
            }
            com.google.gson.JsonElement name = data.get("listenerName");
            // 文字列でなければ以前と同じく viewer として扱う。
            if (name != null && name.isJsonPrimitive() && name.getAsJsonPrimitive().isString()) listenerName = name.getAsString();
        } catch (RuntimeException e) {
            sendHttp(exchange, 400, "{\"ok\":false,\"error\":\"bad_request\"}");
            return;
        }
        if (commands.isEmpty()) {
            sendHttp(exchange, 400, "{\"ok\":false,\"error\":\"commands_required\"}");
            return;
        }
        if (commands.size() > MAX_EXEC_COMMANDS) commands = commands.subList(0, MAX_EXEC_COMMANDS);
        List<String> safe = new ArrayList<>();
        for (String c : commands) {
            String v = c == null ? "" : c.trim();
            if (v.isEmpty() || v.length() > MAX_EXEC_COMMAND_LENGTH) continue;
            safe.add(v);
        }
        if (safe.isEmpty()) {
            sendHttp(exchange, 400, "{\"ok\":false,\"error\":\"commands_required\"}");
            return;
        }
        BridgeEvent event = BridgeEvent.inline(safe, listenerName);
        if (!enqueueBridgeEvent(event)) {
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
        return "{\"ok\":true,\"mod\":\"bridgemod\",\"environmentFixed\":true,\"gift\":" + gift + ",\"like\":" + like + ",\"other\":" + other
            + ",\"games\":" + new com.google.gson.Gson().toJson(GameEvents.status())
            + ",\"gameSessions\":" + new com.google.gson.Gson().toJson(GameEvents.sessions())
            + ",\"discardedGameRequests\":" + discardedGameRequests
            + ",\"displayAvailable\":" + DisplayLink.available()
            + ",\"likeCodActive\":" + likeCod.activeCount() + ",\"likeCodLimit\":" + LikeCodLimiter.MAX_ACTIVE
            + ",\"likeCodSpawned\":" + likeCod.spawned()
            + ",\"executed\":" + executedCommands + ",\"failed\":" + failedCommands
            + ",\"effectsPending\":" + giftEffects.pendingJobs() + ",\"effectsFailed\":" + giftEffects.failures()
            + ",\"effectsError\":\"" + jsonEscape(giftEffects.lastError()) + "\""
            + ",\"deaths\":" + playerDeaths
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
                        Thread client = new Thread(() -> handleWebSocketClient(socket), "BridgeMod-WebSocketClient");
                        client.setDaemon(true); client.start();
                    } catch (IOException ignored) {}
                }
            }, "BridgeMod-WebSocket");
            accept.setDaemon(true); accept.start();
            System.out.println("[Bridge] WebSocket listening on 127.0.0.1:" + (getBridgePort() + 1));
        } catch (IOException e) {
            System.out.println("[Bridge] WebSocket start failed: " + e.getMessage());
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
            // ハンドシェイクは5秒・64行・16KBまで。送ってこない相手にスレッドを抱えさせない。
            socket.setSoTimeout(5000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String requestLine = reader.readLine();
            Map<String, String> headers = new HashMap<>();
            String line;
            int lines = 0, chars = requestLine == null ? 0 : requestLine.length();
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                chars += line.length();
                if (++lines > 64 || chars > 16384) { socket.close(); return; }
                int colon = line.indexOf(':');
                if (colon > 0) headers.putIfAbsent(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
            }
            String key = headers.get("sec-websocket-key");
            BridgeAuth current = auth;
            // ブラウザー（Origin あり）・別ホスト・トークン違いの接続は、状態（プレイヤー座標など）を一切送らずに閉じる。
            if (current == null || !current.checkWebSocket(requestLine, getBridgePort() + 1, name -> headers.get(name.toLowerCase(Locale.ROOT)))) {
                OutputStream denied = socket.getOutputStream();
                denied.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                denied.flush();
                socket.close();
                return;
            }
            if (key == null) { socket.close(); return; }
            String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
                .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.UTF_8)));
            OutputStream out = socket.getOutputStream();
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            socket.setSoTimeout(0); // 接続後は状態を送り続けるだけなので、読み込みの時間制限を外す
            webSocketClients.add(socket);
            sendWebSocket(socket, buildStatusJson());
            InputStream in = socket.getInputStream();
            // 送信専用。Bridge は状態と死亡通知を受け取るだけなので、受信したテキストでイベントを積まない。
            // 読み続けるのは、相手が閉じたことを検知するため。
            while (!socket.isClosed()) {
                if (readWebSocketText(in) == null) break;
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
        // Common events run as received. A game MOD owns duplicate-request detection.
        Deque<BridgeEvent> queue = "gift".equals(event.type) ? giftQueue : "like".equals(event.type) ? likeQueue : otherQueue;
        int limit = queue == giftQueue ? MAX_GIFT_QUEUE : queue == likeQueue ? MAX_LIKE_QUEUE : MAX_OTHER_QUEUE;
        // Backpressure: the sender retains the head until accepted. Never discard an older event.
        if (queue.size() >= limit) return false;
        queue.addLast(event);
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
        boolean pacedCod = "like".equals(event.type) && "cod".equals(event.key);
        if (pacedCod && !likeCod.canSpawn(server)) return 0;
        // /bridge/exec の生コマンド：演出フレームなので失敗は統計に計上しない
        if (event.inlineCommands != null) {
            CommandSourceStack silentInline = server.createCommandSourceStack().withPermission(4).withSuppressedOutput();
            int usedInline = 0;
            while (event.remaining > 0 && (usedInline == 0 || usedInline + event.inlineCommands.size() <= commandBudget)) {
                for (String raw : event.inlineCommands) {
                    performSilent(server, silentInline, applyPlaceholdersMinecraft(raw, event.listenerName), false);
                    usedInline++;
                }
                event.remaining--;
            }
            return usedInline;
        }

        Path file;
        try {
            file = resolveCommandFile(server, event.key);
        } catch (RuntimeException e) {
            System.out.println("[Bridge] " + e.getMessage());
            recordFailure(event.key + ": " + e.getMessage());
            event.remaining = 0;
            return 0;
        }
        if (file == null) {
            System.out.println("[Bridge] file not found: bridge/commands/minecraft/" + event.key + ".txt");
            recordFailure(event.key + ": file not found");
            event.remaining = 0;
            return 0;
        }

        ParsedFile parsed;
        try {
            if (event.parsed == null) event.parsed = parseFile(file);
            parsed = event.parsed;
        } catch (Exception e) {
            System.out.println("[Bridge] read failed (" + event.key + "): " + e.getMessage());
            recordFailure(event.key + ": " + e.getMessage());
            event.remaining = 0;
            return 0;
        }
        if (parsed.commands.isEmpty() && !parsed.meta.containsKey("GAME_MOD")) {
            recordFailure(event.key + ": no commands");
            event.remaining = 0;
            return 0;
        }
        if (event.protectionEnabled && isDestructive(parsed, event)
                && isPlayerInsideProtection(server, event)) {
            protectedSkips++;
            System.out.println("[Bridge] protected area: skipped destructive event " + event.key);
            event.remaining = 0;
            return 0;
        }

        if (parsed.meta.containsKey("GAME_MOD")) {
            Map<String, Object> data = new HashMap<>();
            data.put("server",server); data.put("key",parsed.meta.getOrDefault("GAME_KEY",event.key));
            data.put("count",event.remaining); data.put("type",event.type); data.put("listenerName",event.listenerName);
            data.put("gameSessionId",event.gameSessionId); data.put("args",event.args);
            data.put("announce",event.announce); data.put("requestId",event.eventId); data.put("eventId",event.eventId);
            data.put("protectionEnabled",event.protectionEnabled);
            data.put("protectX1",event.protectX1); data.put("protectX2",event.protectX2);
            data.put("protectZ1",event.protectZ1); data.put("protectZ2",event.protectZ2);
            try {
                int result = GameEvents.offer(parsed.meta.get("GAME_MOD"),data);
                if (result == GameEvents.WAIT) return 0;
                if (result == GameEvents.DISCARDED) { discardedGameRequests++; event.remaining = 0; return 1; }
                executedCommands++; event.remaining = 0; return 1;
            } catch (Exception error) {
                recordFailure(event.key + ": " + error.getMessage()); event.remaining = 0; return 1;
            }
        }

        CommandSourceStack silent = server.createCommandSourceStack().withPermission(4).withSuppressedOutput();
        int used = 0;

        // Native effects receive the full count once; normal command files retain repeat semantics.
        while (event.remaining > 0 && (used == 0 || used + parsed.commands.size() <= commandBudget)) {
            if (pacedCod && !likeCod.canSpawn(server)) break;
            int count = "aggregate".equals(parsed.meta.get("COUNT_MODE")) ? Math.min(MAX_COUNT, event.remaining) : 1;
            currentEffectProtection = new GiftEffects.Protection(event.protectionEnabled,
                event.protectX1, event.protectX2, event.protectZ1, event.protectZ2);
            String commandRequestId = count == event.count ? event.eventId
                : UUID.nameUUIDFromBytes((event.eventId + ":" + (event.count - event.remaining)).getBytes(StandardCharsets.UTF_8)).toString();
            boolean started = false;
            if (pacedCod) likeCod.begin();
            try {
                for (String raw : parsed.commands) {
                    String cmd = applyPlaceholdersMinecraft(raw, event.listenerName).replace("{Count}", Integer.toString(count))
                        .replace("{RequestId}", commandRequestId);
                    started |= performSilent(server, silent, cmd);
                    used++;
                }
            } finally { currentEffectProtection = null; if (pacedCod) likeCod.end(); }
            // Notify only when a command actually ran, once across all tick slices.
            // Game-owned queues call DisplayMOD themselves when their real event starts.
            if (started && DisplayLink.shouldAnnounce(event.announce, event.announced, parsed.meta.get("DISPLAY_OWNER"))) {
                event.announced = true;
                DisplayLink.show(server, Map.of(
                    "title", parsed.meta.getOrDefault("TITLE", event.key),
                    "subtitle", parsed.meta.getOrDefault("SUBTITLE", "{ListenerName}"),
                    "listenerName", event.listenerName, "count", event.count,
                    "sound", parsed.meta.getOrDefault("SOUND", "entity.experience_orb.pickup"),
                    "particle", parsed.meta.getOrDefault("PARTICLE", "minecraft:happy_villager")));
                used++; // Reserve work for the optional notification, not another gameplay command.
            }
            event.remaining -= count;
        }
        return used;
    }

    private static double gameNumber(Map<String, Object> data, String key) {
        return data.get(key) instanceof Number value ? value.doubleValue() : 0;
    }

    private static class BridgeEvent {
        final String type;
        final String key;
        int count;
        final String listenerName;
        final boolean announce;
        final boolean protectionEnabled;
        final double protectX1, protectX2, protectZ1, protectZ2;
        // Only the server tick changes progress; HTTP requests never merge into an executing event.
        volatile int remaining;
        boolean announced;
        // /bridge/exec 用：ファイルではなく生コマンド配列を実行する（null ならファイル実行）
        List<String> inlineCommands;
        ParsedFile parsed;
        String eventId = UUID.randomUUID().toString();
        String gameSessionId = "";
        Map<String, Object> args = Map.of();

        BridgeEvent(String type, String key, int count, String listenerName, boolean announce) {
            this(type, key, count, listenerName, announce, false, 0, 0, 0, 0);
        }

        static BridgeEvent inline(List<String> commands, String listenerName) {
            BridgeEvent event = new BridgeEvent("other", "_inline", 1, listenerName, false);
            event.inlineCommands = commands;
            return event;
        }

        BridgeEvent(String type, String key, int count, String listenerName, boolean announce,
                    boolean protectionEnabled, double protectX1, double protectX2,
                    double protectZ1, double protectZ2) {
            this.type = normalizeType(type);
            this.key = sanitizeKey(key);
            if (count < 1 || count > MAX_GAME_COUNT) throw new IllegalArgumentException("count must be from 1 to " + MAX_GAME_COUNT);
            this.count = count;
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
            try {
                var data = com.google.gson.JsonParser.parseString(json).getAsJsonObject();
                int count = data.has("count") ? data.get("count").getAsBigDecimal().intValueExact() : 1;
                if (data.has("count") && (!data.get("count").isJsonPrimitive() || !data.getAsJsonPrimitive("count").isNumber())) return null;
                String key = memberString(data, "key", "");
                if (!key.matches("[A-Za-z0-9_.-]{1,200}")) return null;
                BridgeEvent event = new BridgeEvent(memberString(data, "type", "other"), key, count,
                    memberString(data, "listenerName", memberString(data, "senderName", "viewer")),
                    memberBoolean(data, "announce", true), memberBoolean(data, "protectionEnabled", false),
                    memberNumber(data, "protectX1"), memberNumber(data, "protectX2"),
                    memberNumber(data, "protectZ1"), memberNumber(data, "protectZ2"));
                String legacyId = memberString(data, "eventId", "");
                String requestId = memberString(data, "requestId", legacyId);
                if (!legacyId.isEmpty() && !legacyId.equals(requestId)) return null;
                if (!requestId.isEmpty()) event.eventId = requestId;
                event.gameSessionId = memberString(data, "gameSessionId", "");
                if (!event.gameSessionId.isEmpty() && !event.gameSessionId.matches("[A-Za-z0-9_.:-]{1,128}")) return null;
                if (data.has("args")) {
                    if (!data.get("args").isJsonObject()) return null;
                    event.args = GameEvents.arguments(new com.google.gson.Gson().fromJson(data.get("args"), Map.class));
                }
                return event.eventId.matches("[A-Za-z0-9_.:-]{1,128}") ? event : null;
            } catch (RuntimeException error) { return null; }
        }
        private static String memberString(com.google.gson.JsonObject data, String name, String fallback) {
            if (!data.has(name)) return fallback;
            var value = data.get(name);
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException("Invalid " + name);
            String text = value.getAsString();
            if (text.length() > 4096) throw new IllegalArgumentException("Text too long");
            return text;
        }
        private static boolean memberBoolean(com.google.gson.JsonObject data, String name, boolean fallback) {
            if (!data.has(name)) return fallback;
            var value = data.get(name);
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) throw new IllegalArgumentException("Invalid " + name);
            return value.getAsBoolean();
        }
        private static double memberNumber(com.google.gson.JsonObject data, String name) {
            if (!data.has(name)) return 0;
            var value = data.get(name);
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber() || !Double.isFinite(value.getAsDouble())) throw new IllegalArgumentException("Invalid " + name);
            return value.getAsDouble();
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
    }

    /**
     * コマンドを「出力を抑制」して実行（赤ログを出さない）
     */
    private boolean performSilent(MinecraftServer server, CommandSourceStack silentSource, String commandLine) {
        return performSilent(server, silentSource, commandLine, true);
    }

    private boolean performSilent(MinecraftServer server, CommandSourceStack silentSource, String commandLine, boolean countFailure) {
        try {
            int result = server.getCommands().performPrefixedCommand(silentSource, commandLine);
            executedCommands++;
            if (result == 0) {
                // execute if/unless の条件不成立（result 0）は正常系。召喚txtは
                // 「上空が空いていれば頭上／塞がっていれば足元」の2行フォールバックで
                // 毎回必ず片方が result 0 になるため、失敗計上すると統計が汚染される。
                if (countFailure && !isConditionalCommand(commandLine)) {
                    recordFailure(commandLine + ": command returned 0");
                }
                return false;
            }
            return true;
        } catch (Exception e) {
            // 失敗時だけは最低限プレイヤーに知らせたいなら、ここで sendFailure してもOK
            // 今回は「赤文字ゼロ優先」なので silent のまま false を返す
            if (countFailure) recordFailure(commandLine + ": " + e.getMessage());
            return false;
        }
    }

    private static boolean isConditionalCommand(String commandLine) {
        String v = commandLine == null ? "" : commandLine.trim();
        if (v.startsWith("/")) v = v.substring(1).trim();
        v = v.toLowerCase(Locale.ROOT);
        // Also recognize "execute at @p if/unless ... run ..." used by the spawn files.
        // Search only the execute prefix, not a word inside a say command or JSON payload.
        int run = v.indexOf(" run ");
        String prefix = run < 0 ? v : v.substring(0, run);
        return v.startsWith("execute ") && prefix.matches(".*\\b(if|unless)\\s+.*");
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

        return CommandRouting.resolve(base, key);
    }

    private List<String> listKeys(MinecraftServer server) {
        Path base = findCommandsBase(server);
        return base == null ? List.of() : CommandRouting.keys(base);
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
