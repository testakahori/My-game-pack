package jp.douma.bridgemod;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

// /bridge/event を本物の HttpServer で受け、BRIDGE と同じ形の要求を送って答えを確かめる（2026-11-07 品質レビュー）。
class BridgeHttpTest {
    private static final String TOKEN = "test-token";

    private static final class Item extends EventQueues.Event {
        Item(String type, int count) { super(type, count); }
    }

    private final EventQueues<Item> queues = new EventQueues<>();
    // プロキシの設定がある PC でも、127.0.0.1 へ直接つなぐ。
    private final HttpClient client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
        .proxy(HttpClient.Builder.NO_PROXY).connectTimeout(Duration.ofSeconds(5)).build();
    private HttpServer server;
    private int port;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        port = server.getAddress().getPort();
        BridgeAuth auth = new BridgeAuth(TOKEN);
        // 本文の読み方だけテスト用（BridgeMod では BridgeEvent.fromJson）。読めなければ null で 400。
        server.createContext("/bridge/event", BridgeHttp.events(() -> auth, port, body -> {
            try {
                JsonObject data = JsonParser.parseString(body).getAsJsonObject();
                Item item = new Item(data.get("type").getAsString(), data.has("count") ? data.get("count").getAsInt() : 1);
                if (data.has("requestId")) item.requestId = data.get("requestId").getAsString();
                return item;
            } catch (RuntimeException error) {
                return null;
            }
        }, queues));
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private HttpResponse<String> post(String json, String token) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/bridge/event"))
            .timeout(Duration.ofSeconds(5))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json));
        if (token != null) request.header(BridgeAuth.HEADER, token);
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static JsonObject json(HttpResponse<String> response) {
        return JsonParser.parseString(response.body()).getAsJsonObject();
    }

    @Test
    void anAcceptedEventIs202AndQueued() throws Exception {
        HttpResponse<String> response = post("{\"type\":\"gift\",\"key\":\"zombie\",\"count\":3,\"requestId\":\"a1:0\"}", TOKEN);
        assertEquals(202, response.statusCode(), response.body());
        assertTrue(json(response).get("queued").getAsBoolean());
        assertFalse(json(response).has("duplicate"));
        assertEquals(new EventQueues.Sizes(1, 0, 0), queues.sizes());
    }

    @Test
    void theSameRequestIdSentAgainIs202DuplicateAndNotQueuedTwice() throws Exception {
        String body = "{\"type\":\"gift\",\"key\":\"zombie\",\"count\":1,\"requestId\":\"retry:0\"}";
        assertEquals(202, post(body, TOKEN).statusCode());
        // BRIDGE が 1.5 秒で諦めて送り直した分。BRIDGE は 2xx を届いたとみなして次へ進む（bridge/index.js の sendBridgeModEvent）。
        HttpResponse<String> retry = post(body, TOKEN);
        assertEquals(202, retry.statusCode(), retry.body());
        assertTrue(json(retry).get("duplicate").getAsBoolean());
        assertTrue(json(retry).get("ok").getAsBoolean());
        assertEquals(new EventQueues.Sizes(1, 0, 0), queues.sizes(), "待ちには1件だけ");
    }

    @Test
    void aWrongOrMissingTokenIsRejectedWith403AndNothingIsQueued() throws Exception {
        // トークン違いは 403（BRIDGE とアプリは 403 を「トークンを読み直して送り直す」と決めている。bridge/mod_event_delivery.cjs）。
        HttpResponse<String> wrong = post("{\"type\":\"gift\",\"key\":\"zombie\"}", "wrong-token");
        assertEquals(403, wrong.statusCode());
        assertEquals("forbidden", json(wrong).get("error").getAsString());
        assertEquals(403, post("{\"type\":\"gift\",\"key\":\"zombie\"}", null).statusCode());
        assertEquals(new EventQueues.Sizes(0, 0, 0), queues.sizes());
    }

    @Test
    void aFullLikeQueueAnswers429ButARetryOfAnAcceptedLikeIsStillADuplicate() throws Exception {
        for (int i = 0; i < EventQueues.MAX_LIKE_QUEUE; i++) {
            assertEquals(202, post("{\"type\":\"like\",\"key\":\"cod\",\"requestId\":\"like-" + i + "\"}", TOKEN).statusCode());
        }
        HttpResponse<String> full = post("{\"type\":\"like\",\"key\":\"cod\",\"requestId\":\"like-new\"}", TOKEN);
        assertEquals(429, full.statusCode());
        assertEquals("queue_full", json(full).get("error").getAsString());
        HttpResponse<String> retry = post("{\"type\":\"like\",\"key\":\"cod\",\"requestId\":\"like-0\"}", TOKEN);
        assertEquals(202, retry.statusCode(), "受け付け済みの送り直しを 429 にしない");
        assertTrue(json(retry).get("duplicate").getAsBoolean());
        // いいねがいっぱいでも、ギフトは受ける。
        assertEquals(202, post("{\"type\":\"gift\",\"key\":\"zombie\",\"requestId\":\"gift-0\"}", TOKEN).statusCode());
        assertEquals(new EventQueues.Sizes(1, 120, 0), queues.sizes());
    }

    @Test
    void badBodiesAndMethodsAreRejected() throws Exception {
        assertEquals(400, post("not json", TOKEN).statusCode());
        HttpRequest get = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/bridge/event"))
            .timeout(Duration.ofSeconds(5)).header(BridgeAuth.HEADER, TOKEN).GET().build();
        assertEquals(405, client.send(get, HttpResponse.BodyHandlers.ofString()).statusCode());
        HttpRequest text = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/bridge/event"))
            .timeout(Duration.ofSeconds(5)).header(BridgeAuth.HEADER, TOKEN).header("Content-Type", "text/plain")
            .POST(HttpRequest.BodyPublishers.ofString("{\"type\":\"gift\"}")).build();
        assertEquals(415, client.send(text, HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(new EventQueues.Sizes(0, 0, 0), queues.sizes());
    }
}
