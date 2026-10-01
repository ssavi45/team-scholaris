// Explicit local-only pilot configuration; does not enroll or modify paper files.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'
const project = process.argv[2]
if (!/^[0-9a-f-]{36}$/i.test(project || '')) throw new Error('Provide a project UUID.')
const frontend = readFileSync('.env.local', 'utf8')
if (parseEnv(frontend).VITE_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('Local Supabase frontend required.')
const env = parseEnv(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }))
if (env.API_URL !== 'http://127.0.0.1:54321') throw new Error('Local Supabase required.')
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data, error } = await admin.from('projects').select('id').eq('id', project).is('deleted_at', null).maybeSingle()
if (error || !data) throw new Error('Project unavailable in local Supabase.')
const path = 'server/coediting/.env.local'
if (existsSync(path)) throw new Error('Backend config already exists; inspect and update it deliberately.')
writeFileSync(path, `SUPABASE_URL=${env.API_URL}\nSUPABASE_SERVICE_ROLE_KEY=${env.SERVICE_ROLE_KEY}\nPAPER_SHARED_HOST=127.0.0.1\nPAPER_SHARED_PORT=5440\nPAPER_SHARED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173\nPAPER_SHARED_PROJECTS=${project}\n`)
writeFileSync('.env.local', frontend.replace(/^VITE_PAPER_SHARED_URL=.*\r?\n?/gm, '').trimEnd() + '\nVITE_PAPER_SHARED_URL=ws://127.0.0.1:5440/paper-shared\n')
console.log('Local pilot configured for the requested project. No paper files enrolled or changed.')
