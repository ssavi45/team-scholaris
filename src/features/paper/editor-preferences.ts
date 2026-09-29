export type EditorPreferences = { fontSize: number; wrap: boolean; indent: number; split: number; explorerWidth: number; sidebar: boolean; focus: 'source' | 'pdf' | null; mode: 'source' | 'split' | 'pdf' }
export const defaultPreferences: EditorPreferences = { fontSize: 14, wrap: true, indent: 2, split: 50, explorerWidth: 220, sidebar: true, focus: null, mode: 'split' }
export function normalizePreferences(value: unknown): EditorPreferences {
  const v = value && typeof value === 'object' ? value as Partial<EditorPreferences> : {}
  const number = (n: unknown, fallback: number, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback
  return { fontSize: number(v.fontSize, 14, 11, 24), wrap: typeof v.wrap === 'boolean' ? v.wrap : true, indent: v.indent === 4 ? 4 : 2,
    split: number(v.split, 50, 25, 75), explorerWidth: number(v.explorerWidth, 220, 170, 380), sidebar: typeof v.sidebar === 'boolean' ? v.sidebar : true,
    focus: v.focus === 'source' || v.focus === 'pdf' ? v.focus : null, mode: v.mode === 'source' || v.mode === 'pdf' ? v.mode : 'split' }
}
export function readEditorPreferences(user: string): EditorPreferences {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(`scholaris:editor:${user}`) ?? 'null')) } catch { return { ...defaultPreferences } }
}
export function saveEditorPreferences(user: string, preferences: EditorPreferences) {
  try { localStorage.setItem(`scholaris:editor:${user}`, JSON.stringify(normalizePreferences(preferences))) } catch { /* Preferences must never block writing. */ }
}
