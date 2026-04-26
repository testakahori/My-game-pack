package jp.douma.doumacmd;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

@Mod(DoumaCmdMod.MODID)
public class DoumaCmdMod {
    public static final String MODID = "doumacmd";

    // count 上限（安全）
    private static final int MAX_COUNT = 100;

    public DoumaCmdMod() {
        MinecraftForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterCommandsEvent event) {
        register(event.getDispatcher());
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
                            return runKey(ctx.getSource(), key, count);
                        })
                    )
                )
        );
    }

    private int runKey(CommandSourceStack source, String key, int count) {
        MinecraftServer server = source.getServer();
        ServerPlayer player = source.getPlayer();

        String listenerName = (player != null) ? player.getGameProfile().getName() : "console";

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
        CommandSourceStack silent = source.withSuppressedOutput();

        // アナウンス（datapack不要・Mod内で直接 title コマンドを実行）
        if (player != null) {
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
        for (int i = 0; i < count; i++) {
            for (String raw : parsed.commands) {
                String cmd = applyPlaceholdersMinecraft(raw, listenerName);
                if (performSilent(server, silent, cmd)) executed++;
            }
        }

        // 成功メッセージは表示しない

        return 1;
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