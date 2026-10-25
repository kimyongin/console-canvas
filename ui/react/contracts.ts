// Renderer-facing contracts only. Runtime validation remains in JS/IPC/MCP.
export interface SaveView {
  pending: boolean;
  error: string | null;
  message: string;
}
export interface SnapshotPoint {
  edits: Record<string, { dx?: number; dy?: number; deleted?: boolean; copy?: unknown }>;
  annotations: Record<string, string>;
  selected: string | null;
  selection: string[];
  note: string;
  activityHead: string | null;
}
export interface SnapshotEntry {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  kind: 'initial' | 'automatic' | 'manual';
  deletedAt?: string;
  state: SnapshotPoint;
}
export interface ActivityEvent {
  id: string;
  parent_id: string | null;
  snapshot_id: string | null;
  created_at: string;
  actor: 'user' | 'agent';
  label: string;
  changes: {
    id: string;
    type: string;
    name: string;
    before: string | SnapshotPoint['edits'][string];
    after: string | SnapshotPoint['edits'][string];
  }[];
}
export type FileSaveResult = { canceled: true } | { path: string };
export type FlushResult = { document_id: string | null };
export type MutationResult<T> =
  | { ok: true; screen: T; persisted?: FlushResult | false; save_error?: string }
  | { ok: false; revision: number; error: { code: string; message: string } };
export interface EditorDesktopAPI {
  openSource(url: string): Promise<unknown>;
  showSource(): Promise<unknown>;
  renderImage(value: { html: string; width: number; height: number }): Promise<Uint8Array>;
  saveFile(value: { name: string; bytes: ArrayBuffer }): Promise<FileSaveResult>;
  getConnection(): Promise<{ url: string; token: string } | null>;
  onHistory(callback: (command: 'undo' | 'redo') => void): void;
  onFlush(callback: () => Promise<FlushResult>): void;
  onSnapshot(callback: (value: unknown) => void): void;
}
declare global {
  interface Window {
    ConsoleCanvasDesktop?: EditorDesktopAPI;
  }
}
