package org.slf4j;

// Forge なしで ObsControllerClient を確かめるための写し（本物は Minecraft に入っている slf4j。使うメソッドだけ）。
public interface Logger {
    void info(String message);
    void info(String format, Object argument);
    void warn(String message);
    void warn(String format, Object argument);
}
