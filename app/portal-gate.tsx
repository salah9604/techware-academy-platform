'use client';
import {useEffect,useState} from 'react';
import {type User,signOut} from 'firebase/auth';
import {firebaseAuth} from '../lib/firebase-client';
import {profileFor,bootstrapAdmin,activateLegacyInstructor,portalError} from '../lib/portal-client';
import Platform from './platform';

export default function PortalGate({user}:{user:User}){
 const [state,setState]=useState<'loading'|'pending'|'ready'>('loading');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [copied,setCopied]=useState(false);
 const canBootstrapAdmin=user.email?.toLowerCase()==='techwareacademy@gmail.com'&&user.emailVerified;
 async function check(){
  setError('');
  try{
   let p=await profileFor(user.uid);
   if(!p){try{await activateLegacyInstructor(user.uid,user.displayName||user.email?.split('@')[0]||'مدرب Techware');p=await profileFor(user.uid);}catch{/* Only existing, verified instructors may activate under Firestore rules. */}}
   setState(p?.active?'ready':'pending');
  }catch(e){setState('pending');setError(portalError(e));}
 }
 useEffect(()=>{check();},[user.uid]);
 async function copyUid(){
  try{await navigator.clipboard.writeText(user.uid);setCopied(true);}
  catch{setError('تعذّر نسخ رقم الحساب. اضغط عليه مطولًا للنسخ.');}
 }
 if(state==='ready')return <Platform liveUid={user.uid}/>;
 return <main className="auth-page"><section className="auth-card">
  <a className="auth-brand" href="/">TECHWARE <small>ACADEMY</small></a>
  {state==='loading'?<><h1>جاري تجهيز حسابك…</h1><p role="status">بنتحقق من صلاحية دخولك للمجموعات والمحاضرات.</p></>:<>
   <h1>حسابك في انتظار التفعيل</h1>
   <p className="auth-intro">تم تسجيل الدخول بنجاح، لكن حسابك لسه محتاج يتربط ببياناتك في الأكاديمية. ابعت رقم الحساب التالي للإدارة لتفعيله.</p>
   <label className="field"><span>رقم حسابك</span><code className="auth-uid" dir="ltr">{user.uid}</code></label>
   <button className="btn primary auth-full" disabled={busy} onClick={copyUid}>{copied?'تم نسخ رقم الحساب':'نسخ رقم الحساب'}</button>
   <p className="auth-help">بعد ما الإدارة تفعّل حسابك وتربطه بالمجموعة، اضغط «التحقق من التفعيل» للدخول.</p>
   <button className="btn auth-full" disabled={busy} onClick={check}>التحقق من التفعيل</button>
   {canBootstrapAdmin&&<details className="auth-admin-setup"><summary>إعداد حساب إدارة الأكاديمية</summary><p>تفعيل حساب الإدارة الرسمي لأول مرة.</p><button className="btn" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await bootstrapAdmin(user.uid,user.displayName||'إدارة Techware');await check();}catch(e){setError(portalError(e));}finally{setBusy(false);}}}>تفعيل الإدارة</button></details>}
  </>}
  {error&&<p role="alert" className="auth-error">{error}</p>}
  <button className="btn subtle auth-full" disabled={busy} onClick={()=>signOut(firebaseAuth())}>تسجيل الخروج</button>
 </section></main>;
}
