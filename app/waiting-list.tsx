'use client';
import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {GoogleAuthProvider,browserLocalPersistence,onAuthStateChanged,setPersistence,signInWithEmailAndPassword,signInWithPopup,signOut,type User} from 'firebase/auth';
import {collection,doc,documentId,getDoc,getDocs,getFirestore,limit,onSnapshot,orderBy,query,serverTimestamp,setDoc,startAfter,type DocumentData,type QueryDocumentSnapshot} from 'firebase/firestore';
import {firebaseAuth} from '../lib/firebase-client';
import './waiting-list.css';

type Entry={key:string;source:string;name:string;phone:string;whatsapp:string;course:string;age:string;date:Date|null;notes:string;school:string};
type Decision={status:'attended'|'removed'|'waiting';updatedAt?:unknown;actorId?:string};
type Tab='recent'|'all';
const sources=['registrationForms','formSubmissions','courseRegistrations','registrations','enrollments','forms','waitingListSubmissions'];
const waitRoot='academyWaitingList/techware';
const choose=(d:DocumentData,keys:string[])=>{for(const k of keys){const value=d[k];if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();}return '';};
function safeDate(v:unknown):Date|null{
 if(!v)return null;
 if(typeof v==='object'&&v!==null){const o=v as {toDate?:()=>Date;seconds?:number};if(typeof o.toDate==='function')return o.toDate();if(typeof o.seconds==='number')return new Date(o.seconds*1000);}
 if(typeof v==='number')return new Date(v<1e11?v*1000:v);
 const s=String(v).trim();if(/^\d{13}$/.test(s))return new Date(Number(s));if(/^\d{10}$/.test(s))return new Date(Number(s)*1000);
 const egypt=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);if(egypt)return valid(new Date(+egypt[3],+egypt[2]-1,+egypt[1]));
 return valid(new Date(s));
}
function valid(d:Date){return Number.isFinite(d.getTime())&&d.getFullYear()>2000&&d.getFullYear()<2100?d:null;}
function formEntry(source:string,id:string,d:DocumentData):Entry|null{
 const name=choose(d,['student_name','studentName','student_name_ar','name','student','اسم الطالب','اسم الطفل','childName','fullName','full_name']);
 if(!name)return null;
 const dateValue=['createdAt','created_at','submittedAt','submitted_at','submissionDate','submission_date','registrationDate','registeredAt','timestamp','date','form_started_at','created'].map(k=>d[k]).find(x=>x!==undefined&&x!==null&&String(x).trim());
 return {key:source+'__'+id,source,name,
  phone:choose(d,['parent_phone','parentPhone','guardianPhone','phone','mobile','phoneNumber','رقم ولي الأمر','رقم الهاتف']),
  whatsapp:choose(d,['whatsapp_phone','whatsappPhone','whatsapp','whatsApp','رقم الواتساب']),
  course:choose(d,['course_path','coursePath','course','courseName','preferredCourse','course_name','الكورس','اسم الكورس'])||'غير محدد',
  age:choose(d,['age','studentAge','العمر']),date:safeDate(dateValue),
  notes:choose(d,['notes','note','message','ملاحظات']),
  school:choose(d,['school_name','schoolName','school','المدرسة'])};
}
const format=(d:Date|null)=>d?new Intl.DateTimeFormat('ar-EG',{year:'numeric',month:'short',day:'numeric'}).format(d):'التاريخ غير مسجّل';
function cutoff(now:Date){const d=new Date(now);const day=d.getDate();d.setHours(0,0,0,0);d.setDate(1);d.setMonth(d.getMonth()-3);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return d;}
const readable=(e:unknown)=>{const code=(e as {code?:string})?.code||'';if(code==='permission-denied')return 'صلاحيات Firebase لم تتفعّل بعد، أو حسابك غير مسموح له بقراءة بيانات الاستمارات.';return e instanceof Error?e.message:'حدث خطأ في الاتصال بقاعدة البيانات.';};
const canonical=(value:string)=>value.replace(/[\s()+-]/g,'').replace(/^0020/,'0').replace(/^\+20/,'0');

export default function WaitingListApp(){
 const [user,setUser]=useState<User|null>(null),[authReady,setAuthReady]=useState(false);
 const [role,setRole]=useState<'checking'|'admin'|'staff'|'denied'>('checking');
 const [entries,setEntries]=useState<Entry[]>([]),[decisions,setDecisions]=useState<Record<string,Decision>>({});
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false),[lastSync,setLastSync]=useState<Date|null>(null);
 const [tab,setTab]=useState<Tab>('recent'),[search,setSearch]=useState(''),[course,setCourse]=useState('all'),[status,setStatus]=useState('all');
 const [now,setNow]=useState(new Date()),[reload,setReload]=useState(0);
 const [email,setEmail]=useState(''),[staffUid,setStaffUid]=useState(''),[staffName,setStaffName]=useState('');
 const [staffRows,setStaffRows]=useState<{id:string;name:string;active:boolean}[]>([]);
 const db=useMemo(()=>getFirestore(firebaseAuth().app),[]);
 useEffect(()=>{const old=document.title;document.title='قائمة الانتظار | Techware Academy';return()=>{document.title=old;};},[]);
 useEffect(()=>onAuthStateChanged(firebaseAuth(),u=>{setUser(u);setAuthReady(true);setRole('checking');},e=>{setAuthReady(true);setError(readable(e));}),[]);
 useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),60_000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  if(!user){setRole('checking');setEntries([]);setDecisions({});return;}
  let cancelled=false;setRole('checking');setError('');
  (async()=>{
   const [portal,legacy,staff]=await Promise.all([
    getDoc(doc(db,'academyPortal/techware/users',user.uid)).catch(()=>null),
    getDoc(doc(db,'users',user.uid)).catch(()=>null),
    getDoc(doc(db,waitRoot+'/staff',user.uid)).catch(()=>null)
   ]);
   const isAdmin=!!((portal?.exists()&&portal.data().active===true&&portal.data().role==='admin')||(legacy?.exists()&&['admin','Admin'].includes(legacy.data().role)));
   const isStaff=!!(staff?.exists()&&staff.data().active===true);
   if(!cancelled)setRole(isAdmin?'admin':isStaff?'staff':'denied');
  })().catch(e=>{if(!cancelled){setError(readable(e));setRole('denied');}});
  return()=>{cancelled=true;};
 },[user?.uid,db]);
 useEffect(()=>{
  if(!user||!['admin','staff'].includes(role))return;
  setLoading(true);setError('');let cancelled=false;
  const unsub=onSnapshot(collection(db,waitRoot+'/decisions'),snap=>{
   if(cancelled)return;const m:Record<string,Decision>={};snap.docs.forEach(d=>m[d.id]=d.data() as Decision);setDecisions(m);
  },e=>{if(!cancelled)setError(readable(e));});
  (async()=>{
   const result=await Promise.allSettled(sources.map(async source=>{
    const result:Entry[]=[];let last:QueryDocumentSnapshot<DocumentData>|undefined;
    for(let page=0;page<80;page++){
     // Order by document ID so a complete scan never silently stops at the first batch.
     const pageQuery=last?query(collection(db,source),orderBy(documentId()),startAfter(last),limit(300)):query(collection(db,source),orderBy(documentId()),limit(300));
     const snapshot=await getDocs(pageQuery);
     snapshot.docs.forEach(d=>{const row=formEntry(source,d.id,d.data());if(row)result.push(row);});
     if(snapshot.docs.length<300)break;last=snapshot.docs[snapshot.docs.length-1];
     if(page===79)throw Error('تجاوزت الاستمارات حد عرض 24,000 سجل في مصدر '+source);
    }return result;
   }));
   if(cancelled)return;
   const ok=result.filter((r):r is PromiseFulfilledResult<Entry[]>=>r.status==='fulfilled');
   const failed=result.filter((r):r is PromiseRejectedResult=>r.status==='rejected');
   if(ok.length===0){setError(readable(failed[0]?.reason));setEntries([]);}
   else{
    setEntries(ok.flatMap(r=>r.value).sort((a,b)=>(b.date?.getTime()||0)-(a.date?.getTime()||0)));
    if(failed.length)setNotice('بعض مصادر الاستمارات لم تُقرأ. راجع صلاحيات Firebase.');
    setLastSync(new Date());
   }
  })().catch(e=>{if(!cancelled)setError(readable(e));}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;unsub();};
 },[user?.uid,role,db,reload]);
 useEffect(()=>{
  if(role!=='admin')return;
  return onSnapshot(collection(db,waitRoot+'/staff'),snap=>setStaffRows(snap.docs.map(d=>({id:d.id,name:String(d.data().name||''),active:d.data().active===true}))),e=>setError(readable(e)));
 },[role,db]);

 const threshold=cutoff(now);
 const classify=(e:Entry)=>{const d=decisions[e.key];return d?.status==='attended'?'attended':d?.status==='removed'?'removed':e.date&&e.date<threshold?'expired':'waiting';};
 const recent=entries.filter(e=>classify(e)==='waiting');
 const counts=useMemo(()=>({waiting:recent.length,attended:entries.filter(e=>classify(e)==='attended').length,expired:entries.filter(e=>classify(e)==='expired').length,total:entries.length}),[entries,decisions,now]);
 const courses=[...new Set(entries.map(e=>e.course))].sort((a,b)=>a.localeCompare(b,'ar'));
 const filtered=(tab==='recent'?recent:entries).filter(e=>{
  const hay=(e.name+' '+e.phone+' '+e.whatsapp+' '+e.course+' '+e.school).toLowerCase();
  const needle=search.trim().toLowerCase();return (!needle||hay.includes(needle)||canonical(hay).includes(canonical(needle)))&&(course==='all'||e.course===course)&&(status==='all'||classify(e)===status);
 });
 async function loginWithGoogle(){setBusy('login');setError('');try{const auth=firebaseAuth();await setPersistence(auth,browserLocalPersistence);await signInWithPopup(auth,new GoogleAuthProvider());}catch(e){setError(readable(e));}finally{setBusy('');}}
 async function loginWithEmail(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy('login');setError('');try{const auth=firebaseAuth();await setPersistence(auth,browserLocalPersistence);const pwd=String(new FormData(e.currentTarget).get('password')||'');await signInWithEmailAndPassword(auth,email.trim(),pwd);}catch(e){setError(readable(e));}finally{setBusy('');}}
 async function mark(e:Entry,next:'attended'|'removed'|'waiting'){
  if(!user)return;
  if(next==='removed'&&!window.confirm('هل تريد إزالة '+e.name+' من قائمة الانتظار؟ يمكن استرجاعه من القائمة الكاملة.'))return;
  setBusy(e.key);setError('');try{
   await setDoc(doc(db,waitRoot+'/decisions',e.key),{status:next,actorId:user.uid,updatedAt:serverTimestamp()});
   setNotice(next==='attended'?'تم تسجيل حضور '+e.name:next==='removed'?'تمت إزالة الطالب من الانتظار':'رجع الطالب لقائمة الانتظار');
  }catch(err){setError(readable(err));}finally{setBusy('');}
 }
 async function saveStaff(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!user||role!=='admin')return;
  const uid=staffUid.trim();if(!/^[A-Za-z0-9_-]{8,160}$/.test(uid)){setError('اكتب Firebase UID صحيح للموظف.');return;}
  setBusy('staff');setError('');try{await setDoc(doc(db,waitRoot+'/staff',uid),{name:staffName.trim().slice(0,100)||'سكرتارية',active:true,updatedAt:serverTimestamp(),createdBy:user.uid});setStaffName('');setStaffUid('');setNotice('تم تفعيل حساب السكرتارية.');}catch(err){setError(readable(err));}finally{setBusy('');}
 }
 async function toggleStaff(row:{id:string;name:string;active:boolean}){if(!user||role!=='admin')return;setBusy(row.id);setError('');try{await setDoc(doc(db,waitRoot+'/staff',row.id),{name:row.name,active:!row.active,updatedAt:serverTimestamp(),createdBy:user.uid});}catch(err){setError(readable(err));}finally{setBusy('');}}
 const badges:Record<string,string>={waiting:'في الانتظار',attended:'حضر',removed:'تم الحذف',expired:'انتهت 3 شهور'};
 return <main className="wl-page" dir="rtl">
  <header className="wl-header"><div className="wl-brand"><span className="wl-symbol">T</span><div><strong>TECHWARE <span>ACADEMY</span></strong><small>Waiting List Management</small></div></div><div className="wl-header-actions">{user&&<><span className="wl-user">{user.displayName||user.email}</span><button className="wl-out" onClick={()=>signOut(firebaseAuth())}>خروج</button></>}</div></header>
  {!authReady?<section className="wl-center"><div className="wl-loader"/><p>جاري تجهيز الصفحة</p></section>:!user?<section className="wl-auth"><span className="wl-auth-icon">T</span><h1>قائمة انتظار Techware</h1><p>لوحة خاصة بالسكرتارية والإدارة لمتابعة طلبات التسجيل.</p><form onSubmit={loginWithEmail}><label>البريد الإلكتروني<input type="email" dir="ltr" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" required/></label><label>كلمة المرور<input type="password" name="password" dir="ltr" placeholder="كلمة المرور" required/></label><button type="submit" className="wl-primary" disabled={!!busy}>تسجيل الدخول</button></form><div className="wl-or">أو</div><button className="wl-google" type="button" onClick={loginWithGoogle} disabled={!!busy}>المتابعة باستخدام Google</button></section>:role==='checking'?<section className="wl-center"><div className="wl-loader"/><p>التحقق من صلاحيات الحساب...</p></section>:role==='denied'?<section className="wl-auth"><h1>الحساب غير مصرح له بالدخول</h1><p>اطلب من الإدارة تفعيل حسابك كموظف سكرتارية.</p><code dir="ltr" className="wl-uid">{user.uid}</code><button className="wl-google" onClick={()=>navigator.clipboard.writeText(user.uid).then(()=>setNotice('تم نسخ UID'))}>نسخ رقم الحساب</button></section>:<div className="wl-content">
   <section className="wl-heading"><div><span className="wl-overline">لوحة السكرتارية</span><h1>إدارة قائمة الانتظار</h1><p>متابعة طلبات التسجيل والحضور من مكان واحد</p></div><button className="wl-refresh" onClick={()=>setReload(v=>v+1)} disabled={loading}>↻ تحديث البيانات</button></section>
   <section className="wl-stats"><div><span>في الانتظار</span><strong>{counts.waiting}</strong><small>آخر 3 شهور</small></div><div><span>حضروا</span><strong>{counts.attended}</strong><small>تم تأكيد حضورهم</small></div><div><span>انتهت المدة</span><strong>{counts.expired}</strong><small>مستبعدون تلقائيًا</small></div><div><span>إجمالي الاستمارات</span><strong>{counts.total}</strong><small>السجل الكامل</small></div></section>
   <section className="wl-panel"><div className="wl-tabs"><button className={tab==='recent'?'selected':''} onClick={()=>{setTab('recent');setStatus('all');}}>قائمة آخر 3 شهور <b>{counts.waiting}</b></button><button className={tab==='all'?'selected':''} onClick={()=>setTab('all')}>القائمة الكاملة <b>{counts.total}</b></button></div>
    <div className="wl-filters"><input aria-label="البحث" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث باسم الطالب أو رقم ولي الأمر..." /><select aria-label="الكورس" value={course} onChange={e=>setCourse(e.target.value)}><option value="all">كل الكورسات</option>{courses.map(c=><option key={c}>{c}</option>)}</select>{tab==='all'&&<select aria-label="الحالة" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">كل الحالات</option>{Object.entries(badges).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select>}</div>
    {loading?<div className="wl-state"><div className="wl-loader"/><p>تحميل الاستمارات...</p></div>:filtered.length===0?<div className="wl-state"><strong>لا توجد طلبات مطابقة</strong><p>{counts.total===0?'لم تُعرض استمارات بعد. راجع اتصال قاعدة البيانات ومصدر التسجيل.':'جرّب تغيير البحث أو الفلاتر.'}</p></div>:<div className="wl-list">{filtered.map(e=>{const state=classify(e),w=e.whatsapp||e.phone;return <article className="wl-entry" key={e.key}><div className="wl-entry-main"><div className="wl-avatar">{e.name.charAt(0)}</div><div><div className="wl-name">{e.name}<span className={'wl-badge '+state}>{badges[state]}</span></div><div className="wl-meta"><span>{e.course}</span>{e.age&&<span>العمر: {e.age}</span>}<span>تسجيل: {format(e.date)}</span></div></div></div><div className="wl-info"><span dir="ltr">{e.phone||'لا يوجد رقم'}</span>{w&&<a href={'https://wa.me/'+(canonical(w).replace(/^0/,'20'))} target="_blank" rel="noreferrer">واتساب</a>}{e.school&&<span>{e.school}</span>}{e.notes&&<details><summary>ملاحظات</summary><p>{e.notes}</p></details>}</div><div className="wl-actions">{state==='waiting'?<><button className="wl-attend" disabled={!!busy} onClick={()=>mark(e,'attended')}>تسجيل حضور</button><button className="wl-remove" disabled={!!busy} onClick={()=>mark(e,'removed')}>حذف من الانتظار</button></>:<button className="wl-restore" disabled={!!busy||state==='expired'} onClick={()=>mark(e,'waiting')}>{state==='expired'?'انتهت صلاحية الطلب':'إرجاع للانتظار'}</button>}</div></article>})}</div>}
    <footer className="wl-footer"><span>{filtered.length} طلب ظاهر</span><span>{lastSync?'آخر تحديث: '+format(lastSync):'—'}</span></footer>
   </section>
   {role==='admin'&&<details className="wl-staff"><summary>إدارة حسابات السكرتارية</summary><div className="wl-staff-body"><p>الموظف يسجّل دخول بحسابه، ويرسل UID الظاهر له لتفعيل الصلاحية.</p><form onSubmit={saveStaff}><input dir="ltr" value={staffUid} onChange={e=>setStaffUid(e.target.value)} placeholder="Firebase UID" required/><input value={staffName} onChange={e=>setStaffName(e.target.value)} placeholder="اسم الموظف"/><button type="submit" className="wl-primary" disabled={!!busy}>تفعيل الموظف</button></form>{staffRows.map(row=><div key={row.id} className="wl-staff-row"><span>{row.name} <small dir="ltr">{row.id}</small></span><button onClick={()=>toggleStaff(row)} disabled={!!busy}>{row.active?'إيقاف الصلاحية':'تفعيل الصلاحية'}</button></div>)}</div></details>}
   <p className="wl-privacy">الطلبات التي مرّ عليها 3 شهور تُستبعد تلقائيًا من الانتظار، وتظل في السجل الكامل للحفاظ على تاريخ التسجيل. الحذف اليدوي يزيل الطلب من الانتظار فقط ولا يمسح الاستمارة الأصلية.</p>
  </div>}
  {(error||notice)&&<div role={error?'alert':'status'} className={'wl-toast '+(error?'bad':'good')}><span>{error||notice}</span><button onClick={()=>{setError('');setNotice('');}} aria-label="إغلاق">×</button></div>}
 </main>;
}
