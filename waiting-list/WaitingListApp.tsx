'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {GoogleAuthProvider,browserLocalPersistence,onAuthStateChanged,setPersistence,signInWithEmailAndPassword,signInWithPopup,reauthenticateWithPopup,linkWithPopup,signOut,type User} from 'firebase/auth';
import {firebaseAuth} from './firebase-client';
import {contactLinks} from './phone';
import './waiting-list.css';

type Role='checking'|'admin'|'staff'|'denied'|'error';
type Status='waiting'|'attended'|'removed'|'expired'|'undated';
type Entry={key:string;name:string;phone:string;whatsapp:string;course:string;age:string;date:string;notes:string;school:string;initialStatus:'waiting'|'attended'|'removed'};
type Decision={status:'waiting'|'attended'|'removed';actorId:string;updatedAt:string};
type Staff={uid:string;name:string;active:boolean};
type FullList={ready:boolean;syncedAt:string|null;entries:Entry[];decisions:Record<string,Decision>;autoSyncConfigured?:boolean};
type SavedList={uid:string;cachedAt:number;value:FullList};
type ApiError={error?:string;googleStatus?:number};
const CACHE_MS=5*60*1000;
const UPDATE_GAP_MS=60*1000;
const GRANT_MS=45*60*1000;
const sourceKey=(uid:string)=>'tw-wait-list-private-v2:'+uid;
const grantKey=(uid:string)=>'tw-wait-google-admin:'+uid;
const now=()=>Date.now();
function sessionRead<T>(key:string):T|null{try{const raw=sessionStorage.getItem(key);return raw?JSON.parse(raw) as T:null;}catch{return null;}}
function sessionWrite(key:string,value:unknown){try{sessionStorage.setItem(key,JSON.stringify(value));}catch{/* storage disabled */}}
function sessionRemove(key:string){try{sessionStorage.removeItem(key);}catch{/* storage disabled */}}
function cachedList(uid:string):SavedList|null{
 const cached=sessionRead<SavedList>(sourceKey(uid));
 return cached?.uid===uid&&now()-cached.cachedAt<CACHE_MS?cached:null;
}
function monthCutoff(){const d=new Date();const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()-3);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));d.setHours(0,0,0,0);return d;}
function dateOf(text:string):Date|null{
 if(!text)return null;
 // The actual Techware form stores "7:54:27 م 2026/08/03".
 // Keep the time, including Arabic AM/PM, so same-day registrations sort correctly.
 const ymd=text.match(/(20\d\d)[\/-](\d{1,2})[\/-](\d{1,2})/);
 if(ymd){
  const year=+ymd[1],month=+ymd[2],day=+ymd[3];
  const pre=text.slice(0,ymd.index);
  const post=text.slice((ymd.index||0)+ymd[0].length);
  const time=pre.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|م|AM|PM)?/i)
    ||post.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|م|AM|PM)?/i);
  let hour=time?+time[1]:0;
  const marker=time?.[4]?.toLowerCase();
  if(marker==='م'||marker==='pm')hour=hour%12+12;
  if(marker==='ص'||marker==='am')hour=hour%12;
  const minute=time?+time[2]:0,second=time?+(time[3]||0):0;
  const d=new Date(year,month-1,day,hour,minute,second);
  if(d.getFullYear()!==year||d.getMonth()!==month-1||d.getDate()!==day||hour>23||minute>59||second>59)return null;
  return d;
 }
 const d=new Date(text);
 return Number.isFinite(d.getTime())?d:null;
}
function prettyDate(value:string|null){const date=value?dateOf(value):null;return date?new Intl.DateTimeFormat('ar-EG',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date):'غير مسجّل';}
function displayTime(value:string|null){const d=value?new Date(value):null;return d&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d):'لم تتم المزامنة بعد';}
async function api(user:User,method:'GET'|'POST',kind:string,body?:unknown){
 const token=await user.getIdToken();
 const res=await fetch('/api/waitlist'+(method==='GET'?'?kind='+encodeURIComponent(kind):''),{
  method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 const data=await res.json().catch(()=>({})) as ApiError&Record<string,unknown>;
 if(!res.ok){const e=new Error(data.error||'تعذر الاتصال بخدمة قائمة الانتظار ('+res.status+')') as Error&{status?:number};e.status=res.status;throw e;}
 return data;
}
const badges:Record<Status,string>={waiting:'في الانتظار',attended:'حضر',removed:'تم الحذف',expired:'انتهت 3 شهور',undated:'تاريخ غير معروف'};

export default function WaitingListApp(){
 const [user,setUser]=useState<User|null>(null),[authReady,setAuthReady]=useState(false);
 const [role,setRole]=useState<Role>('checking');
 const [autoSync,setAutoSync]=useState(false);
 const [credentialStatus,setCredentialStatus]=useState('missing');
 const [authRetry,setAuthRetry]=useState(0);
 const [data,setData]=useState<FullList>({ready:false,syncedAt:null,entries:[],decisions:{}});
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [lastFetchAt,setLastFetchAt]=useState(0);
 const [tab,setTab]=useState<'recent'|'all'>('recent');
 // Keep a recently handled row on screen so the list doesn't shrink under the finger.
 const [handledRecent,setHandledRecent]=useState<string[]>([]);
 const [confirmRemove,setConfirmRemove]=useState<string|null>(null);
 const [query,setQuery]=useState(''),[course,setCourse]=useState('all'),[status,setStatus]=useState('all');
 const [email,setEmail]=useState(''),[staffUid,setStaffUid]=useState(''),[staffName,setStaffName]=useState('');
 const [staff,setStaff]=useState<Staff[]>([]);
 const [staffLoaded,setStaffLoaded]=useState(false);
 const [showSourceInfo,setShowSourceInfo]=useState(false);
 const [clock,setClock]=useState(new Date());
 useEffect(()=>{const old=document.title;document.title='قائمة الانتظار | Techware Academy';return()=>{document.title=old;};},[]);
 useEffect(()=>onAuthStateChanged(firebaseAuth(),u=>{setUser(u);setAuthReady(true);setRole('checking');},e=>{setError(e.message);setAuthReady(true);}),[]);
 useEffect(()=>{const handle=setInterval(()=>setClock(new Date()),60_000);return()=>clearInterval(handle);},[]);
 useEffect(()=>{
  if(!user){setData({ready:false,syncedAt:null,entries:[],decisions:{}});setStaff([]);setRole('checking');return;}
  let alive=true;setError('');setRole('checking');
  (async()=>{
   const me=await api(user,'GET','me');
   if(!alive)return;
   setAutoSync(me.autoSyncConfigured===true);
   setCredentialStatus(String(me.credentialStatus||'missing'));
   const actualRole=me.role==='admin'?'admin':me.role==='staff'?'staff':'denied';
   setRole(actualRole);
   if(actualRole==='denied')return;
   const cache=cachedList(user.uid);
   if(cache){setData(cache.value);setLastFetchAt(cache.cachedAt);return;}
   setLoading(true);
   const list=await api(user,'GET','list') as unknown as FullList;
   if(!alive)return;
   setData(list);const stamp=now();setLastFetchAt(stamp);
   sessionWrite(sourceKey(user.uid),{uid:user.uid,cachedAt:stamp,value:list} satisfies SavedList);
  })().catch(e=>{if(alive){
   const err=e as Error&{status?:number};
   // A failed API call or invalid Google configuration is NOT evidence of denied access.
   if(err.status===401||err.status===403)setRole('denied');
   else setRole(current=>current==='admin'||current==='staff'?current:'error');
   setError(String(err.message||err));
  }})
   .finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};
 },[user?.uid,authRetry]);

 const cutoff=monthCutoff();
 const classify=(e:Entry):Status=>{
  const v=data.decisions[e.key]?.status||e.initialStatus;
  if(v==='attended'||v==='removed')return v;
  const d=dateOf(e.date);
  return !d?'undated':d<cutoff?'expired':'waiting';
 };
 // Both recent and complete lists use newest submission first, including time of day.
 // Source-row order breaks identical-time ties deterministically (newer rows first).
 const sortedEntries=data.entries.map((entry,index)=>({entry,index})).sort((a,b)=>{
  const at=dateOf(a.entry.date)?.getTime()??Number.NEGATIVE_INFINITY;
  const bt=dateOf(b.entry.date)?.getTime()??Number.NEGATIVE_INFINITY;
  return bt-at||b.index-a.index;
 }).map(item=>item.entry);
 const waiting=sortedEntries.filter(e=>classify(e)==='waiting');
 const visibleRecent=sortedEntries.filter(e=>classify(e)==='waiting'||handledRecent.includes(e.key));
 const attended=data.entries.filter(e=>classify(e)==='attended').length;
 const expired=data.entries.filter(e=>classify(e)==='expired').length;
 const courses=[...new Set(data.entries.map(e=>e.course))].sort((a,b)=>a.localeCompare(b,'ar'));
 const filtered=(tab==='recent'?visibleRecent:sortedEntries).filter(e=>{
  const hay=[e.name,e.phone,e.whatsapp,e.course,e.school].join(' ').toLowerCase();
  return (!query.trim()||hay.includes(query.trim().toLowerCase()))&&(course==='all'||e.course===course)&&(status==='all'||classify(e)===status);
 });
 const remember=(next:FullList)=>{setData(next);if(user)sessionWrite(sourceKey(user.uid),{uid:user.uid,cachedAt:now(),value:next} satisfies SavedList);};
 async function loadList(force=false){
  if(!user||loading)return;
  if(!force&&lastFetchAt&&now()-lastFetchAt<UPDATE_GAP_MS){setNotice('البيانات محدثة بالفعل، مفيش داعي لقراءة جديدة خلال دقيقة.');return;}
  setLoading(true);setError('');
  try{
   const list=await api(user,'GET','list') as unknown as FullList;
   remember(list);setHandledRecent([]);setConfirmRemove(null);setLastFetchAt(now());setNotice('تم تحديث البيانات.');
  }catch(e){setError((e as Error).message);}
  finally{setLoading(false);}
 }
 async function loginWithGoogle(){
  setBusy('login');setError('');
  try{const auth=firebaseAuth();await setPersistence(auth,browserLocalPersistence);await signInWithPopup(auth,new GoogleAuthProvider());}
  catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function loginWithEmail(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy('login');setError('');
  try{const auth=firebaseAuth();await setPersistence(auth,browserLocalPersistence);const password=String(new FormData(e.currentTarget).get('password')||'');await signInWithEmailAndPassword(auth,email.trim(),password);}
  catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function logout(){
  if(user){sessionRemove(sourceKey(user.uid));sessionRemove(grantKey(user.uid));}
  await signOut(firebaseAuth());
 }
 async function syncSource(){
  if(!user||role!=='admin')return;
  setBusy('sync');setError('');
  try{
   if(!autoSync&&credentialStatus!=='missing')
    throw Error('مفتاح Google محفوظ في Vercel لكن صيغته غير سليمة ('+credentialStatus+'). افتح متغير GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON وصحّح محتوى JSON بالكامل؛ مش مطلوب حساب جديد.');
   // With server credentials configured, no popup or admin Google login is needed.
   let googleToken='';
   if(!autoSync){
    const saved=sessionRead<{token:string;expiresAt:number}>(grantKey(user.uid));
    googleToken=saved?.expiresAt&&saved.expiresAt>now()?saved.token:'';
    if(!googleToken){
     const provider=new GoogleAuthProvider();provider.addScope('https://www.googleapis.com/auth/spreadsheets');
     const result=user.providerData.some(p=>p.providerId==='google.com')
       ?await reauthenticateWithPopup(user,provider)
       :await linkWithPopup(user,provider);
     googleToken=GoogleAuthProvider.credentialFromResult(result)?.accessToken||'';
     if(!googleToken)throw Error('لم يتم منح صلاحية استمارات Google.');
     sessionWrite(grantKey(user.uid),{token:googleToken,expiresAt:now()+GRANT_MS});
    }
   }
   const outcome=await api(user,'POST','',{action:'sync',...(googleToken?{token:googleToken}:{})});
   await loadList(true);
   setNotice('تمت مزامنة '+String(outcome.count||0)+' استمارة بنجاح.');
  }catch(e){
   const message=(e as Error).message||'تعذرت المزامنة.';
   if(/Google رفض|الصلاحية|انتهت صلاحية/i.test(message))sessionRemove(grantKey(user.uid));
   setError(message);
  }finally{setBusy('');}
 }
 async function mark(e:Entry,next:'attended'|'removed'|'waiting'){
  if(!user||busy)return;
  setBusy(e.key);setError('');setNotice('');
  try{
   const response=await api(user,'POST','',{action:'mark',key:e.key,status:next});
   const updated={...data,decisions:{...data.decisions,[e.key]:{
    status:next,actorId:user.uid,updatedAt:String(response.updatedAt||new Date().toISOString())
   }}};
   remember(updated);
   // Keep the card in place after attendance or removal instead of deleting DOM
   // elements above the user's scroll position.
   if(tab==='recent'&&next!=='waiting')
    setHandledRecent(previous=>previous.includes(e.key)?previous:[...previous,e.key]);
   setConfirmRemove(null);
   setNotice(next==='attended'?'تم تسجيل الحضور، والتغيير محفوظ.':next==='removed'?'تم الحذف من قائمة الانتظار، والتغيير محفوظ.':'تم إرجاع الطالب للانتظار.');
  }catch(err){setError((err as Error).message);}
  finally{setBusy('');}
 }
 async function loadStaff(){
  if(!user||role!=='admin'||staffLoaded)return;
  setBusy('staff-read');setError('');
  try{const v=await api(user,'GET','staff');setStaff((v.staff||[]) as Staff[]);setStaffLoaded(true);}
  catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function saveStaff(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!user||role!=='admin')return;
  setBusy('staff-save');setError('');
  try{
   const answer=await api(user,'POST','',{action:'staff',uid:staffUid.trim(),name:staffName.trim()||'سكرتارية',active:true});
   const row:Staff={uid:String(answer.uid),name:String(answer.name),active:true};
   setStaff(existing=>[...existing.filter(r=>r.uid!==row.uid),row]);
   setStaffUid('');setStaffName('');setNotice('تم تفعيل حساب السكرتارية.');
  }catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function toggleStaff(staffRow:Staff){
  if(!user||role!=='admin')return;
  setBusy(staffRow.uid);setError('');
  try{
   await api(user,'POST','',{action:'staff',uid:staffRow.uid,name:staffRow.name,active:!staffRow.active});
   setStaff(existing=>existing.map(r=>r.uid===staffRow.uid?{...r,active:!r.active}:r));
  }catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 const count=(n:number)=>data.ready?n.toLocaleString('ar-EG'):'—';
 return <main dir="rtl" className="wl-page">
  <header className="wl-header"><div className="wl-brand"><span className="wl-symbol">T</span><div><strong>TECHWARE <span>ACADEMY</span></strong><small>Waiting List Management</small></div></div><div className="wl-header-actions">{user&&<><span className="wl-user">{user.displayName||user.email}</span><button className="wl-out" onClick={logout}>خروج</button></>}</div></header>
  {!authReady?<section className="wl-center"><div className="wl-loader"/></section>:!user?
   <section className="wl-auth"><span className="wl-auth-icon">T</span><h1>قائمة انتظار Techware</h1><p>دخول موظفي السكرتارية والإدارة.</p>
    <form onSubmit={loginWithEmail}><label>البريد الإلكتروني<input type="email" dir="ltr" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" required/></label><label>كلمة المرور<input type="password" dir="ltr" name="password" required/></label><button type="submit" className="wl-primary" disabled={!!busy}>تسجيل الدخول</button></form>
    <div className="wl-or">أو</div><button className="wl-google" disabled={!!busy} onClick={loginWithGoogle}>الدخول بحساب Google</button>
   </section>:role==='checking'?<section className="wl-center"><div className="wl-loader"/></section>:role==='denied'?
   <section className="wl-auth"><h1>الحساب غير مفعّل للسكرتارية</h1><p>ابعت كود الحساب ده للإدارة علشان تفعّله. مش محتاج تربط استمارات Google.</p><code dir="ltr" className="wl-uid">{user.uid}</code><button className="wl-google" onClick={()=>navigator.clipboard.writeText(user.uid).then(()=>setNotice('تم نسخ الكود.'))}>نسخ كود الحساب</button></section>:role==='error'?
  <section className="wl-auth"><h1>تعذّر الاتصال بالخدمة</h1><p>ده خطأ اتصال أو إعدادات، مش معناه إن حسابك غير مفعّل. جرّب تاني بعد تحديث الصفحة.</p><button className="wl-primary" onClick={()=>{setError('');setAuthRetry(v=>v+1);}}>إعادة المحاولة</button></section>:
  <div className="wl-content">
   <section className="wl-heading"><div><span className="wl-overline">لوحة السكرتارية</span><h1>إدارة قائمة الانتظار</h1><p>التسجيل والحضور من مكان واحد</p></div><button className="wl-refresh" disabled={loading||!!busy} onClick={()=>loadList()}>{loading?'جارٍ التحديث':'↻ تحديث البيانات'}</button></section>
   {role==='admin'&&<section className="wl-connect-panel"><div><strong>{autoSync?(data.syncedAt?'المزامنة التلقائية متصلة':'اعتماد Google جاهز — اختبار المزامنة لم يكتمل بعد'):credentialStatus==='missing'?'مطلوب إعداد حساب Google للخادم':'مفتاح Google المحفوظ يحتاج تصحيح'}</strong><p>{autoSync?'التحديث بيتم تلقائيًا عند فتح القائمة بعد مرور 15 دقيقة على آخر مزامنة، مع مراجعة يومية.':credentialStatus==='missing'?'المتغير GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON غير موجود في بيئة Production.':'المتغير موجود لكن محتوى ملف JSON غير قابل للقراءة أو غير مكتمل. افتح Vercel، وعدّل Value بنص ملف المفتاح كاملًا، ثم اعمل Redeploy. الحالة: '+credentialStatus}</p>{data.syncedAt&&<small>آخر مزامنة ناجحة: {displayTime(data.syncedAt)}</small>}</div><button className="wl-primary" disabled={!!busy||(!autoSync&&credentialStatus!=='missing')} onClick={syncSource}>{busy==='sync'?'جارٍ التحديث':'تحديث الآن'}</button></section>}
   {role==='staff'&&<div className="wl-connected-banner"><strong>حساب السكرتارية متصل</strong><span>الطلبات متاحة مباشرة بدون ربط Google. {autoSync?'المزامنة التلقائية مفعّلة.':'آخر تحديث للطلبات يحدده اتصال الإدارة.'}</span></div>}
   {!data.ready&&<div className="wl-setup-note">{role==='admin'?'لم تتم المزامنة الأولى بعد. اضغط «تحديث الآن» لعرض السجل، وبعد اعتماد خدمة Google ستعمل المزامنة تلقائيًا.':'الإدارة لم تنفّذ المزامنة الأولى للاستـمارات بعد. بمجرد تنفيذها هتظهر القائمة هنا تلقائيًا عند التحديث.'}</div>}
   <section className="wl-stats"><div><span>في الانتظار</span><strong>{count(waiting.length)}</strong><small>آخر 3 شهور</small></div><div><span>حضروا</span><strong>{count(attended)}</strong><small>تم تأكيد حضورهم</small></div><div><span>انتهت المدة</span><strong>{count(expired)}</strong><small>مستبعدون من القائمة الحديثة</small></div><div><span>إجمالي الاستمارات</span><strong>{count(data.entries.length)}</strong><small>السجل الكامل</small></div></section>
   <section className="wl-panel">
    <div className="wl-tabs"><button type="button" className={tab==='recent'?'selected':''} onClick={()=>{setTab('recent');setStatus('all');setConfirmRemove(null);}}>قائمة آخر 3 شهور <b>{count(waiting.length)}</b></button><button type="button" className={tab==='all'?'selected':''} onClick={()=>{setTab('all');setHandledRecent([]);setConfirmRemove(null);}}>القائمة الكاملة <b>{count(data.entries.length)}</b></button></div>
    <div className="wl-filters"><input aria-label="بحث" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث باسم الطالب أو رقم ولي الأمر..."/><select aria-label="الكورس" value={course} onChange={e=>setCourse(e.target.value)}><option value="all">كل الكورسات</option>{courses.map(c=><option key={c} value={c}>{c}</option>)}</select>{tab==='all'&&<select aria-label="حالة الطالب" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">كل الحالات</option>{Object.entries(badges).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>}</div>
    {loading&&!data.ready?<div className="wl-state"><div className="wl-loader"/></div>:!data.ready?<div className="wl-state"><strong>قائمة الانتظار لم تُزامَن بعد</strong><p>مطلوب تنفيذ المزامنة الأولى من حساب الإدارة.</p></div>:filtered.length===0?<div className="wl-state"><strong>لا توجد نتائج مطابقة</strong><p>جرّب تغيير الفلاتر.</p></div>:
    <div className="wl-list">{filtered.map(e=>{const state=classify(e),contact=contactLinks(e.whatsapp,e.phone);return <article className={'wl-entry '+(handledRecent.includes(e.key)&&state!=='waiting'?'wl-entry-handled':'')} key={e.key}><div className="wl-entry-main"><div className="wl-avatar">{e.name.charAt(0)}</div><div><div className="wl-name">{e.name}<span className={'wl-badge '+state}>{badges[state]}</span></div><div className="wl-meta"><span>{e.course}</span>{e.age&&<span>العمر: {e.age}</span>}<span>تسجيل: {prettyDate(e.date)}</span></div></div></div><div className="wl-info"><span dir="ltr">{contact.localPhone||e.phone||'لا يوجد رقم'}</span>{contact.target?<a href={contact.target.whatsappUrl} target="_blank" rel="noopener noreferrer" title={contact.fallback?'رقم الواتساب غير صحيح أو غير موجود؛ تم استخدام رقم الهاتف الموجود في الاستمارة': 'افتح واتساب على الرقم المسجل'}>واتساب: {contact.target.local}{contact.fallback?' (رقم الهاتف)':''}</a>:(e.whatsapp||e.phone)?<span className="wl-phone-invalid" title="الرقم غير مكتمل أو لا يطابق صيغة موبايل مصري سليمة">رقم غير صالح للواتساب</span>:null}{e.school&&<span>{e.school}</span>}{e.notes&&<details><summary>ملاحظات</summary><p>{e.notes}</p></details>}</div><div className="wl-actions">{state==='waiting'?confirmRemove===e.key?
 <div className="wl-delete-confirm"><span>تأكيد حذف الطالب من الانتظار؟</span><button type="button" className="wl-remove" disabled={!!busy} onClick={event=>{event.currentTarget.blur();mark(e,'removed');}}>تأكيد الحذف</button><button type="button" className="wl-restore" onClick={event=>{event.currentTarget.blur();setConfirmRemove(null);}}>إلغاء</button></div>:
 <><button type="button" className="wl-attend" disabled={!!busy} onClick={event=>{event.currentTarget.blur();mark(e,'attended');}}>{busy===e.key?'جاري الحفظ...':'تسجيل حضور'}</button><button type="button" className="wl-remove" disabled={!!busy} onClick={event=>{event.currentTarget.blur();setConfirmRemove(e.key);}}>حذف من الانتظار</button></>:
 <button type="button" className="wl-restore" disabled={!!busy||state==='expired'} onClick={event=>{event.currentTarget.blur();mark(e,'waiting');}}>{busy===e.key?'جاري الحفظ...':state==='expired'?'انتهت صلاحية الطلب':'إرجاع للانتظار'}</button>}</div></article>})}</div>}
    <footer className="wl-footer"><span>{filtered.length.toLocaleString('ar-EG')} طلب ظاهر · الأحدث تسجيلًا أولًا</span><span>آخر مزامنة استمارات: {displayTime(data.syncedAt)}</span></footer>
   </section>
   {role==='admin'&&<details className="wl-staff" onToggle={e=>{if(e.currentTarget.open)loadStaff();}}><summary>إدارة حسابات السكرتارية</summary><div className="wl-staff-body"><p>الموظف يسجل بحسابه العادي ويبعت كود الحساب للإدارة. فعّله هنا مرة واحدة فقط.</p><form onSubmit={saveStaff}><input dir="ltr" value={staffUid} onChange={e=>setStaffUid(e.target.value)} placeholder="كود حساب Firebase" required/><input value={staffName} onChange={e=>setStaffName(e.target.value)} placeholder="اسم الموظف"/><button className="wl-primary" type="submit" disabled={!!busy}>تفعيل الحساب</button></form>{staff.map(r=><div className="wl-staff-row" key={r.uid}><span>{r.name}<small dir="ltr">{r.uid}</small></span><button onClick={()=>toggleStaff(r)} disabled={!!busy}>{r.active?'إيقاف الصلاحية':'تفعيل الصلاحية'}</button></div>)}</div></details>}
   <p className="wl-privacy">حالات الحضور والحذف تُحفظ داخل نظام الانتظار الخاص، من غير مسح بيانات استمارة الطالب الأصلية. الطلبات الأقدم من 3 شهور تُستبعد تلقائيًا من قائمة الانتظار الحديثة.</p>
  </div>}
  {(error||notice)&&<div role={error?'alert':'status'} className={'wl-toast '+(error?'bad':'good')}><span>{error||notice}</span><button onClick={()=>{setError('');setNotice('');}} aria-label="إغلاق">×</button></div>}
 </main>;
}
