package jp.streamtorearn.stackinggame.client;

import jp.streamtorearn.stackinggame.StackingGameMod;
import net.minecraft.client.Minecraft;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RenderGuiEvent;
import net.minecraftforge.client.event.ViewportEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/** 地震のカメラ揺れと転送中の白い光。高速の点滅は使わない。 */
@Mod.EventBusSubscriber(modid = StackingGameMod.MOD_ID, value = Dist.CLIENT)
public final class LabClientEffects {
    private static long quakeEnd, flashStart, flashEnd;
    private static boolean hold;
    private LabClientEffects() {}
    public static void receive(int mode, int ticks) {
        long now = System.nanoTime();
        if (mode == 0) { quakeEnd = flashEnd = 0; hold = false; }
        if (mode == 1) quakeEnd = now + ticks * 50_000_000L;
        // 転送直前まで白を保ち、転送完了の別パケットを受けてから薄くする。
        if (mode == 2) { flashStart = now; flashEnd = now + 15_000_000_000L; hold = true; }
        if (mode == 3) { flashStart = now; flashEnd = now + ticks * 50_000_000L; hold = false; }
    }
    @SubscribeEvent public static void camera(ViewportEvent.ComputeCameraAngles event) {
        long now = System.nanoTime();
        if (now < quakeEnd && Minecraft.getInstance().level != null) {
            double t = now / 1_000_000_000.0;
            float strength = (float) Math.min(1, (quakeEnd - now) / 1_000_000_000.0);
            event.setRoll(event.getRoll() + (float) Math.sin(t * 25) * 3.2f * strength);
            event.setPitch(event.getPitch() + (float) Math.sin(t * 31) * 1.5f * strength);
            event.setYaw(event.getYaw() + (float) Math.cos(t * 21) * 1.2f * strength);
        }
    }
    @SubscribeEvent public static void overlay(RenderGuiEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null || mc.player == null) { receive(0, 0); return; }
        long now = System.nanoTime();
        if (now >= flashEnd) return;
        double alpha = hold ? Math.min(1, (now - flashStart) / 500_000_000.0)
                : Math.min(1, (double) (flashEnd - now) / Math.max(1, flashEnd - flashStart));
        event.getGuiGraphics().fill(0, 0, mc.getWindow().getGuiScaledWidth(), mc.getWindow().getGuiScaledHeight(),
                ((int) (alpha * 255) << 24) | 0xFFFFFF);
    }
}
