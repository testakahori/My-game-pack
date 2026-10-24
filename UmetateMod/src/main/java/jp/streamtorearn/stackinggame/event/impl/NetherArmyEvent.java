package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.AbstractActiveEvent;
import jp.streamtorearn.stackinggame.event.CancelReason;
import jp.streamtorearn.stackinggame.event.EventContext;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobSpawnType;
import net.minecraft.world.entity.monster.Zoglin;
import net.minecraft.world.entity.monster.ZombifiedPiglin;
import net.minecraftforge.event.ForgeEventFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;

/**
 * Nether Army。
 * 標準5組、1組につき「ゾグリン1体 + ゾンビピグリン1体」を生成する。
 * プレイヤーから5～10ブロック周辺へ出現し、最大60秒（設定値）残る。
 */
public final class NetherArmyEvent extends AbstractActiveEvent {
    private final int count;
    private final List<UUID> spawnedEntityIds = new ArrayList<>();
    private long expiresAt;
    private ServerLevel spawnLevel;

    public NetherArmyEvent(EventContext context, List<String> args) {
        super(context);
        int parsed = 5;
        if (!args.isEmpty()) {
            try {
                parsed = Integer.parseInt(args.get(0));
            } catch (NumberFormatException exception) {
                throw new IllegalArgumentException("nether_army pair count invalid");
            }
        }
        if (parsed < 1 || parsed > 50) {
            throw new IllegalArgumentException("pair count out of range");
        }
        count = parsed;
    }

    @Override
    protected void onStart(long tick) {
        ServerLevel level = ctx.level();
        spawnLevel = level;
        Random random = new Random();
        int made = 0;

        for (int i = 0; i < count; i++) {
            BlockPos ground = null;
            for (int attempt = 0; attempt < 16 && ground == null; attempt++) {
                double angle = random.nextDouble() * Math.PI * 2;
                double distance = 5 + random.nextDouble() * 5;
                int x = (int) Math.floor(ctx.player().getX() + Math.cos(angle) * distance);
                int z = (int) Math.floor(ctx.player().getZ() + Math.sin(angle) * distance);
                ground = ctx.ground().resolve(
                        level,
                        new BlockPos(x, ctx.player().getBlockY() + 12, z));
            }
            if (ground == null) continue;

            BlockPos spawnPos = ground.above();
            Zoglin zoglin = EntityType.ZOGLIN.create(level);
            ZombifiedPiglin rider = EntityType.ZOMBIFIED_PIGLIN.create(level);
            if (zoglin == null || rider == null) continue;

            zoglin.moveTo(
                    spawnPos.getX() + 0.5,
                    spawnPos.getY(),
                    spawnPos.getZ() + 0.5,
                    random.nextFloat() * 360F,
                    0F);
            rider.moveTo(
                    spawnPos.getX() + 0.5,
                    spawnPos.getY() + 1,
                    spawnPos.getZ() + 0.5,
                    random.nextFloat() * 360F,
                    0F);

            ForgeEventFactory.onFinalizeSpawn(
                    zoglin,
                    level,
                    level.getCurrentDifficultyAt(spawnPos),
                    MobSpawnType.EVENT,
                    null,
                    null);
            ForgeEventFactory.onFinalizeSpawn(
                    rider,
                    level,
                    level.getCurrentDifficultyAt(spawnPos),
                    MobSpawnType.EVENT,
                    null,
                    null);

            zoglin.addTag("stackinggame_event");
            rider.addTag("stackinggame_event");

            if (!level.addFreshEntity(zoglin)) continue;
            if (!level.addFreshEntity(rider)) {
                zoglin.discard();
                continue;
            }

            rider.startRiding(zoglin, true);
            expiresAt = tick + StackingConfig.NETHER_LIFETIME_SECONDS.get() * 20L;
            ctx.registerEventMob(level, zoglin, expiresAt);
            ctx.registerEventMob(level, rider, expiresAt);
            spawnedEntityIds.add(zoglin.getUUID());
            spawnedEntityIds.add(rider.getUUID());
            made++;
        }

        if (made == 0) {
            throw new IllegalArgumentException("no NetherArmy pair spawned");
        }
    }

    @Override
    public void tick(long tick) {
        if (finished) return;

        ServerLevel encounterLevel = spawnLevel != null ? spawnLevel : ctx.level();
        for (UUID id : spawnedEntityIds) {
            Entity entity = encounterLevel.getEntity(id);
            if (entity != null && entity.isAlive() && entity.distanceToSqr(ctx.player()) <= 16.0) {
                ctx.encounter();
                break;
            }
        }

        // 「7イベントを同時に動かさない」ため、召喚直後にはfinishしない。
        // このイベントが生成したMobが全滅するか、最大生存時間に達するまで次を待たせる。
        if (allSpawnedEntitiesGone()) {
            ctx.unregisterEventMobs(spawnedEntityIds);
            finish();
            return;
        }
        if (tick >= expiresAt) {
            // 次イベントと1tickでも重ならないよう、時間切れ時はここで先に全Mobを削除する。
            discardSpawnedEntities();
            finish();
        }
    }

    private boolean allSpawnedEntitiesGone() {
        ServerLevel level = spawnLevel != null ? spawnLevel : ctx.level();
        for (UUID id : spawnedEntityIds) {
            Entity entity = level.getEntity(id);
            if (entity != null && entity.isAlive()) {
                return false;
            }
        }
        return true;
    }

    @Override
    protected void onCancel(CancelReason reason) {
        super.onCancel(reason);
        // リセット/中止では、このイベント自身が生成したMobを残さない。
        discardSpawnedEntities();
    }

    private void discardSpawnedEntities() {
        ServerLevel level = spawnLevel != null ? spawnLevel : ctx.level();
        for (UUID id : spawnedEntityIds) {
            Entity entity = level.getEntity(id);
            if (entity != null) entity.discard();
        }
        ctx.unregisterEventMobs(spawnedEntityIds);
    }

    @Override
    public long maxRuntimeTicks() {
        return StackingConfig.NETHER_LIFETIME_SECONDS.get() * 20L + 200L;
    }
}
