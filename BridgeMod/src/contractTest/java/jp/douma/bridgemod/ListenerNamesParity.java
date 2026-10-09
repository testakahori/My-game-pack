package jp.douma.bridgemod;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

// Bridge の safeDisplayName と同じ結果になることを確かめるために、scripts/test-bridge-contracts.cjs から呼ぶ。
// 標準入力の各行（">" と UTF-16 の1単位ごとの16進4桁）を ListenerNames.display に通し、結果を同じ形で返す。
// 16進数で受け渡すので、片割れのサロゲートや制御文字も文字コードの変換で化けずに届く。
public final class ListenerNamesParity {
    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
        StringBuilder out = new StringBuilder();
        for (String line; (line = in.readLine()) != null; ) {
            if (!line.startsWith(">")) continue;
            out.append('>').append(hex(ListenerNames.display(text(line.substring(1))))).append('\n');
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
