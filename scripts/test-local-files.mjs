import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const env = parseEnv(await readFile('.env.local', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:54321', 'Local tests only')

const client = () => createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

const sql = (query) => execFileSync(
  'docker',
  ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
  { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
)

const ids = []
const clients = []
const run = randomUUID().slice(0, 8)
const ok = (result, label) => {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? ''}`)
  return result.data
}

let projectId
const uploaded = []

try {
  // 1. Create three accounts: owner, member, viewer
  for (let i = 0; i < 3; i++) {
    const c = client()
    clients.push(c)
    const email = `files-test-${run}-${i}@example.test`
    const password = randomUUID() + 'Aa1!'
    const signup = ok(await c.auth.signUp({
      email,
      password,
      options: { data: { name: `Tester ${i}` } },
    }), 'Create local test account')
    const id = signup.user.id
    ids.push(id)
    assert.match(id, /^[a-f0-9-]{36}$/)
    sql(`update auth.users set email_confirmed_at = now() where id = '${id}';`)
    ok(await c.auth.signInWithPassword({ email, password }), 'Sign in test account')
  }

  const [owner, member, viewer] = clients

  // 2. Owner creates a project
  const project = ok(await owner.rpc('create_project', { project_name: 'Files Repository Test' }).single(), 'Create fixture project')
  projectId = project.id

  const filePayload = Buffer.from('gene_id,expression,pval\nBRCA1,14.2,0.001\nTP53,22.8,0.0001\n')
  const fileId = randomUUID()
  const storagePath = `${projectId}/${fileId}-dataset.csv`
  uploaded.push(storagePath)

  // 3. Outsider upload & read denied
  const outsiderUpload = await member.storage.from('project-files').upload(storagePath, filePayload, { contentType: 'text/csv' })
  assert.ok(outsiderUpload.error, 'Outsider storage upload should be denied')

  const outsiderDbInsert = await member.from('project_files').insert({
    id: fileId,
    project_id: projectId,
    name: 'dataset.csv',
    storage_path: storagePath,
    size_bytes: filePayload.length,
    mime_type: 'text/csv',
    uploaded_by: ids[1],
  })
  assert.ok(outsiderDbInsert.error, 'Outsider DB insert should be denied')

  // 4. Add member and viewer to project
  sql(`insert into public.project_members(project_id, user_id, access_level) values ('${projectId}', '${ids[1]}', 'member'), ('${projectId}', '${ids[2]}', 'viewer');`)

  // 5. Viewer upload denied
  const viewerUpload = await viewer.storage.from('project-files').upload(storagePath, filePayload, { contentType: 'text/csv' })
  assert.ok(viewerUpload.error, 'Viewer storage upload should be denied')

  const viewerDbInsert = await viewer.from('project_files').insert({
    id: fileId,
    project_id: projectId,
    name: 'dataset.csv',
    storage_path: storagePath,
    size_bytes: filePayload.length,
    mime_type: 'text/csv',
    uploaded_by: ids[2],
  })
  assert.ok(viewerDbInsert.error, 'Viewer DB insert should be denied')

  // 6. Member uploads file to storage and inserts DB record
  ok(await member.storage.from('project-files').upload(storagePath, filePayload, { contentType: 'text/csv' }), 'Member storage upload')
  ok(await member.from('project_files').insert({
    id: fileId,
    project_id: projectId,
    name: 'dataset.csv',
    storage_path: storagePath,
    size_bytes: filePayload.length,
    mime_type: 'text/csv',
    uploaded_by: ids[1],
  }), 'Member insert file record')

  // 7. Viewer can read files through RPC and download from storage
  const viewerFiles = ok(await viewer.rpc('get_project_files', { p_project_id: projectId }), 'Viewer fetch files RPC')
  assert.equal(viewerFiles.length, 1)
  assert.equal(viewerFiles[0].name, 'dataset.csv')
  assert.equal(viewerFiles[0].size_bytes, filePayload.length)
  assert.equal(viewerFiles[0].uploader_name, 'Tester 1')

  const viewerDownloaded = ok(await viewer.storage.from('project-files').download(storagePath), 'Viewer storage download')
  assert.equal(viewerDownloaded.size, filePayload.length)

  // 8. Duplicate filename in same project is rejected
  const dupFileId = randomUUID()
  const dupStoragePath = `${projectId}/${dupFileId}-dataset.csv`
  const dupInsert = await member.from('project_files').insert({
    id: dupFileId,
    project_id: projectId,
    name: 'DATASET.CSV', // case-insensitive duplicate
    storage_path: dupStoragePath,
    size_bytes: filePayload.length,
    mime_type: 'text/csv',
    uploaded_by: ids[1],
  })
  assert.ok(dupInsert.error, 'Case-insensitive duplicate filename should be rejected')

  // 9. Per-file limit > 50 MB check
  const hugeFileId = randomUUID()
  const hugeInsert = await member.from('project_files').insert({
    id: hugeFileId,
    project_id: projectId,
    name: 'huge.dat',
    storage_path: `${projectId}/${hugeFileId}-huge.dat`,
    size_bytes: 52428801, // 50 MB + 1 byte
    mime_type: 'application/octet-stream',
    uploaded_by: ids[1],
  })
  assert.ok(hugeInsert.error, 'File size > 50 MB should be rejected by constraint')

  // 10. Cumulative project quota trigger test (> 500 MB)
  const quotaFileId1 = randomUUID()
  const quotaFileId2 = randomUUID()
  // Insert 10 files of 45 MB each
  for (let k = 0; k < 10; k++) {
    const fid = randomUUID()
    const sp = `${projectId}/${fid}-bulk${k}.bin`
    uploaded.push(sp)
    ok(await owner.from('project_files').insert({
      id: fid,
      project_id: projectId,
      name: `bulk_${k}.bin`,
      storage_path: sp,
      size_bytes: 45 * 1024 * 1024, // 45 MB
      mime_type: 'application/octet-stream',
      uploaded_by: ids[0],
    }), `Bulk file ${k} (45 MB) insert`)
  }
  // Total is now 10 * 45 MB = 450 MB (+ 1 KB).
  // Inserting another 60 MB file should exceed 500 MB (450 + 60 = 510 MB > 500 MB)
  // Wait, max per file is 50MB, so let's try to insert two 30 MB files:
  // 1st 30 MB -> total 480 MB (ok)
  const fid30a = randomUUID()
  const sp30a = `${projectId}/${fid30a}-chunk30a.bin`
  uploaded.push(sp30a)
  ok(await owner.from('project_files').insert({
    id: fid30a,
    project_id: projectId,
    name: 'chunk30a.bin',
    storage_path: sp30a,
    size_bytes: 30 * 1024 * 1024,
    mime_type: 'application/octet-stream',
    uploaded_by: ids[0],
  }), 'Insert 30 MB file (now 480 MB)')

  // 2nd 30 MB -> total 510 MB > 500 MB (MUST fail with quota exception)
  const fid30b = randomUUID()
  const sp30b = `${projectId}/${fid30b}-chunk30b.bin`
  const quotaOverflow = await owner.from('project_files').insert({
    id: fid30b,
    project_id: projectId,
    name: 'chunk30b.bin',
    storage_path: sp30b,
    size_bytes: 30 * 1024 * 1024,
    mime_type: 'application/octet-stream',
    uploaded_by: ids[0],
  })
  assert.ok(quotaOverflow.error, 'Project storage quota of 500 MB must reject overflow')
  assert.match(quotaOverflow.error.message, /quota/i, 'Quota error message expected')

  // 11. Rename test
  ok(await member.from('project_files').update({ name: 'cleaned_dataset.csv' }).eq('id', fileId), 'Member rename own file')
  const renamedFiles = ok(await owner.rpc('get_project_files', { p_project_id: projectId }), 'Fetch after rename')
  assert.ok(renamedFiles.some(f => f.name === 'cleaned_dataset.csv'))

  // Viewer attempt to rename denied
  const viewerRename = await viewer.from('project_files').update({ name: 'hacked.csv' }).eq('id', fileId)
  assert.ok(viewerRename.error || (await owner.from('project_files').select('name').eq('id', fileId).single()).data.name !== 'hacked.csv', 'Viewer cannot rename')

  // 12. Delete test
  ok(await member.from('project_files').delete().eq('id', fileId), 'Member delete own file')
  ok(await member.storage.from('project-files').remove([storagePath]), 'Storage remove')

  const finalFiles = ok(await owner.rpc('get_project_files', { p_project_id: projectId }), 'Fetch after delete')
  assert.equal(finalFiles.some(f => f.id === fileId), false, 'Deleted file no longer in list')

  console.log('ALL FILES-01 LOCAL VERIFICATION TESTS PASSED!')
} finally {
  if (projectId) {
    try {
      sql(`delete from public.projects where id = '${projectId}';`)
    } catch {}
  }
  for (const path of uploaded) {
    try {
      clients[0]?.storage.from('project-files').remove([path])
    } catch {}
  }
  for (const id of ids) {
    try {
      sql(`delete from auth.users where id = '${id}';`)
    } catch {}
  }
}

