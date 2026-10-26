package jp.streamtorearn.stackinggame.command;

import java.util.List;
import java.util.Locale;

/**
 * {@code umetate <名前> [回数] [送った人]} で動かす18個の名前（埋め立て PR1。2026-10-26）。
 * そうてんもんさんのイベントは events.master.json で implemented の13個だけ（candidate の10個は作らない。ユーザーの決定）。
 * Forge の型を使わない（scripts/test-soutenmon-contracts.cjs の javac の確かめで使う）。
 */
public final class UmetateKeys {
    public static final List<String> EVENTS = List.of(
            "aquatower", "magmatower", "aquarium", "voidbomb", "voidbomb_rain", "megablast", "nether_army",
            "void_singularity", "meteor_shower", "meteor_purge", "tornado", "orbital_laser", "shockwave_collapse");
    public static final List<String> LAB = List.of("otasuke", "mofumofu", "stamp", "atamahuttou", "zigoku");
    /** 回数の上限（採掘の saikutu コマンドと同じ）。 */
    public static final int MAX_COUNT = 100000;

    private UmetateKeys() {}

    public static boolean isEvent(String key) { return key != null && EVENTS.contains(key.toLowerCase(Locale.ROOT)); }
    public static boolean isLab(String key) { return key != null && LAB.contains(key.toLowerCase(Locale.ROOT)); }
}
