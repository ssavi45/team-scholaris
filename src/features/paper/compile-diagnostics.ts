export type CompileIssue = {
  severity: 'error' | 'warning'; message: string; hint: string;
  file?: string; line?: number; context: string; count: number;
}

export function describeCompileIssue(issue: CompileIssue): { title: string; explanation: string } {
  const message = issue.message
  if (/Underfull.*\\hbox/i.test(message)) return { title: 'Loose spacing in a paragraph', explanation: 'LaTeX stretched a line to fit the column. Check the PDF; if the spacing looks fine, no change is needed.' }
  if (/Overfull.*\\hbox/i.test(message)) return { title: 'Content extends past the margin', explanation: 'A line, equation or table is wider than the available space. Check the PDF near this location.' }
  if (/Underfull.*\\vbox/i.test(message)) return { title: 'Extra vertical space on a page', explanation: 'LaTeX could not fill the available page height evenly. Check the page spacing in the PDF.' }
  if (/Overfull.*\\vbox/i.test(message)) return { title: 'Content exceeds the page height', explanation: 'A block is taller than the available space. Check for content below the page margin.' }
  if (/Citation .*undefined|didn't find a database entry/i.test(message)) return { title: 'Citation could not be found', explanation: issue.hint }
  if (/Reference .*undefined|undefined references/i.test(message)) return { title: 'Unresolved reference', explanation: issue.hint }
  if (/Undefined control sequence/i.test(message)) return { title: 'Unrecognized LaTeX command', explanation: issue.hint }
  if (/Empty.*thebibliography/i.test(message)) return { title: 'The reference list is empty', explanation: issue.hint }
  if (/database file|bibdata|\.bib.*not found/i.test(message)) return { title: 'Bibliography file is missing or not configured', explanation: issue.hint }
  if (/File .*not found/i.test(message)) return { title: 'A required file is missing', explanation: issue.hint }
  if (/Unicode character|inputenc/i.test(message)) return { title: 'A character is not supported by this compiler', explanation: issue.hint }
  return { title: issue.severity === 'error' ? 'LaTeX needs a source correction' : 'LaTeX reported a warning', explanation: issue.hint }
}

function advice(message: string) {
  if (/didn't find a database entry|Citation .*undefined/i.test(message)) return 'Check that the citation key exists exactly in the .bib file selected by \\bibliography, then recompile.'
  if (/database file|bibdata|\.bib.*not found/i.test(message)) return 'Check the bibliography filename and path. Upload the .bib file and use its path without the extension in \\bibliography.'
  if (/style file|bibstyle/i.test(message)) return 'Check \\bibliographystyle and ensure the .bst style is available. Biber/biblatex is not supported by this compiler.'
  if (/expecting|Repeated entry|Illegal|error.*BibTeX|Warning--/i.test(message)) return 'Inspect the BibTeX entry for unmatched braces, missing commas, missing fields or duplicate keys. Keep the raw log for the exact entry.'
  if (/Reference .*undefined|undefined references/i.test(message)) return 'Check that each \\ref key has a matching \\label. Recompile after correcting the key.'
  if (/Unicode character|inputenc/i.test(message)) return 'This engine is pdfLaTeX. Use supported LaTeX commands or input/font packages; arbitrary Unicode and system fonts are not supported.'
  if (/File .*not found/i.test(message)) return 'Check the filename, case and relative path. For packages, check the network and whether this TeX distribution contains the package.'
  if (/Undefined control sequence/i.test(message)) return 'Check the command spelling and load the package that defines it.'
  if (/Overfull|Underfull/i.test(message)) return 'Review the typeset paragraph or table. This layout warning does not prevent a PDF.'
  if (/Empty.*thebibliography/i.test(message)) return 'No bibliography entries were produced. Check cited keys and the .bib database; use \\nocite{*} only if you want every entry.'
  return 'Review the source and raw log around this message, correct the cause, then recompile.'
}

// Only link locations that TeX explicitly reports and that match a project file.
// Parenthesized file tracing is best-effort; unknown locations remain raw context.
export function parseCompileDiagnostics(log: string, paths: string[]): CompileIssue[] {
  const known = new Set(paths)
  const normalize = (path: string) => path.replace(/^\.\//, '')
  const stack: (string | undefined)[] = []
  const rows = log.split(/\r?\n/)
  const issues: CompileIssue[] = []
  const add = (severity: CompileIssue['severity'], message: string, context: string, file?: string, line?: number) => {
    const clean = message.replace(/\s+/g, ' ').trim()
    line = file && line && line > 0 ? line : undefined
    const previous = issues.find(issue => issue.severity === severity && issue.message === clean && issue.file === file && issue.line === line)
    if (previous) { previous.count++; return }
    issues.push({ severity, message: clean, hint: advice(clean), context, file, line: file && line && line > 0 ? line : undefined, count: 1 })
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const location = row.match(/^(.+\.(?:tex|sty|cls|bib)):(\d+):\s*(.+)$/)
    if (location) {
      const file = normalize(location[1])
      add(/Warning/i.test(location[3]) ? 'warning' : 'error', location[3], row, known.has(file) ? file : undefined, Number(location[2]))
      continue
    }
    if (/^!|(?:LaTeX|Package .+|Class .+) Warning:|^(?:Overfull|Underfull|Warning--)|^(?:I couldn't open|I found no|I was expecting|Repeated entry|Illegal)/.test(row)) {
      const severity = /^!|^(?:I couldn't open|I found no|I was expecting|Repeated entry|Illegal)/.test(row) ? 'error' : 'warning'
      const context = rows.slice(i, i + 5).join('\n')
      const continuation = rows.slice(i + 1, i + 4).findIndex(line => /^\s*$|^!|^l\.|Warning:|^\(/.test(line))
      const message = rows.slice(i, i + 1 + (continuation < 0 ? 0 : continuation)).join(' ').replace(/^!\s*/, '')
      const bibLocation = /---line (\d+) of file (\S+\.bib)/.exec(message)
      const number = bibLocation?.[1] ?? /(?:on input line|at lines?)\s+(\d+)/.exec(message)?.[1] ?? /^l\.(\d+)/m.exec(context)?.[1]
      const file = bibLocation ? (known.has(bibLocation[2]) ? bibLocation[2] : undefined) : stack.at(-1)
      add(severity, message, context, file, number ? Number(number) : undefined)
      continue
    }
    // Ignore prose parentheses on warning/error lines, which are not file tracing.
    for (const token of row.matchAll(/\(([^\s()]*)|\)/g)) {
      if (token[0] === ')') stack.pop()
      else { const path = normalize(token[1]); stack.push(known.has(path) ? path : undefined) }
    }
  }
  return issues
}
