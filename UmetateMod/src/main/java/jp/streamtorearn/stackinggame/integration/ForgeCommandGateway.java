package jp.streamtorearn.stackinggame.integration;
import net.minecraft.server.MinecraftServer;
public final class ForgeCommandGateway {public int execute(MinecraftServer server,String command){return server.getCommands().performPrefixedCommand(server.createCommandSourceStack().withPermission(4).withSuppressedOutput(),command);}}
