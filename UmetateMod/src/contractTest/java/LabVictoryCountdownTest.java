import jp.streamtorearn.stackinggame.lab.LabVictoryCountdown;
import jp.streamtorearn.stackinggame.lab.LabVictoryCountdown.Signal;
import java.util.ArrayList;
import java.util.List;

/** 勝ちのカウントダウンの決まり（埋め立て PR1 の Task 4）。20 tick を1秒とする。 */
public final class LabVictoryCountdownTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) {
        LabVictoryCountdown c = new LabVictoryCountdown();
        for (long t = 0; t < 50; t++) check(c.update(false, t) == Signal.NONE, "埋まらないあいだは何もしない");

        // 埋まった tick で 10 から。そこから 20 tick ごとに 9,8,…,1。200 tick 目に勝ち。
        check(c.update(true, 100) == Signal.START && c.secondsLeft() == 10, "埋まったら 10 から");
        List<Integer> seconds = new ArrayList<>();
        Signal last = Signal.NONE;
        for (long t = 101; t <= 300 && last != Signal.WIN; t++) {
            last = c.update(true, t);
            if (last == Signal.SECOND) seconds.add(c.secondsLeft());
            if (t < 300) check(last != Signal.WIN || t == 300, "200 tick より前に勝ちにしない: " + t);
        }
        check(last == Signal.WIN, "200 tick 目に勝ち");
        check(seconds.equals(List.of(9, 8, 7, 6, 5, 4, 3, 2, 1)), "1秒ごとに 9〜1: " + seconds);
        // 勝ちのあと、埋まったままでも数え直さない（枠を消すまで）。いったん空いてから、また埋まったら 10 から。
        check(c.update(true, 301) == Signal.NONE && c.update(true, 400) == Signal.NONE, "勝ちのあとは数え直さない");
        check(c.update(false, 401) == Signal.NONE, "勝ちのあと空いても STOP は出さない（数えていない）");
        check(c.update(true, 402) == Signal.START && c.secondsLeft() == 10, "また埋まったら 10 から");

        // 途中で1マスでも欠けたら止まり、また埋まったら 10 から数え直す。
        check(c.update(true, 462) == Signal.SECOND && c.secondsLeft() == 7, "3秒たって残り 7");
        check(c.update(false, 463) == Signal.STOP, "欠けたら止まる");
        check(c.update(false, 500) == Signal.NONE, "止まったあとは何もしない");
        check(c.update(true, 501) == Signal.START && c.secondsLeft() == 10, "また埋まったら 10 から数え直す");

        // 5 tick ごとにしか見なくても、同じ時に勝つ（数を飛ばしたら、いまの残りを1回だけ知らせる）。
        LabVictoryCountdown sparse = new LabVictoryCountdown();
        check(sparse.update(true, 0) == Signal.START, "5 tick ごと: 開始");
        Signal s = Signal.NONE; long winAt = -1; int shown = 0;
        for (long t = 5; t <= 400 && s != Signal.WIN; t += 5) { s = sparse.update(true, t); if (s == Signal.SECOND) shown++; if (s == Signal.WIN) winAt = t; }
        check(winAt == 200 && shown == 9, "5 tick ごとでも 200 tick 目に勝ち、9回知らせる: " + winAt + " " + shown);
        LabVictoryCountdown late = new LabVictoryCountdown();
        late.update(true, 0);
        check(late.update(true, 70) == Signal.SECOND && late.secondsLeft() == 7, "飛ばしたら、いまの残りを知らせる");
        check(late.update(true, 260) == Signal.WIN, "期限を過ぎて見たら勝ち");
        System.out.println("LabVictoryCountdownTest OK");
    }
}
