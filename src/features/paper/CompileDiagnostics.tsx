import { useState } from 'react'
import type { CompileIssue } from './compile-diagnostics'
import './compile-diagnostics.css'

export function CompileDiagnostics({ issues, log, status, stale, jump, summary }: {
  issues: CompileIssue[]; log: string; status: string; stale: boolean;
  jump: (issue: CompileIssue) => void; summary: string;
}) {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, Math.max(0, issues.length - 1))
  const issue = issues[index]
  return <section id="compile-log" className="compile-diagnostics" aria-label="Compilation diagnostics">
    <div className="diagnostic-heading"><strong role="status">{status}</strong><span>{summary}</span></div>
    {stale && <p>These diagnostics describe the compiled snapshot. Source has changed; recompile for current locations.</p>}
    {!!issues.length && <><div className="diagnostic-navigation"><button className="tool-button" disabled={index === 0} onClick={() => setSelected(index - 1)}>Previous issue</button><span>{index + 1} / {issues.length}</span><button className="tool-button" disabled={index === issues.length - 1} onClick={() => setSelected(index + 1)}>Next issue</button></div>
      <article className={`diagnostic-issue ${issue.severity}`}><strong>{issue.severity === 'error' ? 'Error' : 'Warning'}{issue.count > 1 ? ` (${issue.count} occurrences)` : ''}: {issue.message}</strong><p>{issue.hint}</p>
        {issue.file && issue.line ? <button className="button secondary compact-button" disabled={stale} onClick={() => jump(issue)}>{issue.file}:{issue.line} — Go to source</button> : <p>Exact source location unavailable. See log context below.</p>}
        <details><summary>Log context</summary><pre>{issue.context}</pre></details>
      </article></>}
    {!issues.length && <p>{log ? 'No recognized errors or warnings. The raw log may contain additional engine messages.' : 'No engine log yet.'}</p>}
    <details><summary>Raw compiler log</summary><pre>{log || 'Compile your paper to see engine output.'}</pre></details>
    <p>Compiles in your browser. Each rebuild uses a fresh compiler filesystem. <a href={`${import.meta.env.BASE_URL}vendor/swiftlatex/NOTICE.txt`} target="_blank" rel="noreferrer">Compiler credits</a></p>
  </section>
}
