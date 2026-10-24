package jp.streamtorearn.stackinggame.event.impl;

import jp.streamtorearn.stackinggame.config.StackingConfig;
import jp.streamtorearn.stackinggame.event.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.DustParticleOptions;
import net.minecraft.server.level.ServerLevel;
import java.util.*;

public final class MegaBlastEvent extends AbstractActiveEvent {
    private enum Phase{TRACK,WARNING,EXPLODE} private Phase phase=Phase.TRACK; private final List<BlockPos> points=new ArrayList<>(); private long phaseTick; private int explodeIndex;
    public MegaBlastEvent(EventContext ctx){super(ctx);}
    @Override protected void onStart(long tick){phaseTick=tick;sample();}
    @Override public void tick(long tick){if(finished)return;switch(phase){case TRACK->track(tick);case WARNING->warn(tick);case EXPLODE->explode(tick);}}
    private void track(long tick){if((tick-phaseTick)%StackingConfig.MEGA_SAMPLE_TICKS.get()==0)sample();if(tick-phaseTick>=StackingConfig.MEGA_TRACK_SECONDS.get()*20L){if(points.isEmpty())sample();phase=Phase.WARNING;phaseTick=tick;}}
    private void sample(){if(points.size()>=StackingConfig.MEGA_MAX_POINTS.get())return;BlockPos g;try{g=ctx.playerGround(8);}catch(IllegalArgumentException ex){return;}if(points.isEmpty()||points.get(points.size()-1).getCenter().distanceTo(g.getCenter())>=StackingConfig.MEGA_MIN_DISTANCE.get())points.add(g);}
    private void warn(long tick){ServerLevel l=ctx.level();if((tick-phaseTick)%5==0)for(BlockPos p:points)l.sendParticles(DustParticleOptions.REDSTONE,p.getX()+.5,p.getY()+1.05,p.getZ()+.5,8,.25,.03,.25,0);if(tick-phaseTick>=20){phase=Phase.EXPLODE;phaseTick=tick;}}
    private void explode(long tick){ServerLevel l=ctx.level();int work=0;while(explodeIndex<points.size()&&work++<4){BlockPos p=points.get(explodeIndex++);if(ctx.player().position().distanceTo(p.getCenter().add(0,1,0))<=5.8)ctx.encounter();ctx.explodeCrater(p,2.8,2,StackingConfig.MEGA_DAMAGE.get(),StackingConfig.MEGA_KNOCKBACK.get());ctx.spark().burst(l,p.getCenter().add(0,1,0),1);}if(explodeIndex>=points.size())finish();}

    @Override public long maxRuntimeTicks(){return StackingConfig.MEGA_TRACK_SECONDS.get()*20L+20L+StackingConfig.MEGA_MAX_POINTS.get()+200L;}
}
