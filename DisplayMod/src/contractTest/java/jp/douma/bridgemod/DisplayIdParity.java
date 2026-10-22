package jp.douma.bridgemod;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import jp.douma.displaymod.api.DisplayRequest;

// 音・粒子の ID の決まりが、BRIDGE（bridge/minecraft_ids.cjs の isResourceId）と同じになることを確かめるために、
// scripts/test-bridge-contracts.cjs から呼ぶ（処理のコピー PR7）。標準入力の各行（">" と16進の ID）を
// DisplayRequest.from（DisplayMOD が受け取るときと同じ）に通し、音が空なら ">0"、空でなければ ">1" で返す。
public final class DisplayIdParity {
    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
        StringBuilder out = new StringBuilder();
        for (String line; (line = in.readLine()) != null; ) {
            if (!line.startsWith(">")) continue;
            String id = text(line.substring(1));
            out.append(DisplayRequest.from(Map.of("title", "t", "sound", id)).sound().isEmpty() ? ">0" : ">1").append('\n');
        }
        System.out.print(out);
        System.out.flush();
    }

    static String text(String hex) {
        StringBuilder value = new StringBuilder();
        for (int i = 0; i + 4 <= hex.length(); i += 4) value.append((char) Integer.parseInt(hex.substring(i, i + 4), 16));
        return value.toString();
    }
}
