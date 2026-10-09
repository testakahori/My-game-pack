package jp.douma.bridgemod;

// 視聴者名をどこに埋め込んでも壊れない・注入できない形にすることを、Minecraft なしで確かめる。
// 期待値は Bridge 側（electron/test/tiktok-events.test.cjs の safeDisplayName）と同じにしている。
// 境目の入力で Bridge と結果がそろうことは、scripts/test-bridge-contracts.cjs が ListenerNamesParity で確かめる。
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
        same("x".repeat(40), ListenerNames.display("x".repeat(50)), "ascii length");
        // 前後の空白は全角空白・NBSP・BOM も削る（Java の String.trim では残る）。
        same("viewer", ListenerNames.display(String.valueOf((char) 0x3000).repeat(3)), "full-width spaces only");
        same("名前", ListenerNames.display("" + (char) 0xfeff + (char) 0xa0 + "名前" + (char) 0x3000), "nbsp and bom");
        // 行・段落の区切りと文字の向きの印、片割れのサロゲートも除く。
        same("abcdef", ListenerNames.display("a" + (char) 0x2028 + "b" + (char) 0x2029 + "c" + (char) 0x200e + "d" + (char) 0x200f + "e" + (char) 0x061c + "f"), "separators and marks");
        same("ab", ListenerNames.display("a" + (char) 0xd83d + "b"), "lone surrogate");
        System.out.println("ListenerNames contract: " + checks + " checks passed");
    }

    private static void same(Object expected, Object actual, String label) {
        checks++;
        if (!expected.equals(actual)) throw new AssertionError(label + ": expected " + expected + " but was " + actual);
    }
}
