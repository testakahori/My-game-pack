package jp.streamtorearn.stackinggame.core;

import jp.streamtorearn.stackinggame.command.StackGameCommand;
import jp.streamtorearn.stackinggame.event.CancelReason;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.living.LivingDeathEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;

public final class StackingForgeEvents {
    private final StackingRuntime runtime;

    public StackingForgeEvents(StackingRuntime runtime) {
        this.runtime = runtime;
    }

    @SubscribeEvent
    public void onCommands(RegisterCommandsEvent event) {
        StackGameCommand.register(event.getDispatcher(), runtime);
    }

    @SubscribeEvent
    public void onStarted(ServerStartedEvent event) {
        runtime.started(event.getServer());
    }

    @SubscribeEvent
    public void onStopping(ServerStoppingEvent event) {
        runtime.stopping(event.getServer());
    }

    @SubscribeEvent
    public void onTick(TickEvent.ServerTickEvent event) {
        if (event.phase == TickEvent.Phase.START) {
            // FallingBlockのvanilla着地/再配置より前にArena外を除去する。
            runtime.beforeEntityTick();
        } else if (event.phase == TickEvent.Phase.END) {
            runtime.tick(event.getServer(), event.getServer().getTickCount());
        }
    }

    @SubscribeEvent
    public void onLogout(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            // ログアウト中はイベントを継続できないため、実行中とそのプレイヤーの待機分を破棄する。
            runtime.events.cancelPlayer(event.getEntity().getServer(), player.getUUID(), CancelReason.PLAYER_LOGOUT, true);
        }
    }

    @SubscribeEvent
    public void onDimension(PlayerEvent.PlayerChangedDimensionEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            // 現在のイベントはワールド/座標依存のため、ディメンション移動時は安全側で破棄する。
            runtime.events.cancelPlayer(event.getEntity().getServer(), player.getUUID(), CancelReason.DIMENSION_CHANGE, true);
        }
    }

    @SubscribeEvent
    public void onDeath(LivingDeathEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            // ゲーム継続中の死亡では待機列を消さない。
            // 実行中イベントだけを中止し、リスポーン後は待機順を維持する。
            runtime.events.cancelActiveForPlayer(event.getEntity().getServer(), player.getUUID(), CancelReason.PLAYER_DEATH);
        }
    }
}
