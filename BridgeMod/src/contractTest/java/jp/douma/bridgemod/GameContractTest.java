package jp.douma.bridgemod;
import jp.douma.bridgemod.api.*;
import java.util.*;
import java.nio.file.*;
public class GameContractTest {
    static void check(boolean result) { if (!result) throw new AssertionError(); }
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]);
        Files.writeString(root.resolve("zombie.txt"),"common");
        for (String game : List.of("saikutu","run","umetate")) {
            Path file = root.resolve("game_"+game+"_otosiana.txt"); Files.writeString(file,"game");
            check(CommandRouting.resolve(root,"otosiana").equals(file));
            check(CommandRouting.resolve(root,"game_"+game+"_otosiana").equals(file));
            check(CommandRouting.keys(root).equals(List.of("otosiana","zombie")));
            Files.delete(file);
        }
        check(CommandRouting.resolve(root,"../outside")==null);
        check(CommandRouting.resolve(root,"otosiana")==null);
        RequestLedger ledger = new RequestLedger(2);
        check(!ledger.alreadyAccepted("gift:1","same"));
        ledger.accepted("gift:1","same"); check(ledger.alreadyAccepted("gift:1","same"));
        ledger.completed("gift:1"); check(ledger.alreadyAccepted("gift:1","same"));
        check(!ledger.alreadyAccepted("gift:2","same"));
        try { ledger.alreadyAccepted("gift:1","different"); throw new AssertionError(); } catch (IllegalArgumentException expected) {}
        ledger.accepted("pending","pending");
        for (int i=0;i<10;i++) { ledger.accepted("new:"+i,"same"); ledger.completed("new:"+i); }
        check(ledger.alreadyAccepted("pending","pending"));
        check(ledger.alreadyAccepted("new:9","same"));
        ledger.clear(); check(!ledger.alreadyAccepted("pending","pending"));
        GameEvents.register("testmod", data -> { check(data.get("requestId").equals("id:1")); return GameEvents.WAIT; }, Map::of);
        Map<String,Object> event = Map.of("requestId","id:1","key","otosiana","count",2);
        check(GameEvents.offer("testmod",event)==GameEvents.WAIT);
        check(GameEvents.offer("testmod",event)==GameEvents.WAIT);
        try { GameEvents.offer("testmod",Map.of()); throw new AssertionError(); } catch (IllegalArgumentException expected) {}
        System.out.println("PASS command aliases, request forwarding, pending/completed duplicate detection and conflict rejection");
    }
}
