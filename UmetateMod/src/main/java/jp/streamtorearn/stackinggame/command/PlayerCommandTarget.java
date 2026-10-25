package jp.streamtorearn.stackinggame.command;

import jp.streamtorearn.stackinggame.integration.TargetPlayerResolver;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

final class PlayerCommandTarget {
    private PlayerCommandTarget() {}
    static ServerPlayer resolve(CommandSourceStack source) {
        ServerPlayer player = source.getEntity() instanceof ServerPlayer p ? p
                : new TargetPlayerResolver().resolve(source.getServer()).player();
        if (player == null || !player.isAlive() || player.isSpectator()) {
            source.sendFailure(Component.literal("対象プレイヤーが見つかりません。ゲーム内から実行するか、参加者を1人にしてください。"));
            return null;
        }
        return player;
    }
}
