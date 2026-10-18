package jp.douma.bridgemod;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

// コマンドの名前の決まりが Bridge・アプリ（bridge/command_files.cjs の BRIDGE_COMMAND_KEY）と同じになることを確かめるために、
// scripts/test-bridge-contracts.cjs から呼ぶ。標準入力の各行（">" と16進の名前）を CommandRouting.isCommandKey（受け付けと同じ）に通し、">1"／">0" で返す。
public final class CommandKeyParity {
    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
        StringBuilder out = new StringBuilder();
        for (String line; (line = in.readLine()) != null; ) {
            if (!line.startsWith(">")) continue;
            out.append(CommandRouting.isCommandKey(CommandTextParity.text(line.substring(1))) ? ">1" : ">0").append('\n');
        }
        System.out.print(out);
        System.out.flush();
    }
}
