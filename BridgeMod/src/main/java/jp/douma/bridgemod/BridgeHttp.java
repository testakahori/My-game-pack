package jp.douma.bridgemod;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * BridgeMOD の HTTP の受付のうち、Minecraft に頼らない部分（2026-11-07 品質レビュー）。
 * /bridge/event はここで受け、本物の HttpServer に POST する JUnit（BridgeHttpTest）で確かめる。
 */
final class BridgeHttp {
    static final int MAX_BODY_BYTES = 8192;

    private BridgeHttp() {}

    /** 通すなら true。断った要求には 403（ブラウザー・別ホスト・トークン違い・トークンをまだ書けていない）か 415 を返す。 */
    static boolean authorize(HttpExchange exchange, BridgeAuth auth, int port) throws IOException {
        int status = auth == null ? 403
            : auth.checkHttp(exchange.getRequestMethod(), port, name -> exchange.getRequestHeaders().getFirst(name));
        if (status == BridgeAuth.ALLOWED) return true;
        send(exchange, status, status == 415 ? "{\"ok\":false,\"error\":\"json_required\"}" : "{\"ok\":false,\"error\":\"forbidden\"}");
        return false;
    }

    /**
     * /bridge/event。積めたら 202。待ちがいっぱいなら 429（BRIDGE が先頭を預かって送り直す）。
     * 受け付け済みの要求 ID の送り直しは、積まずに 202 と "duplicate":true を返す（BRIDGE は 2xx を届いたとみなして次へ進む）。
     *
     * @param parse 本文を読む。読めない・形が違うときは null（400）
     */
    static <E extends EventQueues.Event> HttpHandler events(Supplier<BridgeAuth> auth, int port,
                                                            Function<String, E> parse, EventQueues<E> queues) {
        return exchange -> {
            if (!authorize(exchange, auth.get(), port)) return;
            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                send(exchange, 405, "{\"ok\":false,\"error\":\"method_not_allowed\"}");
                return;
            }
            if (!"/bridge/event".equals(exchange.getRequestURI().getPath())) {
                send(exchange, 404, "{\"ok\":false,\"error\":\"not_found\"}");
                return;
            }
            E event = parse.apply(readBody(exchange));
            if (event == null) {
                send(exchange, 400, "{\"ok\":false,\"error\":\"bad_request\"}");
                return;
            }
            switch (queues.offer(event)) {
                case FULL -> send(exchange, 429, "{\"ok\":false,\"error\":\"queue_full\"}");
                case DUPLICATE -> send(exchange, 202, "{\"ok\":true,\"duplicate\":true}");
                case ACCEPTED -> send(exchange, 202, "{\"ok\":true,\"queued\":true}");
            }
        };
    }

    /** 本文を MAX_BODY_BYTES まで読む。超えたら空（読む側が 400 にする）。 */
    static String readBody(HttpExchange exchange) throws IOException {
        InputStream in = exchange.getRequestBody();
        byte[] buf = in.readNBytes(MAX_BODY_BYTES + 1);
        if (buf.length > MAX_BODY_BYTES) return "";
        return new String(buf, StandardCharsets.UTF_8);
    }

    static void send(HttpExchange exchange, int status, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
