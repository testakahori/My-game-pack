package jp.streamtorearn.stackinggame.event;
import java.util.List;
@FunctionalInterface public interface GameEventFactory { ActiveEvent create(EventContext ctx, List<String> args); }
