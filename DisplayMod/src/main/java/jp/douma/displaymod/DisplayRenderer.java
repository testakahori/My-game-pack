package jp.douma.displaymod;

import jp.douma.displaymod.api.DisplayRequest;
import net.minecraft.ChatFormatting;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundSetSubtitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitlesAnimationPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundSource;

/** Vanilla packets keep the client-side DisplayMOD optional, too. */
public final class DisplayRenderer {
    private DisplayRenderer() {}
    public static void show(MinecraftServer server, DisplayRequest request) {
        var title = Component.literal(request.title()).withStyle(ChatFormatting.YELLOW, ChatFormatting.BOLD);
        var subtitle = Component.literal(request.subtitle()).withStyle(ChatFormatting.GREEN);
        var sound = request.sound().isEmpty() ? null : BuiltInRegistries.SOUND_EVENT.getOptional(new ResourceLocation(request.sound())).orElse(null);
        var particle = request.particle().isEmpty() ? null : BuiltInRegistries.PARTICLE_TYPE.getOptional(new ResourceLocation(request.particle())).orElse(null);
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            player.connection.send(new ClientboundSetTitlesAnimationPacket(request.fadeInTicks(), request.stayTicks(), request.fadeOutTicks()));
            // Set subtitle before title, so the first rendered frame is the new pair.
            player.connection.send(new ClientboundSetSubtitleTextPacket(subtitle));
            player.connection.send(new ClientboundSetTitleTextPacket(title));
            if (sound != null) player.playNotifySound(sound, SoundSource.MASTER, 0.8f, 1.0f);
            if (particle instanceof SimpleParticleType simple) player.serverLevel().sendParticles(player, simple, true,
                player.getX(), player.getY() + 1, player.getZ(), 18, 0.6, 0.8, 0.6, 0.05);
        }
    }
}
