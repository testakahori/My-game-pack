package jp.douma.bridgemod;

import org.junit.jupiter.api.Test;

import java.io.DataInputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

// アプリレビュー（2026-10-08）P5：WebSocket の送信がサーバーの tick を止めない。
class WebSocketOutboxTest {
    // 相手（Bridge）が読まなくなっても、送る側（サーバーの tick）は待たされない。送信待ちがあふれたら、その接続を閉じる。
    @Test
    void offerNeverBlocksWhenThePeerStopsReading() throws Exception {
        InetAddress loopback = InetAddress.getLoopbackAddress();
        try (ServerSocket server = new ServerSocket(0, 1, loopback);
             Socket peer = new Socket(loopback, server.getLocalPort());
             Socket accepted = server.accept()) {
            WebSocketOutbox outbox = new WebSocketOutbox(accepted);
            String message = "x".repeat(60_000);
            assertTimeoutPreemptively(Duration.ofSeconds(10), () -> {
                for (int i = 0; i < 2_000 && !outbox.isClosed(); i++) outbox.offer(message);
            }, "the server thread must not wait for a client that stopped reading");
            assertTrue(outbox.isClosed(), "a client that stopped reading is dropped (Bridge reconnects)");
            assertFalse(peer.isClosed());
        }
    }

    // 65,535 バイトを超えるメッセージは、長さを 8 バイトで書く（レビューの「低」：以前は長さが壊れていた）。
    @Test
    void framesLongerThan65535BytesUseTheSixtyFourBitLength() {
        byte[] frame = WebSocketOutbox.frame("あ".repeat(30_000));
        assertEquals((byte) 0x81, frame[0]);
        assertEquals(127, frame[1]);
        long length = 0;
        for (int i = 2; i < 10; i++) length = (length << 8) | (frame[i] & 0xff);
        assertEquals(90_000, length);
        assertEquals(10 + 90_000, frame.length);
    }

    @Test
    void sendsMessagesInOrderToAReadingPeer() throws Exception {
        InetAddress loopback = InetAddress.getLoopbackAddress();
        try (ServerSocket server = new ServerSocket(0, 1, loopback);
             Socket peer = new Socket(loopback, server.getLocalPort());
             Socket accepted = server.accept()) {
            WebSocketOutbox outbox = new WebSocketOutbox(accepted);
            String large = "c".repeat(70_000);
            assertTrue(outbox.offer("a"));
            assertTrue(outbox.offer("b".repeat(300)));
            assertTrue(outbox.offer(large));
            peer.setSoTimeout(5000);
            DataInputStream in = new DataInputStream(peer.getInputStream());
            assertEquals("a", readText(in));
            assertEquals("b".repeat(300), readText(in));
            assertEquals(large, readText(in));
            outbox.close();
            assertTrue(outbox.isClosed());
        }
    }

    private static String readText(DataInputStream in) throws IOException {
        assertEquals(0x81, in.readUnsignedByte());
        int second = in.readUnsignedByte();
        long length = second == 126 ? in.readUnsignedShort() : second == 127 ? in.readLong() : second;
        byte[] payload = new byte[(int) length];
        in.readFully(payload);
        return new String(payload, StandardCharsets.UTF_8);
    }
}
