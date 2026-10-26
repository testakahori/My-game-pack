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
        checkPlayerCommands(server, runtime);
        checkUmetateCommands(server, runtime);
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
        check(zigokuMessages.stream().filter(m -> m.contains("2回のうち1回は実行できませんでした")).count() == 1
                && zigokuMessages.stream().noneMatch(m -> m.contains("実行中です")), "断った分はまとめて1行だけ知らせる");
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
        check(lab.zigoku(server.createCommandSourceStack()) == 2, "2回目開始");
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
            for (int i = 0; i < 20000 && runtime.lab.blocksEvents(); i++) runtime.lab.tick(server);
            check(runEvents(runtime, server, target, tick, 0).isEmpty() && runtime.events.waitingCount() == 0, "reset のあと残りの回数は起きない");
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
