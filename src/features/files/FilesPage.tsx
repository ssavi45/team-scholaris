import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { loadProject } from '../projects/projects-api'
import {
  deleteProjectFile,
  downloadProjectFile,
  formatBytes,
  getFileCategory,
  loadProjectFiles,
  MAX_FILE_SIZE_BYTES,
  MAX_PROJECT_STORAGE_BYTES,
  renameProjectFile,
  uploadProjectFile,
  type ProjectFile,
} from './files-api'

export function FilesPage() {
  const { projectId = '' } = useParams()
  return <FilesWorkspace key={projectId} projectId={projectId} />
}

function FilesWorkspace({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const [projectData, setProjectData] = useState<Awaited<ReturnType<typeof loadProject>> | null>(null)
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'name_asc' | 'size_desc'>('date_desc')

  // Upload states
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Rename modal state
  const [renameTarget, setRenameTarget] = useState<ProjectFile | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  const [renameSubmitting, setRenameSubmitting] = useState(false)

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    Promise.all([
      loadProject(projectId, controller.signal),
      loadProjectFiles(projectId, controller.signal),
    ])
      .then(([proj, fileList]) => {
        if (controller.signal.aborted) return
        setProjectData(proj)
        setFiles(fileList)
        setLoading(false)
        setError('')
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Unable to load project files.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [projectId, attempt])

  const myMembership = projectData?.members.find((m) => m.user_id === user?.id)
  const isOwner = myMembership?.access_level === 'owner'
  const isMember = myMembership?.access_level === 'member' || isOwner
  const isArchived = projectData?.project.status === 'archived'
  const canWrite = !isArchived && isMember

  const totalUsedBytes = useMemo(
    () => files.reduce((sum, f) => sum + f.size_bytes, 0),
    [files]
  )
  const usedPercentage = Math.min(100, (totalUsedBytes / MAX_PROJECT_STORAGE_BYTES) * 100)

  // Filter & Sort
  const filteredFiles = useMemo(() => {
    return files
      .filter((file) => {
        const matchesSearch = file.name.toLowerCase().includes(search.trim().toLowerCase())
        if (!matchesSearch) return false
        if (category === 'all') return true
        const cat = getFileCategory(file.name, file.mime_type)
        return cat === category
      })
      .sort((a, b) => {
        if (sortBy === 'name_asc') return a.name.localeCompare(b.name)
        if (sortBy === 'size_desc') return b.size_bytes - a.size_bytes
        if (sortBy === 'date_asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
  }, [files, search, category, sortBy])

  async function processFiles(fileList: FileList | File[]) {
    if (!canWrite) return
    const incoming = Array.from(fileList)
    if (incoming.length === 0) return

    setUploading(true)
    setUploadError('')
    setUploadStatus(`Preparing ${incoming.length} file(s)...`)

    const currentFiles = [...files]
    const errors: string[] = []

    for (let i = 0; i < incoming.length; i++) {
      const file = incoming[i]
      setUploadStatus(`Uploading (${i + 1}/${incoming.length}): ${file.name}...`)
      try {
        const uploaded = await uploadProjectFile(projectId, file, currentFiles)
        currentFiles.unshift(uploaded)
        setFiles([...currentFiles])
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`)
      }
    }

    setUploading(false)
    setUploadStatus('')
    if (errors.length > 0) {
      setUploadError(errors.join(' | '))
    }
  }

  function handleFileSelection(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      void processFiles(e.target.files)
      e.target.value = ''
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (canWrite && !isDragOver) setIsDragOver(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (canWrite && e.dataTransfer.files) {
      void processFiles(e.dataTransfer.files)
    }
  }

  async function handleDownload(file: ProjectFile) {
    try {
      await downloadProjectFile(file.storage_path, file.name)
    } catch (err) {
      alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  function openRename(file: ProjectFile) {
    setRenameTarget(file)
    setRenameValue(file.name)
    setRenameError('')
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!renameTarget) return
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === renameTarget.name) {
      setRenameTarget(null)
      return
    }

    setRenameSubmitting(true)
    setRenameError('')
    try {
      await renameProjectFile(renameTarget.id, trimmed, files)
      setFiles((prev) =>
        prev.map((f) => (f.id === renameTarget.id ? { ...f, name: trimmed, updated_at: new Date().toISOString() } : f))
      )
      setRenameTarget(null)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename file.')
    } finally {
      setRenameSubmitting(false)
    }
  }

  function openDelete(file: ProjectFile) {
    setDeleteTarget(file)
    setDeleteError('')
  }

  async function handleDeleteSubmit() {
    if (!deleteTarget) return
    setDeleteSubmitting(true)
    setDeleteError('')
    try {
      await deleteProjectFile(deleteTarget.id, deleteTarget.storage_path)
      setFiles((prev) => prev.filter((f) => f.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete file.')
    } finally {
      setDeleteSubmitting(false)
    }
  }

  return (
    <div className="files-page-container">
      <Link to="/app" className="back-link">← Back to dashboard</Link>

      {loading ? (
        <p className="empty-state" role="status">Loading files repository...</p>
      ) : error ? (
        <div className="empty-state" role="alert">
          <p>{error}</p>
          <button className="button secondary compact-button" onClick={() => { setLoading(true); setError(''); setAttempt((a) => a + 1) }}>
            Retry
          </button>
        </div>
      ) : !projectData ? (
        <div className="empty-state">
          <h1>Project unavailable</h1>
          <p>This project does not exist or you do not have access to it.</p>
        </div>
      ) : (
        <>
          <div className="page-heading project-title">
            <div>
              <p className="eyebrow">Project repository</p>
              <h1>{projectData.project.name}</h1>
            </div>
            <span className="status-badge">{projectData.project.status}</span>
          </div>

          {isArchived && <p className="notice">This project is archived and read-only.</p>}

          <nav className="project-tabs" aria-label="Project">
            <Link to={`/project/${projectId}`}>Overview</Link>
            <Link to={`/project/${projectId}/paper`}>Paper workspace</Link>
            <span aria-current="page">Files</span>
          </nav>

          {/* Storage Quota Header */}
          <section className="storage-meter-section" aria-label="Storage quota">
            <div className="storage-meter-header">
              <div>
                <strong>Storage used:</strong>{' '}
                <span>
                  {formatBytes(totalUsedBytes)} of {formatBytes(MAX_PROJECT_STORAGE_BYTES)} ({usedPercentage.toFixed(1)}%)
                </span>
              </div>
              <div className="muted">{files.length} file{files.length === 1 ? '' : 's'}</div>
            </div>
            <div className="storage-progress-bar" role="progressbar" aria-valuenow={usedPercentage} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={`storage-progress-fill ${usedPercentage > 90 ? 'danger' : usedPercentage > 75 ? 'warning' : ''}`}
                style={{ width: `${Math.max(1, usedPercentage)}%` }}
              />
            </div>
          </section>

          {/* File Upload Zone */}
          {canWrite ? (
            <div
              className={`file-drop-zone ${isDragOver ? 'drag-over' : ''} ${uploading ? 'uploading' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              aria-label="Upload files"
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelection}
                multiple
                style={{ display: 'none' }}
                disabled={uploading}
              />
              <div className="drop-zone-content">
                <span className="upload-icon" aria-hidden="true">📁</span>
                {uploading ? (
                  <div>
                    <p className="upload-primary">{uploadStatus}</p>
                    <p className="muted">Please keep this window open.</p>
                  </div>
                ) : (
                  <div>
                    <p className="upload-primary">
                      Drag & drop datasets, reference papers, and notebooks, or <span className="link-text">browse files</span>
                    </p>
                    <p className="upload-meta">
                      Max {formatBytes(MAX_FILE_SIZE_BYTES)} per file • Up to {formatBytes(MAX_PROJECT_STORAGE_BYTES)} total per project
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="notice">
              {isArchived
                ? 'This project is archived. File uploads and modifications are disabled.'
                : 'You have viewer access to this project. Uploading and modifying files is disabled.'}
            </p>
          )}

          {uploadError && (
            <div className="error-banner" role="alert">
              <strong>Upload warning:</strong> {uploadError}
            </div>
          )}

          {/* Controls Bar: Search, Category Filter, Sort */}
          <div className="files-controls-bar">
            <div className="files-search-wrap">
              <input
                type="search"
                className="files-search-input"
                placeholder="Search files by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search files"
              />
              {search && (
                <button className="clear-search-btn" onClick={() => setSearch('')} aria-label="Clear search">
                  ✕
                </button>
              )}
            </div>

            <div className="files-filter-group">
              <select
                className="select-filter"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="all">All file types</option>
                <option value="spreadsheet">Data & Spreadsheets (CSV, XLSX, TSV)</option>
                <option value="pdf">Papers & PDFs</option>
                <option value="code">Code & Notebooks (PY, IPYNB, R, JS)</option>
                <option value="archive">Archives & ZIPs</option>
                <option value="image">Images & Figures</option>
                <option value="document">Documents & Text</option>
                <option value="other">Other files</option>
              </select>

              <select
                className="select-filter"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                aria-label="Sort files"
              >
                <option value="date_desc">Newest uploaded</option>
                <option value="date_asc">Oldest uploaded</option>
                <option value="name_asc">Name (A to Z)</option>
                <option value="size_desc">Largest size</option>
              </select>
            </div>
          </div>

          {/* File List Table */}
          {files.length === 0 ? (
            <div className="empty-files-state">
              <p className="empty-icon">🗂️</p>
              <h3>No research files uploaded yet</h3>
              <p className="muted">
                Keep datasets, code archives, reference PDFs, and experiment outputs in one place for co-authors.
              </p>
              {canWrite && (
                <button
                  className="button primary compact-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload your first file
                </button>
              )}
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="empty-files-state">
              <p>No files match your search or filter.</p>
              <button
                className="button secondary compact-button"
                onClick={() => {
                  setSearch('')
                  setCategory('all')
                }}
              >
                Reset filters
              </button>
            </div>
          ) : (
            <div className="files-table-container">
              <table className="files-table">
                <thead>
                  <tr>
                    <th scope="col" className="col-name">File name</th>
                    <th scope="col" className="col-size">Size</th>
                    <th scope="col" className="col-uploader">Uploaded by</th>
                    <th scope="col" className="col-date">Date</th>
                    <th scope="col" className="col-actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFiles.map((file) => {
                    const cat = getFileCategory(file.name, file.mime_type)
                    const canEditThisFile = canWrite && (isOwner || file.uploaded_by === user?.id)

                    return (
                      <tr key={file.id} className="file-row">
                        <td className="col-name">
                          <div className="file-name-cell">
                            <span className={`file-badge file-badge-${cat}`} aria-label={cat}>
                              {cat === 'pdf'
                                ? 'PDF'
                                : cat === 'spreadsheet'
                                ? 'DATA'
                                : cat === 'code'
                                ? 'CODE'
                                : cat === 'archive'
                                ? 'ZIP'
                                : cat === 'image'
                                ? 'IMG'
                                : 'FILE'}
                            </span>
                            <button
                              className="file-name-button"
                              onClick={() => void handleDownload(file)}
                              title="Click to download"
                            >
                              {file.name}
                            </button>
                          </div>
                        </td>
                        <td className="col-size muted">{formatBytes(file.size_bytes)}</td>
                        <td className="col-uploader muted">
                          <span className="uploader-badge">{file.uploader_name}</span>
                        </td>
                        <td className="col-date muted">
                          <time dateTime={file.created_at}>
                            {new Date(file.created_at).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </time>
                        </td>
                        <td className="col-actions">
                          <div className="file-actions-group">
                            <button
                              className="button secondary compact-button"
                              onClick={() => void handleDownload(file)}
                              title="Download file"
                            >
                              Download
                            </button>
                            {canEditThisFile && (
                              <>
                                <button
                                  className="button secondary compact-button"
                                  onClick={() => openRename(file)}
                                  title="Rename file"
                                >
                                  Rename
                                </button>
                                <button
                                  className="button danger compact-button"
                                  onClick={() => openDelete(file)}
                                  title="Delete file"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Rename Modal */}
          {renameTarget && (
            <div className="modal-backdrop" role="dialog" aria-labelledby="rename-title" aria-modal="true">
              <div className="modal-card">
                <h3 id="rename-title">Rename File</h3>
                <form onSubmit={(e) => void handleRenameSubmit(e)}>
                  <div className="form-field">
                    <label htmlFor="rename-input">File name</label>
                    <input
                      id="rename-input"
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      disabled={renameSubmitting}
                      autoFocus
                      required
                    />
                  </div>
                  {renameError && <p className="form-error">{renameError}</p>}
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setRenameTarget(null)}
                      disabled={renameSubmitting}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="button primary" disabled={renameSubmitting || !renameValue.trim()}>
                      {renameSubmitting ? 'Saving...' : 'Save Name'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete Modal */}
          {deleteTarget && (
            <div className="modal-backdrop" role="dialog" aria-labelledby="delete-title" aria-modal="true">
              <div className="modal-card">
                <h3 id="delete-title">Delete File</h3>
                <p>
                  Are you sure you want to permanently delete <strong>{deleteTarget.name}</strong>?
                </p>
                <p className="muted">This will remove the file from storage for all co-authors. This action cannot be undone.</p>
                {deleteError && <p className="form-error">{deleteError}</p>}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setDeleteTarget(null)}
                    disabled={deleteSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    onClick={() => void handleDeleteSubmit()}
                    disabled={deleteSubmitting}
                  >
                    {deleteSubmitting ? 'Deleting...' : 'Delete Permanently'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
