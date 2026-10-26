package jp.streamtorearn.stackinggame.integration;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * ギフトの表示（DisplayMOD）の題名と中身（埋め立て PR1。2026-10-26）。
 * 13個は events.master.json の displayName と同じ（UmetateTitlesTest で照らす）。研究室の5つは計画で決めた題名。
 * Forge の型を使わない（scripts/test-soutenmon-contracts.cjs の javac の確かめで使う）。
 */
public final class UmetateTitles {
    private static final Map<String, String> TITLES = Map.ofEntries(
            Map.entry("aquatower", "アクアタワー"),
            Map.entry("magmatower", "マグマタワー"),
            Map.entry("aquarium", "アクアリウム"),
            Map.entry("voidbomb", "ボイドボム"),
            Map.entry("voidbomb_rain", "ボイドボム連続"),
            Map.entry("megablast", "メガブラスト"),
            Map.entry("nether_army", "ネザー軍団"),
            Map.entry("void_singularity", "ボイド・シンギュラリティ"),
            Map.entry("meteor_shower", "メテオシャワー"),
            Map.entry("meteor_purge", "メテオパージ"),
            Map.entry("tornado", "トルネード"),
            Map.entry("orbital_laser", "オービタルレーザー"),
            Map.entry("shockwave_collapse", "ショックウェーブ・コラプス"),
            Map.entry("otasuke", "お助け"),
            Map.entry("mofumofu", "もふもふ"),
            Map.entry("stamp", "黒曜石スタンプ"),
            Map.entry("atamahuttou", "頭沸騰"),
            Map.entry("zigoku", "地獄"));

    private UmetateTitles() {}

    /** 表示の題名。知らない名前はその名前を返す。 */
    public static String title(String key) {
        if (key == null) return "";
        return TITLES.getOrDefault(key.toLowerCase(Locale.ROOT), key);
    }

    /** DisplayMOD の DisplayApi.show に渡す中身（採掘と同じ項目。音と粒子は DisplayMOD の既定）。 */
    public static Map<String, Object> payload(String key, String listenerName, int count) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", title(key));
        payload.put("subtitle", "{ListenerName}");
        payload.put("listenerName", listenerName);
        payload.put("count", count);
        return payload;
    }
}
