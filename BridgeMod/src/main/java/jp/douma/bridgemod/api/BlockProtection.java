package jp.douma.bridgemod.api;

import it.unimi.dsi.fastutil.longs.LongOpenHashSet;
import it.unimi.dsi.fastutil.longs.LongSet;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;

import java.util.ArrayList;
import java.util.List;

/**
 * 妨害の自動処理から守るブロック（コマンドブロック3種。一覧は ProtectedBlockIds）。ゲーム MOD からも使う公開 API。
 * <ul>
 *   <li>Java でブロックを書き換える前に {@link #canModifyBlock} を呼び、false なら飛ばす。</li>
 *   <li>/fill・/setblock など、ブロックを変えうるコマンドを実行するときは {@link #runProtected} で包む。
 *       実行のあとで、変わってしまった保護ブロックを中身（コマンド・自動実行など）ごと戻す。</li>
 * </ul>
 * サーバーのメインスレッドから呼ぶこと。
 */
public final class BlockProtection {
    /** オーバーワールドのスポーン地点の周りで常に読み込まれている範囲（ServerLevel.setDefaultSpawnPos の TicketType.START と同じ半径）。 */
    static final int SPAWN_CHUNK_RADIUS = 11;
    /** チケットは中心から2チャンク先までを読み込むので、そこまでは fill などが届く。控える範囲をこの分広げる。 */
    static final int LOADED_MARGIN = 2;
    private static int depth;
    private static long restoredTotal;

    private record Kept(ServerLevel level, BlockPos pos, BlockState state, BlockEntity entity) {}

    private BlockProtection() {}

    public static boolean isProtectedBlock(BlockState state) {
        return state != null && ProtectedBlockIds.isProtectedId(BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
    }

    public static boolean isProtectedBlock(BlockGetter level, BlockPos pos) {
        return isProtectedBlock(level.getBlockState(pos));
    }

    /** 自動処理がこの位置のブロックを書き換えてよいか。保護ブロックなら false。 */
    public static boolean canModifyBlock(BlockGetter level, BlockPos pos) {
        return !isProtectedBlock(level, pos);
    }

    /** サーバーを起動してから戻した数の累計（BridgeMOD の状態の protectedBlockRestores）。 */
    public static long restoredTotal() {
        return restoredTotal;
    }

    /**
     * action を実行し、その間に変わった保護ブロックを戻す。戻した数を返す。label はログ用（"bridgemod" など）。
     * action が例外を投げても戻してから、その例外を呼び出し元へ投げ直す。
     * 入れ子で呼ばれたときは控え直さず、外側の呼び出しがまとめて戻す。
     */
    public static int runProtected(MinecraftServer server, String label, Runnable action) {
        if (depth > 0 || server == null) { action.run(); return 0; }
        List<Kept> kept = capture(server);
        int restored = 0;
        depth++;
        try {
            action.run();
        } finally {
            depth--;
            restored = restore(kept, label);
        }
        return restored;
    }

    // プレイヤーの描画距離・強制読み込み・スポーンチャンク（それぞれ LOADED_MARGIN 広げる）のうち、
    // 読み込み済みのチャンクにある保護ブロックを控える。NBT は戻すときだけ取り出す（取り除かれた BlockEntity にも値は残っている）。
    private static List<Kept> capture(MinecraftServer server) {
        List<Kept> kept = new ArrayList<>();
        int view = server.getPlayerList().getViewDistance();
        for (ServerLevel level : server.getAllLevels()) {
            LongSet chunks = new LongOpenHashSet();
            for (long forced : level.getForcedChunks()) addSquare(chunks, new ChunkPos(forced), LOADED_MARGIN);
            for (ServerPlayer player : level.players()) addSquare(chunks, player.chunkPosition(), view + LOADED_MARGIN);
            if (level.dimension() == Level.OVERWORLD) addSquare(chunks, new ChunkPos(level.getSharedSpawnPos()), SPAWN_CHUNK_RADIUS + LOADED_MARGIN);
            for (long packed : chunks) {
                LevelChunk chunk = level.getChunkSource().getChunkNow(ChunkPos.getX(packed), ChunkPos.getZ(packed));
                if (chunk == null) continue;
                for (BlockEntity entity : chunk.getBlockEntities().values()) {
                    BlockPos pos = entity.getBlockPos();
                    BlockState state = chunk.getBlockState(pos);
                    if (isProtectedBlock(state)) kept.add(new Kept(level, pos.immutable(), state, entity));
                }
            }
        }
        return kept;
    }

    private static void addSquare(LongSet chunks, ChunkPos center, int radius) {
        for (int x = center.x - radius; x <= center.x + radius; x++)
            for (int z = center.z - radius; z <= center.z + radius; z++) chunks.add(ChunkPos.asLong(x, z));
    }

    // ブロックの状態が違う、または BlockEntity が別物に入れ替わった位置だけを戻す（/data で中身だけ変えた場合は戻さない）。
    private static int restore(List<Kept> kept, String label) {
        int restored = 0;
        for (Kept k : kept) {
            try {
                if (k.level.getBlockState(k.pos) == k.state && k.level.getBlockEntity(k.pos) == k.entity) continue;
                // loadStatic は id で種類を決めるので、id 付きで取り出す。
                CompoundTag nbt = k.entity.saveWithId();
                // 周りへ通知せずに置く。通知すると、空の BlockEntity（powered=false）のまま隣の信号で実行が予約される。
                k.level.setBlock(k.pos, k.state, Block.UPDATE_CLIENTS);
                // loadStatic は level が null の状態で読み込むので、auto=true でも実行を予約しない（ワールドの読み込みと同じ）。
                BlockEntity entity = BlockEntity.loadStatic(k.pos, k.state, nbt);
                if (entity != null) { k.level.setBlockEntity(entity); entity.setChanged(); }
                // powered を戻してから周りへ通知し、レッドストーンや比較器の状態をそろえる。
                k.level.blockUpdated(k.pos, k.state.getBlock());
                restored++;
                System.out.println("[BlockProtection] restored " + BuiltInRegistries.BLOCK.getKey(k.state.getBlock()) + " at "
                    + k.pos.getX() + "," + k.pos.getY() + "," + k.pos.getZ() + " in " + k.level.dimension().location() + " (" + label + ")");
            } catch (RuntimeException error) {
                System.err.println("[BlockProtection] restore failed at " + k.pos.getX() + "," + k.pos.getY() + "," + k.pos.getZ()
                    + " in " + k.level.dimension().location() + " (" + label + "): " + error);
            }
        }
        restoredTotal += restored;
        return restored;
    }
}
