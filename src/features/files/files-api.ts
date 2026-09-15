import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'

export type ProjectFile = Database['public']['Functions']['get_project_files']['Returns'][number]

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB
export const MAX_PROJECT_STORAGE_BYTES = 500 * 1024 * 1024 // 500 MB

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const index = Math.min(i, units.length - 1)
  const val = bytes / Math.pow(1024, index)
  return `${val.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export type FileCategory = 'pdf' | 'spreadsheet' | 'code' | 'image' | 'archive' | 'document' | 'media' | 'data' | 'other'

export function getFileCategory(name: string, mimeType: string): FileCategory {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType === 'text/csv' ||
    ['csv', 'tsv', 'xlsx', 'xls', 'parquet'].includes(ext)
  ) return 'spreadsheet'
  if (
    mimeType.includes('json') ||
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('python') ||
    ['py', 'js', 'ts', 'tsx', 'jsx', 'json', 'r', 'm', 'cpp', 'c', 'java', 'rs', 'go', 'sh', 'sql', 'ipynb'].includes(ext)
  ) return 'code'
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return 'image'
  if (
    mimeType.includes('zip') ||
    mimeType.includes('compressed') ||
    mimeType.includes('tar') ||
    ['zip', 'tar', 'gz', '7z', 'rar', 'bz2'].includes(ext)
  ) return 'archive'
  if (
    mimeType.includes('word') ||
    mimeType.includes('text/plain') ||
    mimeType.includes('markdown') ||
    ['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)
  ) return 'document'
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'media'
  if (['h5', 'hdf5', 'mat', 'npy', 'npz', 'feather', 'avro'].includes(ext)) return 'data'
  return 'other'
}

export async function loadProjectFiles(projectId: string, signal?: AbortSignal): Promise<ProjectFile[]> {
  let query = client().rpc('get_project_files', { p_project_id: projectId })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data as ProjectFile[]) ?? []
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  existingFiles: ProjectFile[]
): Promise<ProjectFile> {
  const trimmedName = file.name.trim()
  if (!trimmedName) throw new Error('Filename cannot be empty.')
  if (trimmedName.length > 255) throw new Error('Filename must be 255 characters or fewer.')
  if (file.size <= 0) throw new Error('File cannot be empty.')
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File exceeds the 50 MB limit (${formatBytes(file.size)}).`)
  }

  const existingTotal = existingFiles.reduce((acc, f) => acc + f.size_bytes, 0)
  if (existingTotal + file.size > MAX_PROJECT_STORAGE_BYTES) {
    throw new Error('Project storage quota of 500 MB exceeded.')
  }

  if (existingFiles.some((f) => f.name.toLowerCase() === trimmedName.toLowerCase())) {
    throw new Error(`A file named "${trimmedName}" already exists in this project. Please rename or delete it first.`)
  }

  const { data: userData, error: userError } = await client().auth.getUser()
  if (userError || !userData?.user) throw new Error('Authentication required to upload files.')

  const fileId = crypto.randomUUID()
  const sanitized = trimmedName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${projectId}/${fileId}-${sanitized}`

  const { error: uploadError } = await client().storage
    .from('project-files')
    .upload(storagePath, file, { cacheControl: '3600', upsert: false })

  if (uploadError) {
    throw new Error(uploadError.message)
  }

  const { data: insertData, error: insertError } = await client()
    .from('project_files')
    .insert({
      id: fileId,
      project_id: projectId,
      name: trimmedName,
      storage_path: storagePath,
      size_bytes: file.size,
      mime_type: file.type || 'application/octet-stream',
      uploaded_by: userData.user.id,
    })
    .select()
    .single()

  if (insertError) {
    await client().storage.from('project-files').remove([storagePath]).catch(() => {})
    throw new Error(insertError.message)
  }

  return {
    id: insertData.id,
    project_id: insertData.project_id,
    name: insertData.name,
    storage_path: insertData.storage_path,
    size_bytes: insertData.size_bytes,
    mime_type: insertData.mime_type,
    uploaded_by: insertData.uploaded_by,
    uploader_name: userData.user.user_metadata?.name || userData.user.user_metadata?.full_name || 'Scholar',
    created_at: insertData.created_at,
    updated_at: insertData.updated_at,
  }
}

export async function downloadProjectFile(storagePath: string, fileName: string): Promise<void> {
  const { data, error } = await client().storage
    .from('project-files')
    .createSignedUrl(storagePath, 60, { download: fileName })

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Unable to generate download link.')
  }

  const link = document.createElement('a')
  link.href = data.signedUrl
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export async function renameProjectFile(
  fileId: string,
  newName: string,
  existingFiles: ProjectFile[]
): Promise<void> {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('File name cannot be empty.')
  if (trimmed.length > 255) throw new Error('File name must be 255 characters or fewer.')

  if (existingFiles.some((f) => f.id !== fileId && f.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`A file named "${trimmed}" already exists in this project.`)
  }

  const { error } = await client()
    .from('project_files')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', fileId)

  if (error) throw new Error(error.message)
}

export async function deleteProjectFile(fileId: string, storagePath: string): Promise<void> {
  const { error: dbError } = await client().from('project_files').delete().eq('id', fileId)
  if (dbError) throw new Error(dbError.message)

  await client().storage.from('project-files').remove([storagePath]).catch(() => {})
}

