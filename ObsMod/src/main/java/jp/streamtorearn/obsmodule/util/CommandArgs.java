package jp.streamtorearn.obsmodule.util;

import java.util.*;

public final class CommandArgs {
    private CommandArgs(){}
    public record Parsed(List<String> positional, Map<String,String> kv, String sender){}

    public static Parsed parse(String raw){
        List<String> tokens=tokenize(raw); List<String> pos=new ArrayList<>(); Map<String,String> kv=new LinkedHashMap<>(); String sender="";
        for(int i=0;i<tokens.size();i++){
            String t=tokens.get(i);
            if(t.equals("--sender")){ sender=String.join(" ",tokens.subList(i+1,tokens.size())); break; }
            int eq=t.indexOf('='); if(eq>0) kv.put(t.substring(0,eq),t.substring(eq+1)); else pos.add(t);
        }
        return new Parsed(pos,kv, InputSanitizer.text(sender,64));
    }

    private static List<String> tokenize(String s){
        List<String> out=new ArrayList<>(); StringBuilder b=new StringBuilder(); boolean quote=false; char q=0; boolean esc=false;
        for(int i=0;i<s.length();i++){ char c=s.charAt(i); if(esc){b.append(c);esc=false;continue;} if(c=='\\'){esc=true;continue;} if(quote){if(c==q){quote=false;}else b.append(c);continue;} if(c=='\''||c=='\"'){quote=true;q=c;continue;} if(Character.isWhitespace(c)){if(b.length()>0){out.add(b.toString());b.setLength(0);}} else b.append(c); }
        if(b.length()>0)out.add(b.toString()); return out;
    }
}
