package jp.douma.saikutumod;

/**
 * 衝撃波が触ってよい所。爆心の周りの正方形のチャンクが読み込み済み（FULL）かを、tick ごとに一度だけ調べて覚える。
 * 読み込まれていないチャンクのブロックを読むと、サーバーはその場でチャンクを読み込む（生成もする）。
 * ブロックを変えたときの周りの反応（溶岩・つる・柵・扉など）や爆発は数ブロック先まで読むので、余白をとって確かめる（PR #75 レビュー）。
 * Minecraft に依存しない（scripts/test-bridge-contracts.cjs の契約テストで確かめる）。
 */
final class LoadedArea {
    interface ChunkCheck { boolean full(int chunkX, int chunkZ); }

    private final int minX, minZ, sizeX, sizeZ;
    private final boolean[] full;

    /** (centreX, centreZ) から縦横 reach ブロックの正方形にかかるチャンクを、check で1回ずつ調べる。 */
    LoadedArea(int centreX, int centreZ, int reach, ChunkCheck check) {
        minX = (centreX - reach) >> 4; minZ = (centreZ - reach) >> 4;
        sizeX = ((centreX + reach) >> 4) - minX + 1; sizeZ = ((centreZ + reach) >> 4) - minZ + 1;
        full = new boolean[sizeX * sizeZ];
        for (int i = 0; i < sizeX; i++) for (int j = 0; j < sizeZ; j++) full[i * sizeZ + j] = check.full(minX + i, minZ + j);
    }

    /** (x, z) から縦横 margin ブロックの正方形にかかるチャンクが、すべて読み込み済みか。調べた正方形の外は読み込まれていないとみなす。 */
    boolean around(int x, int z, int margin) {
        for (int cx = (x - margin) >> 4; cx <= (x + margin) >> 4; cx++)
            for (int cz = (z - margin) >> 4; cz <= (z + margin) >> 4; cz++) {
                int i = cx - minX, j = cz - minZ;
                if (i < 0 || j < 0 || i >= sizeX || j >= sizeZ || !full[i * sizeZ + j]) return false;
            }
        return true;
    }
}
