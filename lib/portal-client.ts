import {collection,doc,getDoc,getDocs,getFirestore,limit,onSnapshot,query,serverTimestamp,setDoc,where,writeBatch,type QueryConstraint,type Firestore} from 'firebase/firestore';
import {firebaseAuth} from './firebase-client';
import {applyAction} from './platform-actions';
import {isEligible,techwareCourses,type State,type Row} from './platform-model';
const root='academyPortal/techware';
const db=()=>getFirestore(firebaseAuth().app);
const ref=(name:string,id:string)=>doc(db(),root,name,id);
const col=(name:string)=>collection(db(),root,name);
export const emptyPortal=():State=>({users:[],courses:[],groups:[],sessions:[],tasks:[],submissions:[],messages:[],events:[],competitions:[],registrations:[],invoices:[],notes:[],attendance:[],notifications:[],audit:[]});
export const portalError=(e:unknown)=>{const code=(e as {code?:string})?.code;return code==='permission-denied'?'الصلاحيات رفضت العملية. تأكد من نشر القواعد وربط حسابك، أو حدّث الصفحة لو البيانات اتغيرت.':code==='resource-exhausted'?'وصلنا لحد الاستخدام المتاح. جرّب لاحقًا وراجع الاستخدام في Firebase.':e instanceof Error?e.message:'تعذّر الاتصال بقاعدة البيانات';};
export async function profileFor(uid:string){const d=await getDoc(ref('users',uid));return d.exists()?d.data() as Row:null;}
export async function bootstrapAdmin(uid:string,name:string){await setDoc(ref('users',uid),{id:uid,name:name.trim().slice(0,100)||'إدارة Techware',role:'admin',active:true,children:[],groupIds:[],age:0,completed:[],completedRoboticsLevels:0,color:'blue',version:1,updatedAt:serverTimestamp()});}
// A legacy instructor can activate only their own portal profile. Firestore rules
// verify the old /users role before allowing this write; no new account is approved.
export async function activateLegacyInstructor(uid:string,name:string){await setDoc(ref('users',uid),{id:uid,name:name.trim().slice(0,100)||'مدرب Techware',role:'instructor',active:true,children:[],groupIds:[],age:0,completed:[],completedRoboticsLevels:0,color:'blue',version:1,updatedAt:serverTimestamp()});}
function plain(d:Row):Row {const r={...d};for(const k of ['updatedAt','reviewedAtTs'])if(r[k]?.toDate)r[k]=r[k].toDate().toISOString();if(r.fileIds)r.files=r.fileIds.map((id:string)=>({id,name:'صورة التاسك'}));return r;}
// Realtime queries are constrained by the same group/child ACLs as the rules.
// A bounded pilot: never silently show partial statistics above the bound.
export function watchPortal(uid:string,receive:(s:State)=>void,fail:(e:unknown)=>void,database:Firestore=db()){
 const ref=(name:string,id:string)=>doc(database,root,name,id),col=(name:string)=>collection(database,root,name);
 let stopGroups=()=>{},stops:(()=>void)[]=[],ended=false,generation=0;
 const stopProfile=onSnapshot(ref('users',uid),snapshot=>{
  stopGroups();stops.forEach(f=>f());stops=[];
  const profile=snapshot.exists()?plain(snapshot.data()):null;
  if(!profile?.active){fail(Error('الحساب غير مفعّل. اطلب من الإدارة ربط رقم حسابك.'));return;}
  const admin=profile.role==='admin',parent=profile.role==='parent',instructor=profile.role==='instructor',children:string[]=parent?profile.children:[uid];
  const groupFilters:QueryConstraint[]=admin?[]:instructor?[where('instructorId','==',uid)]:parent?(children.length?[where('studentIds','array-contains-any',children)]:[where('studentIds','array-contains',uid)]):[where('studentIds','array-contains',uid)];
  stopGroups=onSnapshot(query(col('groups'),...groupFilters,limit(501)),gs=>{
   const gen=++generation;stops.forEach(f=>f());stops=[];
   if(gs.size>500){fail(Error('تجاوزت المجموعات حد النسخة التجريبية (500). يلزم إضافة تقسيم الصفحات قبل المتابعة.'));return;}
   const state=emptyPortal();state.users=[profile];state.groups=gs.docs.map(d=>plain(d.data()));
   const sources=new Map<string,Row[]>();let waiting=0,setup=true,broken=false;
   const emit=()=>{if(ended||gen!==generation||waiting||setup||broken)return;
    for(const name of Object.keys(state) as (keyof State)[]){if(name==='groups'||name==='notifications')continue;const values=[...sources].filter(([k])=>k.startsWith(name+':')).flatMap(([,v])=>v);state[name]=[...new Map(values.map(r=>[r.id,r])).values()];}
    state.users=[profile,...state.users.filter(u=>u.id!==uid)];state.messages.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    const notifications:Row[]=[];const add=(r:Row,kind:string,title:string,body:string,priority='normal')=>notifications.push({id:kind+'_'+r.id,userId:uid,kind,title,body,priority,createdAt:r.updatedAt||r.createdAt||new Date().toISOString(),read:false});
    state.messages.filter(m=>m.senderId!==uid).forEach(m=>add(m,'message','رسالة جديدة',m.text,'high'));
    state.submissions.filter(s=>instructor||admin?s.status==='pending':s.reviewerId).forEach(s=>add(s,'task',instructor||admin?'تاسك بانتظار المراجعة':'تحديث مراجعة التاسك',s.feedback||'افتح التاسكات للمراجعة','high'));
    state.sessions.forEach(s=>add(s,'group','ملخص محاضرة',s.title));state.events.forEach(e=>add(e,'event',e.title,e.description,'high'));state.competitions.forEach(c=>add(c,'competition',c.title,c.description));
    state.notifications=notifications.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(n=>({...n,read:Date.parse(n.createdAt)<=readAt}));receive(structuredClone(state));
   };
   let readAt=0;
   const watch=(name:keyof State,label:string,filters:QueryConstraint[]=[])=>{waiting++;let first=true;stops.push(onSnapshot(query(col(name),...filters,limit(501)),snap=>{if(gen!==generation)return;if(first){waiting--;first=false;}if(snap.size>500){broken=true;fail(Error('تجاوزت '+name+' حد العرض الآمن (500 سجل لكل استعلام). يلزم تقسيم الصفحات؛ لن نعرض إحصائيات ناقصة.'));return;}sources.set(name+':'+label,snap.docs.map(d=>plain(d.data())));emit();},e=>{broken=true;fail(e);}));};
   const watchUser=(id:string)=>{waiting++;let first=true;stops.push(onSnapshot(ref('users',id),snap=>{if(first){first=false;waiting--;}sources.set('users:'+id,snap.exists()?[plain(snap.data())]:[]);emit();},e=>{broken=true;fail(e);}));};
   watch('courses','all');watch('competitions','all');
   if(admin){for(const name of ['users','sessions','tasks','submissions','messages','events','registrations','invoices','notes','attendance','audit'] as (keyof State)[])watch(name,'all');}
   else{
    const userIds=new Set<string>([uid,...children]);state.groups.forEach(g=>{userIds.add(g.instructorId);if(instructor)g.studentIds.forEach((sid:string)=>userIds.add(sid));});userIds.forEach(watchUser);
    state.groups.forEach(g=>{for(const name of ['sessions','tasks'] as (keyof State)[])watch(name,g.id,[where('groupId','==',g.id)]);
     if(instructor)for(const name of ['submissions','messages','notes','attendance'] as (keyof State)[])watch(name,g.id,[where('groupId','==',g.id)]);
     if(profile.role==='student')watch('messages',g.id,[where('groupId','==',g.id),where('studentId','==',uid)]);
     watch('events',g.id,[where('groupId','==',g.id)]);
    });
    watch('events','global',[where('groupId','==','')]);
    if(!instructor)children.forEach(sid=>{for(const name of ['submissions','attendance','registrations'] as (keyof State)[])watch(name,sid,[where('studentId','==',sid)]);if(parent){watch('invoices',sid,[where('studentId','==',sid)]);watch('notes',sid,[where('studentId','==',sid),where('visibility','==','parent')]);}});
   }
   stops.push(onSnapshot(ref('readMarkers',uid),s=>{readAt=s.data()?.readAt?.toMillis?.()||0;emit();},fail));setup=false;emit();
  },fail);
 },fail);
 return()=>{ended=true;generation++;stopProfile();stopGroups();stops.forEach(f=>f());};
}
const fields:Record<string,string[]>={
 users:['name','role','active','children','groupIds','age','completed','completedRoboticsLevels','color'],groups:['name','courseId','instructorId','studentIds','day','time','room','level','session','capacity','nextDate','archived'],courses:['name','track','next','color','fee','minAge','maxAge','levels','sessionsPerLevel','sessionHours','tools','description','outcomes','prerequisites','active'],sessions:['groupId','courseId','level','number','date','title','summary','taskText','published'],tasks:['groupId','sessionId','title','description','due','required'],submissions:['groupId','taskId','studentId','text','link','fileIds','status','feedback','reviewerId','reviewedAt','reviewedAtTs','submittedAt','attempt','keepPhotos'],messages:['groupId','studentId','senderId','text','createdAt'],notes:['groupId','studentId','text','visibility','authorId','createdAt'],attendance:['groupId','studentId','sessionId','status'],events:['title','description','date','groupId','type','createdAt'],invoices:['studentId','groupId','level','amount','due','status','paidAt','receipt'],competitions:['title','description','date','deadline','minAge','minLevels','capacity','courseIds','closed','demo','approvedCount'],registrations:['competitionId','studentId','status','createdAt'],audit:['actorId','action','groupId','createdAt']};
export async function savePortalAction(before:State,uid:string,type:string,payload:Row,database:Firestore=db()){
 const ref=(name:string,id:string)=>doc(database,root,name,id);
 if(type==='readNotifications'){await setDoc(ref('readMarkers',uid),{readAt:serverTimestamp()});return;}
 if(type==='addStudent')throw Error('استخدم إدارة الحسابات لربط الطالب برقم Firebase UID.');
 const after=applyAction(before,uid,{type,payload});
 if(type==='approveRegistration'&&before.users.find(u=>u.id===uid)?.role==='admin'){
  const reg=after.registrations.find(r=>r.id===payload.id)!,c=after.competitions.find(c=>c.id===reg.competitionId)!;
  if(!isEligible(after,c,reg.studentId,new Date().toISOString().slice(0,10)))throw Error('شروط المشاركة أو موعد التسجيل لم تعد متاحة.');
  if((c.approvedCount||0)>=c.capacity)throw Error('اكتمل العدد المعتمد للمسابقة.');c.approvedCount=(c.approvedCount||0)+1;
 }

 if(type==='saveGroup'){after.users.forEach(u=>{u.groupIds=after.groups.filter(g=>g.instructorId===u.id||g.studentIds.includes(u.id)||(u.role==='parent'&&g.studentIds.some((id:string)=>u.children.includes(id)))).map(g=>g.id);});}
 const batch=writeBatch(database);let count=0;
 for(const name of Object.keys(fields) as (keyof State)[]){for(const row of after[name]){
  const old=before[name].find(r=>r.id===row.id);if(old&&JSON.stringify(old)===JSON.stringify(row))continue;
  let id=row.id;const r={...row};
  if(name==='submissions'){
   id=r.taskId+'_'+r.studentId;r.groupId=after.tasks.find(t=>t.id===r.taskId)!.groupId;
   if(type==='submitTask'){r.fileIds=(payload.files||[]).map((f:Row)=>f.id);r.reviewerId='';r.reviewedAt='';r.reviewedAtTs=null;r.keepPhotos=false;for(const file of payload.files||[]){if(!file.dataUrl||file.dataUrl.length>300000)throw Error('الصورة أكبر من الحد المجاني. قص لقطة الكود وحاول تاني.');batch.set(ref('photos',file.id),{id:file.id,submissionId:id,studentId:uid,name:file.name.slice(0,160),dataUrl:file.dataUrl,createdAt:serverTimestamp()});count++;}}
   else r.reviewedAtTs=serverTimestamp();
  }
  if(name==='attendance'){r.groupId=after.sessions.find(s=>s.id===r.sessionId)!.groupId;id=r.sessionId+'_'+r.studentId;}
  if(name==='registrations')id=r.competitionId+'_'+r.studentId;
  if(name==='competitions'){r.demo=false;r.approvedCount=r.approvedCount||0;}
  if(name==='invoices')id=r.groupId+'_'+r.studentId+'_'+r.level;
  const record:Row={id,version:(old?.version||0)+1,updatedAt:serverTimestamp()};for(const k of fields[name]){if(r[k]===undefined)throw Error('حقل ناقص: '+name+'.'+k);record[k]=r[k];}
  batch.set(ref(name,id),record);count++;
 }}
 if(count>400)throw Error('العملية كبيرة جدًا؛ قسّم التعديلات على مجموعات أصغر.');await batch.commit();
}
export async function saveProfile(before:State,input:Row){
 const id=String(input.id||'').trim();if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('انسخ UID الصحيح من Firebase Authentication.');
 const old=before.users.find(u=>u.id===id);const role=input.role,children=role==='parent'?(input.children||[]):[];
 if(!['admin','instructor','student','parent'].includes(role))throw Error('اختار نوع الحساب');
 if(old&&old.role!==role&&before.groups.some(g=>g.instructorId===id||g.studentIds.includes(id)))throw Error('شيل الحساب من مجموعاته قبل تغيير نوعه.');
 if(children.some((sid:string)=>!before.users.some(u=>u.id===sid&&u.role==='student')))throw Error('اربط حسابات الأبناء كطلاب الأول.');
 const groupIds=before.groups.filter(g=>g.instructorId===id||g.studentIds.includes(id)||(role==='parent'&&g.studentIds.some((sid:string)=>children.includes(sid)))).map(g=>g.id);
 await setDoc(ref('users',id),{id,name:String(input.name).trim(),role,active:!!input.active,children,groupIds,age:Number(input.age)||0,completed:String(input.completed||'').split(',').map(s=>s.trim()).filter(Boolean),completedRoboticsLevels:Number(input.completedRoboticsLevels)||0,color:old?.color||'blue',version:(old?.version||0)+1,updatedAt:serverTimestamp()});
}
export async function saveCourse(before:State,input:Row){const id=String(input.id||crypto.randomUUID()).trim(),old=before.courses.find(c=>c.id===id),text=(v:unknown,max:number)=>String(v||'').trim().slice(0,max),num=(v:unknown,min:number,max:number)=>Math.min(max,Math.max(min,Number(v)||min));if(!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw Error('معرّف الكورس لازم يكون إنجليزيًا بدون مسافات.');const minAge=num(input.minAge,4,18),maxAge=num(input.maxAge,minAge,18);await setDoc(ref('courses',id),{id,name:text(input.name,100),track:text(input.track,100),next:text(input.next,160),color:['blue','pink','green','orange','violet'].includes(input.color)?input.color:'blue',fee:null,minAge,maxAge,levels:num(input.levels,1,30),sessionsPerLevel:4,sessionHours:2,tools:text(input.tools,500),description:text(input.description,1200),outcomes:text(input.outcomes,1200),prerequisites:text(input.prerequisites,500),active:input.active===true||input.active==='on',version:(old?.version||0)+1,updatedAt:serverTimestamp()});}
export async function seedTechwareCourses(before:State){const batch=writeBatch(db());let count=0;for(const course of techwareCourses){if(before.courses.some(c=>c.id===course.id))continue;batch.set(ref('courses',course.id),{...course,version:1,updatedAt:serverTimestamp()});count++;}if(count)await batch.commit();return count;}
export async function downloadPhoto(id:string){const s=await getDoc(ref('photos',id));if(!s.exists())throw Error('الصورة غير متاحة أو انتهت مدة الاحتفاظ.');const d=s.data(),a=document.createElement('a');a.href=d.dataUrl;a.download=d.name;a.click();}
export async function cleanPortalPhotos(){
 // Read only expired submissions, then bounded photo pages; do not download the whole photo store.
 const cutoff=new Date(Date.now()-90*86400000),subs=await getDocs(query(col('submissions'),where('reviewedAtTs','<=',cutoff),limit(501)));if(subs.size>500)throw Error('أكثر من 500 تسليم قديم؛ يلزم ترقية أداة التنظيف لتقسيم الصفحات.');let deleted=0;
 for(const sub of subs.docs){const s=sub.data();if(s.status!=='complete'||s.keepPhotos)continue;const photos=await getDocs(query(col('photos'),where('submissionId','==',sub.id),limit(100)));if(!photos.empty){const b=writeBatch(db());photos.docs.forEach(p=>b.delete(p.ref));await b.commit();deleted+=photos.size;}}
 return deleted;
}
