package jp.streamtorearn.stackinggame.lab;

import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.client.LabClientEffects;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.network.NetworkDirection;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.simple.SimpleChannel;

public final class LabNetwork {
    private static final String VERSION = "1";
    private static final SimpleChannel CHANNEL = NetworkRegistry.newSimpleChannel(
            new ResourceLocation(StackingGameMod.MOD_ID, "lab_effects"), () -> VERSION,
            v -> VERSION.equals(v) || NetworkRegistry.ABSENT.equals(v),
            v -> VERSION.equals(v) || NetworkRegistry.ABSENT.equals(v));
    public record Effect(int mode, int ticks) {
        public Effect(FriendlyByteBuf buf) { this(buf.readVarInt(), buf.readVarInt()); }
        public void write(FriendlyByteBuf buf) { buf.writeVarInt(mode); buf.writeVarInt(ticks); }
    }
    private LabNetwork() {}
    public static void register() {
        CHANNEL.messageBuilder(Effect.class, 0, NetworkDirection.PLAY_TO_CLIENT)
                .encoder(Effect::write).decoder(Effect::new).consumerMainThread((packet, context) ->
                    DistExecutor.unsafeRunWhenOn(Dist.CLIENT, () -> () -> LabClientEffects.receive(packet.mode(), packet.ticks())))
                .add();
    }
    public static boolean available(ServerPlayer player) { return CHANNEL.isRemotePresent(player.connection.connection); }
    public static void send(ServerPlayer player, int mode, int ticks) {
        if (available(player)) CHANNEL.sendTo(new Effect(mode, ticks), player.connection.connection, NetworkDirection.PLAY_TO_CLIENT);
    }
}
