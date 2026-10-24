package jp.streamtorearn.stackinggame.util;

import java.util.*;
public final class CommandTail {
    private CommandTail(){}
    public record Parsed(List<String> tokens,String sender){}
    public static Parsed parse(String raw){
        String s=raw==null?"":raw.replace("\r","").replace("\n","").replace("\0","").trim();
        int idx=s.indexOf(" --sender "); if(idx<0 && s.startsWith("--sender "))idx=0;
        String sender=""; String before=s;
        if(idx>=0){ if(idx==0){sender=s.substring(9);}else{sender=s.substring(idx+10);before=s.substring(0,idx);} }
        sender=sanitize(sender); List<String> t=before.isBlank()?List.of():Arrays.stream(before.trim().split("\\s+")).filter(x->!x.isBlank()).toList(); return new Parsed(t,sender);
    }
    public static String sanitize(String s){StringBuilder b=new StringBuilder();for(int i=0;i<s.length()&&b.length()<64;i++){char c=s.charAt(i);if(Character.isISOControl(c)||c=='"'||c=='\\')continue;b.append(c);}return b.toString().trim();}
}
