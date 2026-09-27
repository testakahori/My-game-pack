package jp.douma.displaymod;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.mojang.brigadier.arguments.StringArgumentType;
import jp.douma.displaymod.api.DisplayApi;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

import java.util.Map;

@Mod("displaymod")
public final class DisplayMod {
    private static final Gson GSON = new Gson();
    public DisplayMod() { MinecraftForge.EVENT_BUS.register(this); }

    /** Standalone diagnostic entry point; no BridgeMOD or HTTP server is required. */
    @SubscribeEvent
    public void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("displayevent").requires(source -> source.hasPermission(2))
            .then(Commands.argument("json", StringArgumentType.greedyString()).executes(context -> {
                try {
                    String json = StringArgumentType.getString(context, "json");
                    if (json.length() > 8192) throw new IllegalArgumentException("Display request too long");
                    Map<String, ?> payload = GSON.fromJson(json, new TypeToken<Map<String, Object>>() {}.getType());
                    if (DisplayApi.show(context.getSource().getServer(), payload)) return 1;
                } catch (RuntimeException ignored) { /* Report invalid input without stopping the server. */ }
                context.getSource().sendFailure(Component.literal("DisplayMOD: 表示内容を確認してください"));
                return 0;
            })));
    }
}
