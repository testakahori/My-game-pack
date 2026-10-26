import jp.streamtorearn.stackinggame.command.UmetateKeys;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** umetate で動かす18個の名前（そうてんもんさんの13個と研究室の5つ）。args[0] は events.master.json。 */
public final class UmetateKeysTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        check(UmetateKeys.EVENTS.size() == 13, "そうてんもんさんのイベントは13個");
        check(UmetateKeys.LAB.equals(java.util.List.of("otasuke", "mofumofu", "stamp", "atamahuttou", "zigoku")), "研究室の5つ（この順）");
        Set<String> all = new HashSet<>(UmetateKeys.EVENTS);
        for (String key : UmetateKeys.LAB) check(all.add(key), "名前がぶつかった: " + key);
        check(!all.contains("reset"), "reset はギフトに載せない");
        check(UmetateKeys.isEvent("NETHER_ARMY") && UmetateKeys.isEvent("voidbomb"), "大文字小文字を区別しない");
        check(!UmetateKeys.isEvent("gift_spawn_zombie"), "中身の無いイベントは登録しない");
        check(UmetateKeys.isLab("Zigoku") && !UmetateKeys.isLab("reset") && !UmetateKeys.isLab("nether_army"), "研究室の5つだけ");
        check(!UmetateKeys.isEvent(null) && !UmetateKeys.isLab(null), "null は名前でない");
        check(UmetateKeys.MAX_COUNT == 100000, "回数は採掘と同じく 100000 まで");

        // events.master.json の implemented と同じ13個（イベントの一覧を足したら、ここで気づく）。
        String master = Files.readString(Path.of(args[0]));
        Matcher m = Pattern.compile("\"id\"\\s*:\\s*\"([a-z0-9_]+)\"[^}]*?\"implementationStatus\"\\s*:\\s*\"([a-z]+)\"", Pattern.DOTALL).matcher(master);
        Set<String> implemented = new TreeSet<>();
        int seen = 0;
        while (m.find()) { seen++; if (m.group(2).equals("implemented")) implemented.add(m.group(1)); }
        check(seen == 23, "events.master.json のイベントを読み取れた: " + seen);
        check(implemented.equals(new TreeSet<>(UmetateKeys.EVENTS)), "implemented の13個と同じ: " + implemented);
        System.out.println("UmetateKeysTest OK");
    }
}
