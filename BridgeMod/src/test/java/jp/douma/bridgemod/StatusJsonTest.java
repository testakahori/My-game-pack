package jp.douma.bridgemod;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

// アプリレビュー（2026-10-08）P5・PR #98 レビュー I3：外部ゲームMODの状態を JSON にできなくても、ほかの MOD の状態とサーバーは止めない。
class StatusJsonTest {
    @Test
    void oneGameThatCannotBeWrittenAsJsonDoesNotBreakTheOthers() {
        Map<String, Object> loop = new HashMap<>();
        loop.put("self", loop);
        Map<String, Object> status = new TreeMap<>();
        status.put("good", Map.of("round", 1));
        status.put("loop", loop);
        status.put("optional", Map.of("value", Optional.of(1)));
        String json = assertDoesNotThrow(() -> StatusJson.games(status));
        JsonObject parsed = JsonParser.parseString(json).getAsJsonObject();
        assertEquals(1, parsed.getAsJsonObject("good").get("round").getAsInt());
        assertFalse(parsed.getAsJsonObject("loop").get("ok").getAsBoolean());
        assertTrue(parsed.getAsJsonObject("loop").get("error").getAsString().startsWith("StackOverflowError"), json);
        assertFalse(parsed.getAsJsonObject("optional").get("ok").getAsBoolean(), json);
    }

    @Test
    void noGamesIsAnEmptyObject() {
        assertEquals("{}", StatusJson.games(Map.of()));
    }
}
