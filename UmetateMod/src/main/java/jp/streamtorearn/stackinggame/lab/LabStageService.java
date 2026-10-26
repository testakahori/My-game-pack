package jp.streamtorearn.stackinggame.lab;

import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.util.*;
import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.BlockParticleOption;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerBossEvent;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.TicketType;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.BossEvent;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.Vec3;

/** 研究室MAP専用。原本2階と地獄1階には、復元・崩壊の書き込みを行わない。 */
public final class LabStageService {
    private enum Phase { IDLE, QUAKE, DOWN_FLASH, HELL, UP_FLASH }
    private static final TicketType<ChunkPos> TICKET = TicketType.create("umetate_lab", Comparator.comparingLong(ChunkPos::toLong));
    private final StackingRuntime runtime;
    private final java.util.function.LongSupplier clock;
    private final LabPresentation presentation;
    private final LabWardens wardens = new LabWardens();
    private final LabVictoryService victory = new LabVictoryService();
    private long victoryTicks;
    private final Set<UUID> visitors = new LinkedHashSet<>();
    private final Map<UUID, LabSavedData.Home> resetPlayers = new LinkedHashMap<>();
    private final Map<UUID, Integer> recoveryFlash = new HashMap<>();
    private final ServerBossEvent timer = new ServerBossEvent(Component.literal("地獄 残り 5:00"), BossEvent.BossBarColor.RED, BossEvent.BossBarOverlay.PROGRESS);
    private Phase phase = Phase.IDLE;
    private ServerLevel level;
    private LabSavedData saved;
    private LabRestoreJob restore;
    private long deadline;
    private int phaseTicks;
    private boolean tickets;
    private String failure;

    public LabStageService(StackingRuntime runtime) { this(runtime, System::currentTimeMillis, LabPresentation.NETWORK); }
    public LabStageService(StackingRuntime runtime, java.util.function.LongSupplier clock, LabPresentation presentation) {
        this.runtime = runtime; this.clock = clock; this.presentation = presentation;
    }
    public boolean isMaster(ServerLevel candidate, BlockPos pos) {
        return candidate == level && Math.abs(pos.getX()) <= 32 && Math.abs(pos.getZ()) <= 32 && pos.getY() >= 0 && pos.getY() <= 41;
    }
    public boolean blocksEvents() { return restore != null || phase == Phase.QUAKE || phase == Phase.DOWN_FLASH || phase == Phase.UP_FLASH; }
    /**
     * 研究室が落ち着いているか（地獄・復元・光・帰りの光のどれでもない）。地獄の順番待ちは、これが true になるまで待つ（埋め立て PR1）。
     * 研究室マップでないときは true（地獄は「研究室マップ専用です」で断られて終わる）。
     */
    public boolean idle() {
        return level == null || (failure == null && restore == null && phase == Phase.IDLE && recoveryFlash.isEmpty());
    }
    public boolean protects(ServerPlayer player) {
        return resetPlayers.containsKey(player.getUUID()) || recoveryFlash.containsKey(player.getUUID())
                || visitors.contains(player.getUUID()) && phase != Phase.HELL;
    }
    public void started(MinecraftServer server) {
        wardens.recover(server);
        phase = Phase.IDLE; failure = null; restore = null; tickets = false;
        visitors.clear(); resetPlayers.clear(); recoveryFlash.clear(); timer.removeAllPlayers();
        level = null; saved = null;
        runtime.arena.useLabFrame(false);
        try {
            var file = server.getWorldPath(LevelResource.ROOT).resolve("umetate_lab_map.json");
            if (!Files.isRegularFile(file)) return;
            var marker = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            if (marker.get("schema").getAsInt() != 1 || !"umetate_lab_map".equals(marker.get("map").getAsString())) return;
            level = server.overworld(); saved = LabSavedData.get(level);
            // 研究室マップでは、アリーナを枠の内側（Y 49〜64）にする（埋め立て PR1 の Task 3）。
            runtime.arena.useLabFrame(true);
            if (saved.needsRestore) { holdChunks(); validateMaster(); restore = new LabRestoreJob(level); }
        } catch (Exception e) { fail(e); }
    }
    private void validateMaster() {
        for (int x : new int[]{-32, 0, 32}) for (int z : new int[]{-32, 0, 32})
            if (!level.getBlockState(new BlockPos(x, 0, z)).is(Blocks.BEDROCK))
                throw new IllegalStateException("2階原本の岩盤が見つかりません。MAPを確認してください。");
        if (!level.getBlockState(new BlockPos(-7, 6, -7)).is(Blocks.BEDROCK))
            throw new IllegalStateException("2階原本の中央枠が見つかりません。");
    }
    public void keepNaturalSpawningOff(MinecraftServer server) {
        // 識別ファイルを確認できた研究室MAPだけを対象にする。ほかのゲームの固定設定には触れない。
        if (level == null || saved == null) return;
        var rule = level.getGameRules().getRule(net.minecraft.world.level.GameRules.RULE_DOMOBSPAWNING);
        if (rule.get()) rule.set(false, server);
    }
    private boolean ready(CommandSourceStack source) {
        if (level == null || saved == null) { source.sendFailure(Component.literal("このコマンドは umetate_lab_map 専用です。")); return false; }
        if (failure != null) { source.sendFailure(Component.literal("MAP処理を停止中: " + failure + "。確認後サーバーを再起動してください。")); return false; }
        if (restore != null || phase != Phase.IDLE || !recoveryFlash.isEmpty()) {
            source.sendFailure(Component.literal("復元または地獄イベントの実行中です。完了してから入力してください。")); return false;
        }
        return true;
    }
    public int reset(CommandSourceStack source) {
        if (!ready(source)) return 0;
        try {
            holdChunks(); validateMaster(); runtime.reset(source.getServer());
            for (ServerPlayer player : level.players()) if (onTop(player)) {
                resetPlayers.put(player.getUUID(), home(player)); saved.homes.put(player.getUUID(), home(player));
            }
            saved.needsRestore = true; saved.flush(level);
            restore = new LabRestoreJob(level);
            source.sendSuccess(() -> Component.literal("2階を原本に、3階の床・内装・収納・空気を復元しています。"), true);
            return 1;
        } catch (Exception e) { fail(e); source.sendFailure(Component.literal(failure)); return 0; }
    }
    public int zigoku(CommandSourceStack source) {
        if (!ready(source)) return 0;
        List<ServerPlayer> players = level.players().stream().filter(this::onTop).filter(p -> p.isAlive() && !p.isSpectator()).toList();
        if (players.isEmpty()) { source.sendFailure(Component.literal("3階に対象プレイヤーがいません。")); return 0; }
        for (ServerPlayer p : players) if (!presentation.available(p)) {
            source.sendFailure(Component.literal(p.getScoreboardName() + " のMinecraftにも UmetateMod 2.6.17以降を入れてください（揺れ・白い光の表示に必要）。")); return 0;
        }
        try {
            holdChunks(); runtime.reset(source.getServer());
            wardens.validate(level);
            for (ServerPlayer p : players) {
                // 地獄での到着場所を先に確かめる。見つからなければ崩壊を開始しない。
                landing(p.getX(), p.getZ(), LabLayout.HELL_FLOOR, LabLayout.HELL_FLOOR);
            }
            for (ServerPlayer p : players) { visitors.add(p.getUUID()); saved.homes.put(p.getUUID(), home(p)); }
            saved.flush(level); phase = Phase.QUAKE; phaseTicks = 0;
            for (ServerPlayer p : players) { presentation.send(p, 1, LabLayout.QUAKE_TICKS + 20); p.displayClientMessage(Component.literal("大地震！ 研究室が崩れ始めた…"), false); }
            source.sendSuccess(() -> Component.literal("地獄イベント開始。1階への移動から5分後に、壊れた状態の3階へ戻ります。"), true);
            return players.size();
        } catch (Exception e) { fail(e); source.sendFailure(Component.literal(failure)); return 0; }
    }
    private LabSavedData.Home home(ServerPlayer p) { return new LabSavedData.Home(p.getX(), p.getZ(), p.getYRot(), p.getXRot()); }
    private boolean onTop(ServerPlayer p) { return p.level() == level && LabLayout.onTop(p.getX(), p.getY(), p.getZ()); }
    public void tick(MinecraftServer server) {
        wardens.tick();
        victoryTicks++;
        if (level == null || saved == null) return;
        // 勝ちの判定（埋め立て PR1 の Task 4）。復元中・地獄のあいだ・止まっているときは、埋まっていないものとして扱う。
        // 勝ちの判定で何か起きても、研究室の処理とサーバーの tick は止めない（最後のレビュー 軽い8）。
        try {
            victory.tick(level, victoryTicks, failure == null && restore == null && phase == Phase.IDLE);
        } catch (RuntimeException e) {
            StackingGameMod.LOGGER.error("勝ちの判定でエラーが起きました（ゲームは続けます）", e);
        }
        if (failure != null) return;
        try {
            if (restore != null && restore.tick()) {
                restore = null; saved.needsRestore = false; saved.flush(level);
                resetPlayers.forEach((id, h) -> { ServerPlayer p = server.getPlayerList().getPlayer(id); if (p != null && p.isAlive()) { move(p, h, false); saved.homes.remove(id); } });
                saved.flush(level);
                resetPlayers.clear();
                server.getPlayerList().broadcastSystemMessage(Component.literal("3階を2階の原本から復元しました。"), false);
            }
            if (phase == Phase.QUAKE) {
                if (phaseTicks % 5 == 0) collapse();
                if (++phaseTicks >= LabLayout.QUAKE_TICKS) startFlash(Phase.DOWN_FLASH, server);
            } else if (phase == Phase.DOWN_FLASH) {
                if (++phaseTicks >= 20) {
                    forOnline(server, p -> { move(p, saved.homes.get(p.getUUID()), true); presentation.send(p, 3, LabLayout.FLASH_TICKS); });
                    wardens.spawn(level);
                    deadline = clock.getAsLong() + LabLayout.VISIT_MILLIS;
                    phase = Phase.HELL; phaseTicks = 0;
                }
            } else if (phase == Phase.HELL) {
                long now = clock.getAsLong();
                timer.setName(Component.literal("地獄 残り " + LabLayout.countdown(deadline, now)));
                timer.setProgress(LabLayout.remainingSeconds(deadline, now) / 300f);
                forOnline(server, timer::addPlayer);
                if (now >= deadline) { runtime.reset(server); startFlash(Phase.UP_FLASH, server); }
            } else if (phase == Phase.UP_FLASH && ++phaseTicks >= 20) {
                wardens.finish();
                // 帰還では復元しない。床下の岩盤まで含めて安全な足場を探す。
                forOnline(server, p -> { move(p, saved.homes.get(p.getUUID()), false); saved.homes.remove(p.getUUID()); presentation.send(p, 3, LabLayout.FLASH_TICKS); });
                saved.flush(level); visitors.clear(); timer.removeAllPlayers(); phase = Phase.IDLE;
            }
            recoverPlayers(server);
            if (phase == Phase.IDLE && restore == null && recoveryFlash.isEmpty()) releaseChunks();
        } catch (Exception e) { fail(e); }
    }
    private void recoverPlayers(MinecraftServer server) {
        // 途中で退出・死亡・サーバー停止した場合も、再参加時に帰還を確実に行う。
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            UUID id = p.getUUID();
            if (!saved.homes.containsKey(id) || !p.isAlive()) continue;
            if (visitors.contains(id)) {
                if (phase == Phase.HELL && (p.level() != level || p.getY() >= 0)) {
                    presentation.send(p, 2, 0); move(p, saved.homes.get(id), true); presentation.send(p, 3, LabLayout.FLASH_TICKS);
                }
                continue;
            }
            if (restore != null) continue;
            holdChunks();
            int elapsed = recoveryFlash.getOrDefault(id, 0);
            if (elapsed == 0) presentation.send(p, 2, 0);
            if (elapsed >= 20) {
                move(p, saved.homes.get(id), false); presentation.send(p, 3, LabLayout.FLASH_TICKS);
                saved.homes.remove(id); saved.flush(level); recoveryFlash.remove(id);
            } else recoveryFlash.put(id, elapsed + 1);
        }
        recoveryFlash.keySet().removeIf(id -> server.getPlayerList().getPlayer(id) == null);
    }
    private void startFlash(Phase next, MinecraftServer server) {
        phase = next; phaseTicks = 0;
        forOnline(server, p -> {
            presentation.send(p, 2, 0);
            p.playNotifySound(SoundEvents.BEACON_ACTIVATE, SoundSource.PLAYERS, 1.2f, 0.7f);
        });
    }
    private void forOnline(MinecraftServer server, java.util.function.Consumer<ServerPlayer> action) {
        for (UUID id : visitors) { ServerPlayer p = server.getPlayerList().getPlayer(id); if (p != null && p.isAlive()) action.accept(p); }
    }
    private void move(ServerPlayer p, LabSavedData.Home h, boolean down) {
        Vec3 target = landing(h.x(), h.z(), down ? -36 : 48, down ? -36 : 42);
        p.stopRiding(); p.teleportTo(level, target.x, target.y, target.z, h.yaw(), h.pitch());
        p.setDeltaMovement(Vec3.ZERO); p.fallDistance = 0;
    }
    private Vec3 landing(double x, double z, int top, int bottom) {
        int startX = Math.max(-28, Math.min(28, (int) Math.floor(x)));
        int startZ = Math.max(-28, Math.min(28, (int) Math.floor(z)));
        for (int radius = 0; radius <= 60; radius++) for (int dx = -radius; dx <= radius; dx++) for (int dz = -radius; dz <= radius; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) != radius) continue;
            int px = startX + dx, pz = startZ + dz;
            if (px < -30 || px > 30 || pz < -30 || pz > 30) continue;
            for (int y = top; y >= bottom; y--) {
                BlockPos ground = new BlockPos(px, y, pz);
                var state = level.getBlockState(ground);
                if (!state.isCollisionShapeFullBlock(level, ground) || state.is(Blocks.MAGMA_BLOCK) || state.is(Blocks.CAMPFIRE)) continue;
                if (level.getBlockState(ground.above()).isAir() && level.getBlockState(ground.above(2)).isAir())
                    return new Vec3(px + 0.5, y + 1.01, pz + 0.5);
            }
        }
        throw new IllegalStateException("安全な着地場所がありません。/umetate reset で3階を復元してください。");
    }
    private void collapse() {
        // 地形爆発を使わず、3階の外壁と回廊だけを壊す。破片は粒子で表し大量のEntityを残さない。
        for (int i = 0; i < 36; i++) {
            boolean wallX = level.random.nextBoolean();
            int edge = level.random.nextBoolean() ? 1 : -1;
            int along = level.random.nextInt(61) - 30;
            int y = 51 + level.random.nextInt(31);
            int depth = 26 + level.random.nextInt(6);
            BlockPos center = new BlockPos(wallX ? edge * depth : along, y, wallX ? along : edge * depth);
            for (BlockPos pos : BlockPos.betweenClosed(center.offset(-1, -1, -1), center.offset(1, 1, 1))) {
                if (Math.abs(pos.getX()) > 32 || Math.abs(pos.getZ()) > 32 || pos.getY() < 49 || pos.getY() > 82) continue;
                var state = level.getBlockState(pos);
                if (state.isAir() || state.is(Blocks.BEDROCK) || state.hasBlockEntity() || !state.getFluidState().isEmpty()
                        || runtime.protectedBlocks.isProtected(state)) continue;
                if (i < 4) level.sendParticles(new BlockParticleOption(ParticleTypes.BLOCK, state), pos.getX() + .5, pos.getY() + .5, pos.getZ() + .5, 6, .6, .8, .6, .05);
                level.setBlock(pos, Blocks.AIR.defaultBlockState(), 18);
            }
        }
        forOnline(level.getServer(), p -> {
            p.playNotifySound(SoundEvents.GENERIC_EXPLODE, SoundSource.BLOCKS, .8f, .55f);
            level.sendParticles(p, ParticleTypes.CLOUD, true, p.getX(), p.getY() + .5, p.getZ(), 12, 3, 1, 3, .03);
        });
    }
    private void holdChunks() {
        if (tickets) return;
        for (int x = -2; x <= 2; x++) for (int z = -2; z <= 2; z++) {
            ChunkPos pos = new ChunkPos(x, z); level.getChunkSource().addRegionTicket(TICKET, pos, 2, pos); level.getChunk(x, z);
        }
        tickets = true;
    }
    private void releaseChunks() {
        if (!tickets || level == null) return;
        for (int x = -2; x <= 2; x++) for (int z = -2; z <= 2; z++) {
            ChunkPos pos = new ChunkPos(x, z); level.getChunkSource().removeRegionTicket(TICKET, pos, 2, pos);
        }
        tickets = false;
    }
    private void fail(Exception e) {
        wardens.finish();
        failure = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        StackingGameMod.LOGGER.error("研究室MAPの処理を停止しました。帰還情報は保存されています。", e);
        timer.removeAllPlayers(); releaseChunks();
    }
    public void stopping() {
        wardens.finish();
        if (saved != null) saved.flush(level);
        timer.removeAllPlayers(); releaseChunks();
    }
    public void logout(ServerPlayer p) { timer.removePlayer(p); recoveryFlash.remove(p.getUUID()); }
    public void entityJoined(net.minecraft.world.entity.Entity entity) { wardens.joined(entity); }
}
