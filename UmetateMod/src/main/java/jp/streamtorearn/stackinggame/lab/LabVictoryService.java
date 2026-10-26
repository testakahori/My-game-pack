package jp.streamtorearn.stackinggame.lab;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundClearTitlesPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitlesAnimationPacket;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.projectile.FireworkRocketEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 勝ちの判定（埋め立て PR1 の Task 4。2026-10-26 ユーザーの決定）。
 * 3階の中央の枠の内側（LabLayout.FRAME_*。2704マス）が金とダイヤで全部埋まったら 10 から数え、1マスでも欠けたら止まる。
 * 0 で花火・キラキラの粒子・黄緑の「congratulation」のタイトルを出し、枠の中を全部消す。
 * 研究室の処理中（復元・地獄）は、埋まっていないものとして扱う（呼ぶ側が allowed=false で渡す）。
 */
public final class LabVictoryService {
    private static final int CHECK_EVERY_TICKS = 5;
    private static final int[] FIREWORK_COLORS = {0xFF5555, 0xFFFF55, 0x55FF55, 0x55FFFF, 0x5555FF, 0xFF55FF, 0xFFAA00, 0xFFFFFF};
    private final LabVictoryCountdown countdown = new LabVictoryCountdown();
    private int wins;

    /** 研究室マップの毎 tick に呼ぶ。tick は呼ぶたびに1ずつ増える数。 */
    public void tick(ServerLevel level, long tick, boolean allowed) {
        if (tick % CHECK_EVERY_TICKS != 0) return;
        boolean filled = allowed && filled(level);
        switch (countdown.update(filled, tick)) {
            case START, SECOND -> showSeconds(level, countdown.secondsLeft());
            case STOP -> stopped(level);
            case WIN -> { wins++; celebrate(level); clearFrame(level); }
            default -> {}
        }
    }

    public int wins() { return wins; }

    static boolean filled(ServerLevel level) {
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        for (int x = LabLayout.FRAME_MIN_X; x <= LabLayout.FRAME_MAX_X; x++)
            for (int y = LabLayout.FRAME_MIN_Y; y <= LabLayout.FRAME_MAX_Y; y++)
                for (int z = LabLayout.FRAME_MIN_Z; z <= LabLayout.FRAME_MAX_Z; z++) {
                    BlockState state = level.getBlockState(pos.set(x, y, z));
                    if (!state.is(Blocks.GOLD_BLOCK) && !state.is(Blocks.DIAMOND_BLOCK)) return false;
                }
        return true;
    }

    private static void showSeconds(ServerLevel level, int seconds) {
        for (ServerPlayer player : level.players()) {
            player.connection.send(new ClientboundSetTitlesAnimationPacket(0, 25, 5));
            player.connection.send(new ClientboundSetTitleTextPacket(Component.literal(Integer.toString(seconds)).withStyle(ChatFormatting.GOLD)));
            player.playNotifySound(SoundEvents.EXPERIENCE_ORB_PICKUP, SoundSource.PLAYERS, 1f, 0.5f + (10 - seconds) * 0.1f);
        }
    }

    private static void stopped(ServerLevel level) {
        for (ServerPlayer player : level.players()) {
            player.connection.send(new ClientboundClearTitlesPacket(true));
            player.displayClientMessage(Component.literal("カウントダウン中止").withStyle(ChatFormatting.RED), true);
        }
    }

    private static void celebrate(ServerLevel level) {
        double cx = (LabLayout.FRAME_MIN_X + LabLayout.FRAME_MAX_X) / 2.0 + 0.5, cz = (LabLayout.FRAME_MIN_Z + LabLayout.FRAME_MAX_Z) / 2.0 + 0.5;
        double top = LabLayout.FRAME_MAX_Y + 2;
        // 花火：枠の四隅と辺の中ほど、まん中の上から8発。色は毎回いくつか混ぜる。
        double[][] spots = {{-6, -6}, {6, -6}, {-6, 6}, {6, 6}, {0, -6}, {0, 6}, {-6, 0}, {6, 0}};
        for (int i = 0; i < spots.length; i++) {
            FireworkRocketEntity rocket = new FireworkRocketEntity(level, spots[i][0] + 0.5, top, spots[i][1] + 0.5, firework(level, i));
            level.addFreshEntity(rocket);
        }
        // キラキラ：トーテム・エンドロッド・ハッピービレジャーの粒子を枠のまわりに。
        double cy = (LabLayout.FRAME_MIN_Y + LabLayout.FRAME_MAX_Y) / 2.0;
        level.sendParticles(ParticleTypes.TOTEM_OF_UNDYING, cx, cy, cz, 300, 6, 8, 6, 0.6);
        level.sendParticles(ParticleTypes.END_ROD, cx, cy, cz, 150, 6, 8, 6, 0.05);
        level.sendParticles(ParticleTypes.HAPPY_VILLAGER, cx, cy, cz, 120, 6, 8, 6, 0.1);
        for (ServerPlayer player : level.players()) {
            player.connection.send(new ClientboundSetTitlesAnimationPacket(10, 70, 20));
            player.connection.send(new ClientboundSetTitleTextPacket(Component.literal("congratulation").withStyle(ChatFormatting.GREEN)));
            player.playNotifySound(SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundSource.PLAYERS, 1f, 1f);
        }
    }

    private static ItemStack firework(ServerLevel level, int index) {
        ItemStack stack = new ItemStack(Items.FIREWORK_ROCKET);
        CompoundTag fireworks = stack.getOrCreateTagElement("Fireworks");
        fireworks.putByte("Flight", (byte) 1);
        ListTag explosions = new ListTag();
        CompoundTag explosion = new CompoundTag();
        explosion.putByte("Type", (byte) (index % 5));
        int a = FIREWORK_COLORS[level.random.nextInt(FIREWORK_COLORS.length)], b = FIREWORK_COLORS[level.random.nextInt(FIREWORK_COLORS.length)];
        explosion.putIntArray("Colors", new int[]{a, b});
        explosion.putIntArray("FadeColors", new int[]{0xFFFFFF});
        explosion.putBoolean("Flicker", true);
        explosion.putBoolean("Trail", true);
        explosions.add(explosion);
        fireworks.put("Explosions", explosions);
        return stack;
    }

    private static void clearFrame(ServerLevel level) {
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        BlockState air = Blocks.AIR.defaultBlockState();
        for (int x = LabLayout.FRAME_MIN_X; x <= LabLayout.FRAME_MAX_X; x++)
            for (int y = LabLayout.FRAME_MIN_Y; y <= LabLayout.FRAME_MAX_Y; y++)
                for (int z = LabLayout.FRAME_MIN_Z; z <= LabLayout.FRAME_MAX_Z; z++)
                    // 物は落とさない（setBlock は壊さずに置き換える）。まわりへの更新もしない（中は金とダイヤだけ）。
                    level.setBlock(pos.set(x, y, z), air, 18);
    }
}
