import type { TreeEntry } from './file-tree'

export const starterNames = { article: 'Blank article', report: 'Research report', thesis: 'Multi-file thesis' }
export function starterTemplate(kind: keyof typeof starterNames): TreeEntry[] {
  const text = (path: string, content: string): TreeEntry => ({ path, content, kind: 'text' })
  const preamble = `\\documentclass{${kind === 'article' ? 'article' : 'report'}}\n\\usepackage{graphicx}\n\\usepackage{amsmath}\n\\usepackage{hyperref}\n\\title{Your research}\n\\author{Your name}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n`
  const end = '\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}\n'
  const example = '\nSee the bibliography example \\cite{greenwade93}.\n\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=2cm]{figures/example.png}\n\\caption{Replace this sample image with your research figure.}\n\\label{fig:example}\n\\end{figure}\n'
  const sections = kind === 'thesis' ? '\\tableofcontents\n\\input{chapters/introduction}\n\\input{chapters/methods}\n\\input{chapters/results}\n' : kind === 'report' ? '\\tableofcontents\n\\chapter{Introduction}\nWrite your research question here.\n' + example + '\\chapter{Methods}\nDescribe your methods.\n\\chapter{Results}\nDiscuss your results.\n' : '\\section{Introduction}\nStart writing here.\n'
  const entries = [text('main.tex', preamble + sections + end), text('references.bib', '@article{greenwade93,\n author={George D. Greenwade},\n title={The Comprehensive TeX Archive Network (CTAN)},\n journal={TUGBoat}, year={1993}, volume={14}, number={3}, pages={342--351}\n}\n')]
  if (kind === 'thesis') entries.push(text('chapters/introduction.tex', '\\chapter{Introduction}\nIntroduce your research.\n' + example), text('chapters/methods.tex', '\\chapter{Methods}\nDescribe your methods.\n'), text('chapters/results.tex', '\\chapter{Results}\nDiscuss your results.\n'))
  if (kind !== 'article') {
    // Original minimal PNG fixture, not a third-party publisher asset.
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    entries.push({ path: 'figures/example.png', kind: 'image', content: '', bytes, size_bytes: bytes.length })
  }
  return entries
}
