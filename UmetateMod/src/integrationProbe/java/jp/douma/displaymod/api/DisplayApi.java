package jp.douma.displaymod.api;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 検証用の偽の DisplayMOD（本物と同じ名前の入口だけ。検証用の jar にだけ入り、製品の jar には入らない）。
 * 呼ばれた中身を残して true を返す。UmetateMod がギフトの表示をいつ・何で呼ぶかを確かめる（埋め立て PR1 の Task 2）。
 */
public final class DisplayApi {
    public static final List<Map<String, Object>> CALLS = new CopyOnWriteArrayList<>();
    private DisplayApi() {}

    public static boolean show(Object server, Map<String, ?> payload) {
        CALLS.add(new LinkedHashMap<>(payload));
        return true;
    }
}
