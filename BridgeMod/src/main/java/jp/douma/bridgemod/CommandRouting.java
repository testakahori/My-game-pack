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
    static Path resolve(Path directory, String key) {
        String stem = key.replaceFirst("(?i)\\.txt$", "");
        if (!stem.matches("[A-Za-z0-9_-]+")) return null;
        Path base = directory.toAbsolutePath().normalize();
        List<Path> matches = new ArrayList<>();
        for (String game : List.of("saikutu", "umetate", "run")) {
            Path candidate = base.resolve("game_" + game + "_" + stem + ".txt");
            if (Files.isRegularFile(candidate)) matches.add(candidate);
        }
        if (matches.size() > 1) throw new IllegalArgumentException("複数ゲームに同じコマンドがあります。アプリでゲームを選び直してください: " + stem);
        if (!matches.isEmpty()) return matches.get(0);
        Path direct = base.resolve(stem + ".txt");
        return Files.isRegularFile(direct) ? direct : null;
    }
    static List<String> keys(Path directory) {
        try (var files = Files.list(directory)) {
            return files.filter(Files::isRegularFile).map(p -> p.getFileName().toString())
                .filter(n -> n.endsWith(".txt") && !n.startsWith("_")).map(CommandRouting::publicKey).distinct().sorted().toList();
        } catch (IOException e) { return List.of(); }
    }
}
