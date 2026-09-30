import { useEffect, useMemo, useRef, useState } from 'react'
import { applyPaperTree, loadPaperState, type PaperFile } from './paper-api'
import { bibDisplay, commonBibFields, editBibFields, indexReferences, mergeBibImport, parseBibFile, renameCitation, validReferenceKey, type BibEntry, type ImportChoice } from './references'
import type { TextSource, SourceLocation } from './editor-tools'
import { sourceDiff } from './history-diff'
import './references.css'

type Snapshot = { files: PaperFile[]; revision: number; main: string }
type Plan = { entries: PaperFile[]; description: string; warnings: string[]; changes: { path: string; before: string; after: string }[] }
const fieldValue = (entry: BibEntry, name: string) => {
  const raw = entry.fields.find(field => field.name === name)?.value ?? ''
  return (raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('"') && raw.endsWith('"')) ? raw.slice(1, -1) : raw
}
export default function ReferenceManager({ projectId, files, blocked, close, onBusy, applied, navigate }: {
  projectId: string; files: TextSource[]; blocked: boolean; close: () => void;
  onBusy: (busy: boolean) => void; applied: () => Promise<void>;
  navigate: (location: SourceLocation, expected: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), working = useRef(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [query, setQuery] = useState('')
  const [mode, setMode] = useState<'browse' | 'import' | 'edit' | 'new' | 'rename'>('browse')
  const [entry, setEntry] = useState<BibEntry | null>(null), [fields, setFields] = useState<Record<string, string>>({})
  const [key, setKey] = useState(''), [type, setType] = useState('article'), [raw, setRaw] = useState('')
  const [target, setTarget] = useState('references.bib'), [choices, setChoices] = useState<Record<string, ImportChoice>>({})
  const [plan, setPlan] = useState<Plan | null>(null), [acknowledged, setAcknowledged] = useState(false)
  const live = useMemo(() => indexReferences(files), [files])
  const saved = useMemo(() => indexReferences(snapshot?.files ?? []), [snapshot])
  const imported = useMemo(() => parseBibFile({ id: 'import', path: 'import.bib', kind: 'text', content: raw }), [raw])
  const existingBibs = snapshot?.files.filter(file => file.kind === 'text' && file.path.endsWith('.bib')) ?? []
  useEffect(() => {
    const node = dialog.current!; node.showModal(); const controller = new AbortController()
    void loadPaperState(projectId, controller.signal).then(state => {
      if (controller.signal.aborted) return
      if (!state.settings) throw new Error('Paper unavailable.')
      setSnapshot({ files: state.files, revision: state.settings.revision, main: state.settings.main_file })
      setTarget(state.files.find(file => file.kind === 'text' && file.path.endsWith('.bib'))?.path ?? 'references.bib')
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load references.') })
    return () => { controller.abort(); node.close() }
  }, [projectId])
  function start(next: typeof mode, selected?: BibEntry) {
    setMode(next); setEntry(selected ?? null); setPlan(null); setError(''); setAcknowledged(false)
    setKey(selected?.key ?? ''); setFields(selected ? Object.fromEntries(commonBibFields.map(name => [name, fieldValue(selected, name)])) : {})
  }
  function openSource(location: SourceLocation) {
    const file = files.find(item => item.id === location.fileId)
    if (file) { navigate(location, file.content); close() }
  }
  async function readImport(file?: File) {
    if (!file) return
    try {
      if (file.size > 524288) throw new Error('Import at most 512 KiB of UTF-8 BibTeX.')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      setRaw(content); setChoices({}); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read BibTeX.') }
  }
  function prepare() {
    if (!snapshot || blocked || busy) return
    try {
      let entries = snapshot.files, description = '', warnings: string[] = []
      if (mode === 'rename' && entry) {
        const result = renameCitation(entries, entry.key, key)
        entries = result.entries; warnings = result.warnings.map(item => `${item.path}:${item.line} — ${item.message}`)
        description = `Rename ${entry.key} to ${key}; update ${result.uses.length} supported citation uses.`
      } else if (mode === 'edit' && entry) {
        const file = entries.find(item => item.id === entry.fileId)!
        if (parseBibFile(file).notices.length) throw new Error('Repair malformed entries in this file before using the form.')
        const changed = Object.fromEntries(commonBibFields.filter(name => (fields[name] ?? '') !== fieldValue(entry, name)).map(name => [name, fields[name] ?? '']))
        const content = editBibFields(file.content, entry, changed)
        if (parseBibFile({ ...file, content }).notices.length) throw new Error('These field values produce invalid BibTeX. Check braces or edit in source.')
        entries = entries.map(item => item.id === file.id ? { ...item, content } : item)
        description = `Update fields in ${entry.key}. Unchanged fields and advanced values are preserved.`
      } else {
        let incoming = raw
        if (mode === 'new') {
          if (!validReferenceKey(key)) throw new Error('Use a key starting with a letter or number, without spaces.')
          if (saved.entries.some(item => item.key === key)) throw new Error('That key already exists. Choose another key.')
          const base = `@${type}{${key},\n}\n`
          const parsed = parseBibFile({ id: '', path: target, kind: 'text', content: base }).entries[0]
          incoming = editBibFields(base, parsed, fields)
        }
        if (!target.endsWith('.bib')) throw new Error('Choose a .bib destination.')
        if (!entries.some(file => file.path === target)) {
          if (target !== 'references.bib') throw new Error('Create additional bibliography files in Files first.')
          // Empty id becomes a new-file entry in the manifest, never a fabricated database id.
          entries = [...entries, { ...snapshot.files[0], id: '', path: target, kind: 'text', content: '', storage_path: null }]
        }
        if (entries.filter(file => file.path.endsWith('.bib')).some(file => parseBibFile(file).notices.length)) throw new Error('Repair malformed bibliography files before importing.')
        const incomingStrings = [...incoming.matchAll(/@string\s*[{(]\s*([^=\s]+)\s*=/gi)].map(match => match[1].toLowerCase())
        const oldStrings = entries.flatMap(file => file.path.endsWith('.bib') ? [...file.content.matchAll(/@string\s*[{(]\s*([^=\s]+)\s*=/gi)].map(match => match[1].toLowerCase()) : [])
        if (new Set(incomingStrings).size !== incomingStrings.length || incomingStrings.some(name => oldStrings.includes(name))) throw new Error('Conflicting @string definitions. Resolve them in the import text first; strings are never silently overwritten.')
        entries = mergeBibImport(entries, target, incoming, mode === 'new' ? {} : choices)
        description = mode === 'new' ? `Add ${key} to ${target}.` : `Import BibTeX into ${target} using your duplicate choices.`
        warnings = ['Ensure the paper uses the correct \\bibliography{...} file and \\bibliographystyle{...}. This action does not change compiler setup.']
        if (mode === 'import' && Object.values(choices).some(choice => choice.action === 'rename')) warnings.push('Renamed imported keys do not rewrite crossref, xdata or macro dependencies. Review those manually.')
      }
      const changes = entries.filter(file => file.content !== (snapshot.files.find(old => old.id === file.id && old.path === file.path)?.content ?? '')).map(file => ({ path: file.path, before: snapshot.files.find(old => old.id === file.id && old.path === file.path)?.content ?? '', after: file.content }))
      if (!changes.length) throw new Error('No changes to apply.')
      setPlan({ entries, description, warnings, changes }); setAcknowledged(false); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to prepare changes.') }
  }
  async function apply() {
    if (!snapshot || !plan || blocked || working.current || (plan.warnings.length && !acknowledged)) return
    working.current = true; setBusy(true); onBusy(true); setError('')
    try {
      await applyPaperTree(projectId, snapshot.revision, plan.entries.map(file => ({ ...file, id: file.id || undefined })), snapshot.main)
      await applied(); close()
    } catch (cause) { setError((cause instanceof Error ? cause.message : 'Save failed.') + ' Close and reopen to load the latest version before retrying.'); setPlan(null) }
    finally { working.current = false; setBusy(false); onBusy(false) }
  }
  const shown = live.entries.filter(item => [item.key, item.path, ...['title', 'author', 'year'].map(name => bibDisplay(item, name))].join(' ').toLowerCase().includes(query.toLowerCase()))
  return <dialog ref={dialog} className="project-dialog reference-dialog reference-manager" aria-labelledby="reference-manager-title" onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    <header className="reference-heading"><h2 id="reference-manager-title">References</h2><button className="button secondary compact-button" disabled={busy} onClick={close}>Close</button></header>
    {error && <p role="alert" className="notice error-notice">{error}</p>}
    {blocked && !busy && <p className="reference-help">Browse current drafts. To apply changes, you need edit access, saved drafts, no conflicts and no active operation.</p>}
    {!snapshot && !error && <p role="status">Loading saved bibliography…</p>}
    {plan ? <>
      <h3>Review changes</h3><p>{plan.description}</p><p className="reference-help">{plan.changes.length} files · saved revision {snapshot?.revision}. All changes are applied together with revision protection.</p>
      {plan.warnings.length > 0 && <><ul>{plan.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul><label className="reference-check"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I have reviewed these limitations.</label></>}
      <div className="reference-diffs">{plan.changes.map(change => { const diff = sourceDiff(change.before, change.after); return <details key={change.path}><summary>{change.path} · changes at line {diff.firstLine}</summary><pre>{diff.removed.slice(0, 200).map(line => '- ' + line).join('\n')}{'\n'}{diff.added.slice(0, 200).map(line => '+ ' + line).join('\n')}</pre><small>Preview limited to 200 lines per side.</small></details> })}</div>
      <div className="reference-actions"><button className="button secondary" disabled={busy} onClick={() => setPlan(null)}>Back to editing</button><button className="button primary" disabled={blocked || busy || (!!plan.warnings.length && !acknowledged)} onClick={() => void apply()}>{busy ? 'Saving…' : 'Apply reviewed changes'}</button></div>
    </> : mode === 'browse' ? <>
      <div className="reference-actions"><button className="button primary" disabled={blocked || !snapshot} onClick={() => start('new')}>Add reference</button><button className="button secondary" disabled={blocked || !snapshot} onClick={() => start('import')}>Import BibTeX</button></div>
      <label>Find a reference<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Author, title, year or key" /></label>
      <p className="reference-help">Current .bib drafts · {live.entries.length} entries. Raw source remains editable; this form does not expand TeX macros or BibTeX strings.</p>
      <div className="reference-results">{shown.slice(0, 150).map(item => {
        const savedEntry = saved.entries.find(old => old.fileId === item.fileId && old.key === item.key && old.raw === item.raw)
        return <article className="reference-entry" key={item.fileId + ':' + item.from}><strong>{bibDisplay(item, 'title') || item.key}</strong><p>{bibDisplay(item, 'author')} {bibDisplay(item, 'year')}</p><code>{item.key}</code><small>{item.path}:{item.line}</small><div className="reference-actions"><button className="button secondary compact-button" onClick={() => openSource(item)}>Open source</button><button className="button secondary compact-button" disabled={blocked || !savedEntry} onClick={() => start('edit', savedEntry)}>Edit fields</button><button className="button secondary compact-button" disabled={blocked || !savedEntry || live.duplicateCitations.has(item.key)} onClick={() => start('rename', savedEntry)}>Rename key</button></div></article>
      })}{!shown.length && <p>No references yet, or no matches. Add a reference or import BibTeX.</p>}{shown.length > 150 && <p>Showing 150 entries. Narrow your search.</p>}</div>
      <details className="reference-checks"><summary>Key checks · {live.notices.length} issues</summary>{!live.notices.length && <p>No missing or duplicate literal keys found in current project files.</p>}{live.notices.map((notice, i) => <button className="reference-pick" key={i} onClick={() => openSource(notice)}><strong>{notice.message}</strong><small>{notice.path}:{notice.line} · Open source</small></button>)}<p className="reference-help">Checks scan all project sources, including files outside the active paper. They do not evaluate macros or confirm which .bib files are included. Compilation remains the final check.</p></details>
      <details className="reference-checks"><summary>Unsupported commands · {live.unsupported.length}</summary>{live.unsupported.map((notice, i) => <button className="reference-pick" key={i} onClick={() => openSource(notice)}>{notice.message}<small>{notice.path}:{notice.line}</small></button>)}</details>
    </> : <>
      <button className="button secondary compact-button" onClick={() => start('browse')}>Back to references</button><h3>{mode === 'import' ? 'Import BibTeX' : mode === 'rename' ? 'Rename citation key' : mode === 'new' ? 'Add a reference' : 'Edit common fields'}</h3>
      {(mode === 'import' || mode === 'new') && <><label>Bibliography file<select value={target} onChange={event => setTarget(event.target.value)}>{existingBibs.map(file => <option key={file.id}>{file.path}</option>)}{!existingBibs.some(file => file.path === 'references.bib') && <option value="references.bib">references.bib (create)</option>}</select></label><details className="reference-checks"><summary>How do references appear in my PDF?</summary><p>Cite an entry using Insert → Citation. For a standard BibTeX paper, include these commands before <code>\end{'{document}'}</code>, then recompile. Keep your existing bibliography style if one is already configured.</p><pre>{'\\bibliographystyle{plain}\n\\bibliography{' + target.replace(/\.bib$/, '') + '}'}</pre><p>Nested main files may need a different relative path. Advanced bibliography setup stays in source. DOI lookup and external library sync are not enabled.</p></details></>}
      {mode === 'import' ? <>
        <label>Upload .bib file<input type="file" accept=".bib,text/plain" onChange={event => void readImport(event.target.files?.[0])} /></label><label>Or paste BibTeX<textarea value={raw} maxLength={524288} onChange={event => { setRaw(event.target.value); setChoices({}) }} rows={9} /></label>
        <p>{imported.entries.length} entries found</p>{imported.entries.slice(0, 100).map(item => <div className="reference-import-row" key={item.from}><strong>{item.key}</strong><span>{bibDisplay(item, 'title')}</span>{saved.entries.some(old => old.key === item.key) && <><label>Duplicate key<select value={choices[item.key]?.action ?? ''} onChange={event => setChoices({ ...choices, [item.key]: { action: event.target.value as ImportChoice['action'] } })}><option value="" disabled>Choose an action</option><option value="keep">Keep existing; skip imported entry</option><option value="replace">Replace existing entry</option><option value="rename">Import with a new key</option></select></label>{choices[item.key]?.action === 'rename' && <label>New key<input value={choices[item.key]?.key ?? ''} onChange={event => setChoices({ ...choices, [item.key]: { action: 'rename', key: event.target.value } })} /></label>}</>}</div>)}{imported.entries.length > 100 && <p>Use imports of at most 100 entries so every entry can be reviewed.</p>}{imported.notices.map((notice, i) => <p role="alert" key={i}>Line {notice.line}: {notice.message}</p>)}
      </> : mode === 'rename' ? <><p>Current key: <code>{entry?.key}</code>. Preview shows supported citation changes. Comments and verbatim text are excluded.</p><label>New citation key<input value={key} onChange={event => setKey(event.target.value)} /></label></> : <>
        {mode === 'new' && <><label>Entry type<select value={type} onChange={event => setType(event.target.value)}>{['article', 'book', 'inproceedings', 'misc', 'phdthesis'].map(value => <option key={value}>{value}</option>)}</select></label><label>Citation key<input value={key} onChange={event => setKey(event.target.value)} placeholder="greenwade93" /></label></>}
        <p className="reference-help">Only changed fields are rewritten as braced text. Leave advanced string expressions unchanged or edit them in source. Use “and” between authors. Required fields depend on the entry type and style.</p>
        <div className="reference-field-grid">{commonBibFields.map(name => <label key={name}>{name}<input value={fields[name] ?? ''} onChange={event => setFields({ ...fields, [name]: event.target.value })} /></label>)}</div>
      </>}
      <button className="button primary" disabled={blocked || !snapshot || (mode === 'import' && (imported.entries.length > 100 || !!imported.notices.length))} onClick={prepare}>Preview changes</button>
    </>}
  </dialog>
}
