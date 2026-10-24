import jp.streamtorearn.obsmodule.encounter.EncounterDeduplicator;

public class ObsDedupeSmokeTest {
    private static void test(boolean actual, boolean expected, String label) {
        if (actual != expected) {
            throw new AssertionError(label + " expected=" + expected + ", got=" + actual);
        }
        System.out.println("PASS " + label);
    }

    public static void main(String[] args) {
        EncounterDeduplicator dedupe = new EncounterDeduplicator();
        dedupe.configure(750, 300, 256);
        test(dedupe.shouldPublish("p", "zombie_hit", "forge", "melee", 1000), true, "first encounter");
        test(dedupe.shouldPublish("p", "zombie_hit", "forge", "melee", 1010), false, "duplicate same event");
        test(dedupe.shouldPublish("p", "skeleton_arrow", "game", "melee", 1100), false, "cross-source same attack");
        test(dedupe.shouldPublish("other", "zombie_hit", "forge", "melee", 1100), true, "different player");
        test(dedupe.shouldPublish("p", "zombie_hit", "forge", "melee", 2000), true, "after suppression window");
    }
}
