package example.displayprobe;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import example.game.integration.OptionalDisplay;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.EntityType;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Mimics a game MOD which owns its own queue and calls DisplayMOD only on start. */
@Mod("displayprobe")
public final class DisplayProbe {
    private record Pending(MinecraftServer server, int startTick, int count, String name) {}
    private final List<Pending> queue = new ArrayList<>();
    public DisplayProbe() { MinecraftForge.EVENT_BUS.register(this); }
    @SubscribeEvent
    public void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("displayprobe").requires(s -> s.hasPermission(2))
            .then(Commands.argument("delay", IntegerArgumentType.integer(1, 1200))
            .then(Commands.argument("count", IntegerArgumentType.integer(1, 10))
            .then(Commands.argument("name", StringArgumentType.greedyString()).executes(ctx -> {
                var server = ctx.getSource().getServer();
                queue.add(new Pending(server, server.getTickCount() + IntegerArgumentType.getInteger(ctx, "delay"),
                    IntegerArgumentType.getInteger(ctx, "count"), StringArgumentType.getString(ctx, "name")));
                return 1;
            })))));
    }
    @SubscribeEvent
    public void tick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        var it = queue.iterator();
        while (it.hasNext()) {
            Pending item = it.next();
            if (item.server.getTickCount() < item.startTick) continue;
            it.remove();
            var players = item.server.getPlayerList().getPlayers();
            if (players.isEmpty()) continue;
            var player = players.get(0);
            for (int i = 0; i < item.count; i++) {
                var mob = EntityType.PIG.create(player.serverLevel());
                if (mob != null) {
                    mob.moveTo(player.getX() + i, player.getY(), player.getZ());
                    mob.setCustomName(Component.literal(item.name));
                    player.serverLevel().addFreshEntity(mob);
                }
            }
            OptionalDisplay.show(item.server, Map.of("title", "QUEUE-START", "subtitle", "{ListenerName} ×{Count}",
                "listenerName", item.name, "count", item.count, "sound", "", "particle", ""));
        }
    }
    @SubscribeEvent
    public void stop(ServerStoppingEvent event) { queue.clear(); }
}
