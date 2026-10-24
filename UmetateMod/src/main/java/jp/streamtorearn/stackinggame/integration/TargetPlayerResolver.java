package jp.streamtorearn.stackinggame.integration;

import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.util.List;

/**
 * 現在はローカル配信サーバーでMinecraftプレイヤー1人だけが参加する前提。
 * 将来マルチ対応する場合は、このクラスだけ差し替える。
 */
public final class TargetPlayerResolver {
    public Result resolve(MinecraftServer server) {
        List<ServerPlayer> players = server.getPlayerList().getPlayers();
        if (players.size() == 1) {
            return new Result(players.get(0), "ok");
        }
        if (players.isEmpty()) {
            return new Result(null, "connected players=0");
        }
        return new Result(null, "connected players=" + players.size() + " (exactly one player is required)");
    }

    public record Result(ServerPlayer player, String message) {
        public boolean ok() {
            return player != null;
        }
    }
}
