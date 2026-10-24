import java.util.*;
import jp.streamtorearn.stackinggame.event.*;
public class LedgerSmokeTest {
  static EventRequest req(String id,String key,int count) {
    return new EventRequest(UUID.randomUUID(), id,key,UUID.randomUUID(),count,"ギフター","gift","session-A",Map.of(),true,List.of(),10L);
  }
  static void expect(Object result,Object expected,String label) {
    if (!result.equals(expected))throw new AssertionError(label+" expected="+expected+" actual="+result);
    System.out.println("PASS "+label+" -> "+result);
  }
  public static void main(String[] args) {
    var ledger=new RequestLedger();
    var a=req("r-1001","voidbomb",1);
    expect(ledger.check(a),RequestLedger.Check.NEW,"未受付");
    ledger.remember(a);
    expect(ledger.check(req("r-1001","voidbomb",1)),RequestLedger.Check.DUPLICATE,"同じIDの再送");
    expect(ledger.check(req("r-1002","voidbomb",1)),RequestLedger.Check.NEW,"同イベント/別ID");
    expect(ledger.check(req("r-1001","voidbomb",500)),RequestLedger.Check.CONFLICT,"同じID/異なるcount");
    ledger.clear();
    expect(ledger.check(a),RequestLedger.Check.NEW,"RESET台帳消去");
  }
}
