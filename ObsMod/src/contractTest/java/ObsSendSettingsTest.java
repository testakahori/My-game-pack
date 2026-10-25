import java.net.ServerSocket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import jp.streamtorearn.obsmodule.config.ObsSendSettings;
import jp.streamtorearn.obsmodule.http.ObsControllerClient;

// OBS ツールへ送るかの設定（MyGamePack が書く config/minecraft_obs_bridge/obs-send.properties）と、オフのときに送らないこと（2026-10-25）。
// scripts/test-soutenmon-contracts.cjs から、Forge なしで動かす（ObsBridgeMod と slf4j は src/contractTest/stubs の写し）。
public class ObsSendSettingsTest {
    private static final String FALLBACK = "http://127.0.0.1:3000/event";

    private static void expect(Object actual, Object expected, String label) {
        if (!actual.equals(expected)) throw new AssertionError(label + " expected=" + expected + " actual=" + actual);
        System.out.println("PASS " + label);
    }

    private static ObsSendSettings read(Path dir, String text) throws Exception {
        Path file = dir.resolve(ObsSendSettings.FILE_NAME);
        if (text == null) Files.deleteIfExists(file); else Files.writeString(file, text, StandardCharsets.UTF_8);
        return ObsSendSettings.read(file, FALLBACK);
    }

    // 待ち受けて、つないでくるかを見る。
    private static boolean connects(ServerSocket server, int timeoutMs) throws Exception {
        server.setSoTimeout(timeoutMs);
        try (var socket = server.accept()) { return true; } catch (SocketTimeoutException e) { return false; }
    }

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("obs-send-");
        try {
            expect(read(dir, null), new ObsSendSettings(false, FALLBACK), "ファイルが無ければ送らない");
            expect(read(dir, "enabled=true\nendpoint=http://192.168.0.5:3000/event\n"), new ObsSendSettings(true, "http://192.168.0.5:3000/event"), "オンで送り先あり");
            expect(read(dir, "enabled=false\nendpoint=http://192.168.0.5:3000/event\n"), new ObsSendSettings(false, "http://192.168.0.5:3000/event"), "オフ");
            expect(read(dir, "enabled=yes\n"), new ObsSendSettings(false, FALLBACK), "true のほかはオフ");
            expect(read(dir, "enabled=true\nendpoint=ftp://192.168.0.5/event\n"), new ObsSendSettings(true, FALLBACK), "http・https でない送り先は使わない");
            expect(read(dir, "enabled=true\nendpoint=\n"), new ObsSendSettings(true, FALLBACK), "送り先が空なら OBSMOD の設定の送り先");
            expect(read(dir, "enabled=true\nendpoint=https://obs.example/event\n").endpoint(), "https://obs.example/event", "https も使う");
            // 大文字の HTTP:// も使う（Java の HttpClient も受け付ける）。ユーザー名・パスワード入りの送り先は、ログに出るので使わない（最後のレビュー 軽い1・3）。
            expect(read(dir, "enabled=true\nendpoint=HTTP://192.168.0.5:3000/event\n").endpoint(), "HTTP://192.168.0.5:3000/event", "大文字の HTTP も使う");
            expect(read(dir, "enabled=true\nendpoint=http://user:pw@127.0.0.1:3000/event\n").endpoint(), FALLBACK, "ユーザー名・パスワード入りの送り先は使わない");
            Files.createDirectories(dir.resolve("broken")); Files.writeString(dir.resolve("broken").resolve("x"), "x");
            expect(ObsSendSettings.read(dir.resolve("broken"), FALLBACK), new ObsSendSettings(false, FALLBACK), "読めなければ送らない");
            // メモ帳などで BOM 付きで保存しても読む（最後のレビュー 重要2）。
            expect(read(dir, "﻿enabled=true\nendpoint=http://192.168.0.5:3000/event\n"), new ObsSendSettings(true, "http://192.168.0.5:3000/event"), "BOM 付きでも読む");

            // ファイルはあるのにオンにならない・送り先を使わないときは、理由を警告に出す（ファイルが無いだけなら出さない）。
            var warnings = new java.util.ArrayList<String>();
            Path file = dir.resolve(ObsSendSettings.FILE_NAME);
            Files.deleteIfExists(file);
            ObsSendSettings.read(file, FALLBACK, warnings::add);
            expect(warnings.size(), 0, "ファイルが無いだけなら警告しない");
            Files.writeString(file, "enabled=yes\nendpoint=ftp://x/event\n", StandardCharsets.UTF_8);
            ObsSendSettings.read(file, FALLBACK, warnings::add);
            expect(warnings.size(), 2, "enabled と送り先の誤りを警告する");
            expect(warnings.get(0).contains("enabled") && warnings.get(1).contains("endpoint"), true, "どの項目かを書く");
            warnings.clear();
            ObsSendSettings.read(dir.resolve("broken"), FALLBACK, warnings::add);
            expect(warnings.size(), 1, "読めないときも警告する");
            warnings.clear();
            Files.writeString(file, "enabled=true\nendpoint=http://user:secret-pw@127.0.0.1:3000/event\n", StandardCharsets.UTF_8);
            ObsSendSettings.read(file, FALLBACK, warnings::add);
            expect(warnings.size() == 1 && !warnings.get(0).contains("secret-pw"), true, "警告にパスワードを書かない");

            // 先にオンで送れることを確かめて通信の仕組みを温め、そのあと別のポートで「オフなら、つないでこない」を確かめる
            // （同じポートだと、遅い PC ではオフのときの接続をオンの確かめが受け取り、間違って通りうる。最後のレビュー 軽い4）。
            var client = new ObsControllerClient();
            expect(client.enabled(), false, "はじめはオフ");
            try (var on = new ServerSocket(0)) {
                client.setEndpoint("http://127.0.0.1:" + on.getLocalPort() + "/event");
                client.setEnabled(true);
                client.postAsync("{}");
                expect(connects(on, 5000), true, "オンなら送る");
            }
            try (var off = new ServerSocket(0)) {
                client.setEnabled(false);
                client.setEndpoint("http://127.0.0.1:" + off.getLocalPort() + "/event");
                client.postAsync("{}");
                client.healthAsync();
                expect(connects(off, 1500), false, "オフなら送らず、確かめもしない");
            }
        } finally {
            try (var walk = Files.walk(dir)) { walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete()); }
        }
    }
}
