package jp.streamtorearn.obsmodule.util;
public final class InputSanitizer {
    private InputSanitizer(){}
    public static String text(String s,int max){ if(s==null)return ""; StringBuilder o=new StringBuilder(); for(int i=0;i<s.length()&&o.length()<max;i++){char c=s.charAt(i); if(c=='\r'||c=='\n'||c=='\0'||Character.isISOControl(c))continue; o.append(c);} return o.toString().trim(); }
}
