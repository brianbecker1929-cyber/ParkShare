import {createClient} from '@supabase/supabase-js';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const SOURCE='biydlfekindgaslgktsx';
export const TARGET='heqxirlsorcztsawaldg';
const BUCKET='listing-photos';
const EXPECTED_FILES=4;
let phase='initialization';
export const digest=data=>createHash('sha256').update(data).digest('hex');

export function validateKey(value,ref){
  if(typeof value!=='string'||!value.trim()||/[\r\n\0]/.test(value))throw new Error('A private server API key is required.');
  const key=value.trim();
  if(/^sb_secret_[A-Za-z0-9_-]+$/.test(key))return key;
  try{
    const data=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));
    if(key.split('.').length===3&&data.ref===ref&&data.role==='service_role')return key;
  }catch{}
  throw new Error('Wrong server key type or project; operation refused.');
}

export function safePath(path){
  if(typeof path!=='string'||!path||path.length>1024||/[\r\n\0\\]/.test(path)||path.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('Unsafe object path; operation refused.');
  return path;
}

function checked(result){
  if(result.error){
    const status=result.error.statusCode??result.error.status??result.error.originalError?.status;
    throw new Error(`${phase} failed${/^\d{3}$/.test(String(status))?' (HTTP '+status+')':''}. Private details are not logged.`);
  }
  return result.data;
}

function clients(){
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(40000)})}};
  const sourceKey=validateKey(process.env.QA_RECOVERY_SOURCE_SUPABASE_SECRET_KEY,SOURCE);
  const targetKey=validateKey(process.env.QA_RECOVERY_TARGET_SUPABASE_SECRET_KEY,TARGET);
  return {source:createClient(`https://${SOURCE}.supabase.co`,sourceKey,options),target:createClient(`https://${TARGET}.supabase.co`,targetKey,options),targetKey,options};
}

async function bucketPrivate(client){
  const data=checked(await client.storage.getBucket(BUCKET));
  if(data.id!==BUCKET||data.public!==false)throw new Error('The fixed private bucket must exist and remain private.');
}

async function listFiles(client,prefix='',seen=new Set()){
  if(seen.size>100)throw new Error('Unexpected object tree; copy refused.');
  if(seen.has(prefix))throw new Error('Repeated object prefix; copy refused.');
  seen.add(prefix);
  const items=checked(await client.storage.from(BUCKET).list(prefix,{limit:100,offset:0,sortBy:{column:'name',order:'asc'}}));
  if(items.length===100)throw new Error('Unexpected large bucket; copy refused.');
  const files=[];
  for(const item of items){
    const path=safePath(prefix?prefix+'/'+item.name:item.name);
    if(item.id)files.push({path,contentType:item.metadata?.mimetype||'application/octet-stream'});
    else files.push(...await listFiles(client,path,seen));
  }
  return files;
}

async function save(path,value){await writeFile(path,value,{mode:0o600});}

async function prepare(root,source,target){
  phase='source private bucket access';await bucketPrivate(source);
  phase='replacement private bucket access';await bucketPrivate(target);
  phase='source file inventory';const files=await listFiles(source);
  if(files.length!==EXPECTED_FILES)throw new Error('Source file count differs from the restored database; copy refused.');
  const objects=[];
  for(const [index,file] of files.entries()){
    phase='source private file download';
    const blob=checked(await source.storage.from(BUCKET).download(file.path));
    if(blob.size>64*1024*1024)throw new Error('Unexpected large object; copy refused.');
    const bytes=Buffer.from(await blob.arrayBuffer());
    const filename=`object-${index}.bin`;
    await save(join(root,filename),bytes);
    objects.push({...file,filename,bytes:bytes.length,sha256:digest(bytes)});
  }
  const manifest={source:SOURCE,target:TARGET,bucket:BUCKET,private:true,objects};
  await save(join(root,'storage-manifest.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({source_files_downloaded:objects.length,total_bytes:objects.reduce((n,x)=>n+x.bytes,0),target_writes_performed:false}));
}

function isMissing(error){return ['400','404'].includes(String(error?.statusCode??error?.status))&&/not.?found|does not exist|no.?such.?key/i.test(error.message||'');}

export async function copyOne(storage,file,bytes){
  safePath(file.path);
  if(bytes.length!==file.bytes||digest(bytes)!==file.sha256)throw new Error('Private checkpoint checksum mismatch; copy refused.');
  const prior=await storage.download(file.path);
  let copied=false;
  if(!prior.error){
    if(digest(Buffer.from(await prior.data.arrayBuffer()))!==file.sha256)throw new Error('A different target file already exists; overwrite refused.');
  }else{
    if(!isMissing(prior.error))checked(prior);
    checked(await storage.upload(file.path,bytes,{contentType:file.contentType,cacheControl:'3600',upsert:true}));
    copied=true;
  }
  const target=checked(await storage.download(file.path));
  if(digest(Buffer.from(await target.arrayBuffer()))!==file.sha256)throw new Error('Copied file checksum mismatch.');
  return copied;
}

async function restore(root,target){
  phase='replacement bucket verification';await bucketPrivate(target);
  const m=JSON.parse(await readFile(join(root,'storage-manifest.json'),'utf8'));
  if(m.source!==SOURCE||m.target!==TARGET||m.bucket!==BUCKET||m.private!==true||m.objects.length!==EXPECTED_FILES)throw new Error('Checkpoint identity mismatch; copy refused.');
  let uploaded=0,totalBytes=0;
  for(const file of m.objects){
    if(!/^object-\d+\.bin$/.test(file.filename))throw new Error('Unsafe checkpoint filename; copy refused.');
    phase='replacement private file copy and hash verification';
    const bytes=await readFile(join(root,file.filename));
    if(await copyOne(target.storage.from(BUCKET),file,bytes))uploaded++;
    totalBytes+=bytes.length;
  }
  const report={source_project:SOURCE,target_project:TARGET,verified_at:new Date().toISOString(),
    object_count:m.objects.length,uploaded,total_bytes:totalBytes,all_hashes_match:true,bucket_private:true,
    source_writes_performed:false,application_cutover_performed:false};
  await save(join(root,'storage-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}

async function authSmoke(root,target,key,options){
  const created=[],userClients=[],checks=[];let failure;
  try{
    for(const role of ['driver','host']){
      phase=`replacement ${role} test account creation`;
      const password=randomBytes(32).toString('hex');
      const email=`qa-recovery-${role}-${randomBytes(10).toString('hex')}@example.invalid`;
      const {user}=checked(await target.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{name:'QA Recovery Probe',role}}));
      created.push(user.id);
      const client=createClient(`https://${TARGET}.supabase.co`,key,options);userClients.push(client);
      phase=`replacement ${role} password login`;
      const signed=checked(await client.auth.signInWithPassword({email,password}));
      if(!signed.session||signed.user.id!==user.id)throw new Error('Test login identity mismatch.');
      phase=`replacement ${role} own-profile access`;
      const profile=checked(await client.from('profiles').select('id,role').eq('id',user.id).single());
      if(profile.id!==user.id||profile.role!==role)throw new Error('Test profile identity or role mismatch.');
      checks.push({role,password_login:true,own_profile:true});
    }
    phase='replacement cross-user profile isolation';
    for(let i=0;i<2;i++){
      const rows=checked(await userClients[i].from('profiles').select('id,role').eq('id',created[1-i]));
      if(rows.length)throw new Error('Cross-user profile isolation failed.');
      checks[i].other_profile_hidden=true;
    }
  }catch(error){failure=error;}
  const cleanup=[];
  for(let i=0;i<created.length;i++){
    try{await userClients[i]?.auth.signOut({scope:'global'});}catch{}
    phase='replacement synthetic account cleanup';
    try{checked(await target.auth.admin.deleteUser(created[i]));cleanup.push(true);}catch{cleanup.push(false);}
  }
  const report={target_project:TARGET,verified_at:new Date().toISOString(),checks,synthetic_accounts_removed:cleanup.length===created.length&&cleanup.every(Boolean),
    original_accounts_modified:false,emails_sent:false,application_cutover_performed:false};
  await save(join(root,'auth-smoke-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(failure)throw failure;
  if(!report.synthetic_accounts_removed)throw new Error('A synthetic test account needs cleanup.');
}

export async function main(){
  process.umask(0o077);
  const root=resolve(process.env.QA_RECOVERY_STORAGE_DIR||'');
  if(!process.env.QA_RECOVERY_STORAGE_DIR)throw new Error('Private export directory is required.');
  await mkdir(root,{recursive:true,mode:0o700});
  const c=clients();
  if(process.argv[2]==='prepare')await prepare(root,c.source,c.target);
  else if(process.argv[2]==='restore')await restore(root,c.target);
  else if(process.argv[2]==='auth')await authSmoke(root,c.target,c.targetKey,c.options);
  else throw new Error('Expected prepare, restore or auth stage.');
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main().catch(error=>{console.error(error instanceof Error?error.message:`${phase} failed; private details not logged.`);process.exitCode=1;});
}
