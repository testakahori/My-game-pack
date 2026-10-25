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
            Files.createDirectories(dir.resolve("broken")); Files.writeString(dir.resolve("broken").resolve("x"), "x");
            expect(ObsSendSettings.read(dir.resolve("broken"), FALLBACK), new ObsSendSettings(false, FALLBACK), "読めなければ送らない");

            try (var server = new ServerSocket(0)) {
                var client = new ObsControllerClient();
                client.setEndpoint("http://127.0.0.1:" + server.getLocalPort() + "/event");
                expect(client.enabled(), false, "はじめはオフ");
                client.postAsync("{}");
                client.healthAsync();
                expect(connects(server, 800), false, "オフなら送らず、確かめもしない");
                client.setEnabled(true);
                client.postAsync("{}");
                expect(connects(server, 5000), true, "オンなら送る");
            }
        } finally {
            try (var walk = Files.walk(dir)) { walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete()); }
        }
    }
}
