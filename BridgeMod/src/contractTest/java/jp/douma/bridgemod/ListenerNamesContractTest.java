package jp.douma.bridgemod;

// 視聴者名をどこに埋め込んでも壊れない・注入できない形にすることを、Minecraft なしで確かめる。
// 期待値は Bridge 側（electron/test/tiktok-events.test.cjs の safeDisplayName）と同じにしている。
public final class ListenerNamesContractTest {
    private static int checks;

    public static void main(String[] args) {
        // シングルクォートの SNBT から出て、ウィザーを乗せる NBT を書き足そうとする名前。
        same("a’},Passengers:[{id:”wither”}],x:{’", ListenerNames.display("a'},Passengers:[{id:\"wither\"}],x:{'"), "snbt escape");
        same("say ”hi” ＼o/", ListenerNames.display("say \"hi\" \\o/"), "json quotes and backslash");
        same("赤字", ListenerNames.display("§c赤§r字"), "formatting codes");
        same("視聴者 [Gift] 偽の行", ListenerNames.display("視聴者\n[Gift] 偽の行"), "newline");
        same("abcdef", ListenerNames.display("abc\u202edef\u0007"), "bidi and control");
        same("viewer", ListenerNames.display("§\u0000"), "empty after cleaning");
        same("viewer", ListenerNames.display(null), "null");
        same("ふつうの名前", ListenerNames.display("ふつうの名前"), "plain");
        // 40文字（サロゲートペアを壊さずに数える）。
        String emoji = "😀".repeat(45);
        same("😀".repeat(40), ListenerNames.display(emoji), "code point length");
        System.out.println("ListenerNames contract: " + checks + " checks passed");
    }

    private static void same(Object expected, Object actual, String label) {
        checks++;
        if (!expected.equals(actual)) throw new AssertionError(label + ": expected " + expected + " but was " + actual);
    }
}
