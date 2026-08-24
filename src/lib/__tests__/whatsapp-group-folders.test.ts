import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyFoldersToSelection,
  folderCounts,
  unionFolderGroupIds,
  validateFolderName,
  DEFAULT_BROADCAST_INTERVAL_SECONDS,
  type GroupFolder,
} from "@/lib/whatsapp-broadcast/folders";

const ROOT = process.cwd();
const FN_SRC = readFileSync(join(ROOT, "src/lib/whatsapp-broadcast.functions.ts"), "utf8");
const UI_SRC = readFileSync(join(ROOT, "src/routes/_app.broadcasts.tsx"), "utf8");

const groups = [
  { id: "g1", send_enabled: true, archived: false },
  { id: "g2", send_enabled: true, archived: false },
  { id: "g3", send_enabled: false, archived: false },
  { id: "g4", send_enabled: true, archived: true },
];

const trips: GroupFolder = { id: "f1", connection_id: "c1", name: "טיולים", description: null, group_ids: ["g1", "g2"] };
const vip: GroupFolder = { id: "f2", connection_id: "c1", name: "VIP", description: null, group_ids: ["g2", "g3"] };

describe("group folders — naming and persistence contract", () => {
  it("validates and trims folder names, rejecting duplicates case-insensitively", () => {
    expect(validateFolderName("  טיולים  ")).toEqual({ ok: true, name: "טיולים" });
    expect(validateFolderName("")).toMatchObject({ ok: false });
    expect(validateFolderName("x".repeat(61))).toMatchObject({ ok: false });
    expect(validateFolderName("vip", ["VIP"])).toMatchObject({ ok: false });
    expect(validateFolderName("VIP2", ["VIP"])).toMatchObject({ ok: true });
  });

  it("persists folders in normalized tables, not browser state", () => {
    expect(FN_SRC).toContain('from("whatsapp_group_folders")');
    expect(FN_SRC).toContain('from("whatsapp_group_folder_members")');
    expect(UI_SRC).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("group folders — multi-folder selection and dedupe", () => {
  it("unions overlapping folders without duplicates", () => {
    expect(unionFolderGroupIds([trips, vip], ["f1", "f2"])).toEqual(["g1", "g2", "g3"]);
  });

  it("applies folders on top of manual selection and skips unsendable groups", () => {
    expect(applyFoldersToSelection([], [trips, vip], ["f1", "f2"], groups)).toEqual(["g1", "g2"]);
    expect(applyFoldersToSelection(["g1"], [trips], ["f1"], groups)).toEqual(["g1", "g2"]);
    expect(applyFoldersToSelection([], [trips], ["missing"], groups)).toEqual([]);
  });

  it("never silently re-enables send-disabled or archived groups", () => {
    const disabled: GroupFolder = { ...vip, id: "f3", group_ids: ["g3", "g4"] };
    expect(applyFoldersToSelection([], [disabled], ["f3"], groups)).toEqual([]);
    expect(folderCounts(disabled, groups)).toEqual({ total: 2, effective: 0 });
    expect(folderCounts(trips, groups)).toEqual({ total: 2, effective: 2 });
  });
});

describe("group folders — safety and Alex-only enforcement", () => {
  it("gates every folder server fn on admin and on the bridge connection", () => {
    const handlers = FN_SRC.match(/createServerFn\(\{/g) ?? [];
    const gates = FN_SRC.match(/assertAdmin\(context\)/g) ?? [];
    expect(gates.length).toBe(handlers.length);
    expect(FN_SRC).toContain("assertBridgeConnection");
    expect(FN_SRC).toContain("canOwnGroupBroadcast");
  });

  it("filters folder membership to groups of the same bridge connection", () => {
    expect(FN_SRC).toMatch(/g\.connection_id === data\.connection_id/);
  });

  it("deleting a folder never deletes or archives WhatsApp groups", () => {
    const del = FN_SRC.slice(FN_SRC.indexOf("export const deleteGroupFolder"));
    expect(del).toContain('from("whatsapp_group_folders").delete()');
    expect(del).not.toMatch(/from\(\s*["'`]whatsapp_groups["'`]/);
    expect(del).not.toMatch(/archived/);
  });

  it("folder edits do not touch existing broadcasts or their target snapshots", () => {
    const save = FN_SRC.slice(
      FN_SRC.indexOf("export const saveGroupFolder"),
      FN_SRC.indexOf("export const deleteGroupFolder"),
    );
    expect(save).not.toMatch(/whatsapp_broadcasts|whatsapp_broadcast_targets/);
    const del = FN_SRC.slice(FN_SRC.indexOf("export const deleteGroupFolder"));
    expect(del).not.toMatch(/whatsapp_broadcasts|whatsapp_broadcast_targets/);
  });

  it("broadcast targets remain immutable name/chat-id snapshots", () => {
    expect(FN_SRC).toContain("group_name_snapshot");
    expect(FN_SRC).toContain("whatsapp_chat_id_snapshot");
  });

  it("keeps a conservative default pacing value for the future runner", () => {
    expect(DEFAULT_BROADCAST_INTERVAL_SECONDS).toBe(30);
  });
});
