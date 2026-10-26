import jp.streamtorearn.stackinggame.command.UmetateKeys;
import jp.streamtorearn.stackinggame.integration.UmetateTitles;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** ギフトの表示の題名と中身（埋め立て PR1 の Task 2）。args[0] は events.master.json。 */
public final class UmetateTitlesTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        // 13個は events.master.json の displayName と同じ題名。
        String master = Files.readString(Path.of(args[0]));
        Matcher m = Pattern.compile("\"id\"\\s*:\\s*\"([a-z0-9_]+)\"[^}]*?\"displayName\"\\s*:\\s*\"([^\"]+)\"[^}]*?\"implementationStatus\"\\s*:\\s*\"([a-z]+)\"", Pattern.DOTALL).matcher(master);
        int implemented = 0;
        while (m.find()) {
            String id = m.group(1), name = m.group(2), status = m.group(3);
            if (status.equals("implemented")) { implemented++; check(UmetateTitles.title(id).equals(name), id + " の題名は " + name + "（今は " + UmetateTitles.title(id) + "）"); }
            else check(UmetateTitles.title(id).equals(id), "中身の無いイベントは題名を持たない: " + id);
        }
        check(implemented == 13, "implemented の13個を照らした: " + implemented);
        // 研究室の5つ。
        check(UmetateTitles.title("otasuke").equals("お助け"), "otasuke");
        check(UmetateTitles.title("mofumofu").equals("もふもふ"), "mofumofu");
        check(UmetateTitles.title("stamp").equals("黒曜石スタンプ"), "stamp");
        check(UmetateTitles.title("atamahuttou").equals("頭沸騰"), "atamahuttou");
        check(UmetateTitles.title("zigoku").equals("地獄"), "zigoku");
        for (String key : UmetateKeys.EVENTS) check(!UmetateTitles.title(key).equals(key), "題名がある: " + key);
        for (String key : UmetateKeys.LAB) check(!UmetateTitles.title(key).equals(key), "題名がある: " + key);
        check(UmetateTitles.title("NETHER_ARMY").equals("ネザー軍団"), "大文字小文字を区別しない");
        check(UmetateTitles.title("unknown_x").equals("unknown_x"), "知らない名前はそのまま");
        // 表示の中身（DisplayMOD の DisplayApi.show に渡す）。
        Map<String, Object> payload = UmetateTitles.payload("nether_army", "視聴者 A 😀", 3);
        check(payload.get("title").equals("ネザー軍団"), "題名");
        check(payload.get("subtitle").equals("{ListenerName}"), "副題は送った人の名前");
        check(payload.get("listenerName").equals("視聴者 A 😀"), "送った人の名前はそのまま");
        check(payload.get("count").equals(3), "回数");
        System.out.println("UmetateTitlesTest OK");
    }
}
