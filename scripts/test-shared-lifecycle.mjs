import assert from 'node:assert/strict'
import { execFileSync, fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseEnv } from 'node:util'
import { once } from 'node:events'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { SharedSessionService } from '../server/coediting/session-service.mjs'

assert.ok(process.argv.includes('--local'), 'Disposable local fixture only.')
const env = parseEnv(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','env'], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }))
assert.equal(env.API_URL,'http://127.0.0.1:54321')
const options = { auth:{ persistSession:false, autoRefreshToken:false } }
const admin = createClient(env.API_URL,env.SERVICE_ROLE_KEY,options), accounts=[], children=[], sockets=[], docs=[]
const ok = (result,label) => { assert.equal(result.error,null,label); return result.data }
const sql = query => execFileSync('docker',['exec','-i','supabase_db_team-scholaris','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'], { input:query, encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim()
let project, service, main, other
const state = async (account=accounts[0]) => ok(await account.client.rpc('read_paper_state',{p_project:project}),'Coherent state')
async function manifest(entries, mainFile, confirm=false, account=accounts[0], revision) {
  return account.client.rpc('apply_shared_paper_manifest',{p_project_id:project,p_revision:revision ?? (await state(account)).settings.revision,p_entries:entries,p_main_file:mainFile,p_confirm_shared:confirm})
}
function edit(current,text) {
  const doc=new Y.Doc(); docs.push(doc); Y.applyUpdate(doc,Buffer.from(current.session.state,'base64'))
  const vector=Y.encodeStateVector(doc); doc.getText('source').insert(0,text)
  return Y.encodeStateAsUpdate(doc,vector)
}
async function gateway(mode) {
  const child=fork('scripts/shared-crash-gateway.mjs',[],{stdio:['ignore','ignore','pipe','ipc']}); children.push(child)
  let errors=''; child.stderr.on('data',chunk => { errors+=chunk.toString() })
  const ready=new Promise((resolve,reject) => {
    const timer=setTimeout(() => reject(new Error('Gateway startup timed out.')),15000)
    child.on('message',m => { if(m.port){clearTimeout(timer); resolve(m.port)} })
    child.once('exit',() => { clearTimeout(timer); reject(new Error('Gateway exited: '+errors.slice(0,160))) })
  })
  child.send({url:env.API_URL,key:env.SERVICE_ROLE_KEY,project,mode})
  return {child,url:`ws://127.0.0.1:${await ready}/paper-shared`}
}
async function join(gateway,account=accounts[0]) {
  const socket=new WebSocket(gateway.url,'scholaris-paper-v1',{origin:'http://127.0.0.1:5173'}); sockets.push(socket)
  const inbox=[]; socket.on('message',bytes => inbox.push(JSON.parse(bytes)))
  await once(socket,'open'); socket.send(JSON.stringify({type:'join',token:account.token,file:main.id}))
  await waitFor(() => inbox.some(m => m.type==='state'))
  return {socket,inbox}
}
async function waitFor(predicate) {
  const deadline=Date.now()+20000
  while(!predicate()){if(Date.now()>deadline)throw new Error('Condition timed out.');await new Promise(resolve => setTimeout(resolve,50))}
}
try {
  for(let i=0;i<5;i++) {
    const email=`lifecycle-${randomUUID()}@example.test`,password=randomUUID()+'Aa1!'
    const user=ok(await admin.auth.admin.createUser({email,password,email_confirm:true}),'Create user').user
    const client=createClient(env.API_URL,env.ANON_KEY,options)
    accounts.push({id:user.id,client,token:ok(await client.auth.signInWithPassword({email,password}),'Sign in').session.access_token})
  }
  project=ok(await accounts[0].client.rpc('create_project',{project_name:'Lifecycle fixture'}).single(),'Project').id
  ok(await accounts[0].client.rpc('initialize_paper',{p_project_id:project}),'Initialize')
  for(const account of accounts.slice(1))ok(await admin.from('project_members').insert({project_id:project,user_id:account.id,access_level:'member'}),'Member')
  main=(await state()).files.find(f => f.path==='main.tex')
  other=ok(await accounts[0].client.rpc('create_paper_file',{p_project_id:project,p_path:'method.tex'}).single(),'Other file')
  service=new SharedSessionService(admin,[project])
  const initial=await service.enable(accounts[0].token,main.id)
  await service.enable(accounts[0].token,other.id)
  const checkpoint=ok(await accounts[0].client.rpc('create_paper_checkpoint',{p_project_id:project,p_revision:(await state()).settings.revision,p_label:'Both live'}),'Named checkpoint')
  const causal=JSON.parse(sql(`select coalesce(json_agg(row_to_json(d)),'[]') from public.paper_history_shared d where history_id=${checkpoint};`))
  assert.equal(causal.length,2)
  assert.equal(causal.find(d=>d.file_id===main.id).state,initial.session.state)
  const history=ok(await accounts[0].client.rpc('get_paper_history',{p_project_id:project,p_history_id:checkpoint}),'History')
  assert.equal(history.size_bytes,Number(sql(`select octet_length(files::text)+(select sum(octet_length(state)) from public.paper_history_shared where history_id=${checkpoint}) from public.paper_history where id=${checkpoint};`)))
  assert.ok((await accounts[0].client.from('paper_history_shared').select('*')).error,'Causal states are private')
  const running=await gateway('normal'), live=await join(running)
  let current=await state()
  ok(await manifest(current.files.map(f=>f.id===main.id?{...f,path:'paper.tex'}:f),'paper.tex',false,accounts[1],current.settings.revision),'Member rename preserves live identity')
  await waitFor(()=>live.inbox.some(m=>m.type==='state'&&m.path==='paper.tex'))
  const renamed=await service.read(accounts[0].token,main.id)
  assert.equal(renamed.session.epoch,initial.session.epoch);assert.equal(renamed.session.state,initial.session.state)
  await service.update(accounts[1].token,main.id,initial.session.epoch,edit(renamed,'% after rename\n'))
  const historical=await state()
  const beforeRestore=await service.read(accounts[0].token,main.id)
  assert.ok((await accounts[1].client.rpc('restore_shared_paper_history',{p_project_id:project,p_history_id:checkpoint,p_revision:historical.settings.revision,p_file_id:main.id,p_confirm_shared:true})).error,'Member cannot end a live file by restore')
  ok(await accounts[0].client.rpc('restore_shared_paper_history',{p_project_id:project,p_history_id:checkpoint,p_revision:historical.settings.revision,p_file_id:main.id,p_confirm_shared:true}),'Owner coordinated file restore')
  assert.equal((await service.read(accounts[0].token,main.id)).session,null)
  assert.ok((await service.read(accounts[0].token,other.id)).session,'Unrelated live session survives restore')
  await waitFor(()=>live.socket.readyState===WebSocket.CLOSED)
  await assert.rejects(service.update(accounts[1].token,main.id,initial.session.epoch,edit(beforeRestore,'% stale\n')))
  assert.equal(sql(`select count(*) from public.paper_history_shared d join public.paper_history h on h.id=d.history_id where h.project_id='${project}' and h.label='Before restore #${checkpoint}' and d.state='${beforeRestore.session.state}';`),'1','Pre-restore causal state retained')
  let reenrolled=await service.enable(accounts[0].token,main.id)
  assert.notEqual(reenrolled.session.epoch,initial.session.epoch)
  current=await state()
  assert.ok((await manifest(current.files.map(f=>f.id===main.id?{...f,content:'replace'}:f),current.settings.main_file)).error,'Unconfirmed content replacement denied')
  assert.ok((await manifest([], '',true,accounts[1])).error,'Member delete-all cannot terminate shared files')
  const bad=await manifest(current.files.map(f=>f.id===main.id?{...f,path:'../bad.tex'}:f),current.settings.main_file,true)
  assert.ok(bad.error);assert.equal((await service.read(accounts[0].token,main.id)).session.epoch,reenrolled.session.epoch,'Invalid lifecycle change rolls back completely')
  // Ten rounds of five simultaneous writers plus coherent checkpoints.
  const start=Date.now()
  for(let round=0;round<10;round++) {
    const base=await service.read(accounts[0].token,main.id)
    const writes=accounts.map((a,i)=>service.update(a.token,main.id,base.session.epoch,edit(base,`% load ${round}:${i}\n`)))
    const captured=state()
    await Promise.all(writes)
    const point=await captured
    assert.equal(point.files.find(f=>f.id===main.id).shared_epoch,base.session.epoch)
    if(round===4)console.log('PASS first 25 concurrent writes and coherent state reads')
  }
  const loaded=await service.read(accounts[0].token,main.id)
  for(let round=0;round<10;round++)for(let i=0;i<5;i++)assert.ok(loaded.file.content.includes(`% load ${round}:${i}\n`))
  console.log(`PASS 50 concurrent writes without dropped authors (${Date.now()-start} ms local bounded load)`)
  const saved=await state()
  assert.ok(saved.settings.revision>current.settings.revision,'Shared writes advance the project revision')
  const staleManifest=await manifest(current.files,current.settings.main_file,false,accounts[0],current.settings.revision)
  assert.ok(staleManifest.error,'Concurrent edits fence stale manifest previews')
  assert.match(staleManifest.error.message,/Paper changed/)
  assert.equal(staleManifest.error.code,'PT409')
  const loadedCheckpoint=ok(await accounts[0].client.rpc('create_paper_checkpoint',{p_project_id:project,p_revision:saved.settings.revision,p_label:'Load cut'}),'Loaded checkpoint')
  const sourceSnapshot=ok(await accounts[0].client.rpc('get_paper_history',{p_project_id:project,p_history_id:loadedCheckpoint}),'Loaded history')
  const clocks=JSON.parse(sql(`select json_agg(row_to_json(d)) from public.paper_history_shared d where history_id=${loadedCheckpoint};`))
  for(const clock of clocks) {
    const doc=new Y.Doc();docs.push(doc);Y.applyUpdate(doc,Buffer.from(clock.state,'base64'))
    assert.equal(doc.getText('source').toString(),sourceSnapshot.files.find(f=>f.id===clock.file_id).content,'History causal state and materialized source agree')
  }
  // Kill an actual gateway before durable commit, then after commit before ACK.
  for(const mode of ['before','after']) {
    const childGateway=await gateway(mode), peer=await join(childGateway)
    const prior=await service.read(accounts[0].token,main.id),delta=edit(prior,`% crash-${mode}\n`)
    const boundary=new Promise(resolve=>childGateway.child.on('message',m=>{if(m.boundary===mode)resolve()}))
    peer.socket.send(JSON.stringify({type:'update',id:`crash-${mode}`,epoch:prior.session.epoch,update:Buffer.from(delta).toString('base64')}))
    await Promise.race([boundary,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Crash boundary timeout')),15000))])
    const exited=once(childGateway.child,'exit');childGateway.child.kill('SIGKILL');await exited
    assert.ok(!peer.inbox.some(m=>m.type==='ack'&&m.id===`crash-${mode}`),'No ACK before crash')
    const persisted=await service.read(accounts[0].token,main.id)
    assert.equal(persisted.file.content.includes(`% crash-${mode}\n`),mode==='after')
    const replacement=await gateway('normal');const retry=await join(replacement)
    retry.socket.send(JSON.stringify({type:'update',id:`retry-${mode}`,epoch:prior.session.epoch,update:Buffer.from(delta).toString('base64')}))
    await waitFor(()=>retry.inbox.some(m=>m.type==='ack'&&m.id===`retry-${mode}`))
    const recovered=await service.read(accounts[0].token,main.id)
    assert.equal(recovered.file.content.split(`% crash-${mode}\n`).length-1,1,'Retry applies exactly once')
    assert.equal(recovered.session.sequence,prior.session.sequence+1)
  }
  console.log('PASS abrupt process crash before commit and after commit/before ACK, restart and idempotent retry')
  // Two gateway service instances share presence, permissions and budgets.
  const twin=new SharedSessionService(admin,[project]),presenceIds=accounts.map(()=>randomUUID())
  for(let i=0;i<5;i++)await (i%2?service:twin).presence(accounts[i].token,main.id,presenceIds[i],reenrolled.session.epoch,{anchor:{type:'source'},head:{type:'source'}})
  let presence=await service.presence(accounts[0].token,main.id,presenceIds[0],reenrolled.session.epoch,null)
  assert.equal(new Set(presence.map(p=>p.userId)).size,5)
  ok(await admin.from('project_members').delete().eq('project_id',project).eq('user_id',accounts[4].id),'Remove peer')
  presence=await twin.presence(accounts[0].token,main.id,presenceIds[0],reenrolled.session.epoch,null)
  assert.ok(!presence.some(p=>p.userId===accounts[4].id),'Revoked identity immediately filtered')
  await assert.rejects(service.presence(accounts[4].token,main.id,presenceIds[4],reenrolled.session.epoch,null))
  sql(`update public.paper_shared_presence set expires_at=clock_timestamp()-interval '1 second' where peer_id='${presenceIds[2]}';`)
  presence=await twin.presence(accounts[0].token,main.id,presenceIds[0],reenrolled.session.epoch,null)
  assert.ok(!presence.some(p=>p.id===presenceIds[2]),'Expired crashed peer removed')
  assert.ok((await accounts[0].client.rpc('paper_shared_presence',{p_actor:accounts[1].id,p_file:main.id,p_peer:randomUUID(),p_epoch:reenrolled.session.epoch})).error,'Presence RPC cannot impersonate')
  const budget=await Promise.all(Array.from({length:121},(_,i)=>(i%2?service:twin).rate(accounts[4].id,'operation')))
  assert.equal(budget.filter(Boolean).length,120,'Distributed budget across gateways')
  console.log('PASS cross-gateway presence, TTL, revocation and distributed operation budget')
  sql(`update auth.users set email_confirmed_at=null where id='${accounts[3].id}';`)
  assert.ok((await accounts[3].client.rpc('read_paper_state',{p_project:project})).error,'Coherent reads require a currently verified account')
  sql(`update auth.users set email_confirmed_at=clock_timestamp() where id='${accounts[3].id}';`)
  current=await state()
  ok(await manifest([], '',true),'Owner delete-all')
  await assert.rejects(service.read(accounts[0].token,main.id))
  current=await state();assert.equal(current.files.length,0)
  ok(await accounts[0].client.rpc('restore_shared_paper_history',{p_project_id:project,p_history_id:checkpoint,p_revision:current.settings.revision,p_confirm_shared:true}),'Restore deleted files')
  const restored=await service.enable(accounts[0].token,main.id)
  assert.notEqual(restored.session.epoch,reenrolled.session.epoch)
  await assert.rejects(service.update(accounts[0].token,main.id,reenrolled.session.epoch,edit(reenrolled,'% zombie\n')))
  ok(await accounts[0].client.rpc('delete_paper_checkpoint',{p_project_id:project,p_history_id:checkpoint}),'Remove fixture checkpoint')
  assert.equal(sql(`select count(*) from public.paper_history_shared where history_id=${checkpoint};`),'0','History deletion cascades causal data')
  console.log('PASS rename, owner-only replace/delete/restore, causal history/quotas, old-epoch fencing and retention cleanup')
} finally {
  for(const socket of sockets)socket.terminate()
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited}
  for(const doc of docs)doc.destroy()
  if(project&&service&&accounts[0]) {
    await admin.from('projects').update({status:'active'}).eq('id',project)
    const current=await state()
    for(const file of current.files)if(file.shared_epoch)await service.disable(accounts[0].token,file.id)
    ok(await admin.from('projects').delete().eq('id',project),'Fixture cleanup')
  }
  for(const account of accounts)ok(await admin.auth.admin.deleteUser(account.id),'Account cleanup')
}
