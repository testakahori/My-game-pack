// src/types.ts

// 統合UI: 左サイドバーのページ
export enum AppPage {
  DASHBOARD = "dashboard",
  GIFTS = "gifts",
  EVENTS = "events",
  EVENTS2 = "events2",
  TTS = "tts",
  GIFTS_VIEWER = "gifts_viewer",
  COMMANDS = "commands",
  WORLD = "world",
  SETUP = "setup",
  OPERATIONS = "operations",
  STATS = "stats",
}

export enum AppTab {
  COMMAND_SETS = "command_sets",
  MAPPINGS = "mappings",
  GIFTS = "gifts", // ✅ 追加：ギフト一覧タブ
  SETTINGS = "settings",
  IMAGE_EDITOR = "image_editor",
}

export type GiftMapping = {
  id: string;
  giftId: string;
  name: string;

  // bridge/commands に置く txt を参照（ファイル名だけ持つ）
  commandFile: string;

  // このギフトでコマンドセットを何回繰り返すか（1〜100）
  repeat?: number;

  // UI表示用（任意）
  commandSetLabel?: string;
};

export type CommandSet = {
  id: string;
  label: string; // 表示名
  filename: string; // husk_1.txt など
  content: string; // 1行=1コマンド
  updatedAt: number;
};
