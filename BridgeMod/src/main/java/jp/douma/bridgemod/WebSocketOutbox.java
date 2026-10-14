package jp.douma.bridgemod;

import java.io.IOException;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;

/**
 * WebSocket の1つの接続へ送る（送信専用。BridgeMOD から Bridge へ状態と死亡通知を送る）。
 * サーバーの tick は送信待ちに積むだけで、送るのはこの接続専用のスレッド（アプリレビュー 2026-10-08 P5）。
 * 以前は tick の中で直接送っていたので、相手が読まなくなると tick が止まり、専用サーバーは watchdog で落ちた。
 */
final class WebSocketOutbox {
    /** 送信待ちの上限。状態は1秒に1回なので、4分ほど読まれなければ、その接続を切る（Bridge はつなぎ直す）。 */
    static final int MAX_PENDING = 256;
    private final Socket socket;
    private final BlockingQueue<byte[]> pending = new ArrayBlockingQueue<>(MAX_PENDING);
    private final Thread writer;

    WebSocketOutbox(Socket socket) {
        this.socket = socket;
        writer = new Thread(this::writeLoop, "BridgeMod-WebSocketSend");
        writer.setDaemon(true);
        writer.start();
    }

    /** 送信待ちに積むだけで、送り終わるのを待たない。相手が読まずに送信待ちがあふれたら、接続を閉じて false を返す。 */
    boolean offer(String text) {
        if (isClosed()) return false;
        if (pending.offer(frame(text))) return true;
        close();
        return false;
    }

    boolean isClosed() {
        return socket.isClosed();
    }

    void close() {
        try { socket.close(); } catch (IOException ignored) {}
        writer.interrupt();
    }

    private void writeLoop() {
        try {
            OutputStream out = socket.getOutputStream();
            while (!socket.isClosed()) {
                byte[] frame = pending.take();
                out.write(frame);
                out.flush();
            }
        } catch (IOException | InterruptedException ignored) {
        } finally {
            close();
        }
    }

    /** サーバーからクライアントへのテキストフレーム（マスクなし）。長さは 125 まで1バイト、65,535 まで2バイト、それより長ければ8バイト。 */
    static byte[] frame(String text) {
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        int length = payload.length;
        int header = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
        byte[] frame = new byte[header + length];
        frame[0] = (byte) 0x81;
        if (length < 126) {
            frame[1] = (byte) length;
        } else if (length <= 0xffff) {
            frame[1] = 126;
            frame[2] = (byte) (length >> 8);
            frame[3] = (byte) length;
        } else {
            frame[1] = 127;
            for (int i = 0; i < 8; i++) frame[2 + i] = (byte) ((long) length >> (56 - 8 * i));
        }
        System.arraycopy(payload, 0, frame, header, length);
        return frame;
    }
}
