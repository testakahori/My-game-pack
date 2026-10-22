package jp.douma.bridgemod;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

// ゲームの一覧とチャットの名前（publicKey）が、アプリ・BRIDGE（bridge/game_commands.cjs）と同じになることを確かめるために、
// scripts/test-bridge-contracts.cjs から呼ぶ（処理のコピー PR6）。引数 ids なら ">" と16進の一覧（"," でつないだもの）を返す。
// 引数なしなら、標準入力の各行（">" と16進の名前）に、">" と16進の CommandRouting.publicKey を返す。
public final class GameCommandParity {
    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("ids")) {
            System.out.println(">" + CommandTextParity.hex(String.join(",", CommandRouting.GAME_IDS)));
            System.out.flush();
            return;
        }
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
        StringBuilder out = new StringBuilder();
        for (String line; (line = in.readLine()) != null; ) {
            if (!line.startsWith(">")) continue;
            out.append('>').append(CommandTextParity.hex(CommandRouting.publicKey(CommandTextParity.text(line.substring(1))))).append('\n');
        }
        System.out.print(out);
        System.out.flush();
    }
}
