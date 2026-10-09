package jp.douma.bridgemod;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Locale;
import java.util.function.Function;

/**
 * BridgeMOD の HTTP と WebSocket を、このPCの Bridge とアプリからの要求だけに限る。
 * <ul>
 *   <li>Origin ヘッダーがある要求はブラウザーからのもの。配信中に開いたページから権限4のコマンドを
 *       実行させないよう拒否する（Node の http・fetch・WebSocket は Origin を付けない）。</li>
 *   <li>Host が 127.0.0.1 / localhost とポート以外なら拒否する（DNS リバインディング対策）。</li>
 *   <li>X-Bridge-Token ヘッダー（WebSocket は ?token=）が、サーバー起動ごとに作って
 *       サーバーフォルダーの config/bridgemod-token.txt に書いた乱数と一致すること。</li>
 *   <li>POST の本文は application/json に限る（フォームや text/plain の要求を通さない）。</li>
 * </ul>
 * Minecraft に依存しない純粋な Java にしてある。scripts/test-bridge-auth.cjs で単体検証する。
 */
public final class BridgeAuth {
    public static final String HEADER = "X-Bridge-Token";
    public static final String TOKEN_FILE = "bridgemod-token.txt";
    public static final int ALLOWED = 0;

    private final byte[] token;

    public BridgeAuth(String token) {
        if (token == null || token.isBlank()) throw new IllegalArgumentException("token is required");
        this.token = token.trim().getBytes(StandardCharsets.UTF_8);
    }

    public static String newToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    public static Path tokenPath(Path serverDir) {
        return serverDir.resolve("config").resolve(TOKEN_FILE);
    }

    /**
     * 一時ファイルから置き換え、読み手が書きかけのトークンを読まないようにする。
     * 置き換えはウイルス対策ソフトや OneDrive が一瞬つかんでいると失敗するので数回やり直し、
     * それでも駄目なら直接書く（書けないままだと受付が閉じたままになり、ギフトが届かない）。
     */
    public static void writeToken(Path file, String token) throws IOException {
        Files.createDirectories(file.getParent());
        Path temp = file.resolveSibling(TOKEN_FILE + ".tmp");
        IOException last = null;
        for (int attempt = 0; attempt < 5; attempt++) {
            try {
                Files.writeString(temp, token, StandardCharsets.UTF_8);
                try {
                    Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException e) {
                    Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
                }
                return;
            } catch (IOException e) {
                last = e;
                try { Thread.sleep(100L * (attempt + 1)); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); break; }
            }
        }
        try {
            Files.writeString(file, token, StandardCharsets.UTF_8);
        } catch (IOException e) {
            if (last != null) e.addSuppressed(last);
            throw e;
        }
        // 残った一時ファイルの掃除。つかまれたままで消せなくてもトークンは書けているので、受付を閉じない。
        try { Files.deleteIfExists(temp); } catch (IOException ignored) {}
    }

    /**
     * @param header 要求ヘッダーの最初の値を大文字小文字を区別せずに返す関数（なければ null）
     * @return ALLOWED、または返すべき HTTP ステータス（403 拒否 / 415 本文の形式違い）
     */
    public int checkHttp(String method, int port, Function<String, String> header) {
        if (!fromLocalClient(port, header) || !tokenMatches(header.apply(HEADER))) return 403;
        if ("POST".equalsIgnoreCase(method)) {
            String type = header.apply("Content-Type");
            if (type == null || !type.trim().toLowerCase(Locale.ROOT).startsWith("application/json")) return 415;
        }
        return ALLOWED;
    }

    /** @param requestLine ハンドシェイクの1行目（例: "GET /?token=... HTTP/1.1"） */
    public boolean checkWebSocket(String requestLine, int port, Function<String, String> header) {
        if (!fromLocalClient(port, header)) return false;
        return tokenMatches(queryToken(requestLine)) || tokenMatches(header.apply(HEADER));
    }

    private static boolean fromLocalClient(int port, Function<String, String> header) {
        if (header.apply("Origin") != null) return false;
        String host = header.apply("Host");
        if (host == null) return false;
        String value = host.trim().toLowerCase(Locale.ROOT);
        return value.equals("127.0.0.1:" + port) || value.equals("localhost:" + port);
    }

    private boolean tokenMatches(String candidate) {
        if (candidate == null) return false;
        // 比較時間で「どこまで合っていたか」が分からないよう、一定時間で比べる。
        return MessageDigest.isEqual(candidate.trim().getBytes(StandardCharsets.UTF_8), token);
    }

    static String queryToken(String requestLine) {
        if (requestLine == null) return null;
        String[] parts = requestLine.trim().split(" ");
        if (parts.length < 2) return null;
        int query = parts[1].indexOf('?');
        if (query < 0) return null;
        for (String pair : parts[1].substring(query + 1).split("&")) {
            if (pair.startsWith("token=")) return pair.substring("token=".length());
        }
        return null;
    }
}
