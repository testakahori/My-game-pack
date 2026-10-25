import jp.streamtorearn.stackinggame.lab.LabLayout;
import java.util.HashSet;

public final class LabLayoutTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) {
        HashSet<String> coordinates = new HashSet<>();
        for (int i = 0; i < LabLayout.VOLUME; i++) {
            int x = LabLayout.x(i), y = LabLayout.y(i), z = LabLayout.z(i);
            check(x >= -32 && x <= 32 && z >= -32 && z <= 32 && y >= 0 && y <= 41, "原本範囲を外れた");
            check(y + LabLayout.TOP_BASE >= 42 && y + LabLayout.TOP_BASE <= 83, "複製先が別の階に重なった");
            check(coordinates.add(x + "," + y + "," + z), "複製座標が重複した");
        }
        check(coordinates.size() == 177450, "床下を含む65×65×42ブロックが必要");
        check(LabLayout.onTop(-32, 42, -32) && LabLayout.onTop(32.9, 90, 32.9), "3階の端を見落とした");
        check(!LabLayout.onTop(0, 41.99, 0) && !LabLayout.onTop(33, 49, 0), "2階または場外の人を巻き込んだ");
        long start = 123456789L, deadline = start + LabLayout.VISIT_MILLIS;
        check(LabLayout.countdown(deadline, start).equals("5:00"), "開始時は5分");
        check(LabLayout.countdown(deadline, deadline - 1).equals("0:01"), "期限前に0を表示しない");
        check(LabLayout.countdown(deadline, deadline).equals("0:00"), "期限で0になる");
        check(LabLayout.remainingSeconds(deadline, deadline + 999999) == 0, "再接続が遅れても負数にしない");
        System.out.println("LabLayoutTest OK");
    }
}
