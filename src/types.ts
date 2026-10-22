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
  IMAGE_EDITOR = "image_editor",
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

  // 手で書いた enabled: false（画面に切り替えはない）。BRIDGE はそのコマンドを動かさない。保存で落とさないように持つ（処理のコピー PR5）
  enabled?: boolean;
};

export type CommandSet = {
  id: string;
  label: string; // 表示名
  filename: string; // husk_1.txt など
  content: string; // 1行=1コマンド
  updatedAt: number;
};
