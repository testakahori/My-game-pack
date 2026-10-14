package jp.douma.bridgemod;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.util.Map;

/**
 * 外部ゲームMODの状態を、MOD ごとに JSON にする。JSON にできない MOD（自分を含む Map・Gson が扱えない型など）は、
 * その MOD の分だけ {"ok":false,"error":…} にして、ほかの MOD の状態とサーバーは止めない（アプリレビュー 2026-10-08 P5・PR #98 レビュー）。
 */
final class StatusJson {
    private static final Gson GSON = new Gson();

    private StatusJson() {}

    static String games(Map<String, Object> status) {
        JsonObject games = new JsonObject();
        for (Map.Entry<String, Object> entry : status.entrySet()) {
            try {
                games.add(entry.getKey(), GSON.toJsonTree(entry.getValue()));
            } catch (RuntimeException | StackOverflowError | LinkageError error) {
                JsonObject failed = new JsonObject();
                failed.addProperty("ok", false);
                failed.addProperty("error", error.getClass().getSimpleName() + ": " + error.getMessage());
                games.add(entry.getKey(), failed);
            }
        }
        return GSON.toJson(games);
    }
}
