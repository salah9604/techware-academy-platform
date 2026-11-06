import {get,put,BlobPreconditionFailedError} from '@vercel/blob';
import {createRemoteJWKSet,jwtVerify,importPKCS8,SignJWT} from 'jose';
import {createHash} from 'node:crypto';

const project='techware-instructor';
const base='techware-waiting-list/v2/';
const source='1vZcM6n0eDhDXbi1jNMSpfVWQNLmGBEieqJSgTj_V080';
const tab="'waiting list'!A2:L10000";
const SOURCE_FRESH_MS=15*60*1000;
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
type Role='admin'|'staff';
type Decision={status:'attended'|'removed'|'waiting';actorId:string;updatedAt:string};
type Student={key:string;name:string;phone:string;whatsapp:string;course:string;age:string;date:string;notes:string;school:string;initialStatus:'waiting'|'attended'|'removed'};
type Snapshot={entries:Student[];syncedAt:string;source:string};
type Staff={uid:string;name:string;active:boolean};
type Stored<T>={value:T;etag:string|null};
async function readFile<T>(name:string,fallback:T):Promise<Stored<T>>{
 const res=await get(base+name+'.json',{access:'private',useCache:false});
 if(!res||res.statusCode!==200||!res.stream)return {value:fallback,etag:null};
 const text=await new Response(res.stream).text();
 return {value:JSON.parse(text) as T,etag:res.blob.etag};
}
async function storeFile(name:string,value:unknown,etag:string|null){
 await put(base+name+'.json',JSON.stringify(value),{
  access:'private',contentType:'application/json; charset=utf-8',cacheControlMaxAge:60,
  ...(etag?{allowOverwrite:true,ifMatch:etag}:{allowOverwrite:false})
 });
}
async function updateFile<T>(name:string,fallback:T,transform:(prev:T)=>T){
 for(let attempt=0;attempt<5;attempt++){
  const old=await readFile(name,fallback);
  try{await storeFile(name,transform(old.value),old.etag);return;}
  catch(error){if(error instanceof BlobPreconditionFailedError||/already exists|precondition|conflict/i.test(String(error)))continue;throw error;}
 }
 throw Error('حصل تعارض في الحفظ. جرّب تاني.');
}
async function profileFromFirestore(token:string,path:string):Promise<Record<string,unknown>|null>{
 const url='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents/'+path.split('/').map(encodeURIComponent).join('/');
 const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});
 if(response.status===403||response.status===404)return null;
 if(!response.ok)throw Error('تعذّر التحقق من صلاحيات المستخدم.');
 const result=await response.json() as {fields?:Record<string,{stringValue?:string;booleanValue?:boolean}>};
 return Object.fromEntries(Object.entries(result.fields||{}).map(([k,v])=>[k,v.stringValue??v.booleanValue??null]));
}
async function authorize(req:Request):Promise<{uid:string;role:Role}>{
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)throw Object.assign(Error('برجاء تسجيل الدخول.'),{status:401});
 const verified=await jwtVerify(token,jwks,{issuer:'https://securetoken.google.com/'+project,audience:project,algorithms:['RS256']}).catch(()=>null);
 const uid=verified?.payload?.sub;
 if(!uid||typeof uid!=='string'||uid.length>160)throw Object.assign(Error('انتهت جلسة الدخول؛ سجّل دخول تاني.'),{status:401});
 const legacy=await profileFromFirestore(token,'users/'+uid);
 const legacyRole=String(legacy?.role||'').toLowerCase();
 if(legacyRole==='admin'&&legacy?.active!==false)return {uid,role:'admin'};
 const portal=await profileFromFirestore(token,'academyPortal/techware/users/'+uid);
 const portalRole=String(portal?.role||'').toLowerCase();
 if(portalRole==='admin'&&portal?.active===true)return {uid,role:'admin'};
 if(['secretary','staff','receptionist'].includes(legacyRole)&&legacy?.active!==false)return {uid,role:'staff'};
 if(['secretary','staff','receptionist'].includes(portalRole)&&portal?.active===true)return {uid,role:'staff'};
 const staff=await readFile<Record<string,Staff>>('staff',{});
 if(staff.value[uid]?.active===true)return {uid,role:'staff'};
 throw Object.assign(Error('حسابك مش مضاف ضمن الإدارة أو السكرتارية.'),{status:403});
}
function normalizeSheetRow(row:string[],index:number):Student|null{
 const name=String(row[1]||'').trim().slice(0,150);
 if(!name)return null;
 const date=String(row[0]||'').trim().slice(0,60),phone=String(row[4]||'').trim().slice(0,60);
 const docId=String(row[10]||'').trim();
 const naturalId=docId||[name,date,phone,String(row[5]||'')].join('|');
 const hash=createHash('sha256').update(naturalId).digest('hex').slice(0,36);
 const rawAttended=String(row[9]||'').trim(),deleted=String(row[11]||'').trim();
 const initialStatus=deleted?'removed':/^(حضر|نعم|yes|true|تم الحضور|1)$/i.test(rawAttended)?'attended':'waiting';
 return {key:'sheet__'+hash,name,date,phone,whatsapp:String(row[5]||'').slice(0,60),
  age:String(row[2]||'').slice(0,30),course:String(row[7]||'غير محدد').slice(0,100),
  notes:String(row[8]||'').slice(0,1000),school:String(row[6]||'').slice(0,160),initialStatus};
}

type ServiceAccount={client_email:string;private_key:string;token_uri?:string};
function serviceAccount():ServiceAccount|null{
 const value=process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
 if(!value)return null;
 let parsed:unknown;
 try{parsed=JSON.parse(value);}catch{throw Object.assign(Error('صيغة اعتماد Google غير صحيحة.'),{status:503});}
 const a=parsed as Partial<ServiceAccount>;
 if(!a||typeof a.client_email!=='string'||!a.client_email.endsWith('.gserviceaccount.com')
   ||typeof a.private_key!=='string'||!a.private_key.includes('BEGIN PRIVATE KEY'))throw Object.assign(Error('اعتماد Google غير مكتمل.'),{status:503});
 return {client_email:a.client_email,private_key:a.private_key,token_uri:'https://oauth2.googleapis.com/token'};
}
async function googleAccessToken():Promise<string>{
 const account=serviceAccount();
 if(!account)throw Object.assign(Error('مطلوب تفعيل اتصال Google الدائم من الإدارة مرة واحدة.'),{status:503});
 const key=await importPKCS8(account.private_key,'RS256');
 const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/spreadsheets.readonly'})
  .setProtectedHeader({alg:'RS256',typ:'JWT'})
  .setIssuer(account.client_email).setSubject(account.client_email)
  .setAudience(account.token_uri||'https://oauth2.googleapis.com/token')
  .setIssuedAt().setExpirationTime('50m').sign(key);
 const response=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw Object.assign(Error('تعذر اعتماد خدمة Google تلقائيًا. راجع صلاحيات حساب الخدمة.'),{status:502});
 const result=await response.json() as {access_token?:string};
 if(!result.access_token)throw Object.assign(Error('Google لم يصدر رمز وصول صالح.'),{status:502});
 return result.access_token;
}
export async function syncRoster(options?:{token?:string;force?:boolean;onlyIfStale?:boolean}){
 const configured=!!serviceAccount();
 if(!configured&&!options?.token)throw Object.assign(Error('اتصال Google الدائم لم يتم إعداده بعد.'),{status:503});
 const old=await readFile<Snapshot|null>('roster',null);
 if(options?.onlyIfStale&&old.value&&Date.now()-Date.parse(old.value.syncedAt)<SOURCE_FRESH_MS){
  return {count:old.value.entries.length,syncedAt:old.value.syncedAt,skipped:true};
 }
 const token=options?.token||await googleAccessToken();
 const url='https://sheets.googleapis.com/v4/spreadsheets/'+source+'/values/'+encodeURIComponent(tab);
 const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(!response.ok){
  if(response.status===403)throw Object.assign(Error('حساب الخدمة محتاج صلاحية Reader على ملف تسجيلات Techware أو تفعيل Google Sheets API.'),{status:424});
  throw Object.assign(Error('تعذر قراءة استمارات Google أثناء المزامنة ('+response.status+').'),{status:502});
 }
 const data=await response.json() as {values?:string[][]};
 if(!Array.isArray(data.values))throw Object.assign(Error('لم تُسترجع بيانات صحيحة من الاستمارات.'),{status:502});
 const entries=data.values.map((row,i)=>normalizeSheetRow(row,i)).filter((row):row is Student=>!!row);
 if(!entries.length)throw Object.assign(Error('ملف الاستمارات رجع فاضي؛ تم الاحتفاظ بالبيانات القديمة دون تغيير.'),{status:409});
 // Guard against accidental truncation caused by source API mistakes.
 if(old.value?.entries?.length&&entries.length<old.value.entries.length*.7)
  throw Object.assign(Error('البيانات الجديدة أقل كثيرًا من السجل السابق؛ المزامنة توقفت لحماية السجل.'),{status:409});
 const stamp=new Date().toISOString();
 await updateFile<Snapshot|null>('roster',null,()=>({entries,syncedAt:stamp,source:'Techware courses (Responses)'}));
 return {count:entries.length,syncedAt:stamp,skipped:false};
}

export async function GET(request:Request):Promise<Response>{return handler(request);}
export async function POST(request:Request):Promise<Response>{return handler(request);}
async function handler(req:Request):Promise<Response>{
 try{
  if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
  const person=await authorize(req);
  if(req.method==='GET'){
   const kind=new URL(req.url).searchParams.get('kind')||'list';
   if(kind==='me')return reply({role:person.role});
   if(kind==='staff'){
    if(person.role!=='admin')return reply({error:'غير مسموح.'},403);
    const data=await readFile<Record<string,Staff>>('staff',{});
    return reply({staff:Object.values(data.value)});
   }
   if(kind!=='list')return reply({error:'Unknown request'},400);
   // Lazy refresh: at most once per 15 minutes when staff actually access the dashboard.
   // No Google access is required from the secretary's browser.
   const snapshotBefore=await readFile<Snapshot|null>('roster',null);
   if(serviceAccount()&&(!snapshotBefore.value||Date.now()-Date.parse(snapshotBefore.value.syncedAt)>SOURCE_FRESH_MS)){
    try{await syncRoster({onlyIfStale:true});}
    catch(e){/* Serve last verified snapshot when the external source is unavailable. */}
   }
   const [snapshot,decisions]=await Promise.all([
    readFile<Snapshot|null>('roster',null),
    readFile<Record<string,Decision>>('decisions',{})
   ]);
   return reply({role:person.role,ready:!!snapshot.value,
    autoSyncConfigured:!!serviceAccount(),
    syncedAt:snapshot.value?.syncedAt||null,
    entries:snapshot.value?.entries||[],
    decisions:decisions.value});
  }
  if(Number(req.headers.get('content-length')||0)>2_000_000)return reply({error:'طلب كبير جدًا.'},413);
  const body=await req.json().catch(()=>null) as {action?:string;token?:string;key?:string;status?:string;uid?:string;name?:string;active?:boolean}|null;
  if(!body||typeof body.action!=='string')return reply({error:'بيانات غير صحيحة.'},400);
  if(body.action==='sync'){
   if(person.role!=='admin')return reply({error:'المزامنة للإدارة فقط.'},403);
   // Permanent service account wins. Temporary admin OAuth is kept only for setup.
   const googleToken=typeof body.token==='string'&&body.token.length>50&&body.token.length<4096?body.token:undefined;
   const result=await syncRoster({token:serviceAccount()?undefined:googleToken,force:true});
   return reply({ok:true,...result});
  }
  if(body.action==='mark'){
   if(typeof body.key!=='string'||!/^sheet__[0-9a-f]{36}$/.test(body.key))return reply({error:'معرّف الطالب غير صحيح.'},400);
   if(!['waiting','attended','removed'].includes(String(body.status)))return reply({error:'حالة غير صحيحة.'},400);
   const snap=await readFile<Snapshot|null>('roster',null);
   if(!snap.value?.entries?.some(e=>e.key===body.key))return reply({error:'الطالب غير موجود؛ حدّث القائمة.'},404);
   const status=body.status as Decision['status'],updatedAt=new Date().toISOString();
   await updateFile<Record<string,Decision>>('decisions',{},prev=>({...prev,[body.key]:{status,actorId:person.uid,updatedAt}}));
   return reply({ok:true,key:body.key,status,updatedAt});
  }
  if(body.action==='staff'){
   if(person.role!=='admin')return reply({error:'الإدارة فقط.'},403);
   const uid=String(body.uid||'').trim(),name=String(body.name||'سكرتارية').trim().slice(0,100);
   if(!/^[A-Za-z0-9_-]{8,160}$/.test(uid)||!name)return reply({error:'UID أو الاسم غير صحيح.'},400);
   if(uid===person.uid&&body.active===false)return reply({error:'ماينفعش توقف حساب الإدارة الحالي.'},400);
   const active=body.active===true;
   await updateFile<Record<string,Staff>>('staff',{},prev=>({...prev,[uid]:{uid,name,active}}));
   return reply({ok:true,uid,name,active});
  }
  return reply({error:'عملية غير مدعومة.'},400);
 }catch(error){
  const e=error as Error&{status?:number};
  // Do not log student data, OAuth tokens, or full request bodies.
  return reply({error:e.message||'تعذر تنفيذ الطلب'},e.status||500);
 }
}
