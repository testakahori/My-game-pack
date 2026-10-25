package jp.streamtorearn.stackinggame.world;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import jp.streamtorearn.stackinggame.lab.LabStageService;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.AABB;

/** 3個の黒曜石を予告の後に落とす。着地した黒曜石は通常ブロックとして残る。 */
public final class StampService {
    private static final class Stamp {
        final List<FallingBlockEntity> blocks = new ArrayList<>();
        int age;
    }
    private final LabStageService lab;
    private final List<Stamp> active = new ArrayList<>();

    public StampService(LabStageService lab) { this.lab = lab; }

    public int start(CommandSourceStack source, ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        if (lab.blocksEvents() || lab.isMaster(level, player.blockPosition()) || active.size() >= 32) {
            source.sendFailure(Component.literal("復元・転送中、2階の原本、またはスタンプが多すぎるため実行できません。"));
            return 0;
        }
        double x = player.getX(), y = player.getBoundingBox().maxY + 3, z = player.getZ();
        AABB space = new AABB(x - .49, y, z - .49, x + .49, y + 3, z + .49);
        if (y + 3 >= level.getMaxBuildHeight() || !level.noCollision(space)) {
            source.sendFailure(Component.literal("頭の上に黒曜石3個を出せる空間がありません。"));
            return 0;
        }
        Stamp stamp = new Stamp();
        for (int i = 0; i < 3; i++) {
            // fall()は元の地形を消すため使わず、空中のエンティティを直接作る。
            FallingBlockEntity block = new FallingBlockEntity(EntityType.FALLING_BLOCK, level);
            CompoundTag tag = block.saveWithoutId(new CompoundTag());
            tag.put("BlockState", NbtUtils.writeBlockState(Blocks.OBSIDIAN.defaultBlockState()));
            tag.putInt("Time", 1); tag.putBoolean("DropItem", false);
            block.load(tag);
            block.setPos(x, y + i, z); block.setStartPos(block.blockPosition());
            block.setNoGravity(true); block.setHurtsEntities(6, 20);
            block.addTag("umetate_stamp");
            if (!level.addFreshEntity(block)) {
                stamp.blocks.forEach(FallingBlockEntity::discard);
                source.sendFailure(Component.literal("スタンプを作成できませんでした。"));
                return 0;
            }
            stamp.blocks.add(block);
        }
        active.add(stamp);
        level.playSound(null, player.blockPosition(), SoundEvents.ANVIL_PLACE, SoundSource.BLOCKS, .7f, .7f);
        source.sendSuccess(() -> Component.literal(player.getScoreboardName() + " の頭上から黒曜石スタンプ！"), true);
        return 3;
    }

    /** ワールド更新前に、予告・落下・原本への侵入防止を処理する。 */
    public void tick() {
        for (Iterator<Stamp> it = active.iterator(); it.hasNext();) {
            Stamp stamp = it.next();
            stamp.age++;
            boolean stop = stamp.age > 200;
            for (FallingBlockEntity block : stamp.blocks) {
                if (block.isRemoved()) continue;
                ServerLevel level = (ServerLevel) block.level();
                BlockPos next = BlockPos.containing(block.position().add(block.getDeltaMovement()));
                if (lab.isMaster(level, block.blockPosition()) || lab.isMaster(level, next)) stop = true;
            }
            if (stop) stamp.blocks.forEach(FallingBlockEntity::discard);
            if (stop || stamp.blocks.stream().allMatch(FallingBlockEntity::isRemoved)) { it.remove(); continue; }
            if (stamp.age == 20) {
                for (FallingBlockEntity block : stamp.blocks) {
                    block.setNoGravity(false); block.setDeltaMovement(0, -.8, 0);
                    block.hurtMarked = true;
                }
                var first = stamp.blocks.get(0);
                first.level().playSound(null, first.blockPosition(), SoundEvents.ANVIL_LAND, SoundSource.BLOCKS, 1, .6f);
            }
        }
    }

    public void clear() {
        for (Stamp stamp : active) stamp.blocks.forEach(FallingBlockEntity::discard);
        active.clear();
    }
}
