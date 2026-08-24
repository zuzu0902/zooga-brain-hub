/**
 * ZOOGA OS — תיקיות קבוצות (saved audiences) — pure, client-safe logic.
 *
 * Folders are reusable named sets of Alex Personal (WhatsApp Web Bridge) groups.
 * They never mutate the underlying groups, and never affect broadcasts that were
 * already created — broadcast targets are immutable snapshots.
 */

export type GroupFolder = {
  id: string;
  connection_id: string;
  name: string;
  description: string | null;
  group_ids: string[];
};

export type FolderGroupRef = {
  id: string;
  send_enabled: boolean;
  archived: boolean;
};

export type FolderValidation = { ok: true; name: string } | { ok: false; error: string };

export function validateFolderName(raw: unknown, existing: string[] = []): FolderValidation {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return { ok: false, error: "נדרש שם לתיקיית הקבוצות" };
  if (name.length > 60) return { ok: false, error: "שם התיקייה ארוך מדי (עד 60 תווים)" };
  const key = name.toLowerCase();
  if (existing.some((e) => e.trim().toLowerCase() === key)) {
    return { ok: false, error: "קיימת כבר תיקייה בשם הזה" };
  }
  return { ok: true, name };
}

/** Union of the selected folders' members, deduplicated and order-stable. */
export function unionFolderGroupIds(
  folders: Pick<GroupFolder, "id" | "group_ids">[],
  folderIds: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const fid of folderIds) {
    const folder = folders.find((f) => f.id === fid);
    if (!folder) continue;
    for (const gid of folder.group_ids) {
      if (seen.has(gid)) continue;
      seen.add(gid);
      out.push(gid);
    }
  }
  return out;
}

/** Applying a folder adds to the current selection; manual edits survive. */
export function applyFoldersToSelection(
  current: string[],
  folders: Pick<GroupFolder, "id" | "group_ids">[],
  folderIds: string[],
  selectable: FolderGroupRef[],
): string[] {
  const allowed = new Set(selectable.filter((g) => g.send_enabled && !g.archived).map((g) => g.id));
  const merged = [...current, ...unionFolderGroupIds(folders, folderIds)];
  const seen = new Set<string>();
  return merged.filter((id) => allowed.has(id) && !seen.has(id) && (seen.add(id), true));
}

/** Member count vs. the count that can actually be broadcast right now. */
export function folderCounts(
  folder: Pick<GroupFolder, "group_ids">,
  groups: FolderGroupRef[],
): { total: number; effective: number } {
  const byId = new Map(groups.map((g) => [g.id, g]));
  let effective = 0;
  for (const id of folder.group_ids) {
    const g = byId.get(id);
    if (g && g.send_enabled && !g.archived) effective += 1;
  }
  return { total: folder.group_ids.length, effective };
}

/** Default pacing between group sends. Stored only; no live runner yet. */
export const DEFAULT_BROADCAST_INTERVAL_SECONDS = 30;
