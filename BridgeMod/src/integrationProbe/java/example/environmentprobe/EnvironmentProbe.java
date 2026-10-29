package example.environmentprobe;

import com.google.gson.Gson;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.MobSpawnType;
import net.minecraft.world.entity.ai.village.VillageSiege;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.entity.living.MobSpawnEvent;
import net.minecraftforge.event.village.VillageSiegeEvent;
import net.minecraftforge.eventbus.api.Event;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import java.util.*;

/** Opt-in fixture. Never bundled in the product jar or application. */
@Mod("environmentprobe")
public final class EnvironmentProbe {
    public EnvironmentProbe() { MinecraftForge.EVENT_BUS.register(this); }
    @SubscribeEvent public void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("environmentprobe").requires(s -> s.hasPermission(4))
            .then(Commands.argument("action", StringArgumentType.word()).executes(ctx -> {
                var server = ctx.getSource().getServer();
                var result = new LinkedHashMap<String, Object>();
                if (StringArgumentType.getString(ctx, "action").equals("spawns")) {
                    for (ServerLevel level : List.of(server.overworld(), server.getLevel(net.minecraft.world.level.Level.NETHER))) {
                        var checks = new LinkedHashMap<String, Object>();
                        for (EntityType<? extends Mob> type : List.of(EntityType.ZOMBIE, EntityType.SKELETON, EntityType.CREEPER,
                                EntityType.SLIME, EntityType.MAGMA_CUBE, EntityType.PHANTOM, EntityType.PILLAGER, EntityType.GHAST, EntityType.COW, EntityType.SHEEP, EntityType.COD)) {
                            for (MobSpawnType reason : List.of(MobSpawnType.NATURAL, MobSpawnType.CHUNK_GENERATION,
                                    MobSpawnType.PATROL, MobSpawnType.REINFORCEMENT, MobSpawnType.COMMAND, MobSpawnType.SPAWN_EGG,
                                    MobSpawnType.SPAWNER, MobSpawnType.EVENT)) {
                                BlockPos pos = new BlockPos(0, 90, 0);
                                var placement = new MobSpawnEvent.SpawnPlacementCheck(type, level, reason, pos, level.random, true);
                                MinecraftForge.EVENT_BUS.post(placement);
                                Mob mob = type.spawn(level, pos, reason);
                                boolean spawned = mob != null && level.getEntity(mob.getUUID()) != null;
                                checks.put(EntityType.getKey(type) + "/" + reason, Map.of("spawned", spawned,
                                    "placementDenied", placement.getResult() == Event.Result.DENY));
                                if (mob != null) mob.discard();
                            }
                        }
                        result.put(level.dimension().location().toString(), checks);
                    }
                    var siege = new VillageSiegeEvent(new VillageSiege(), server.overworld(),
                        server.getPlayerList().getPlayers().get(0), Vec3.ZERO);
                    MinecraftForge.EVENT_BUS.post(siege); result.put("siegeCanceled", siege.isCanceled());
                } else {
                    GameRules rules = server.getGameRules();
                    result.put("sendCommandFeedback", rules.getBoolean(GameRules.RULE_SENDCOMMANDFEEDBACK));
                    result.put("commandBlockOutput", rules.getBoolean(GameRules.RULE_COMMANDBLOCKOUTPUT));
                    result.put("doMobSpawning", rules.getBoolean(GameRules.RULE_DOMOBSPAWNING));
                    result.put("keepInventory", rules.getBoolean(GameRules.RULE_KEEPINVENTORY));
                    result.put("dayTime", server.overworld().getDayTime() % 24000);
                    result.put("raining", server.overworld().isRaining());
                }
                String json = new Gson().toJson(result);
                if (StringArgumentType.getString(ctx, "action").equals("spawns")) {
                    try { java.nio.file.Files.writeString(java.nio.file.Path.of("fixed-spawn-probe.json"), json); }
                    catch (java.io.IOException error) { throw new java.io.UncheckedIOException(error); }
                    json = "spawn-probe-written";
                }
                ctx.getSource().sendSystemMessage(Component.literal(json));
                return 1;
            })));
    }
}
