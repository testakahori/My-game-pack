package jp.douma.saikutumod;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * コマンド txt の読み方。Bridge・アプリ（bridge/command_text.cjs の parseCommandText）と同じ決まりで、Minecraft に依存しない
 * （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 5）。scripts/test-bridge-contracts.cjs が
 * 同じ例の一覧（bridge/test/fixtures/command-text.json）を両方に通して確かめる。
 * これは BridgeMOD の jp.douma.bridgemod.CommandText の写し（中身は同じ）。BridgeMOD のものを使うと、新しい SaikutuMod が
 * BridgeMOD 1.8.1 より前と組み合わさったときに起動できなくなるので、写しを持ち、契約テストで同じ結果になることを確かめる。
 * <ul>
 *   <li>行は CRLF・LF・CR で区切り、前後の空白（JavaScript の trim と同じ文字。BOM・全角空白・NBSP を含む）を除く。
 *       メモ帳などが付ける BOM が1行目にあっても、見出しとして読む（前は BOM 付きの行をコマンドとして実行していた）。</li>
 *   <li>「# キー: 値」は見出し。キーは英字と _ だけで、大文字にそろえる。値が空の行は無視する。同じキーは後の行が勝つ。</li>
 *   <li>「#」で始まるほかの行と「//」で始まる行はコマンドにしない。</li>
 * </ul>
 */
final class CommandText {
    private CommandText() {}

    record Parsed(Map<String, String> meta, List<String> commands) {}

    static Parsed parse(String text) {
        Map<String, String> meta = new HashMap<>();
        List<String> commands = new ArrayList<>();
        for (String raw : (text == null ? "" : text).split("\r\n|\r|\n", -1)) {
            String line = trim(raw);
            if (line.isEmpty()) continue;
            if (line.startsWith("#")) {
                header(line, meta);
                continue;
            }
            if (line.startsWith("//")) continue;
            commands.add(line);
        }
        return new Parsed(meta, commands);
    }

    // 「#」・空白・キー（英字と _）・空白・「:」・値。この形でない行は何もしない。
    private static void header(String line, Map<String, String> meta) {
        int i = 1, n = line.length();
        while (i < n && space(line.charAt(i))) i++;
        int start = i;
        while (i < n && keyChar(line.charAt(i))) i++;
        if (i == start) return;
        String key = line.substring(start, i).toUpperCase(Locale.ROOT);
        while (i < n && space(line.charAt(i))) i++;
        if (i >= n || line.charAt(i) != ':') return;
        String value = trim(line.substring(i + 1));
        if (!value.isEmpty()) meta.put(key, value);
    }

    private static boolean keyChar(char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
    }

    // 前後から除く空白（JavaScript の String.prototype.trim と同じ文字）。Java の trim・strip は範囲が違うので使わない。
    static String trim(String value) {
        int start = 0, end = value.length();
        while (start < end && space(value.charAt(start))) start++;
        while (end > start && space(value.charAt(end - 1))) end--;
        return value.substring(start, end);
    }

    private static boolean space(char c) {
        return c == '\t' || c == '\n' || c == 0x0b || c == 0x0c || c == '\r' || c == ' ' || c == 0xa0 || c == 0x1680
            || (c >= 0x2000 && c <= 0x200a) || c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
    }
}
