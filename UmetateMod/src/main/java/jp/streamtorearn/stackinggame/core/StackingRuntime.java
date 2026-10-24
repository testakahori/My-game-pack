package jp.streamtorearn.stackinggame.core;

import jp.streamtorearn.stackinggame.event.CancelReason;
import jp.streamtorearn.stackinggame.event.EventContext;
import jp.streamtorearn.stackinggame.event.EventManager;
import jp.streamtorearn.stackinggame.event.EventLifecycleCleanup;
import jp.streamtorearn.stackinggame.event.BlockInteractionAuditService;
import jp.streamtorearn.stackinggame.event.EncounterService;
import jp.streamtorearn.stackinggame.event.EventRegistryConsistency;
import jp.streamtorearn.stackinggame.event.EventResourceOwnership;
import jp.streamtorearn.stackinggame.event.EventRequest;
import jp.streamtorearn.stackinggame.event.GameEventRegistry;
import jp.streamtorearn.stackinggame.integration.BridgeGameApiIntegration;
import jp.streamtorearn.stackinggame.integration.IntegrationService;
import jp.streamtorearn.stackinggame.world.ArenaService;
import jp.streamtorearn.stackinggame.world.BlockSafetyService;
import jp.streamtorearn.stackinggame.world.CraterService;
import jp.streamtorearn.stackinggame.world.FluidContainmentService;
import jp.streamtorearn.stackinggame.world.GroundResolver;
import jp.streamtorearn.stackinggame.world.MobLifetimeManager;
import jp.streamtorearn.stackinggame.world.ProtectedBlockPolicy;
import jp.streamtorearn.stackinggame.world.SparkService;
import jp.streamtorearn.stackinggame.world.StackBlockService;
import jp.streamtorearn.stackinggame.world.TemporaryBlockManager;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

public final class StackingRuntime {
    public final ProtectedBlockPolicy protectedBlocks = new ProtectedBlockPolicy();
    public final ArenaService arena = new ArenaService();
    public final BlockSafetyService blockSafety = new BlockSafetyService(protectedBlocks, arena);
    public final TemporaryBlockManager tempBlocks = new TemporaryBlockManager(blockSafety);
    public final FluidContainmentService fluid = new FluidContainmentService();
    public final GroundResolver ground = new GroundResolver();
    public final CraterService crater = new CraterService(blockSafety);
    public final StackBlockService stackBlocks = new StackBlockService(protectedBlocks, arena, blockSafety);
    public final SparkService spark = new SparkService();
    public final MobLifetimeManager mobLifetime = new MobLifetimeManager();
    public final EventLifecycleCleanup lifecycleCleanup = new EventLifecycleCleanup(fluid, tempBlocks, stackBlocks, mobLifetime);
    public final EventResourceOwnership resources = new EventResourceOwnership(tempBlocks, stackBlocks, mobLifetime);

    // 外部演出は任意連携。OBSMOD Lifecycle APIはEventManagerの実開始/終了/中止地点から呼び出す。
    // Gifts-Displayは別担当のため、表示失敗・未導入でもゲーム本体は継続する。
    public final IntegrationService integration = new IntegrationService();
    public final EncounterService encounters = new EncounterService(integration);
    public final BlockInteractionAuditService blockAudit = new BlockInteractionAuditService();

    public final GameEventRegistry registry = new GameEventRegistry();
    public final EventManager events = new EventManager(this);
    public final BridgeGameApiIntegration bridgeApi = new BridgeGameApiIntegration();

    public StackingRuntime() {
        EventRegistryConsistency.validate(registry);
    }

    public EventContext context(MinecraftServer server, ServerPlayer player, EventRequest request) {
        return new EventContext(
                server,
                player,
                request,
                registry.targetMode(request.eventKey()),
                registry.blockInteractionMode(request.eventKey()),
                tempBlocks,
                fluid,
                ground,
                crater,
                spark,
                mobLifetime,
                protectedBlocks,
                arena,
                blockSafety,
                stackBlocks,
                integration,
                encounters,
                blockAudit);
    }

    /** Entity/FallingBlockが着地処理する前の安全監視。 */
    public void beforeEntityTick() {
        stackBlocks.beforeEntityTick();
    }

    public void tick(MinecraftServer server, long tick) {
        events.tick(server, tick);
        fluid.tick(tick);
        mobLifetime.tick(server, tick);
        tempBlocks.tick(server, tick);
    }

    public void started(MinecraftServer server) {
        tempBlocks.loadAndRestore(server);
        bridgeApi.start(server, this);
    }

    /**
     * ゲーム内リセット。
     * 現在イベントと待機列を破棄し、BridgeのgameSessionIdも新しい番号へ切り替える。
     */
    public void reset(MinecraftServer server) {
        // RESETはイベント由来の一時流体だけ復元し、Mob/FallingBlock/積み上げ/地形は残す。
        events.resetRound(server);
        // BridgeMOD 1.4.0 reference flow clears the game-owned request ledger at a round boundary.
        // Keeping old entries is normally harmless because gameSessionId changes, but clearing here
        // prevents cross-round requestId conflicts and keeps status/diagnostics bounded by the round.
        events.clearLedger();
        bridgeApi.rotateSession();
    }

    public void stopping(MinecraftServer server) {
        bridgeApi.stop();
        events.cancelAll(server, CancelReason.SERVER_STOP);
        events.clearLedger();
        stackBlocks.discardAllManaged();
        tempBlocks.flush(server, true);
        mobLifetime.clear();
    }
}
