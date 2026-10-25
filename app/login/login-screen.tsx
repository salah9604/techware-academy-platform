'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {GoogleAuthProvider,browserLocalPersistence,onAuthStateChanged,setPersistence,signInWithEmailAndPassword,signInWithPopup,sendPasswordResetEmail,type User} from 'firebase/auth';
import PortalGate from '../portal-gate';
import {firebaseAuth} from '../../lib/firebase-client';

function message(error:unknown){
 const code=(error as {code?:string})?.code||'';
 return ({
  'auth/unauthorized-domain':'عنوان المنصة مش مضاف في إعدادات تسجيل الدخول. تواصل مع إدارة الأكاديمية.',
  'auth/operation-not-allowed':'طريقة تسجيل الدخول غير متاحة حاليًا. تواصل مع إدارة الأكاديمية.',
  'auth/invalid-credential':'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/wrong-password':'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/user-not-found':'راجع البريد الإلكتروني أو استخدم حساب Google المرتبط بالأكاديمية.',
  'auth/invalid-email':'اكتب بريد إلكتروني صحيح.',
  'auth/user-disabled':'الحساب متوقف. تواصل مع إدارة الأكاديمية.',
  'auth/popup-closed-by-user':'تم إغلاق نافذة Google قبل اكتمال تسجيل الدخول.',
  'auth/popup-blocked':'المتصفح منع نافذة Google. اسمح بالنوافذ المنبثقة وحاول تاني.',
  'auth/network-request-failed':'تعذّر الاتصال. تأكد من الإنترنت وحاول تاني.',
  'auth/too-many-requests':'محاولات دخول كتير. جرّب بعد شوية.'
 } as Record<string,string>)[code]||'تعذّر إكمال العملية. حاول تاني أو تواصل مع إدارة الأكاديمية.';
}

export default function LoginScreen(){
 const [user,setUser]=useState<User|null>(null);
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [email,setEmail]=useState('');
 useEffect(()=>{
  try{return onAuthStateChanged(firebaseAuth(),u=>{setUser(u);setReady(true);},e=>{setError(message(e));setReady(true);});}
  catch(e){setError(message(e));setReady(true);}
 },[]);
 async function run(action:()=>Promise<unknown>){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{await action();}catch(e){setError(message(e));}
  finally{setBusy(false);}
 }
 async function emailLogin(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  const password=String(new FormData(e.currentTarget).get('password')||'');
  await run(async()=>{const auth=firebaseAuth();await setPersistence(auth,browserLocalPersistence);await signInWithEmailAndPassword(auth,email.trim(),password);});
 }
 async function googleLogin(){
  await run(async()=>{const auth=firebaseAuth();await setPersistence(auth,browserLocalPersistence);const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);});
 }
 async function resetPassword(){
  if(!email.trim()){setError('اكتب بريدك الإلكتروني الأول علشان نرسل رابط تغيير كلمة المرور.');return;}
  await run(async()=>{await sendPasswordResetEmail(firebaseAuth(),email.trim());setNotice('لو البريد مسجّل بكلمة مرور، هيصلك رابط لتغييرها. راجع البريد الوارد والرسائل غير المرغوب فيها.');});
 }
 if(ready&&user)return <PortalGate user={user}/>;
 return <main className="auth-page"><section className="auth-card">
  <div className="auth-heading"><a className="auth-brand" href="/" aria-label="Techware Academy">TECHWARE <small>ACADEMY</small></a><span className="eyebrow">منصة Techware التعليمية</span></div>
  <h1>أهلًا بيك في Techware</h1>
  <p className="auth-intro">تابع محاضراتك وتاسكاتك ومجموعتك التعليمية من مكان واحد.</p>
  {!ready?<p role="status">جاري التحقق من تسجيل الدخول…</p>:<>
   <form onSubmit={emailLogin}>
    <label className="field"><span>البريد الإلكتروني</span><input name="email" type="email" autoComplete="username" dir="ltr" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="name@example.com"/></label>
    <label className="field"><span>كلمة المرور</span><input name="password" type="password" autoComplete="current-password" dir="ltr" required placeholder="كلمة المرور"/></label>
    <button className="btn primary auth-full" type="submit" disabled={busy}>{busy?'جاري تسجيل الدخول…':'تسجيل الدخول'}</button>
   </form>
   <button className="auth-reset" type="button" disabled={busy} onClick={resetPassword}>نسيت كلمة المرور؟</button>
   <div className="auth-divider"><span>أو</span></div>
   <button className="btn auth-full auth-google" disabled={busy} onClick={googleLogin} type="button">المتابعة باستخدام Google</button>
   <p className="auth-help">أول مرة تستخدم المنصة؟ سجّل بحساب Google، ولو حسابك لسه مش مربوط بالمجموعة، هتظهر لك خطوات تفعيله مع الإدارة.</p>
  </>}
  {error&&<p role="alert" className="auth-error">{error}</p>}
  {notice&&<p role="status" className="auth-notice">{notice}</p>}
  <div className="auth-footer">Techware Academy · مساحة آمنة لمتابعة التعلّم</div>
 </section></main>;
}
