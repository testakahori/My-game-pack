package jp.streamtorearn.obsmodule.config;

import java.io.Reader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * OBS ツールへ送るかの設定。MyGamePack（アプリ）がサーバーの config/minecraft_obs_bridge/obs-send.properties に書く。
 * ファイルが無い・読めない・enabled が true でないときは送らない（アプリに同梱した OBSMOD の既定。2026-10-25 ユーザーの決定）。
 * 送り先は http・https のときだけ使い、それ以外は OBSMOD の設定（events.generated.json の controller.endpoint）の送り先を使う。
 * Forge を使わない（scripts/test-soutenmon-contracts.cjs の ObsSendSettingsTest で確かめる）。
 */
public record ObsSendSettings(boolean enabled, String endpoint) {
    public static final String FILE_NAME = "obs-send.properties";

    public static ObsSendSettings read(Path file, String fallbackEndpoint) {
        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            properties.load(reader);
        } catch (Exception e) {
            return new ObsSendSettings(false, fallbackEndpoint);
        }
        boolean enabled = "true".equals(properties.getProperty("enabled", "").trim());
        String endpoint = properties.getProperty("endpoint", "").trim();
        return new ObsSendSettings(enabled, isHttp(endpoint) ? endpoint : fallbackEndpoint);
    }

    static boolean isHttp(String value) {
        try {
            URI uri = new URI(value);
            return ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) && uri.getHost() != null;
        } catch (Exception e) {
            return false;
        }
    }
}
