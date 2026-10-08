package jp.douma.bridgemod;

/**
 * 視聴者名を、コマンドの中のどこに埋め込んでも壊れない・注入できない形にする。
 * txt では {ListenerName} が JSON 文字列の中（タイトル）、SNBT のダブルクォートの中の JSON（MOB の名前）、
 * シングルクォートの中など、場所によって必要なエスケープが違う。場所ごとに正しく2段階で
 * エスケープする代わりに、意味を持つ記号そのものを全角の同じ形の文字に置き換えて、どこでも安全にする。
 * <ul>
 *   <li>" ' \ は ” ’ ＼ に置き換える（文字列の外へ出て NBT を書き足すことを防ぐ）。</li>
 *   <li>書式コード（§ と次の1文字）と制御文字、文字の向きを変える制御文字は取り除く。改行・タブは空白にする。</li>
 *   <li>40文字（コードポイント）までにする。空になったら viewer。</li>
 * </ul>
 * Minecraft に依存しない純粋な Java。scripts/test-bridge-contracts.cjs で単体検証する。
 */
public final class ListenerNames {
    private ListenerNames() {}

    public static final int MAX_LENGTH = 40;

    public static String display(String raw) {
        StringBuilder out = new StringBuilder();
        int[] points = (raw == null ? "" : raw).codePoints().toArray();
        for (int i = 0; i < points.length; i++) {
            int cp = points[i];
            if (cp == '§') { i++; continue; } // 書式コードは「§」と次の1文字（§c など）をまとめて除く
            if (cp == '\r' || cp == '\n' || cp == '\t') out.append(' ');
            else if (removed(cp)) { /* 制御用の文字は名前に残さない */ }
            else if (cp == '"') out.append('”');
            else if (cp == '\'') out.append('’');
            else if (cp == '\\') out.append('＼');
            else out.appendCodePoint(cp);
        }
        String value = out.toString().trim();
        if (value.codePointCount(0, value.length()) > MAX_LENGTH) value = value.substring(0, value.offsetByCodePoints(0, MAX_LENGTH)).trim();
        return value.isEmpty() ? "viewer" : value;
    }

    private static boolean removed(int cp) {
        return cp < 0x20 || (cp >= 0x7f && cp < 0xa0)
            || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
    }
}
