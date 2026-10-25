package jp.streamtorearn.obsmodule.config;

import java.io.StringReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.function.Consumer;

/**
 * OBS ツールへ送るかの設定。MyGamePack（アプリ）がサーバーの config/minecraft_obs_bridge/obs-send.properties に書く。
 * ファイルが無い・読めない・enabled が true でないときは送らない（アプリに同梱した OBSMOD の既定。2026-10-25 ユーザーの決定）。
 * 送り先は http・https のときだけ使い、それ以外は OBSMOD の設定（events.generated.json の controller.endpoint）の送り先を使う。
 * Forge を使わない（scripts/test-soutenmon-contracts.cjs の ObsSendSettingsTest で確かめる）。
 */
public record ObsSendSettings(boolean enabled, String endpoint) {
    public static final String FILE_NAME = "obs-send.properties";
    private static final String BOM = "﻿";

    public static ObsSendSettings read(Path file, String fallbackEndpoint) {
        return read(file, fallbackEndpoint, message -> {});
    }

    // ファイルはあるのにオンにならない・送り先を使わないときは、理由を warn に渡す（ファイルが無いだけなら渡さない）。
    public static ObsSendSettings read(Path file, String fallbackEndpoint, Consumer<String> warn) {
        if (!Files.exists(file)) return new ObsSendSettings(false, fallbackEndpoint);
        Properties properties = new Properties();
        try {
            String text = Files.readString(file, StandardCharsets.UTF_8);
            // メモ帳などで BOM 付きで保存しても読む（Properties は BOM を外さない。最後のレビュー 重要2）。
            if (text.startsWith(BOM)) text = text.substring(BOM.length());
            properties.load(new StringReader(text));
        } catch (Exception e) {
            warn.accept("OBSMOD could not read " + FILE_NAME + " (" + e + "); events are not sent to the OBS tool");
            return new ObsSendSettings(false, fallbackEndpoint);
        }
        String enabledText = properties.getProperty("enabled", "").trim();
        if (!enabledText.equals("true") && !enabledText.equals("false")) {
            warn.accept("OBSMOD " + FILE_NAME + ": enabled must be true or false (got \"" + enabledText + "\"); events are not sent to the OBS tool");
        }
        String endpoint = properties.getProperty("endpoint", "").trim();
        boolean usable = isHttp(endpoint);
        if (!endpoint.isEmpty() && !usable) {
            warn.accept("OBSMOD " + FILE_NAME + ": endpoint must be an http or https URL; using " + fallbackEndpoint + " instead");
        }
        return new ObsSendSettings(enabledText.equals("true"), usable ? endpoint : fallbackEndpoint);
    }

    static boolean isHttp(String value) {
        try {
            URI uri = new URI(value);
            // 大文字の HTTP:// も使う。ユーザー名・パスワード入りの送り先は、送り先をログに出すので使わない（最後のレビュー 軽い1・3）。
            return ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) && uri.getHost() != null && uri.getUserInfo() == null;
        } catch (Exception e) {
            return false;
        }
    }
}
