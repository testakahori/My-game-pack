package jp.streamtorearn.stackinggame.lab;

import net.minecraft.server.level.ServerPlayer;

/** 通信とステージ進行を分離し、サーバー上でも時刻を進めて転送を検証できるようにする。 */
public interface LabPresentation {
    boolean available(ServerPlayer player);
    void send(ServerPlayer player, int mode, int ticks);
    LabPresentation NETWORK = new LabPresentation() {
        public boolean available(ServerPlayer player) { return LabNetwork.available(player); }
        public void send(ServerPlayer player, int mode, int ticks) { LabNetwork.send(player, mode, ticks); }
    };
}
