package jp.douma.bridgemod;

/**
 * 視聴者名を、コマンドの中のどこに埋め込んでも壊れない・注入できない形にする。
 * txt では {ListenerName} が JSON 文字列の中（タイトル）、SNBT のダブルクォートの中の JSON（MOB の名前）、
 * シングルクォートの中など、場所によって必要なエスケープが違う。場所ごとに正しく2段階で
 * エスケープする代わりに、意味を持つ記号そのものを全角の同じ形の文字に置き換えて、どこでも安全にする。
 * <ul>
 *   <li>" ' \ は ” ’ ＼ に置き換える（文字列の外へ出て NBT を書き足すことを防ぐ）。</li>
 *   <li>書式コード（§ と次の1文字）と制御文字、文字の向きや行を変える制御文字（U+061C・U+200E・U+200F・
 *       U+2028・U+2029・U+202A〜U+202E・U+2066〜U+2069）、片割れのサロゲートは取り除く。改行・タブは空白にする。</li>
 *   <li>前後の空白（trimmed の一覧だけ）を削り、40文字（コードポイント）までにする。切った後ろの空白も削る。空になったら viewer。</li>
 * </ul>
 * Bridge の safeDisplayName（bridge/tiktok_events.cjs）と同じ規則。同じ入力で同じ結果になることを、
 * scripts/test-bridge-contracts.cjs で確かめる（Minecraft に依存しない純粋な Java）。
 */
public final class ListenerNames {
    private ListenerNames() {}

    public static final int MAX_LENGTH = 40;

    public static String display(String raw) {
        int[] points = (raw == null ? "" : raw).codePoints().toArray();
        int[] kept = new int[points.length];
        int length = 0;
        for (int i = 0; i < points.length; i++) {
            int cp = points[i];
            if (cp == '§') { i++; continue; } // 書式コードは「§」と次の1文字（§c など）をまとめて除く
            if (cp == '\r' || cp == '\n' || cp == '\t') kept[length++] = ' ';
            else if (removed(cp)) { /* 制御用の文字は名前に残さない */ }
            else if (cp == '"') kept[length++] = '”';
            else if (cp == '\'') kept[length++] = '’';
            else if (cp == '\\') kept[length++] = '＼';
            else kept[length++] = cp;
        }
        // 前の空白を削ってから40文字で切り、後ろの空白を削る（Bridge の safeDisplayName と同じ順番）。
        int start = 0, end = length;
        while (start < end && trimmed(kept[start])) start++;
        end = Math.min(end, start + MAX_LENGTH);
        while (end > start && trimmed(kept[end - 1])) end--;
        return start == end ? "viewer" : new String(kept, start, end - start);
    }

    private static boolean removed(int cp) {
        return cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0xd800 && cp <= 0xdfff)
            || cp == 0x061c || cp == 0x200e || cp == 0x200f || cp == 0x2028 || cp == 0x2029
            || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
    }

    // 前後から削る空白。String.trim（Java）と String.prototype.trim（JS）は範囲が違うので、この一覧だけを使う。
    private static boolean trimmed(int cp) {
        return cp == 0x20 || cp == 0xa0 || cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200a)
            || cp == 0x202f || cp == 0x205f || cp == 0x3000 || cp == 0xfeff;
    }
}
