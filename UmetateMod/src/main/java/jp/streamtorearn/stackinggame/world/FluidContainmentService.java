package jp.streamtorearn.stackinggame.world;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class FluidContainmentService {
    private final Map<UUID, List<Session>> sessions = new HashMap<>();

    private static final class Session {
        private final ServerLevel level;
        private final Block fluid;
        private final Map<BlockPos, BlockState> boundary;

        private Session(ServerLevel level, Block fluid, Map<BlockPos, BlockState> boundary) {
            this.level = level;
            this.fluid = fluid;
            this.boundary = boundary;
        }
    }

    /** Adds one independent containment volume to an event request. */
    public void start(UUID requestId, ServerLevel level, IntBox box, Block fluid) {
        Map<BlockPos, BlockState> boundary = new LinkedHashMap<>();
        int minX = box.minX() - 1;
        int maxX = box.maxX() + 1;
        int minY = Math.max(level.getMinBuildHeight(), box.minY() - 1);
        int maxY = Math.min(level.getMaxBuildHeight() - 1, box.maxY() + 1);
        int minZ = box.minZ() - 1;
        int maxZ = box.maxZ() + 1;

        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    boolean surface = x == minX || x == maxX
                            || y == minY || y == maxY
                            || z == minZ || z == maxZ;
                    if (!surface) {
                        continue;
                    }
                    BlockPos pos = new BlockPos(x, y, z);
                    if (level.hasChunkAt(pos)) {
                        boundary.put(pos.immutable(), level.getBlockState(pos));
                    }
                }
            }
        }

        sessions.computeIfAbsent(requestId, ignored -> new ArrayList<>())
                .add(new Session(level, fluid, boundary));
    }

    public void tick(long tick) {
        // Check every server tick. A two-tick interval can allow a source fluid to advance
        // beyond the one-block containment boundary before it is restored.
        for (List<Session> requestSessions : sessions.values()) {
            for (Session session : requestSessions) {
                contain(session);
            }
        }
    }

    public void stop(UUID requestId, boolean restoreBoundary) {
        List<Session> removed = sessions.remove(requestId);
        if (removed == null || !restoreBoundary) {
            return;
        }
        for (Session session : removed) {
            contain(session);
        }
    }

    private void contain(Session session) {
        for (Map.Entry<BlockPos, BlockState> entry : session.boundary.entrySet()) {
            BlockPos pos = entry.getKey();
            if (!session.level.hasChunkAt(pos)) {
                continue;
            }
            BlockState current = session.level.getBlockState(pos);
            BlockState original = entry.getValue();
            if (current.getBlock() == session.fluid && original.getBlock() != session.fluid) {
                session.level.setBlock(pos, original, 3);
            }
        }
    }
}
