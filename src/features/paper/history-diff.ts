import type { PaperFile } from './paper-api'

export function compareHistory(snapshot: PaperFile[], current: PaperFile[]) {
  const ids = [...new Set([...snapshot.map(file => file.id), ...current.map(file => file.id)])]
  return ids.map(id => {
    const before = snapshot.find(file => file.id === id)
    const after = current.find(file => file.id === id)
    const changes = !before ? ['Added since snapshot'] : !after ? ['Deleted since snapshot'] : [
      ...(before.path !== after.path ? ['Renamed'] : []),
      ...(before.kind !== after.kind || before.content !== after.content || before.storage_path !== after.storage_path ? ['Modified'] : []),
    ]
    return { id, before, after, changes }
  }).sort((a, b) => (a.after?.path ?? a.before!.path).localeCompare(b.after?.path ?? b.before!.path))
}

// Bounded line diff: retain common prefix/suffix and show the changed middle.
// Unlike a quadratic LCS, a large manuscript cannot stall the UI.
export function sourceDiff(before: string, after: string) {
  const a = before.split('\n'), b = after.split('\n')
  let first = 0, tail = 0
  while (first < a.length && first < b.length && a[first] === b[first]) first++
  while (tail < a.length - first && tail < b.length - first && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { firstLine: first + 1, removed: a.slice(first, a.length - tail), added: b.slice(first, b.length - tail), unchanged: first + tail }
}
