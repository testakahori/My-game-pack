package jp.douma.bridgemod;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;

// BridgeMOD の受付が「このPCの Bridge とアプリ」以外を拒否することを、Minecraft なしで確かめる。
public final class BridgeAuthContractTest {
    private static int checks;

    public static void main(String[] args) throws Exception {
        String token = BridgeAuth.newToken();
        BridgeAuth auth = new BridgeAuth(token);
        int port = 25576;

        // 正しい要求（Bridge・アプリと同じ形）は通る。
        same(BridgeAuth.ALLOWED, auth.checkHttp("GET", port, headers("Host", "127.0.0.1:25576", "X-Bridge-Token", token)), "status with token");
        same(BridgeAuth.ALLOWED, auth.checkHttp("POST", port, headers("Host", "localhost:25576", "X-Bridge-Token", token,
            "Content-Type", "application/json; charset=utf-8")), "event with token");

        // 完了条件：トークンなし・Origin あり・text/plain の要求は 403。
        same(403, auth.checkHttp("POST", port, headers("Host", "127.0.0.1:25576", "Content-Type", "application/json")), "missing token");
        same(403, auth.checkHttp("POST", port, headers("Host", "127.0.0.1:25576", "X-Bridge-Token", token,
            "Origin", "https://example.com", "Content-Type", "application/json")), "browser origin with token");
        same(403, auth.checkHttp("POST", port, headers("Host", "127.0.0.1:25576", "Origin", "null", "Content-Type", "text/plain")), "browser text/plain");
        same(403, auth.checkHttp("POST", port, headers("Host", "127.0.0.1:25576", "X-Bridge-Token", token + "0",
            "Content-Type", "application/json")), "wrong token");
        // DNS リバインディング：名前はブラウザーのページのまま、宛先だけ 127.0.0.1。
        same(403, auth.checkHttp("GET", port, headers("Host", "evil.example:25576", "X-Bridge-Token", token)), "rebound host");
        same(403, auth.checkHttp("GET", port, headers("Host", "127.0.0.1:25577", "X-Bridge-Token", token)), "other port");
        same(403, auth.checkHttp("GET", port, headers("X-Bridge-Token", token)), "missing host");
        // トークンを持つ相手でも、本文は JSON に限る。
        same(415, auth.checkHttp("POST", port, headers("Host", "127.0.0.1:25576", "X-Bridge-Token", token, "Content-Type", "text/plain")), "text body");
        same(415, auth.checkHttp("POST", port, headers("Host", "127.0.0.1:25576", "X-Bridge-Token", token)), "missing body type");

        // WebSocket：ブラウザーの接続とトークンなしは拒否。Bridge は ?token= で接続する。
        int ws = port + 1;
        truth(auth.checkWebSocket("GET /?token=" + token + " HTTP/1.1", ws, headers("Host", "127.0.0.1:25577")), "ws query token");
        truth(auth.checkWebSocket("GET / HTTP/1.1", ws, headers("Host", "127.0.0.1:25577", "X-Bridge-Token", token)), "ws header token");
        truth(!auth.checkWebSocket("GET / HTTP/1.1", ws, headers("Host", "127.0.0.1:25577")), "ws without token");
        truth(!auth.checkWebSocket("GET /?token=" + token + " HTTP/1.1", ws, headers("Host", "127.0.0.1:25577", "Origin", "https://example.com")), "ws from browser");
        truth(!auth.checkWebSocket("GET /?token=" + token + " HTTP/1.1", ws, headers("Host", "evil.example:25577")), "ws rebound host");
        truth(!auth.checkWebSocket(null, ws, headers("Host", "127.0.0.1:25577")), "ws without request line");

        // トークンは毎回別の値で、サーバーフォルダーの config/ に置き換えで書く。
        truth(token.matches("[0-9a-f]{64}") && !token.equals(BridgeAuth.newToken()), "random token");
        Path dir = Path.of(args[0]);
        Path file = BridgeAuth.tokenPath(dir);
        same(dir.resolve("config").resolve("bridgemod-token.txt"), file, "token path");
        BridgeAuth.writeToken(file, "first");
        BridgeAuth.writeToken(file, token);
        same(token, Files.readString(file, StandardCharsets.UTF_8), "token file replaced");
        truth(!Files.exists(file.resolveSibling(BridgeAuth.TOKEN_FILE + ".tmp")), "no temporary file left");
        System.out.println("BridgeAuth contract: " + checks + " checks passed");
    }

    private static Function<String, String> headers(String... pairs) {
        Map<String, String> map = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put(pairs[i].toLowerCase(Locale.ROOT), pairs[i + 1]);
        return name -> map.get(name.toLowerCase(Locale.ROOT));
    }

    private static void same(Object expected, Object actual, String label) {
        checks++;
        if (!expected.equals(actual)) throw new AssertionError(label + ": expected " + expected + " but was " + actual);
    }

    private static void truth(boolean value, String label) {
        checks++;
        if (!value) throw new AssertionError(label);
    }
}
