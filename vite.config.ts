import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const TTS_ENGINE_PORTS = {
  voicevox: 50021,
  aivis: 10101,
} as const;

type TtsEngine = keyof typeof TTS_ENGINE_PORTS;

const TTS_ENGINE_EXES: Record<TtsEngine, string[]> = {
  voicevox: [
    path.join(os.homedir(), "AppData", "Local", "Programs", "VOICEVOX", "VOICEVOX.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "VOICEVOX", "VOICEVOX.exe"),
    path.join(process.env.PROGRAMFILES || "", "VOICEVOX", "VOICEVOX.exe"),
  ],
  aivis: [
    path.join(os.homedir(), "AppData", "Local", "Programs", "AivisSpeech", "AivisSpeech.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "AivisSpeech", "AivisSpeech.exe"),
    path.join(process.env.PROGRAMFILES || "", "AivisSpeech", "AivisSpeech.exe"),
  ],
};

function isTtsEngine(value: string | undefined): value is TtsEngine {
  return value === "voicevox" || value === "aivis";
}

function sendJson(res: any, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readJsonIfExists(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function parseRequestUrl(req: any) {
  return new URL(req.url || "/", "http://127.0.0.1");
}

function safeQueryPath(value: string | null) {
  if (!value) return "";
  return value;
}

function readServerProperties(serverRoot: string) {
  const propsPath = path.join(serverRoot, "server.properties");
  if (!fs.existsSync(propsPath)) return {};
  const props: Record<string, string> = {};
  const text = fs.readFileSync(propsPath, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    props[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return props;
}

function writeServerProperties(serverRoot: string, updates: Record<string, string>) {
  const propsPath = path.join(serverRoot, "server.properties");
  let text = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, "utf-8") : "";
  for (const [key, value] of Object.entries(updates)) {
    const lines = text.split(/\r?\n/);
    let found = false;
    text = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    }).join("\n");
    if (!found) text += `${text ? "\n" : ""}${key}=${value}`;
  }
  fs.mkdirSync(serverRoot, { recursive: true });
  fs.writeFileSync(propsPath, text, "utf-8");
}

function checkTtsEngine(engine: TtsEngine, timeoutMs = 1200) {
  const port = TTS_ENGINE_PORTS[engine];
  return new Promise<boolean>((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/version", timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForTtsEngine(engine: TtsEngine, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkTtsEngine(engine)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function resolveTtsExe(engine: TtsEngine) {
  return TTS_ENGINE_EXES[engine].find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function ttsDevHelperPlugin(): Plugin {
  return {
    name: "mygamepack-dev-helper",
    configureServer(server) {
      server.middlewares.use("/__dev/gifts/read", (req, res) => {
        const dir = path.join(process.cwd(), "GiftsViewer", "data", "gifts");
        const minPath = path.join(dir, "gifts.min.json");
        const metaPath = path.join(dir, "gifts.meta.json");
        const gifts = readJsonIfExists(minPath) || [];
        const meta = readJsonIfExists(metaPath);
        sendJson(res, 200, { gifts, meta, exists: fs.existsSync(minPath), minPath, metaPath });
      });

      server.middlewares.use("/__dev/commands/minecraft", (_req, res) => {
        const dir = path.join(process.cwd(), "bridge", "commands", "minecraft");
        if (!fs.existsSync(dir)) {
          sendJson(res, 200, []);
          return;
        }
        const files = fs.readdirSync(dir).filter((file) => file.endsWith(".txt")).sort();
        const commands = files.map((name) => {
          let title = name;
          try {
            const content = fs.readFileSync(path.join(dir, name), "utf-8");
            const match = content.match(/^#\s*TITLE:\s*(.+)$/m);
            if (match) title = match[1].trim();
          } catch {}
          return { name, title };
        });
        sendJson(res, 200, commands);
      });

      server.middlewares.use("/__dev/worlds/list", (req, res) => {
        const url = parseRequestUrl(req);
        const root = safeQueryPath(url.searchParams.get("root"));
        const dir = path.join(root, "haihu_world");
        if (!root || !fs.existsSync(dir)) {
          sendJson(res, 200, []);
          return;
        }
        sendJson(res, 200, fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
      });

      server.middlewares.use("/__dev/server/props/read", (req, res) => {
        const url = parseRequestUrl(req);
        const root = safeQueryPath(url.searchParams.get("root"));
        sendJson(res, 200, root ? readServerProperties(root) : {});
      });

      server.middlewares.use("/__dev/server/props/write", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, message: "POST only" });
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
            const root = String(body.root || "");
            if (!root) throw new Error("server root is empty");
            writeServerProperties(root, body.updates || {});
            sendJson(res, 200, { ok: true });
          } catch (error: any) {
            sendJson(res, 500, { ok: false, message: error?.message ?? String(error) });
          }
        });
      });

      server.middlewares.use("/__dev/folder/open", (req, res) => {
        const url = parseRequestUrl(req);
        const target = safeQueryPath(url.searchParams.get("path"));
        if (!target || !fs.existsSync(target)) {
          sendJson(res, 404, { ok: false, message: `フォルダが見つかりません: ${target}` });
          return;
        }
        try {
          spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
          sendJson(res, 200, { ok: true, path: target });
        } catch (error: any) {
          sendJson(res, 500, { ok: false, message: error?.message ?? String(error) });
        }
      });

      server.middlewares.use("/__dev/image/base64", async (req, res) => {
        const url = parseRequestUrl(req);
        const imageUrl = url.searchParams.get("url");
        if (!imageUrl) {
          sendJson(res, 400, { ok: false, message: "url is empty" });
          return;
        }
        try {
          const response = await fetch(imageUrl);
          if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
          const contentType = response.headers.get("content-type") || "image/webp";
          const bytes = Buffer.from(await response.arrayBuffer());
          sendJson(res, 200, { ok: true, dataUrl: `data:${contentType};base64,${bytes.toString("base64")}` });
        } catch (error: any) {
          sendJson(res, 500, { ok: false, message: error?.message ?? String(error) });
        }
      });

      server.middlewares.use("/__tts/launch", async (req, res, next) => {
        if (req.method !== "POST") return next();
        const engine = req.url?.replace(/^\/+/, "").split("?")[0];
        if (!isTtsEngine(engine)) {
          sendJson(res, 400, { ok: false, message: "未対応の読み上げエンジンです。" });
          return;
        }

        if (await checkTtsEngine(engine)) {
          sendJson(res, 200, { ok: true, alreadyRunning: true, message: "すでに起動しています。" });
          return;
        }

        const exePath = resolveTtsExe(engine);
        if (!exePath) {
          sendJson(res, 404, {
            ok: false,
            message: `実行ファイルが見つかりません。${engine === "voicevox" ? "VOICEVOX" : "AivisSpeech"}をインストールしてください。`,
          });
          return;
        }

        try {
          spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: "ignore" }).unref();
          const ready = await waitForTtsEngine(engine);
          sendJson(res, ready ? 200 : 504, {
            ok: ready,
            message: ready
              ? `${engine === "voicevox" ? "VOICEVOX" : "AivisSpeech"} を起動しました。`
              : "起動は実行しましたが、APIがまだ応答していません。少し待ってから同期してください。",
          });
        } catch (error: any) {
          sendJson(res, 500, { ok: false, message: error?.message ?? String(error) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ttsDevHelperPlugin()],
  base: "./", // ★Electron(file://)でもassetsが死なないため
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5174,
    proxy: {
      "/__tts/voicevox": {
        target: "http://127.0.0.1:50021",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/__tts\/voicevox/, ""),
      },
      "/__tts/aivis": {
        target: "http://127.0.0.1:10101",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/__tts\/aivis/, ""),
      },
    },
  }
});
