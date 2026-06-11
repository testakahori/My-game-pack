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
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
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
    private static final int MAX_QUEUE_SIZE = 1000;
    private static final int GIFT_EVENTS_PER_TICK = 5;
    private static final int OTHER_EVENTS_PER_TICK = 2;
    private static final int LIKE_EVENTS_PER_TICK = 1;

    private final Deque<BridgeEvent> giftQueue = new ArrayDeque<>();
    private final Deque<BridgeEvent> likeQueue = new ArrayDeque<>();
    private final Deque<BridgeEvent> otherQueue = new ArrayDeque<>();

    private HttpServer bridgeServer;
    private MinecraftServer activeServer;

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
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        stopBridgeHttpServer();
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

        processQueue(activeServer, giftQueue, GIFT_EVENTS_PER_TICK);
        processQueue(activeServer, otherQueue, OTHER_EVENTS_PER_TICK);
        processQueue(activeServer, likeQueue, LIKE_EVENTS_PER_TICK);
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
        return runCommandFile(server, source, key, count, listenerName, announce);
    }

    private int runCommandFile(
        MinecraftServer server,
        CommandSourceStack source,
        String key,
        int count,
        String listenerName,
        boolean announce
    ) {
        int safeCount = Math.max(1, Math.min(MAX_COUNT, count));

        Path file;
        try {
            file = resolveCommandFile(server, key);
        } catch (RuntimeException e) {
            source.sendFailure(Component.literal("[Douma] " + e.getMessage()));
            return 0;
        }
        if (file == null) {
            source.sendFailure(Component.literal(
                "[Douma] file not found: bridge/commands/minecraft/" + key + ".txt"
            ));
            return 0;
        }

        ParsedFile parsed;
        try {
            parsed = parseFile(file);
        } catch (Exception e) {
            source.sendFailure(Component.literal(
                "[Douma] read failed: " + e.getMessage()
            ));
            return 0;
        }

        String title = parsed.meta.getOrDefault("TITLE", key);

        // ★ 赤文字を完全に消すため、内部実行は「出力抑制」した source を使う
        CommandSourceStack silent = source.withPermission(4).withSuppressedOutput();

        // アナウンス（datapack不要・Mod内で直接 title コマンドを実行）
        if (announce) {
            String subtitleRaw = parsed.meta.getOrDefault("SUBTITLE", "{ListenerName}");
            String subtitleText = subtitleRaw.replace("{ListenerName}", listenerName);

            String titleJson    = "{\"text\":\"" + mcJsonStringEscape(title, 60) + "\",\"color\":\"yellow\",\"bold\":true}";
            String subtitleJson = "{\"text\":\"" + mcJsonStringEscape(subtitleText, 60) + "\",\"color\":\"green\"}";

            performSilent(server, silent, "title @a times 10 70 10");
            performSilent(server, silent, "title @a title "    + titleJson);
            performSilent(server, silent, "title @a subtitle " + subtitleJson);
        }

        // 本体コマンドを count 回（summon/effect等のログも suppressed で消える）
        int executed = 0;
        for (int i = 0; i < safeCount; i++) {
            for (String raw : parsed.commands) {
                String cmd = applyPlaceholdersMinecraft(raw, listenerName);
                if (performSilent(server, silent, cmd)) executed++;
            }
        }

        // 成功メッセージは表示しない

        return 1;
    }

    private void startBridgeHttpServer(MinecraftServer server) {
        if (bridgeServer != null) return;

        int port = getBridgePort();
        try {
            bridgeServer = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 32);
            bridgeServer.createContext("/douma/event", exchange -> handleBridgeEvent(server, exchange));
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

    private void sendHttp(HttpExchange exchange, int status, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private synchronized boolean enqueueBridgeEvent(BridgeEvent event) {
        int total = giftQueue.size() + likeQueue.size() + otherQueue.size();
        if (total >= MAX_QUEUE_SIZE) return false;

        if ("gift".equals(event.type)) {
            giftQueue.addLast(event);
        } else if ("like".equals(event.type)) {
            likeQueue.addLast(event);
        } else {
            otherQueue.addLast(event);
        }
        return true;
    }

    private void processQueue(MinecraftServer server, Deque<BridgeEvent> queue, int limit) {
        for (int i = 0; i < limit; i++) {
            BridgeEvent event;
            synchronized (this) {
                event = queue.pollFirst();
            }
            if (event == null) return;

            CommandSourceStack source = server.createCommandSourceStack().withPermission(4).withSuppressedOutput();
            runCommandFile(server, source, event.key, event.count, event.listenerName, event.announce);
        }
    }

    private static class BridgeEvent {
        final String type;
        final String key;
        final int count;
        final String listenerName;
        final boolean announce;

        BridgeEvent(String type, String key, int count, String listenerName, boolean announce) {
            this.type = normalizeType(type);
            this.key = sanitizeKey(key);
            this.count = Math.max(1, Math.min(MAX_COUNT, count));
            this.listenerName = listenerName == null || listenerName.isBlank() ? "viewer" : listenerName;
            this.announce = announce;
        }

        static BridgeEvent fromJson(String json) {
            if (json == null || json.isBlank()) return null;
            String type = jsonString(json, "type", "other");
            String key = jsonString(json, "key", "");
            int count = jsonInt(json, "count", 1);
            String listenerName = jsonString(json, "listenerName", "viewer");
            boolean announce = jsonBool(json, "announce", true);
            return new BridgeEvent(type, key, count, listenerName, announce);
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
            return result >= 0;
        } catch (Exception e) {
            // 失敗時だけは最低限プレイヤーに知らせたいなら、ここで sendFailure してもOK
            // 今回は「赤文字ゼロ優先」なので silent のまま false を返す
            return false;
        }
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
