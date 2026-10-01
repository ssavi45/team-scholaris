import { useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleAlert, ChevronDown, FileCode2, X } from 'lucide-react'
import { describeCompileIssue, type CompileIssue } from './compile-diagnostics'
import './compile-diagnostics.css'

export function CompileDiagnostics({ issues, log, status, outcome, compiling, stale, jump, summary, close, canJump }: {
  issues: CompileIssue[]; log: string; status: string; stale: boolean;
  outcome: 'idle' | 'success' | 'failed' | 'cancelled'; compiling: boolean;
  jump: (issue: CompileIssue) => void; summary: string; close: () => void;
  canJump?: (issue: CompileIssue) => boolean;
}) {
  const [tab, setTab] = useState<'issues' | 'log'>('issues')
  const errors = issues.filter(issue => issue.severity === 'error')
  const warnings = issues.filter(issue => issue.severity === 'warning')
  const ordered = [...errors, ...warnings]
  const title = compiling ? 'Compiling your paper…' : outcome === 'failed' ? 'Compilation failed' : outcome === 'cancelled' ? 'Compilation cancelled' : outcome === 'success' ? errors.length ? 'PDF created — errors need attention' : 'PDF ready' : 'Compilation report'
  const description = compiling ? status : outcome === 'failed' ? 'Fix the reported problem, then recompile.' : outcome === 'cancelled' ? 'This build was stopped. Recompile when you are ready.' : outcome === 'success' ? errors.length ? 'Review these errors before using this PDF.' : warnings.length ? 'Your PDF is available. Review the warnings below for possible improvements.' : 'No recognized errors or warnings.' : 'Compile your paper to see the results here.'
  const StatusIcon = outcome === 'failed' || errors.length ? CircleAlert : outcome === 'success' ? CheckCircle2 : FileCode2
  return <section id="compile-log" className="compile-diagnostics" aria-label="Compilation report">
    <header className="diagnostic-header">
      <div className={errors.length || outcome === 'failed' ? 'diagnostic-result has-errors' : 'diagnostic-result'}><StatusIcon size={18} aria-hidden="true" /><div><strong role="status">{title}</strong><p>{description}</p></div></div>
      <button className="tool-button diagnostic-close" aria-label="Close compilation report" title="Close compilation report" onClick={close}><X size={17} /></button>
    </header>
    <div className="diagnostic-tabs" role="group" aria-label="Compilation report view">
      <button aria-pressed={tab === 'issues'} onClick={() => setTab('issues')}>Issues <span>{issues.length}</span></button>
      <button aria-pressed={tab === 'log'} onClick={() => setTab('log')}>Full log</button>
      {!!issues.length && <span className="diagnostic-counts">{errors.length} {errors.length === 1 ? 'error' : 'errors'} · {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}</span>}
    </div>
    <div className="diagnostic-body">
      {stale && <p className="diagnostic-stale">Source changed since this build. Recompile to update issues and source links.</p>}
      {tab === 'issues' ? <>
        {ordered.length ? <div className="diagnostic-list">{ordered.map((issue, index) => {
          const readable = describeCompileIssue(issue)
          const IssueIcon = issue.severity === 'error' ? CircleAlert : AlertTriangle
          return <details className={'diagnostic-item ' + issue.severity} key={index + ':' + issue.message}>
            <summary><IssueIcon size={15} aria-hidden="true" /><span className="diagnostic-item-title">{readable.title}</span><span className="diagnostic-location">{issue.file && issue.line ? issue.file + ':' + issue.line : 'Location unavailable'}</span><ChevronDown className="diagnostic-chevron" size={14} aria-hidden="true" /><span className="sr-only">{issue.severity}</span></summary>
            <div className="diagnostic-item-body"><p>{readable.explanation}</p>
              {issue.file && issue.line && <button className="diagnostic-source" title={canJump && !canJump(issue) ? 'Open this file from the workspace explorer to review it.' : undefined} disabled={stale || compiling || (canJump && !canJump(issue))} onClick={() => jump(issue)}><FileCode2 size={14} />Open {issue.file}, line {issue.line}</button>}
              <details className="diagnostic-technical"><summary>Technical details{issue.count > 1 ? ' · reported ' + issue.count + ' times' : ''}</summary><pre>{issue.message}{issue.context && '\n\nLog context:\n' + issue.context}</pre></details>
            </div>
          </details>
        })}</div> : <p className="diagnostic-empty">{outcome === 'failed' ? 'No source issue could be identified. Check the error above or open Full log for details.' : log ? 'Nothing to review. The full compiler output is available in Full log.' : 'No compiler messages yet.'}</p>}
      </> : <pre className="diagnostic-raw" tabIndex={0} aria-label="Full compiler output">{log || 'No compiler output for this build.'}</pre>}
      <details className="diagnostic-build-details"><summary>Build details</summary><p>{summary || 'No build details yet.'}</p><p>Compiled in your browser. <a href={import.meta.env.BASE_URL + 'vendor/swiftlatex/NOTICE.txt'} target="_blank" rel="noreferrer">Compiler credits</a></p></details>
    </div>
  </section>
}
