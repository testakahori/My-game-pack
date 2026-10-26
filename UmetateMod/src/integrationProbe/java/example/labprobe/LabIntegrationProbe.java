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
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.monster.warden.Warden;
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
        try { run(server); Files.writeString(Path.of("lab-probe-result.txt"), "PASS: clone, air, block entities, 2F/1F preservation, quake, flashes, 3 wardens and cleanup, 5-minute timer, no automatic restore, reconnect, restart recovery\n"); }
        catch (Throwable e) {
            StackingGameMod.LOGGER.error("LAB_PROBE_FAILED", e);
            try { Files.writeString(Path.of("lab-probe-result.txt"), "FAIL: " + e); } catch (Exception ignored) {}
        } finally { server.halt(false); }
    }
    private void run(MinecraftServer server) throws Exception {
        check(Boolean.getBoolean("umetate.lab.probe"), "使い捨てテスト環境でのみ実行できます");
        ServerLevel level = server.overworld();
        // BridgeMODの固定環境を含め、実際のイベントバスを通した後も研究室では自然湧きを止める。
        for (int i = 0; i < 3; i++) {
            level.getGameRules().getRule(GameRules.RULE_DOMOBSPAWNING).set(true, server);
            MinecraftForge.EVENT_BUS.post(new net.minecraftforge.event.TickEvent.ServerTickEvent(
                    net.minecraftforge.event.TickEvent.Phase.END, () -> true, server));
            check(!level.getGameRules().getBoolean(GameRules.RULE_DOMOBSPAWNING), "研究室の自然湧きオフをBridgeMOD併用時も維持する");
        }
        level.getGameRules().getRule(GameRules.RULE_RANDOMTICKING).set(0, server);
        StackingRuntime runtime = StackingGameMod.RUNTIME;
        checkLabFrame(server, runtime);
        checkPlayerCommands(server, runtime);
        checkUmetateCommands(server, runtime);
        checkDisplayOnStart(server, runtime);
        checkLabActionLanes(server, runtime);
        checkVictory(server, runtime);
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
        Snapshot beforeHelp = snapshot(level, 42);
        // ネザーを実行元にしても3階だけを埋め、枠・上半分・原本・地獄は変更しない。
        // 回数付き（埋め立て PR1）。2回目は埋め済みで fill が何も変えずに断られるが、1回目の分を返す。
        check(server.getCommands().getDispatcher().execute("umetate otasuke 2",
                server.createCommandSourceStack().withLevel(server.getLevel(net.minecraft.world.level.Level.NETHER))) > 0, "otasuke受付");
        Snapshot afterHelp = snapshot(level, 42);
        for (int i = 0; i < LabLayout.VOLUME; i++) {
            int x = LabLayout.x(i), y = 42 + LabLayout.y(i), z = LabLayout.z(i);
            boolean filled = x >= -6 && x <= 6 && y >= 49 && y <= 56 && z >= -6 && z <= 6;
            check(afterHelp.states().get(i).equals(filled ? Blocks.GOLD_BLOCK.defaultBlockState() : beforeHelp.states().get(i)), "otasukeの範囲と金ブロック");
        }
        check(snapshot(level, 0).equals(master) && snapshot(level, -42).equals(hellBefore), "otasukeは1階・2階を変更しない");
        level.setBlock(new BlockPos(-6, 49, -6), Blocks.DIAMOND_BLOCK.defaultBlockState(), 18);
        level.setBlock(new BlockPos(6, 64, 6), Blocks.DIAMOND_BLOCK.defaultBlockState(), 18);
        level.setBlock(new BlockPos(6, 65, 6), Blocks.GOLD_BLOCK.defaultBlockState(), 18);
        level.setBlock(new BlockPos(-7, 60, 0), Blocks.DIAMOND_BLOCK.defaultBlockState(), 18);
        level.setBlock(new BlockPos(0, 49, 0), Blocks.STONE.defaultBlockState(), 18);
        level.setBlock(new BlockPos(0, 50, 0), Blocks.PINK_WOOL.defaultBlockState(), 18);
        level.setBlock(new BlockPos(0, 51, 0), Blocks.AIR.defaultBlockState(), 18);
        Snapshot beforeWool = snapshot(level, 42);
        level.random.setSeed(20261025L);
        int woolCount = server.getCommands().getDispatcher().execute("umetate mofumofu",
                server.createCommandSourceStack().withLevel(server.getLevel(net.minecraft.world.level.Level.NETHER)));
        Snapshot afterWool = snapshot(level, 42);
        Set<BlockState> colors = new HashSet<>(); int expectedWool = 0;
        for (int i = 0; i < LabLayout.VOLUME; i++) {
            int x = LabLayout.x(i), y = 42 + LabLayout.y(i), z = LabLayout.z(i);
            BlockState before = beforeWool.states().get(i), after = afterWool.states().get(i);
            boolean target = x >= -6 && x <= 6 && y >= 49 && y <= 64 && z >= -6 && z <= 6
                    && (before.is(Blocks.GOLD_BLOCK) || before.is(Blocks.DIAMOND_BLOCK));
            if (target) {
                check(after.is(net.minecraft.tags.BlockTags.WOOL), "金・ダイヤだけを羊毛にする");
                colors.add(after); expectedWool++;
            } else check(after.equals(before), "mofumofuの範囲外・空気・他素材を保持");
        }
        check(woolCount == expectedWool && colors.size() == 16, "変換数と16色の混在");
        check(afterWool.tags().equals(beforeWool.tags()), "収納データを保持");
        check(snapshot(level, 0).equals(master) && snapshot(level, -42).equals(hellBefore), "mofumofuは1階・2階を変更しない");
        check(server.getCommands().getDispatcher().execute("umetate mofumofu", server.createCommandSourceStack()) == 0,
                "変換対象なしなら0件");
        check(snapshot(level, 42).equals(afterWool), "再実行で既存の羊毛を変えない");
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
        Warden unrelated = EntityType.WARDEN.create(level);
        unrelated.setPos(-24.5, -35, -24.5); unrelated.setNoAi(true); level.addFreshEntity(unrelated);
        // 回数付き（埋め立て PR1）。2回目は「実行中」で断られ、断った分はまとめて1行だけ知らせる。
        List<String> zigokuMessages = new ArrayList<>();
        net.minecraft.commands.CommandSource recorder = new net.minecraft.commands.CommandSource() {
            @Override public void sendSystemMessage(net.minecraft.network.chat.Component message) { zigokuMessages.add(message.getString()); }
            @Override public boolean acceptsSuccess() { return true; }
            @Override public boolean acceptsFailure() { return true; }
            @Override public boolean shouldInformAdmins() { return false; }
        };
        check(server.getCommands().getDispatcher().execute("umetate zigoku 2", server.createCommandSourceStack().withSource(recorder)) == 2, "2人が参加");
        // 2回目は断らずに順番待ちに入り、いまの地獄が終わってから落ちる（最後のレビュー 重要4。2026-10-26 ユーザーの決定「何回も地獄に落ちてもいい」）。
        check(zigokuMessages.stream().filter(m -> m.contains("あと1回は順番に起こします")).count() == 1
                && zigokuMessages.stream().noneMatch(m -> m.contains("実行中です")), "2回目は順番待ちだと1行で知らせる: " + zigokuMessages);
        check(runtime.labLanes.pending("zigoku") == 1, "2回目の地獄は順番待ち");
        check(lab.zigoku(server.createCommandSourceStack()) == 0, "二重地獄は拒否");
        for (int i = 0; i < 119; i++) lab.tick(server);
        check(first.getY() > 0 && effects.contains(2), "白い光が始まってから転送する");
        check(eventWardens(level).isEmpty(), "転送前には召喚しない");
        lab.tick(server);
        check(first.getY() < 0 && second.getY() < 0, "1階への転送");
        List<Warden> wave = eventWardens(level);
        check(wave.size() == 3, "複数人でも1階にウォーデンを合計3体召喚");
        for (Warden w : wave) {
            check(w.getY() == -35 && level.noCollision(w, w.getBoundingBox()), "1階の足場上で壁に埋まらず召喚");
            check(w.isPersistenceRequired(), "距離による自然消滅を防ぐ");
            for (int tick = 0; tick < 1300; tick++) w.getBrain().tick(level, w);
            check(w.isAlive() && w.getPose() != net.minecraft.world.entity.Pose.DIGGING, "静かな時間にも地中へ帰らない");
        }
        wave.get(0).kill();
        check(!wave.get(0).isAlive(), "途中で倒せる");
        Snapshot collapsed = snapshot(level, 42);
        check(!collapsed.states().equals(master.states()), "外壁が実際に崩れる");
        lab.tick(server);
        ServerBossEvent timer = (ServerBossEvent) field(lab, "timer");
        check(timer.getName().getString().contains("5:00") && timer.getPlayers().size() == 2, "5分のボスバー");
        check((long) field(lab, "deadline") == now.get() + 300000, "1階到着から実時間5分");
        // 地獄のあいだは、枠が金で埋まっていても勝ちのカウントダウンをしない（埋め立て PR1 の Task 4）。
        fillFrame(level, (x, y, z) -> Blocks.GOLD_BLOCK.defaultBlockState());
        for (int i = 0; i < 260; i++) lab.tick(server);
        check(victoryWins(lab) == 0 && frameCount(level, Blocks.GOLD_BLOCK) == LabLayout.FRAME_VOLUME, "地獄のあいだは勝ちにしない");
        fillFrame(level, (x, y, z) -> Blocks.AIR.defaultBlockState());
        connect(server, second, false); lab.logout(second);
        now.addAndGet(299999); lab.tick(server);
        check(first.getY() < 0 && timer.getName().getString().contains("0:01"), "5分前に帰還しない");
        check(wave.stream().filter(Warden::isAlive).count() == 2, "途中で倒した1体を補充せず、生存分を期限まで保持");
        check(snapshot(level, 42).equals(collapsed), "滞在中は3階を復元しない");
        // 帰還地点の床を岩盤まで抜き、穴があっても着地できるか確かめる。
        for (BlockPos pos : BlockPos.betweenClosed(-2, 43, -15, 2, 48, -10)) level.setBlock(pos, Blocks.AIR.defaultBlockState(), 18);
        Snapshot damaged = snapshot(level, 42);
        now.incrementAndGet(); lab.tick(server);
        check(first.getY() < 0 && timer.getName().getString().contains("0:00"), "0秒で帰還の光");
        for (int i = 0; i < 20; i++) lab.tick(server);
        check(first.getY() >= 43 && first.getY() < 44, "床下の岩盤に帰還");
        check(wave.stream().noneMatch(Warden::isAlive), "3階への帰還時に召喚分の生存ウォーデンをキル");
        check(unrelated.isAlive(), "無関係のウォーデンはキルしない");
        check(snapshot(level, 42).equals(damaged), "帰還時も修復しない");
        check(timer.getPlayers().isEmpty(), "タイマーを片付ける");
        connect(server, second, true);
        for (int i = 0; i < 21; i++) lab.tick(server);
        check(second.getY() >= 43, "期限後の再参加でも帰還");
        check(LabSavedData.get(level).homes.isEmpty(), "帰還済みデータを消す");
        // 次のイベント途中でサービスを再起動。復元せず帰還だけを回復する。
        // 2回目の地獄は、順番待ちから始まる（いまの地獄が終わり、研究室が落ち着いたので）。
        runtime.tickLabActions(server, server.getTickCount() + 1_000_000L);
        check(runtime.labLanes.pending("zigoku") == 0 && ((Set<?>) field(lab, "visitors")).size() == 2, "2回目開始（順番待ちから）");
        check(lab.zigoku(server.createCommandSourceStack()) == 0, "2回目の最中の地獄は拒否");
        for (int i = 0; i < 120; i++) lab.tick(server);
        List<Warden> nextWave = eventWardens(level);
        check(nextWave.size() == 3, "次の地獄イベントでも新しく3体だけ召喚");
        // チャンクに保存された個体が停止後に遅れて読み込まれる場合も再現する。
        CompoundTag unloaded = nextWave.get(0).saveWithoutId(new CompoundTag());
        nextWave.get(0).discard();
        Snapshot beforeRestart = snapshot(level, 42);
        lab.stopping();
        check(nextWave.stream().noneMatch(w -> !w.isRemoved() && w.isAlive()), "サーバー停止時も生存分を片付ける");
        LabStageService recovered = new LabStageService(runtime, now::get, presentation); recovered.started(server);
        runtimeLab.set(runtime, recovered);
        Warden reloaded = EntityType.WARDEN.create(level); reloaded.load(unloaded); level.addFreshEntity(reloaded);
        for (int i = 0; i < 21; i++) recovered.tick(server);
        check(!reloaded.isAlive() && unrelated.isAlive(), "再起動後の遅い読み込みでも召喚分だけ片付ける");
        check(first.getY() >= 43 && second.getY() >= 43, "再起動後の帰還");
        check(snapshot(level, 42).equals(beforeRestart), "再起動でも自動復元しない");
        check(snapshot(level, 0).equals(master) && snapshot(level, -42).equals(hellBefore), "全演出で原本と1階を維持");
        check(effects.containsAll(List.of(1, 2, 3)), "揺れ・白の保持・フェードアウト");
        recovered.stopping(); connect(server, first, false); connect(server, second, false);
        unrelated.discard();
        StackingGameMod.LOGGER.info("LAB_PROBE_PASS");
    }

    private List<Warden> eventWardens(ServerLevel level) {
        List<Warden> wardens = new ArrayList<>();
        for (var entity : level.getAllEntities()) if (entity instanceof Warden w && w.isAlive()
                && !w.isRemoved() && w.getTags().contains("umetate_zigoku_warden")) wardens.add(w);
        return wardens;
    }

    @SuppressWarnings("unchecked")
    private void checkPlayerCommands(MinecraftServer server, StackingRuntime runtime) throws Exception {
        ServerLevel level = server.overworld();
        ServerPlayer player = player(level, "CommandProbe");
        player.setPos(.5, 49, -12.5); connect(server, player, true);
        var source = server.createCommandSourceStack().withEntity(player);
        BlockPos floor = new BlockPos(0, 48, -13);
        List<BlockState> original = new ArrayList<>();
        for (int i = 0; i < 9; i++) original.add(level.getBlockState(floor.above(i)));
        level.setBlock(floor, Blocks.STONE.defaultBlockState(), 18);
        for (int i = 1; i < 9; i++) level.setBlock(floor.above(i), Blocks.AIR.defaultBlockState(), 18);
        var pig = net.minecraft.world.entity.EntityType.PIG.create(level);
        pig.setNoAi(true); pig.setPos(.5, 49, -12.5); level.addFreshEntity(pig);
        check(server.getCommands().getDispatcher().execute("umetate stamp", source) == 3, "stamp受付");
        var stamp = ((List<?>) field(runtime.stamps, "active")).get(0);
        var blocks = (List<net.minecraft.world.entity.item.FallingBlockEntity>) field(stamp, "blocks");
        check(blocks.size() == 3, "黒曜石3個");
        for (int i = 0; i < 3; i++) check(blocks.get(i).getBlockState().is(Blocks.OBSIDIAN)
                && Math.abs(blocks.get(i).getY() - (player.getBoundingBox().maxY + 3 + i)) < .001, "頭上3ブロックから縦3個");
        double startY = blocks.get(0).getY();
        for (int tick = 0; tick < 60; tick++) {
            runtime.stamps.tick();
            for (var block : blocks) if (!block.isRemoved()) block.tick();
            if (tick == 18) check(blocks.get(0).getY() == startY, "落下前の予告");
        }
        for (int i = 1; i <= 3; i++) check(level.getBlockState(floor.above(i)).is(Blocks.OBSIDIAN), "着地後も黒曜石が残る");
        check(pig.getHealth() < pig.getMaxHealth(), "落下する黒曜石が衝突ダメージを与える");
        pig.discard();
        check(((List<?>) field(runtime.stamps, "active")).isEmpty(), "着地後に管理情報を片付ける");
        check(server.getCommands().getDispatcher().execute("umetate atamahuttou", source) == 0, "頭上に既存ブロックがあれば溶岩で上書きしない");
        for (int i = 1; i < 9; i++) level.setBlock(floor.above(i), Blocks.AIR.defaultBlockState(), 18);
        check(server.getCommands().getDispatcher().execute("umetate atamahuttou", source) == 1, "atamahuttou受付");
        BlockPos lava = BlockPos.containing(player.getX(), player.getBoundingBox().maxY + 1, player.getZ());
        check(level.getBlockState(lava).is(Blocks.LAVA) && level.getFluidState(lava).isSource(), "頭上1ブロックに溶岩源");
        level.getFluidState(lava).tick(level, lava);
        check(level.getBlockState(lava.below()).is(Blocks.LAVA), "溶岩が下へ流れる");
        for (int i = 0; i < 9; i++) level.setBlock(floor.above(i), original.get(i), 18);
        player.setPos(.5, 7, -12.5);
        check(server.getCommands().getDispatcher().execute("umetate stamp", source) == 0, "stampは2階原本を保護");
        check(server.getCommands().getDispatcher().execute("umetate atamahuttou", source) == 0, "溶岩は2階原本を保護");
        player.setPos(.5, 49, -12.5);
        check(server.getCommands().getDispatcher().execute("umetate stamp", source) == 3, "stamp再実行");
        var pending = ((List<?>) field(runtime.stamps, "active")).get(0);
        var pendingBlocks = (List<net.minecraft.world.entity.item.FallingBlockEntity>) field(pending, "blocks");
        runtime.reset(server);
        check(pendingBlocks.stream().allMatch(net.minecraft.world.entity.Entity::isRemoved), "resetで空中のstampを片付ける");
        connect(server, player, false);
    }

    // umetate <名前> [回数] [送った人]（埋め立て PR1）。18個の登録・回数の範囲。そうてんもんさんのイベントは待ち行列を1つしか使わず、
    // 回数の分だけ続けて起き、あとのギフトはそのあと。/umetate reset と stackgame cancel は残りの回数ごと止める。
    // 回数の確かめには、すぐ終わる voidbomb（約2秒）を使う。
    private void checkUmetateCommands(MinecraftServer server, StackingRuntime runtime) throws Exception {
        var dispatcher = server.getCommands().getDispatcher();
        var umetate = dispatcher.getRoot().getChild("umetate");
        for (String key : jp.streamtorearn.stackinggame.command.UmetateKeys.EVENTS) check(umetate.getChild(key) != null, "umetate " + key + " を登録");
        for (String key : jp.streamtorearn.stackinggame.command.UmetateKeys.LAB) check(umetate.getChild(key) != null, "umetate " + key + " を登録");
        check(umetate.getChild("reset") != null && umetate.getChild("gift_spawn_zombie") == null, "reset は残し、中身の無いイベントは登録しない");
        var console = server.createCommandSourceStack();
        for (String bad : List.of("umetate voidbomb 0", "umetate voidbomb 100001")) {
            boolean rejected = false;
            try { dispatcher.execute(bad, console); } catch (com.mojang.brigadier.exceptions.CommandSyntaxException e) { rejected = true; }
            check(rejected, "回数の範囲外を受け付けない: " + bad);
        }
        ServerPlayer target = player(server.overworld(), "RepeatProbe");
        target.setPos(.5, 49, -12.5); connect(server, target, true);
        long[] tick = {0};
        try {
            check(dispatcher.execute("umetate voidbomb 3 視聴者 A 😀", console) == 1, "回数と送った人の名前（空白・絵文字入り）を受け付ける");
            check(runtime.events.waitingCount() == 1, "回数があっても待ち行列は1つ");
            check(dispatcher.execute("umetate voidbomb 1 B", console) == 1, "あとのギフトも受け付ける");
            List<String> starts = runEvents(runtime, server, target, tick, 4);
            check(starts.size() == 4, "3回と1回の合わせて4回始まる: " + starts);
            String first = starts.get(0).split("\\|")[0];
            check(starts.subList(0, 3).equals(List.of(first + "|2", first + "|1", first + "|0")), "同じギフトが3回続けて始まる: " + starts);
            check(!starts.get(3).startsWith(first + "|") && starts.get(3).endsWith("|0"), "あとのギフトは3回のあと: " + starts);
            runEvents(runtime, server, target, tick, 0);
            // /umetate reset で残りの回数ごと止まる。
            check(dispatcher.execute("umetate voidbomb 5", console) == 1, "5回を受け付ける");
            runEvents(runtime, server, target, tick, 1);
            check(runtime.events.activeRepeatsLeft() == 4, "1回目のあと残り4回");
            check(dispatcher.execute("umetate reset", console) == 1, "reset受付");
            // 復元中に届いたギフトは、待たせて、終わってから起こす（2026-10-26 ユーザーの決定）。
            check(runtime.lab.blocksEvents(), "復元中");
            check(dispatcher.execute("umetate voidbomb 1 待つ人", console) == 1 && runtime.events.waitingCount() == 1, "復元中に届いたギフトは待ち行列に入る（消さない）");
            for (int i = 0; i < 20000 && runtime.lab.blocksEvents(); i++) runtime.lab.tick(server);
            List<String> afterReset = runEvents(runtime, server, target, tick, 0);
            check(afterReset.size() == 1 && afterReset.get(0).endsWith("|0") && runtime.events.waitingCount() == 0,
                    "reset で前の残りは消え、復元中に届いた1回だけが起きる: " + afterReset);
            // 死んでも残りの回数は消えない（最後のレビュー 重要1）。死んだときの取り消しは、終わったときと同じに続ける。
            check(dispatcher.execute("umetate voidbomb 3", console) == 1, "3回を受け付ける");
            runEvents(runtime, server, target, tick, 1);
            runtime.events.cancelActiveForPlayer(server, target.getUUID(), jp.streamtorearn.stackinggame.event.CancelReason.PLAYER_DEATH);
            List<String> afterDeath = runEvents(runtime, server, target, tick, 0);
            check(afterDeath.size() == 2, "1回目の最中に死んでも、残り2回が起きる: " + afterDeath);
            // stackgame cancel でも残りの回数ごと止まる。
            check(dispatcher.execute("umetate voidbomb 3", console) == 1, "3回を受け付ける");
            runEvents(runtime, server, target, tick, 1);
            check(dispatcher.execute("stackgame cancel RepeatProbe", console) == 1, "cancel受付");
            check(runEvents(runtime, server, target, tick, 0).isEmpty(), "cancel のあと残りの回数は起きない");
        } finally {
            runtime.reset(server);
            connect(server, target, false);
        }
    }

    // 研究室マップのアリーナは、枠の内側 Y 49〜64 まで（埋め立て PR1 の Task 3）。設定ファイルの max-y（既定 56）によらない。
    // まっさらなマップで、枠の内側 2704マスが空気で、枠の骨組みが Y 49〜64 を囲んでいることも確かめる。
    private void checkLabFrame(MinecraftServer server, StackingRuntime runtime) {
        ServerLevel level = server.overworld();
        int air = 0;
        for (int x = LabLayout.FRAME_MIN_X; x <= LabLayout.FRAME_MAX_X; x++) for (int y = LabLayout.FRAME_MIN_Y; y <= LabLayout.FRAME_MAX_Y; y++)
            for (int z = LabLayout.FRAME_MIN_Z; z <= LabLayout.FRAME_MAX_Z; z++) if (level.getBlockState(new BlockPos(x, y, z)).isAir()) air++;
        check(air == LabLayout.FRAME_VOLUME, "まっさらな枠の内側は空気: " + air + "/" + LabLayout.FRAME_VOLUME);
        // 枠の上（Y 65〜80）も空いている。アリーナの地面を探し始める高さが Y 80 になったため（設計書 3.1。最後のレビュー 軽い10）。
        int above = 0;
        for (int x = LabLayout.FRAME_MIN_X; x <= LabLayout.FRAME_MAX_X; x++) for (int y = LabLayout.FRAME_MAX_Y + 1; y <= 80; y++)
            for (int z = LabLayout.FRAME_MIN_Z; z <= LabLayout.FRAME_MAX_Z; z++) if (!level.getBlockState(new BlockPos(x, y, z)).isAir()) above++;
        check(above == 0, "枠の上（Y 65〜80）は空いている: " + above);
        // 枠は岩盤の骨組み（2026-10-26 に実物で調べた）：Y 49 と Y 64 の外周（x か z が ±7）はぐるりと岩盤、Y 50〜63 は四隅の柱だけ。
        // 枠の内側の真下（Y 48）は床がある。横は開いているので、勝ちの判定は内側の 2704マスだけを見る。
        List<String> missing = new ArrayList<>();
        for (int i = -7; i <= 7; i++) for (int y : new int[]{LabLayout.FRAME_MIN_Y, LabLayout.FRAME_MAX_Y})
            for (BlockPos pos : List.of(new BlockPos(i, y, -7), new BlockPos(i, y, 7), new BlockPos(-7, y, i), new BlockPos(7, y, i)))
                if (!level.getBlockState(pos).is(Blocks.BEDROCK)) missing.add(pos.toShortString());
        for (int y = LabLayout.FRAME_MIN_Y; y <= LabLayout.FRAME_MAX_Y; y++) for (int cx : new int[]{-7, 7}) for (int cz : new int[]{-7, 7})
            if (!level.getBlockState(new BlockPos(cx, y, cz)).is(Blocks.BEDROCK)) missing.add(cx + ", " + y + ", " + cz);
        for (int x = LabLayout.FRAME_MIN_X; x <= LabLayout.FRAME_MAX_X; x++) for (int z = LabLayout.FRAME_MIN_Z; z <= LabLayout.FRAME_MAX_Z; z++)
            if (level.getBlockState(new BlockPos(x, LabLayout.FRAME_MIN_Y - 1, z)).isAir()) missing.add(x + ", 48, " + z + "（床）");
        check(missing.isEmpty(), "枠の骨組み（Y 49 と Y 64 の輪・四隅の柱・内側の床）がある: " + missing.size() + " 例 " + missing.stream().limit(5).toList());
        var box = runtime.arena.bounds();
        check(box.minX() == LabLayout.FRAME_MIN_X && box.maxX() == LabLayout.FRAME_MAX_X && box.minZ() == LabLayout.FRAME_MIN_Z
                && box.maxZ() == LabLayout.FRAME_MAX_Z && box.minY() == LabLayout.FRAME_MIN_Y && box.maxY() == LabLayout.FRAME_MAX_Y,
                "研究室マップのアリーナは枠の内側（Y 49〜64）: " + runtime.arena.summary());
    }

    // 研究室の5つの順番待ち（最後のレビュー 重要4。2026-10-26 ユーザーの決定）。
    // 頭沸騰を2回：1回目はすぐ、2回目は1秒後に、その時のプレイヤーの位置に出る（追いかける）。表示はギフトごとに1回。
    // 復元中に届いたお助けは、待って、終わってから起きる。
    private void checkLabActionLanes(MinecraftServer server, StackingRuntime runtime) throws Exception {
        ServerLevel level = server.overworld();
        var dispatcher = server.getCommands().getDispatcher();
        var console = server.createCommandSourceStack();
        var calls = jp.douma.displaymod.api.DisplayApi.CALLS;
        ServerPlayer target = player(level, "LaneProbe");
        BlockPos a = new BlockPos(0, 48, -13), b = new BlockPos(4, 48, -13);
        for (BlockPos floor : List.of(a, b)) {
            level.setBlock(floor, Blocks.STONE.defaultBlockState(), 18);
            for (int i = 1; i < 9; i++) level.setBlock(floor.above(i), Blocks.AIR.defaultBlockState(), 18);
        }
        target.setPos(a.getX() + .5, 49, a.getZ() + .5); connect(server, target, true);
        long t = server.getTickCount();
        try {
            calls.clear();
            check(dispatcher.execute("umetate atamahuttou 2 Viewer", console) == 1, "1回目はすぐ");
            check(level.getBlockState(a.above(3)).is(Blocks.LAVA), "1回目は A の頭上");
            check(runtime.labLanes.pending("atamahuttou") == 1, "2回目は順番待ち");
            target.setPos(b.getX() + .5, 49, b.getZ() + .5);
            runtime.tickLabActions(server, t + 5);
            check(!level.getBlockState(b.above(3)).is(Blocks.LAVA), "1秒たつまでは2回目を出さない");
            runtime.tickLabActions(server, t + 20);
            check(level.getBlockState(b.above(3)).is(Blocks.LAVA) && runtime.labLanes.pending("atamahuttou") == 0, "2回目は動いた先（B）の頭上に出る");
            check(calls.size() == 1 && "頭沸騰".equals(calls.get(0).get("title")) && Integer.valueOf(2).equals(calls.get(0).get("count")), "表示はギフトごとに1回: " + calls);
            // 復元中に届いたお助けは、待って、終わってから起きる。
            check(dispatcher.execute("umetate reset", console) == 1, "reset受付");
            check(dispatcher.execute("umetate otasuke 1", console) == 1 && runtime.labLanes.pending("otasuke") == 1, "復元中のお助けは順番待ち");
            runtime.tickLabActions(server, t + 100);
            check(runtime.labLanes.pending("otasuke") == 1, "復元が終わるまでは待つ");
            for (int i = 0; i < 20000 && runtime.lab.blocksEvents(); i++) runtime.lab.tick(server);
            runtime.tickLabActions(server, t + 200);
            check(runtime.labLanes.pending("otasuke") == 0 && frameCount(level, Blocks.GOLD_BLOCK) == LabLayout.FRAME_VOLUME / 2, "復元のあとにお助けが起きる");
            // 片付け：3階を元に戻す。/umetate reset は順番待ちも捨てる。
            runtime.labLanes.offer("stamp", 3, "");
            check(dispatcher.execute("umetate reset", console) == 1 && runtime.labLanes.pending() == 0, "/umetate reset で順番待ちも捨てる");
            for (int i = 0; i < 20000 && runtime.lab.blocksEvents(); i++) runtime.lab.tick(server);
        } finally {
            runtime.labLanes.clear();
            connect(server, target, false);
        }
    }

    // 勝ちの判定（埋め立て PR1 の Task 4）。枠の内側 2704マスが金とダイヤで全部埋まったら10から数え、0で花火を出して枠を空にする。
    // 1マスでも欠けたら止まる。羊毛があったり、下の8段（otasuke）だけだったりでは数え始めない。/umetate reset のあいだは止まる。
    private void checkVictory(MinecraftServer server, StackingRuntime runtime) throws Exception {
        ServerLevel level = server.overworld();
        var lab = runtime.lab;
        var dispatcher = server.getCommands().getDispatcher();
        int winsBefore = victoryWins(lab);
        // 1. 金とダイヤを混ぜて埋めると、10秒あまりで勝ち、枠が空になり、花火が上がる。
        int rocketsBefore = rockets(level);
        fillFrame(level, (x, y, z) -> (x + y + z) % 2 == 0 ? Blocks.GOLD_BLOCK.defaultBlockState() : Blocks.DIAMOND_BLOCK.defaultBlockState());
        // 枠の上に立っている配信者（最後の段を置いたところ）と、枠の上に積まれた砂（最後のレビュー 重要3・軽い9）。
        ServerPlayer standing = player(level, "TopProbe");
        standing.setPos(.5, LabLayout.FRAME_MAX_Y + 1, .5); connect(server, standing, true);
        BlockPos sand = new BlockPos(3, LabLayout.FRAME_MAX_Y + 1, 3);
        level.setBlock(sand, Blocks.SAND.defaultBlockState(), 18);
        // 置いたときに入る「落ちる予定」は消しておく（下が空いたことを知らされて、改めて入るかを見る）。
        level.getBlockTicks().clearArea(new net.minecraft.world.level.levelgen.structure.BoundingBox(sand));
        check(!level.getBlockTicks().hasScheduledTick(sand, Blocks.SAND), "砂の予定を消した");
        for (int i = 0; i < 9 * 20; i++) lab.tick(server);
        check(victoryWins(lab) == winsBefore && frameCount(level, null) == LabLayout.FRAME_VOLUME, "10秒たつまでは勝ちにしない");
        for (int i = 0; i < 2 * 20 + 10; i++) lab.tick(server);
        check(victoryWins(lab) == winsBefore + 1, "10秒あまりで勝ち");
        check(frameCount(level, Blocks.AIR) == LabLayout.FRAME_VOLUME, "勝ったら枠の中を全部消す");
        check(rockets(level) - rocketsBefore >= 5, "花火を5発以上上げる: " + (rockets(level) - rocketsBefore));
        check(standing.hasEffect(net.minecraft.world.effect.MobEffects.SLOW_FALLING) && standing.fallDistance == 0, "枠の上の人は、消す前にゆっくり落ちる効果がかかる");
        check(level.getBlockTicks().hasScheduledTick(sand, Blocks.SAND), "枠の上の砂は、下が空いたことを知って落ちる");
        level.setBlock(sand, Blocks.AIR.defaultBlockState(), 18);
        connect(server, standing, false);
        // 2. 埋めて3秒後に1マスを空気にすると止まり、15秒進めても残りは消えない。
        fillFrame(level, (x, y, z) -> Blocks.GOLD_BLOCK.defaultBlockState());
        for (int i = 0; i < 3 * 20; i++) lab.tick(server);
        level.setBlock(new BlockPos(0, 60, 0), Blocks.AIR.defaultBlockState(), 18);
        for (int i = 0; i < 15 * 20; i++) lab.tick(server);
        check(victoryWins(lab) == winsBefore + 1 && frameCount(level, Blocks.GOLD_BLOCK) == LabLayout.FRAME_VOLUME - 1, "1マス欠けたら止まり、消えない");
        // 3. 1マスでも羊毛があれば数え始めない。
        level.setBlock(new BlockPos(0, 60, 0), Blocks.WHITE_WOOL.defaultBlockState(), 18);
        for (int i = 0; i < 15 * 20; i++) lab.tick(server);
        check(victoryWins(lab) == winsBefore + 1 && frameCount(level, null) == LabLayout.FRAME_VOLUME, "羊毛があると勝ちにならない");
        // 4. 下の8段だけ金（umetate otasuke）では数え始めない。
        fillFrame(level, (x, y, z) -> Blocks.AIR.defaultBlockState());
        check(dispatcher.execute("umetate otasuke", server.createCommandSourceStack()) > 0, "otasuke受付");
        for (int i = 0; i < 15 * 20; i++) lab.tick(server);
        check(victoryWins(lab) == winsBefore + 1 && frameCount(level, Blocks.GOLD_BLOCK) == LabLayout.FRAME_VOLUME / 2, "下の8段だけでは勝ちにならない");
        // 5. 数えているあいだに /umetate reset で止まり、勝ちにならない（3階は2階の原本どおりに戻る）。
        //    残り約0.5秒で reset する。守りが無ければ、復元の読み取り中（約44 tick）に勝ちに届く（最後のレビュー 軽い10）。
        fillFrame(level, (x, y, z) -> Blocks.DIAMOND_BLOCK.defaultBlockState());
        for (int i = 0; i < 190; i++) lab.tick(server);
        check(victoryWins(lab) == winsBefore + 1, "まだ勝ちではない");
        check(dispatcher.execute("umetate reset", server.createCommandSourceStack()) == 1, "reset受付");
        for (int i = 0; i < 20000 && lab.blocksEvents(); i++) lab.tick(server);
        for (int i = 0; i < 15 * 20; i++) lab.tick(server);
        check(victoryWins(lab) == winsBefore + 1 && frameCount(level, Blocks.AIR) == LabLayout.FRAME_VOLUME, "reset のあいだは止まり、勝ちにならない");
        for (var entity : level.getAllEntities()) if (entity instanceof net.minecraft.world.entity.projectile.FireworkRocketEntity rocket) rocket.discard();
        // 6. 勝ちの判定で例外が起きても、研究室の処理とサーバーの tick は止めない（最後のレビュー 軽い8）。
        Object victory = field(lab, "victory");
        Field countdown = victory.getClass().getDeclaredField("countdown"); countdown.setAccessible(true);
        Object saved = countdown.get(victory);
        countdown.set(victory, null);
        try {
            fillFrame(level, (x, y, z) -> Blocks.GOLD_BLOCK.defaultBlockState());
            for (int i = 0; i < 20; i++) lab.tick(server);
            check(!lab.blocksEvents() && field(lab, "failure") == null, "勝ちの判定の例外で、研究室の処理を止めない");
        } finally {
            countdown.set(victory, saved);
            fillFrame(level, (x, y, z) -> Blocks.AIR.defaultBlockState());
        }
    }

    @FunctionalInterface private interface FrameBlock { BlockState at(int x, int y, int z); }

    private static void fillFrame(ServerLevel level, FrameBlock block) {
        for (int x = LabLayout.FRAME_MIN_X; x <= LabLayout.FRAME_MAX_X; x++) for (int y = LabLayout.FRAME_MIN_Y; y <= LabLayout.FRAME_MAX_Y; y++)
            for (int z = LabLayout.FRAME_MIN_Z; z <= LabLayout.FRAME_MAX_Z; z++) level.setBlock(new BlockPos(x, y, z), block.at(x, y, z), 18);
    }

    /** 枠の内側で、block のマスの数（block が null なら空気でないマスの数）。 */
    private static int frameCount(ServerLevel level, net.minecraft.world.level.block.Block block) {
        int count = 0;
        for (int x = LabLayout.FRAME_MIN_X; x <= LabLayout.FRAME_MAX_X; x++) for (int y = LabLayout.FRAME_MIN_Y; y <= LabLayout.FRAME_MAX_Y; y++)
            for (int z = LabLayout.FRAME_MIN_Z; z <= LabLayout.FRAME_MAX_Z; z++) {
                BlockState state = level.getBlockState(new BlockPos(x, y, z));
                if (block == null ? !state.isAir() : state.is(block)) count++;
            }
        return count;
    }

    private static int rockets(ServerLevel level) {
        int count = 0;
        for (var entity : level.getAllEntities()) if (entity instanceof net.minecraft.world.entity.projectile.FireworkRocketEntity && !entity.isRemoved()) count++;
        return count;
    }

    private static int victoryWins(LabStageService lab) throws Exception {
        return ((jp.streamtorearn.stackinggame.lab.LabVictoryService) field(lab, "victory")).wins();
    }

    // ギフトの表示（埋め立て PR1 の Task 2）。そうてんもんさんのイベントは1回目が始まったときに1回だけ、研究室の5つは動いたときに出す。
    // 送った人の名前が無い（手で打った）ときは出さない。DisplayMOD は検証用の偽物（jp.douma.displaymod.api.DisplayApi）。
    private void checkDisplayOnStart(MinecraftServer server, StackingRuntime runtime) throws Exception {
        var calls = jp.douma.displaymod.api.DisplayApi.CALLS;
        check(jp.streamtorearn.stackinggame.integration.OptionalDisplay.available(), "DisplayMOD の入口を見つける");
        var dispatcher = server.getCommands().getDispatcher();
        var console = server.createCommandSourceStack();
        ServerPlayer target = player(server.overworld(), "DisplayProbe");
        target.setPos(.5, 49, -12.5); connect(server, target, true);
        long[] tick = {100000};
        try {
            calls.clear();
            check(dispatcher.execute("umetate voidbomb 2 Alice 😀", console) == 1, "回数と名前付きで受け付ける");
            check(calls.isEmpty(), "受け付けた時点では出さない: " + calls);
            runEvents(runtime, server, target, tick, 1);
            check(calls.size() == 1, "1回目の開始で出す: " + calls);
            Map<String, Object> shown = calls.get(0);
            check("ボイドボム".equals(shown.get("title")) && "Alice 😀".equals(shown.get("listenerName"))
                    && Integer.valueOf(2).equals(shown.get("count")) && "{ListenerName}".equals(shown.get("subtitle")), "題名・送った人・回数: " + shown);
            runEvents(runtime, server, target, tick, 0);
            check(calls.size() == 1, "2回目の開始では出さない: " + calls);
            check(dispatcher.execute("umetate voidbomb 1", console) == 1, "名前なしで受け付ける");
            runEvents(runtime, server, target, tick, 0);
            check(calls.size() == 1, "送った人の名前が無ければ出さない: " + calls);
            check(dispatcher.execute("umetate otasuke 1 Bob", console) > 0, "otasuke受付");
            check(calls.size() == 2 && "お助け".equals(calls.get(1).get("title")) && "Bob".equals(calls.get(1).get("listenerName"))
                    && Integer.valueOf(1).equals(calls.get(1).get("count")), "研究室の5つは動いたときに出す: " + calls);
            // 名前に " があっても、そのまま渡る（最後のレビュー 軽い10）。
            check(dispatcher.execute("umetate mofumofu 1 a\"b c", console) > 0, "mofumofu受付");
            check(calls.size() == 3 && "a\"b c".equals(calls.get(2).get("listenerName")), "名前の \" もそのまま: " + calls);
            // stackgame run は今までどおり表示しない（--sender があっても。最後のレビュー 軽い7）。
            check(dispatcher.execute("stackgame run voidbomb --sender Zed", console) == 1, "stackgame run受付");
            runEvents(runtime, server, target, tick, 0);
            check(calls.size() == 3, "stackgame run では表示しない: " + calls);
            // 3階を元に戻して、あとの確かめ（otasuke の範囲など）に響かないようにする。
            check(dispatcher.execute("umetate reset", console) == 1, "reset受付");
            for (int i = 0; i < 20000 && runtime.lab.blocksEvents(); i++) runtime.lab.tick(server);
            check(!runtime.lab.blocksEvents(), "復元完了");
        } finally {
            runtime.reset(server);
            connect(server, target, false);
        }
    }

    /** イベントを進め、始まったもの（requestId|残りの回数）を、want 個そろうか、何も動かなくなるまで集める。want が 0 なら動かなくなるまで。 */
    private List<String> runEvents(StackingRuntime runtime, MinecraftServer server, ServerPlayer target, long[] tick, int want) {
        List<String> starts = new ArrayList<>();
        String last = "";
        int idle = 0;
        for (int i = 0; i < 6000 && (want == 0 || starts.size() < want) && idle < 200; i++) {
            target.setHealth(target.getMaxHealth());
            runtime.events.tick(server, tick[0]++);
            boolean active = !runtime.events.activeKey().equals("-");
            String now = active ? runtime.events.activeExternalRequestId() + "|" + runtime.events.activeRepeatsLeft() : "";
            if (active && !now.equals(last)) starts.add(now);
            idle = active || runtime.events.waitingCount() > 0 ? 0 : idle + 1;
            last = now;
        }
        return starts;
    }
}
