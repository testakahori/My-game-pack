package jp.douma.bridgemod;

import java.nio.file.*;
import java.io.IOException;
import java.util.*;

/** Active game files are installed transactionally by the app. Keep their private filenames out of chat. */
final class CommandRouting {
    private CommandRouting() {}
    static String publicKey(String filename) {
        return filename.replaceFirst("(?i)\\.txt$", "").replaceFirst("^game_(?:saikutu|umetate|run)_", "");
    }
    /**
     * 開発版のアプリ（パッケージ前）が渡すコマンドの置き場所（環境変数 BRIDGE_MOD_COMMANDS_DIR）。
     * 開発版は BRIDGE とゲームの切替がリポジトリの bridge を使うので、BridgeMOD にも同じ場所を読ませる。
     * 空・実在しないフォルダー・不正なパスなら null（インストール版は渡さないので、今までどおりサーバーフォルダーを読む）。
     */
    static Path overrideDir(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            Path dir = Path.of(raw.trim()).toAbsolutePath().normalize();
            return Files.isDirectory(dir) ? dir : null;
        } catch (InvalidPathException e) {
            return null;
        }
    }
    /**
     * コマンドの名前（.txt を除いた部分）の決まり。Bridge・アプリ（bridge/command_files.cjs の BRIDGE_COMMAND_KEY）と、
     * 受け付け（BridgeEvent.fromJson）とファイルを探す所（resolve）で同じものを使う。前は resolve だけが . を許さず、
     * tnt.v2.txt のような名前を受け付けたあとで「file not found」として捨てていた（2026-10-18）。/ と \ は含まないのでフォルダーの外は指せない。
     */
    static final String KEY = "[A-Za-z0-9_.-]{1,200}";
    static boolean isKey(String stem) {
        return stem != null && stem.matches(KEY);
    }
    static Path resolve(Path directory, String key) {
        String stem = key.replaceFirst("(?i)\\.txt$", "");
        if (!isKey(stem)) return null;
        Path base = directory.toAbsolutePath().normalize();
        List<Path> matches = new ArrayList<>();
        for (String game : List.of("saikutu", "umetate", "run")) {
            Path candidate = base.resolve("game_" + game + "_" + stem + ".txt");
            if (inside(base, candidate) && Files.isRegularFile(candidate)) matches.add(candidate);
        }
        if (matches.size() > 1) throw new IllegalArgumentException("複数ゲームに同じコマンドがあります。アプリでゲームを選び直してください: " + stem);
        if (!matches.isEmpty()) return matches.get(0);
        Path direct = base.resolve(stem + ".txt");
        return inside(base, direct) && Files.isRegularFile(direct) ? direct : null;
    }
    // 名前の決まりで外は指せないが、念のため見つけたファイルがコマンドのフォルダーの直下にあることも確かめる。
    private static boolean inside(Path base, Path file) {
        return base.equals(file.toAbsolutePath().normalize().getParent());
    }
    static List<String> keys(Path directory) {
        try (var files = Files.list(directory)) {
            // .txt は大文字小文字を問わない（UPPER.TXT もチャット候補に出す。Bridge・アプリと同じ。2026-10-18）。
            return files.filter(Files::isRegularFile).map(p -> p.getFileName().toString())
                .filter(n -> n.toLowerCase(Locale.ROOT).endsWith(".txt") && !n.startsWith("_")).map(CommandRouting::publicKey).distinct().sorted().toList();
        } catch (IOException e) { return List.of(); }
    }
}
