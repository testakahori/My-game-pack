import jp.streamtorearn.stackinggame.lab.LabActionLanes;
import java.util.ArrayList;
import java.util.List;

/**
 * 研究室の5つの順番待ち（最後のレビュー 重要4。2026-10-26 ユーザーの決定）。
 * 名前ごとに1列。回数の分だけ1秒（20 tick）おきに起こす。列が空のときに届いたギフトの1回目は、すぐ起こす。
 * 復元・地震・光のあいだ（blocked）は全部待つ。地獄の列は、研究室が落ち着く（labIdle）まで待つ。
 */
public final class LabActionLanesTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static List<String> keys(List<LabActionLanes.Run> runs) { List<String> k = new ArrayList<>(); for (var r : runs) k.add(r.key()); return k; }

    public static void main(String[] args) {
        LabActionLanes lanes = new LabActionLanes();
        // 1. 3回の黒曜石スタンプ：1回目はすぐ、あとは 20 tick おき。
        lanes.offer("stamp", 3, "視聴者 A");
        List<LabActionLanes.Run> now = lanes.due(1000, false, true);
        check(keys(now).equals(List.of("stamp")) && now.get(0).count() == 3 && now.get(0).listener().equals("視聴者 A"), "1回目はすぐ");
        check(now.get(0).claimDisplay() && !now.get(0).claimDisplay(), "表示はそのギフトで1回だけ");
        check(lanes.pending("stamp") == 2, "あと2回");
        check(lanes.due(1010, false, true).isEmpty(), "1秒たつまでは次を起こさない");
        List<LabActionLanes.Run> second = lanes.due(1020, false, true);
        check(keys(second).equals(List.of("stamp")) && !second.get(0).claimDisplay(), "1秒後に2回目（表示はもう出さない）");
        check(keys(lanes.due(1040, false, true)).equals(List.of("stamp")) && lanes.pending("stamp") == 0, "2秒後に3回目で終わり");
        check(lanes.due(2000, false, true).isEmpty(), "終わったら何も起こさない");

        // 2. 列が空なら、別のギフトはすぐ起こす（同じ tick に2つ届いても、どちらもすぐ）。
        lanes.offer("atamahuttou", 1, "B");
        check(keys(lanes.due(3000, false, true)).equals(List.of("atamahuttou")), "1つめはすぐ");
        lanes.offer("atamahuttou", 1, "C");
        check(keys(lanes.due(3000, false, true)).equals(List.of("atamahuttou")), "列が空なら2つめもすぐ");

        // 3. 名前が違えば別々に進む。同じ名前は届いた順。
        lanes.offer("stamp", 2, "D");
        lanes.offer("stamp", 1, "E");
        lanes.offer("mofumofu", 1, "F");
        List<LabActionLanes.Run> mixed = lanes.due(4000, false, true);
        check(keys(mixed).equals(List.of("stamp", "mofumofu")) && mixed.get(0).listener().equals("D"), "名前ごとに1つずつ、同じ名前は届いた順");
        List<LabActionLanes.Run> next = lanes.due(4020, false, true);
        check(next.size() == 1 && next.get(0).listener().equals("D"), "D の2回目");
        List<LabActionLanes.Run> last = lanes.due(4040, false, true);
        check(last.size() == 1 && last.get(0).listener().equals("E") && last.get(0).claimDisplay(), "そのあと E（E の表示は1回）");

        // 4. 復元・地震・光のあいだ（blocked）は、すぐ起こすはずのものも待つ。終わったら起こす。
        lanes.offer("otasuke", 1, "G");
        check(lanes.due(5000, true, false).isEmpty() && lanes.pending("otasuke") == 1, "処理中は待つ");
        check(keys(lanes.due(5001, false, true)).equals(List.of("otasuke")), "終わったら起こす");

        // 5. 地獄の列は、研究室が落ち着くまで待つ。ほかの列は地獄のあいだも動く。
        lanes.offer("zigoku", 2, "H");
        check(keys(lanes.due(6000, false, true)).equals(List.of("zigoku")) && lanes.pending("zigoku") == 1, "1回目の地獄はすぐ");
        lanes.offer("stamp", 1, "I");
        check(keys(lanes.due(6100, false, false)).equals(List.of("stamp")), "地獄のあいだも、ほかの列は動く");
        check(lanes.due(9000, false, false).isEmpty(), "地獄のあいだは、2回目の地獄を待つ");
        check(keys(lanes.due(9001, false, true)).equals(List.of("zigoku")) && lanes.pending("zigoku") == 0, "地獄が終わったら2回目");

        // 6. 大文字小文字を区別しない。全部捨てる。
        lanes.offer("STAMP", 5, "J");
        check(lanes.pending("stamp") == 4 || lanes.pending("stamp") == 5, "大文字でも同じ列");
        lanes.clear();
        check(lanes.pending() == 0 && lanes.due(10000, false, true).isEmpty(), "clear で全部捨てる");
        System.out.println("LabActionLanesTest OK");
    }
}
