package jp.douma.bridgemod;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

// BridgeMOD がコマンドの名前からファイルを探す所（CommandRouting）を、Minecraft なしで確かめる（2026-10-18）。
// 名前に . があっても探せること、フォルダーの外は読まないこと、大文字の .TXT もチャット候補に出ること、
// 同じ名前のコマンドが2つのゲームにあると今の文で止めることを確かめる。
public final class CommandRoutingContractTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("command-routing-");
        try {
            Path dir = Files.createDirectories(root.resolve("commands"));
            for (String name : List.of("tnt.v2.txt", "plain.txt", "game_saikutu_x.y.txt", "UPPER.TXT", "_op.txt", "...txt", "..txt",
                "game_saikutu_dup.txt", "game_umetate_dup.txt", "game_saikutu_d.v.txt", "game_run_d.v.txt")) write(dir.resolve(name));

            // 受け付け（fromJson）とファイルを探す所は、.txt を除いてから同じ決まりで確かめる。.txt だけの名前は受け付けない（PR1 の最終レビュー）。
            for (String key : List.of("neko", "a.txt", "tnt.v2", "TNT.TXT", "..")) check(CommandRouting.isCommandKey(key), "accepted: " + key);
            for (String key : List.of(".txt", ".TXT", "", "a b.txt", "a/b", "ネコ")) check(!CommandRouting.isCommandKey(key), "rejected: " + key);

            // .. と . もふつうの名前として、フォルダーの直下の ...txt・..txt を指す（外は指さない）。
            same(dir.resolve("...txt"), CommandRouting.resolve(dir, ".."), "dots only name");
            same(dir.resolve("..txt"), CommandRouting.resolve(dir, "."), "single dot name");
            write(root.resolve("outside.txt"));

            same(dir.resolve("tnt.v2.txt"), CommandRouting.resolve(dir, "tnt.v2"), "dotted name");
            same(dir.resolve("tnt.v2.txt"), CommandRouting.resolve(dir, "tnt.v2.txt"), "dotted name with .txt");
            same(dir.resolve("plain.txt"), CommandRouting.resolve(dir, "plain"), "plain name");
            same(dir.resolve("game_saikutu_x.y.txt"), CommandRouting.resolve(dir, "x.y"), "dotted game command");
            for (String key : List.of("../outside", "..", ".", "a..b", "a/b", "a\\b", "a b", "")) {
                Path found = CommandRouting.resolve(dir, key);
                check(found == null || dir.toAbsolutePath().normalize().equals(found.toAbsolutePath().normalize().getParent()),
                    "stays inside the commands folder: " + key);
            }
            same(null, CommandRouting.resolve(dir, "../outside"), "path outside is rejected");
            for (String key : List.of("dup", "d.v")) {
                try {
                    CommandRouting.resolve(dir, key);
                    check(false, "duplicate game command should throw: " + key);
                } catch (IllegalArgumentException expected) {
                    check(expected.getMessage().contains("複数ゲームに同じコマンドがあります"), "duplicate message: " + key);
                }
            }
            List<String> keys = CommandRouting.keys(dir);
            check(keys.contains("UPPER"), "upper-case .TXT is listed: " + keys);
            check(keys.contains("tnt.v2") && keys.contains("x.y"), "dotted names are listed: " + keys);
            check(!keys.contains("_op"), "underscore files are hidden: " + keys);
        } finally {
            try (Stream<Path> walk = Files.walk(root)) {
                walk.sorted(Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
            }
        }
        System.out.println("CommandRoutingContractTest: " + checks + " checks passed");
    }

    private static void write(Path file) throws Exception {
        Files.writeString(file, "say test\n", StandardCharsets.UTF_8);
    }

    private static void same(Object expected, Object actual, String name) {
        check(expected == null ? actual == null : expected.equals(actual), name + ": expected " + expected + " but was " + actual);
    }

    private static void check(boolean ok, String message) {
        checks++;
        if (!ok) throw new AssertionError(message);
    }
}
