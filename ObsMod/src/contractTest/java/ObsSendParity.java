import java.nio.file.Path;
import jp.streamtorearn.obsmodule.config.ObsSendSettings;

// アプリ（electron/obs_send.cjs）が書いた obs-send.properties を、OBSMOD と同じ読み方（ObsSendSettings）で読んで、
// 「送るか|送り先」を1行ずつ出す。scripts/test-soutenmon-contracts.cjs が JS の期待と照らす（2026-10-25。PR2 の最後のレビュー 軽い2）。
public class ObsSendParity {
    public static void main(String[] args) {
        for (String file : args) {
            ObsSendSettings settings = ObsSendSettings.read(Path.of(file), "http://fallback.invalid/event", message -> System.out.println("WARN " + message));
            System.out.println(">" + settings.enabled() + "|" + settings.endpoint());
        }
    }
}
