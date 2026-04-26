export type Mapping = {
  giftId: string;
  name: string;
  commandFile: string;
  repeat: number;
};

export type SharedData = {
  mappings: Mapping[];
  updatedAt: number;
};

const KEY = "trybai_shared_mappings_v1";

export function loadShared(): SharedData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { mappings: [], updatedAt: Date.now() };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.mappings)) {
      return { mappings: [], updatedAt: Date.now() };
    }
    return {
      mappings: parsed.mappings,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return { mappings: [], updatedAt: Date.now() };
  }
}

export function saveShared(next: Omit<SharedData, "updatedAt">) {
  const data: SharedData = { ...next, updatedAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(data));
  return data;
}
