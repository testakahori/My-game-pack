package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.integration.IntegrationService;
import jp.streamtorearn.stackinggame.world.*;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

import java.util.Collection;
import java.util.List;
import java.util.Random;
import java.util.UUID;

public record EventContext(MinecraftServer server, ServerPlayer player, EventRequest request,
                           EventTargetMode targetMode,
                           BlockInteractionMode blockInteractionMode,
                           TemporaryBlockManager tempBlocks, FluidContainmentService fluid,
                           GroundResolver ground, CraterService crater, SparkService spark,
                           MobLifetimeManager mobLifetime, ProtectedBlockPolicy protectedBlocks,
                           ArenaService arena, BlockSafetyService blockSafety, StackBlockService stackBlocks,
                           IntegrationService integration, EncounterService encounters,
                           BlockInteractionAuditService blockAudit) {

    /** Event implementations only signal the fact; Event Master supplies encounter key/kind. */
    public boolean encounter() {
        return encounters.notifyEncounter(server, request);
    }

    /** Compatibility overload. New code should use encounter(). */
    @Deprecated
    public boolean encounter(String encounterKey, String encounterKind) {
        return encounter();
    }

    public boolean removeBlock(BlockPos pos) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.TERRAIN_REMOVE);
        return blockSafety.remove(level(), pos, targetMode);
    }

    public boolean placeTemporary(BlockPos pos, BlockState temporary) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.TEMPORARY_PLACE);
        return tempBlocks.place(request.executionId(), level(), pos, temporary, targetMode);
    }

    public boolean placeTemporary(BlockPos pos, BlockState temporary, BlockState restore) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.TEMPORARY_PLACE);
        return tempBlocks.place(request.executionId(), level(), pos, temporary, restore, targetMode);
    }

    /** Permanent crater operation, audited against Event Master's block intent. */
    public void explodeCrater(BlockPos groundPos, double radius, int depth, double damage, double knockback) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.TERRAIN_REMOVE);
        crater.explode(level(), groundPos, radius, depth, damage, knockback, player, targetMode);
    }

    public int removeStackCylinder(Vec3 center, double radius, int below, int above, int maxBlocks) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.STACK_REMOVE);
        return stackBlocks.removeCylinder(level(), center, radius, below, above, maxBlocks);
    }

    public List<FallingBlockEntity> liftStackRandomBatch(
            Vec3 center, double radius, int verticalRange, int limit, Random random) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.STACK_FALLING);
        return stackBlocks.liftRandomBatch(request.executionId(), level(), center, radius, verticalRange, limit, random);
    }

    public int ejectStackRing(
            Vec3 center, double radius, double width, int above,
            int maxBlocks, int maxEntities, double speed) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.STACK_FALLING);
        return stackBlocks.ejectRing(request.executionId(), level(), center, radius, width,
                above, maxBlocks, maxEntities, speed);
    }

    public void releaseStackBlock(FallingBlockEntity entity, Vec3 velocity) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.STACK_FALLING);
        stackBlocks.release(request.executionId(), entity, velocity);
    }

    public void releaseStackBlock(FallingBlockEntity entity) {
        blockAudit.audit(request, blockInteractionMode, BlockInteractionAuditService.Operation.STACK_FALLING);
        stackBlocks.release(request.executionId(), entity);
    }

    /** Register spawned mobs with their owning executionId. */
    public void registerEventMob(ServerLevel level, Entity entity, long expiresAt) {
        mobLifetime.register(request.executionId(), level, entity, expiresAt);
    }

    public void unregisterEventMobs(Collection<UUID> entityIds) {
        mobLifetime.unregister(entityIds);
    }

    /** Unified level lookup. ARENA events are rejected outside the configured arena dimension. */
    public ServerLevel level() {
        ServerLevel level = player.serverLevel();
        if (targetMode == EventTargetMode.ARENA) arena.requireArenaLevel(level);
        return level;
    }

    /** Ground directly around the current player; PLAYER events should use this helper. */
    public BlockPos playerGround(int searchAbove) {
        requireTargetMode(EventTargetMode.PLAYER);
        BlockPos result = ground.resolve(level(), player.blockPosition().above(searchAbove));
        if (result == null) throw new IllegalArgumentException("no valid ground near player");
        return result;
    }

    /** Fixed arena center-column ground; ARENA events should use this helper for a default ground anchor. */
    public BlockPos arenaGround() {
        requireTargetMode(EventTargetMode.ARENA);
        BlockPos result = ground.resolve(level(), arena.centerSearchStart());
        return result != null ? result : arena.floorCenterBlock();
    }

    public Vec3 arenaFloorCenter() {
        requireTargetMode(EventTargetMode.ARENA);
        level();
        return arena.floorCenter();
    }

    public Vec3 arenaVolumeCenter() {
        requireTargetMode(EventTargetMode.ARENA);
        level();
        return arena.volumeCenter();
    }

    /** Entire effect box must be inside the fixed arena (used by Aquarium). */
    public void requireArenaBox(IntBox box) {
        requireTargetMode(EventTargetMode.ARENA);
        level();
        if (!arena.contains(box)) {
            throw new IllegalArgumentException("event area must stay inside stacking arena: " + arena.summary());
        }
    }

    /** Horizontal target must be inside the fixed arena. Y may be a sky/search coordinate. */
    public void requireArenaHorizontal(int x, int z) {
        requireTargetMode(EventTargetMode.ARENA);
        level();
        if (!arena.containsHorizontal(x, z)) {
            throw new IllegalArgumentException(
                    "event target x/z must stay inside stacking arena: x=" + x + " z=" + z + " arena=" + arena.summary());
        }
    }

    /** Horizontal X/Z extents must be inside the fixed arena (used by rain/search regions). */
    public void requireArenaHorizontalBox(IntBox box) {
        requireArenaHorizontal(box.minX(), box.minZ());
        requireArenaHorizontal(box.maxX(), box.maxZ());
    }

    public void requireTargetMode(EventTargetMode expected) {
        if (targetMode != expected) {
            throw new IllegalStateException(
                    "event target mode mismatch: expected=" + expected + " actual=" + targetMode
                            + " key=" + request.eventKey());
        }
    }
}
