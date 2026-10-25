package jp.streamtorearn.obsmodule;

// Forge なしで ObsControllerClient を確かめるための写し（本物は src/main の ObsBridgeMod。ログを出すだけ）。
public final class ObsBridgeMod {
    public static final org.slf4j.Logger LOGGER = new org.slf4j.Logger() {
        public void info(String message) { System.out.println("[info] " + message); }
        public void info(String format, Object argument) { System.out.println("[info] " + format + " " + argument); }
        public void warn(String message) { System.out.println("[warn] " + message); }
        public void warn(String format, Object argument) { System.out.println("[warn] " + format + " " + argument); }
    };
    private ObsBridgeMod() {}
}
