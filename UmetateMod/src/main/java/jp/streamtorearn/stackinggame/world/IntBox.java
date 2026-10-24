package jp.streamtorearn.stackinggame.world;
public record IntBox(int minX,int minY,int minZ,int maxX,int maxY,int maxZ){
    public static IntBox of(int x1,int y1,int z1,int x2,int y2,int z2){return new IntBox(Math.min(x1,x2),Math.min(y1,y2),Math.min(z1,z2),Math.max(x1,x2),Math.max(y1,y2),Math.max(z1,z2));}
    public long volume(){return (long)(maxX-minX+1)*(maxY-minY+1)*(maxZ-minZ+1);}
}
