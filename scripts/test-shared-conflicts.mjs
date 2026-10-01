import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'
assert.ok(process.argv.includes('--local'),'Disposable local fixture only.')
const env=parseEnv(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','env'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
assert.equal(env.API_URL,'http://127.0.0.1:54321')
const options={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient(env.API_URL,env.SERVICE_ROLE_KEY,options)
const client=createClient(env.API_URL,env.ANON_KEY,options)
const ok=(result,label)=>{assert.equal(result.error,null,label);return result.data}
let actor,project
try {
  const email=`conflict-${randomUUID()}@example.test`,password=randomUUID()+'Aa1!'
  actor=ok(await admin.auth.admin.createUser({email,password,email_confirm:true}),'Create user').user.id
  ok(await client.auth.signInWithPassword({email,password}),'Sign in')
  project=ok(await client.rpc('create_project',{project_name:'Conflict fixture'}).single(),'Project').id
  ok(await client.rpc('initialize_paper',{p_project_id:project}),'Initialize')
  const state=ok(await client.rpc('read_paper_state',{p_project:project}),'State')
  const history=ok(await client.rpc('create_shared_paper_checkpoint',{p_project_id:project,p_revision:state.settings.revision,p_label:'Fixture checkpoint'}),'Current checkpoint')
  for(const [rpc,args] of [
    ['apply_shared_paper_manifest',{p_entries:state.files,p_main_file:state.settings.main_file}],
    ['restore_shared_paper_history',{p_history_id:history}],
    ['create_shared_paper_checkpoint',{p_label:'Stale checkpoint'}],
  ]) {
    const started=Date.now()
    const response=await client.rpc(rpc,{p_project_id:project,p_revision:state.settings.revision-1,...args}).abortSignal(AbortSignal.timeout(5000))
    assert.equal(response.status,409,rpc)
    assert.equal(response.error?.code,'PT409',rpc)
    assert.match(response.error.message,/Paper changed/)
    assert.ok(Date.now()-started<5000,'Stale revision returns without timeout/retry')
  }
  assert.deepEqual(ok(await client.rpc('read_paper_state',{p_project:project}),'Unchanged state'),state)
  ok(await client.rpc('restore_shared_paper_history',{p_project_id:project,p_history_id:history,p_revision:state.settings.revision}),'Current restore')
  console.log('PASS immediate HTTP 409 for stale manifest/restore/checkpoint, no mutation on conflict and current checkpoint/restore success')
} finally {
  if(project)ok(await admin.from('projects').delete().eq('id',project),'Fixture cleanup')
  if(actor)ok(await admin.auth.admin.deleteUser(actor),'User cleanup')
}
