import {get,put,BlobPreconditionFailedError} from '@vercel/blob';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {createHash} from 'node:crypto';

const project='techware-instructor';
const base='techware-waiting-list/v2/';
const source='1vZcM6n0eDhDXbi1jNMSpfVWQNLmGBEieqJSgTj_V080';
const tab="'waiting list'!A2:L1500";
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
export default async function handler(req:Request):Promise<Response>{
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
   const [snapshot,decisions]=await Promise.all([
    readFile<Snapshot|null>('roster',null),
    readFile<Record<string,Decision>>('decisions',{})
   ]);
   return reply({role:person.role,ready:!!snapshot.value,
    syncedAt:snapshot.value?.syncedAt||null,
    entries:snapshot.value?.entries||[],
    decisions:decisions.value});
  }
  if(Number(req.headers.get('content-length')||0)>2_000_000)return reply({error:'طلب كبير جدًا.'},413);
  const body=await req.json().catch(()=>null) as {action?:string;token?:string;key?:string;status?:string;uid?:string;name?:string;active?:boolean}|null;
  if(!body||typeof body.action!=='string')return reply({error:'بيانات غير صحيحة.'},400);
  if(body.action==='sync'){
   if(person.role!=='admin')return reply({error:'المزامنة للإدارة فقط.'},403);
   if(typeof body.token!=='string'||body.token.length<50||body.token.length>4096)return reply({error:'محتاج ربط حساب Google للإدارة مرة واحدة.'},400);
   const url='https://sheets.googleapis.com/v4/spreadsheets/'+source+'/values/'+encodeURIComponent(tab);
   const res=await fetch(url,{headers:{Authorization:'Bearer '+body.token}});
   if(!res.ok)return reply({error:'Google رفض قراءة الملف، راجع صلاحية الحساب وGoogle Sheets API.',googleStatus:res.status},424);
   const data=await res.json() as {values?:string[][]};
   if(!Array.isArray(data.values))return reply({error:'ملف الاستمارات لم يرجّع بيانات صحيحة.'},502);
   const entries=data.values.map((row,i)=>normalizeSheetRow(row,i)).filter((row):row is Student=>!!row);
   if(entries.length===0)return reply({error:'ملف الانتظار رجع بدون طلاب. تم إلغاء المزامنة حفاظًا على البيانات السابقة.'},409);
   // Import is read-only against the original sheet: attendance decisions stay independently durable.
   await updateFile<Snapshot|null>('roster',null,()=>({entries,syncedAt:new Date().toISOString(),source:'Techware courses (Responses)'}));
   return reply({ok:true,count:entries.length,syncedAt:new Date().toISOString()});
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
