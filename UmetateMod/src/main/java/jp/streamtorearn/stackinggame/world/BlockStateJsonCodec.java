package jp.streamtorearn.stackinggame.world;

import com.google.gson.JsonObject;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraftforge.registries.ForgeRegistries;

public final class BlockStateJsonCodec {
    private BlockStateJsonCodec(){}
    public static JsonObject encode(BlockState state){ JsonObject o=new JsonObject(); var key=ForgeRegistries.BLOCKS.getKey(state.getBlock()); o.addProperty("block",key==null?"minecraft:air":key.toString()); JsonObject props=new JsonObject(); for(Property<?> p:state.getProperties())props.addProperty(p.getName(),valueName(state,p));o.add("properties",props);return o; }
    public static BlockState decode(JsonObject o){ Block block=ForgeRegistries.BLOCKS.getValue(new ResourceLocation(o.get("block").getAsString())); if(block==null)return net.minecraft.world.level.block.Blocks.AIR.defaultBlockState(); BlockState s=block.defaultBlockState(); if(o.has("properties")){JsonObject props=o.getAsJsonObject("properties"); for(Property<?> p:s.getProperties())if(props.has(p.getName()))s=setValue(s,p,props.get(p.getName()).getAsString());} return s; }
    private static <T extends Comparable<T>> String valueName(BlockState s,Property<T> p){return p.getName(s.getValue(p));}
    private static <T extends Comparable<T>> BlockState setValue(BlockState s,Property<T> p,String v){return p.getValue(v).map(x->s.setValue(p,x)).orElse(s);}
}
