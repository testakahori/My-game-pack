package jp.douma.bridgemod;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import jp.douma.bridgemod.api.GameEvents;

// ゲーム MOD の ID の決まりが、アプリ・BRIDGE（bridge/game_commands.cjs の isGameModId）と同じになることを確かめるために、
// scripts/test-bridge-contracts.cjs から呼ぶ（処理のコピー PR6）。標準入力の各行（">" と16進の ID）を GameEvents.isGameModId
// （GameEvents.register と同じ）に通し、">1"／">0" で返す。
public final class GameModIdParity {
    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
        StringBuilder out = new StringBuilder();
        for (String line; (line = in.readLine()) != null; ) {
            if (!line.startsWith(">")) continue;
            out.append(GameEvents.isGameModId(CommandTextParity.text(line.substring(1))) ? ">1" : ">0").append('\n');
        }
        System.out.print(out);
        System.out.flush();
    }
}
