// Renderer-facing contracts only. Runtime validation remains in JS/IPC/MCP.
export interface SaveView {
  pending: boolean;
  error: string | null;
  message: string;
}
export interface EditorPoint {
  resourceRepairs?: unknown[];
  edits: Record<string, { dx?: number; dy?: number; deleted?: boolean; copy?: unknown }>;
  annotations: Record<string, string>;
  selected: string | null;
  selection: string[];
  note: string;
  activityHead: string | null;
}
export interface ActivityEvent {
  id: string;
  parent_id: string | null;
  created_at: string;
  actor: 'user' | 'agent';
  label: string;
  changes: {
    id: string;
    type: string;
    name: string;
    before: string | EditorPoint['edits'][string];
    after: string | EditorPoint['edits'][string];
  }[];
}
export type FileSaveResult = { canceled: true } | { path: string };
export type FlushResult = { document_id: string | null };
export type MutationResult<T> =
  | { ok: true; screen: T; persisted?: FlushResult | false; save_error?: string }
  | { ok: false; revision: number; error: { code: string; message: string } };
export interface EditorDesktopAPI {
  retryAssets(urls: string[]): Promise<{ url: string; data?: string; error?: string }[]>;
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
