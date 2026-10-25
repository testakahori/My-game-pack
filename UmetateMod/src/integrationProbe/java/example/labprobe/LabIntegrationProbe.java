package example.labprobe;

import jp.streamtorearn.stackinggame.lab.*;

import com.mojang.authlib.GameProfile;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerBossEvent;
import net.minecraft.server.players.PlayerList;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BarrelBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/** 使い捨てのMAPコピーでだけ実行する。製品jarへは含めない。 */
@Mod("umetate_lab_probe")
public final class LabIntegrationProbe {
    public LabIntegrationProbe() { MinecraftForge.EVENT_BUS.register(this); }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static Object field(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(target);
    }
    private record Snapshot(List<BlockState> states, Map<Integer, CompoundTag> tags) {}
    private ServerPlayer player(ServerLevel level, String name) {
        ServerPlayer p = new ServerPlayer(level.getServer(), level, new GameProfile(UUID.randomUUID(), name));
        // FakePlayerはteleport自体が空実装なので、通常の転送処理を通し送信部分だけを受け止める。
        p.connection = new net.minecraft.server.network.ServerGamePacketListenerImpl(level.getServer(),
                new net.minecraft.network.Connection(net.minecraft.network.protocol.PacketFlow.SERVERBOUND), p) {
            @Override public void send(net.minecraft.network.protocol.Packet<?> packet) {}
            @Override public void send(net.minecraft.network.protocol.Packet<?> packet, net.minecraft.network.PacketSendListener listener) {}
        };
        return p;
    }
    private Snapshot snapshot(ServerLevel level, int base) {
        List<BlockState> states = new ArrayList<>(); Map<Integer, CompoundTag> tags = new HashMap<>();
        for (int i = 0; i < LabLayout.VOLUME; i++) {
            BlockPos pos = new BlockPos(LabLayout.x(i), base + LabLayout.y(i), LabLayout.z(i));
            states.add(level.getBlockState(pos)); var be = level.getBlockEntity(pos);
            if (be != null) tags.put(i, be.saveWithoutMetadata().copy());
        }
        return new Snapshot(states, tags);
    }
    @SuppressWarnings("unchecked")
    private void connect(MinecraftServer server, ServerPlayer player, boolean add) throws Exception {
        // テスト用プレイヤーを実際のオンライン一覧にも登録して、複数人・退出を確かめる。
        for (Field field : PlayerList.class.getDeclaredFields()) {
            if (!(field.getGenericType() instanceof ParameterizedType type)) continue;
            Type[] types = type.getActualTypeArguments(); field.setAccessible(true);
            if (List.class.isAssignableFrom(field.getType()) && types.length == 1 && types[0] == ServerPlayer.class) {
                List<ServerPlayer> players = (List<ServerPlayer>) field.get(server.getPlayerList());
                if (players instanceof ArrayList<?>) { if (add) players.add(player); else players.remove(player); }
            }
            if (Map.class.isAssignableFrom(field.getType()) && types.length == 2 && types[0] == UUID.class && types[1] == ServerPlayer.class) {
                Map<UUID, ServerPlayer> players = (Map<UUID, ServerPlayer>) field.get(server.getPlayerList());
                if (add) players.put(player.getUUID(), player); else players.remove(player.getUUID());
            }
        }
        if (add) server.overworld().players().add(player); else server.overworld().players().remove(player);
    }
    @SubscribeEvent(priority = net.minecraftforge.eventbus.api.EventPriority.LOWEST)
    public void started(ServerStartedEvent event) {
        MinecraftServer server = event.getServer();
        try { run(server); Files.writeString(Path.of("lab-probe-result.txt"), "PASS: clone, air, block entities, 2F/1F preservation, quake, flashes, 5-minute timer, no automatic restore, reconnect, restart recovery\n"); }
        catch (Throwable e) {
            StackingGameMod.LOGGER.error("LAB_PROBE_FAILED", e);
            try { Files.writeString(Path.of("lab-probe-result.txt"), "FAIL: " + e); } catch (Exception ignored) {}
        } finally { server.halt(false); }
    }
    private void run(MinecraftServer server) throws Exception {
        check(Boolean.getBoolean("umetate.lab.probe"), "使い捨てテスト環境でのみ実行できます");
        ServerLevel level = server.overworld();
        level.getGameRules().getRule(GameRules.RULE_RANDOMTICKING).set(0, server);
        StackingRuntime runtime = StackingGameMod.RUNTIME;
        AtomicLong now = new AtomicLong(1000000);
        List<Integer> effects = new ArrayList<>();
        LabPresentation presentation = new LabPresentation() {
            public boolean available(ServerPlayer p) { return true; }
            public void send(ServerPlayer p, int mode, int ticks) { effects.add(mode); }
        };
        LabStageService lab = new LabStageService(runtime, now::get, presentation);
        Field runtimeLab = StackingRuntime.class.getField("lab"); runtimeLab.setAccessible(true); runtimeLab.set(runtime, lab);
        runtime.blockSafety.setReservedRegion(lab::isMaster); lab.started(server);
        check(server.getCommands().getDispatcher().getRoot().getChild("umetate").getChild("zigoku") != null, "コマンド登録");
        Snapshot hellBefore = snapshot(level, -42);
        BlockPos barrel = new BlockPos(15, 7, 15);
        level.setBlock(barrel, Blocks.BARREL.defaultBlockState(), 18);
        ((BarrelBlockEntity) level.getBlockEntity(barrel)).setItem(0, new ItemStack(Items.DIAMOND, 23));
        Snapshot master = snapshot(level, 0);
        level.setBlock(new BlockPos(0, 70, 0), Blocks.DIAMOND_BLOCK.defaultBlockState(), 18);
        level.setBlock(new BlockPos(0, 48, -12), Blocks.AIR.defaultBlockState(), 18);
        check(server.getCommands().getDispatcher().execute("umetate reset", server.createCommandSourceStack()) == 1, "reset受付");
        check(lab.reset(server.createCommandSourceStack()) == 0, "二重resetは拒否");
        for (int i = 0; i < 20000 && lab.blocksEvents(); i++) lab.tick(server);
        check(!lab.blocksEvents(), "復元完了");
        check(snapshot(level, 42).equals(master), "3階の全177450ブロックと全NBTが2階と一致");
        check(snapshot(level, 0).equals(master), "2階が変わらない");
        check(snapshot(level, -42).equals(hellBefore), "1階が変わらない");

        ServerPlayer first = player(level, "LabProbeOne");
        ServerPlayer second = player(level, "LabProbeTwo");
        first.setPos(.5, 49, -12.5); second.setPos(12.5, 49, .5);
        connect(server, first, true); connect(server, second, true);
        check(server.getPlayerList().getPlayer(first.getUUID()) == first, "オンライン登録");
        check(server.getCommands().getDispatcher().execute("umetate zigoku", server.createCommandSourceStack()) == 2, "2人が参加");
        check(lab.zigoku(server.createCommandSourceStack()) == 0, "二重地獄は拒否");
        for (int i = 0; i < 119; i++) lab.tick(server);
        check(first.getY() > 0 && effects.contains(2), "白い光が始まってから転送する");
        lab.tick(server);
        check(first.getY() < 0 && second.getY() < 0, "1階への転送");
        Snapshot collapsed = snapshot(level, 42);
        check(!collapsed.states().equals(master.states()), "外壁が実際に崩れる");
        lab.tick(server);
        ServerBossEvent timer = (ServerBossEvent) field(lab, "timer");
        check(timer.getName().getString().contains("5:00") && timer.getPlayers().size() == 2, "5分のボスバー");
        check((long) field(lab, "deadline") == now.get() + 300000, "1階到着から実時間5分");
        connect(server, second, false); lab.logout(second);
        now.addAndGet(299999); lab.tick(server);
        check(first.getY() < 0 && timer.getName().getString().contains("0:01"), "5分前に帰還しない");
        check(snapshot(level, 42).equals(collapsed), "滞在中は3階を復元しない");
        // 帰還地点の床を岩盤まで抜き、穴があっても着地できるか確かめる。
        for (BlockPos pos : BlockPos.betweenClosed(-2, 43, -15, 2, 48, -10)) level.setBlock(pos, Blocks.AIR.defaultBlockState(), 18);
        Snapshot damaged = snapshot(level, 42);
        now.incrementAndGet(); lab.tick(server);
        check(first.getY() < 0 && timer.getName().getString().contains("0:00"), "0秒で帰還の光");
        for (int i = 0; i < 20; i++) lab.tick(server);
        check(first.getY() >= 43 && first.getY() < 44, "床下の岩盤に帰還");
        check(snapshot(level, 42).equals(damaged), "帰還時も修復しない");
        check(timer.getPlayers().isEmpty(), "タイマーを片付ける");
        connect(server, second, true);
        for (int i = 0; i < 21; i++) lab.tick(server);
        check(second.getY() >= 43, "期限後の再参加でも帰還");
        check(LabSavedData.get(level).homes.isEmpty(), "帰還済みデータを消す");
        // 次のイベント途中でサービスを再起動。復元せず帰還だけを回復する。
        check(lab.zigoku(server.createCommandSourceStack()) == 2, "2回目開始");
        for (int i = 0; i < 120; i++) lab.tick(server);
        Snapshot beforeRestart = snapshot(level, 42);
        lab.stopping();
        LabStageService recovered = new LabStageService(runtime, now::get, presentation); recovered.started(server);
        for (int i = 0; i < 21; i++) recovered.tick(server);
        check(first.getY() >= 43 && second.getY() >= 43, "再起動後の帰還");
        check(snapshot(level, 42).equals(beforeRestart), "再起動でも自動復元しない");
        check(snapshot(level, 0).equals(master) && snapshot(level, -42).equals(hellBefore), "全演出で原本と1階を維持");
        check(effects.containsAll(List.of(1, 2, 3)), "揺れ・白の保持・フェードアウト");
        recovered.stopping(); connect(server, first, false); connect(server, second, false);
        StackingGameMod.LOGGER.info("LAB_PROBE_PASS");
    }
}
