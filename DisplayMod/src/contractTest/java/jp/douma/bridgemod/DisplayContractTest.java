package jp.douma.bridgemod;

import example.game.integration.OptionalDisplay;
import jp.douma.displaymod.api.DisplayRequest;
import java.util.Map;

public final class DisplayContractTest {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("check " + checks); }
    private static void rejects(Map<String, ?> payload) {
        try { DisplayRequest.from(payload); throw new AssertionError("accepted invalid input"); }
        catch (IllegalArgumentException expected) { checks++; }
    }
    public static void main(String[] args) {
        String mode = args[0];
        var payload = Map.of("title", "ゾンビ襲来", "subtitle", "{ListenerName}さん ×{Count}", "listenerName", "赤堀堂馬", "count", 3);
        var display = DisplayRequest.from(payload);
        check(display.title().equals("ゾンビ襲来"));
        check(display.subtitle().equals("赤堀堂馬さん ×3"));
        check(display.count() == 3);
        check(display.fadeInTicks() == 10 && display.stayTicks() == 70 && display.fadeOutTicks() == 10);
        var timed = DisplayRequest.from(Map.of("title", "開始", "senderName", "Aさん", "fadeInTicks", 0, "stayTicks", 120, "fadeOutTicks", 20));
        check(timed.stayTicks() == 120 && timed.fadeInTicks() == 0 && timed.fadeOutTicks() == 20 && timed.listenerName().equals("Aさん"));
        check(new DisplayRequest("old", "", "A", 1, "", "").stayTicks() == 70);
        for (Object invalid : new Object[]{-1, 1.5, "20", Double.NaN, 1201}) rejects(Map.of("title", "test", "stayTicks", invalid));
        rejects(Map.of("title", "test", "stayTicks", 1200, "fadeInTicks", 1, "fadeOutTicks", 0));
        rejects(Map.of("title", "test", "listenerName", "A", "senderName", "B"));
        var literal = DisplayRequest.from(Map.of("title", "\"} run op @a", "listenerName", "{Count}", "count", 2,
            "sound", "x master @a", "particle", "minecraft:flame\nkill @a"));
        check(literal.title().equals("\"} run op @a"));
        check(literal.subtitle().equals("{Count}"));
        check(literal.sound().isEmpty() && literal.particle().isEmpty());
        var longText = DisplayRequest.from(Map.of("title", "🌟".repeat(80), "subtitle", "a".repeat(200)));
        check(longText.title().codePointCount(0, longText.title().length()) == 60);
        check(longText.subtitle().length() == 120);
        rejects(Map.of("title", "")); rejects(Map.of("title", "test", "count", 0));
        rejects(Map.of("title", "test", "count", 1.5)); rejects(Map.of("title", "test", "count", Double.NaN));
        rejects(Map.of("title", "test", "count", "3")); rejects(Map.of("title", "test", "subtitle", true));
        check(DisplayLink.shouldAnnounce(true, false, null));
        check(DisplayLink.shouldAnnounce(true, false, "bridge"));
        check(!DisplayLink.shouldAnnounce(true, false, "game"));
        check(!DisplayLink.shouldAnnounce(true, false, "NONE"));
        check(!DisplayLink.shouldAnnounce(false, false, "bridge"));
        check(!DisplayLink.shouldAnnounce(true, true, "bridge"));
        check(DisplayLink.available() == !mode.equals("absent"));
        // A missing/incompatible/failing display never interrupts caller gameplay.
        int gameplay = 0;
        boolean shown = DisplayLink.show(new Object(), payload); gameplay++;
        boolean gameShown = OptionalDisplay.show(new Object(), payload); gameplay++;
        check(gameplay == 2);
        check(shown == mode.equals("present")); check(gameShown == mode.equals("present"));
        System.out.println("Display contract " + mode + ": " + checks + " checks passed");
    }
}
