package jp.douma.saikutumod;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.TreeMap;

// SaikutuMod のコマンド txt の読み方が Bridge・アプリ（bridge/command_text.cjs）と BridgeMOD と同じ結果になることを確かめるために、
// scripts/test-bridge-contracts.cjs から呼ぶ。受け渡しの形は BridgeMOD の CommandTextParity と同じ
// （">" と UTF-16 の1単位ごとの16進4桁。見出しをキーの順に「キー U+0000 値」を U+0001 でつなぎ、U+0002 のあとにコマンドを U+0001 でつなぐ）。
public final class CommandTextParity {
    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
        StringBuilder out = new StringBuilder();
        for (String line; (line = in.readLine()) != null; ) {
            if (!line.startsWith(">")) continue;
            CommandText.Parsed parsed = CommandText.parse(text(line.substring(1)));
            StringBuilder canonical = new StringBuilder();
            for (Map.Entry<String, String> entry : new TreeMap<>(parsed.meta()).entrySet()) {
                if (canonical.length() > 0) canonical.append('\u0001');
                canonical.append(entry.getKey()).append('\u0000').append(entry.getValue());
            }
            canonical.append('\u0002').append(String.join("\u0001", parsed.commands()));
            out.append('>').append(hex(canonical.toString())).append('\n');
        }
        System.out.print(out);
        System.out.flush();
    }

    private static String text(String hex) {
        StringBuilder value = new StringBuilder();
        for (int i = 0; i + 4 <= hex.length(); i += 4) value.append((char) Integer.parseInt(hex.substring(i, i + 4), 16));
        return value.toString();
    }

    private static String hex(String value) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < value.length(); i++) out.append(String.format("%04x", (int) value.charAt(i)));
        return out.toString();
    }
}
