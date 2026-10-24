package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;

public final class VoidBombEvent extends AbstractActiveEvent {
    private BlockPos ground;
    public VoidBombEvent(EventContext ctx){super(ctx);}
    @Override protected void onStart(long tick){ground=ctx.playerGround(8);}
    @Override public void tick(long tick){if(finished)return;long e=tick-startedTick;ServerLevel l=ctx.level();if(e<StackingConfig.VOID_WARNING.get()){if(e%3==0){double x=ground.getX()+.5,y=ground.getY()+1.1,z=ground.getZ()+.5;l.sendParticles(ParticleTypes.PORTAL,x,y,z,18,1.0,.4,1.0,.08);l.sendParticles(ParticleTypes.LARGE_SMOKE,x,y,z,6,.7,.3,.7,.02);}return;}double encounterDistance = ctx.player().position().distanceTo(ground.getCenter().add(0, 1, 0));if(encounterDistance <= StackingConfig.VOID_RADIUS.get()+3.0)ctx.encounter();ctx.explodeCrater(ground,StackingConfig.VOID_RADIUS.get(),StackingConfig.VOID_DEPTH.get(),StackingConfig.VOID_DAMAGE.get(),StackingConfig.VOID_KNOCKBACK.get());ctx.spark().burst(l,ground.getCenter().add(0,1,0),3);finish();}

    @Override public long maxRuntimeTicks(){return StackingConfig.VOID_WARNING.get()+200L;}
}
