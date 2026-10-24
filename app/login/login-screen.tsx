'use client';
import {useEffect,useState} from 'react';
import {GoogleAuthProvider,browserSessionPersistence,onAuthStateChanged,setPersistence,signInWithEmailAndPassword,signInWithPopup,signOut,type User} from 'firebase/auth';
import PortalGate from '../portal-gate';
import {firebaseAuth} from '../../lib/firebase-client';
function message(error:unknown){const code=(error as {code?:string})?.code||'';return ({
 'auth/unauthorized-domain':'عنوان الموقع غير مسموح له بتسجيل الدخول. أضف localhost في Authorized domains من إعدادات Firebase Authentication.',
 'auth/operation-not-allowed':'طريقة تسجيل الدخول دي مش مفعّلة في مشروع Firebase. فعّل Email/Password أو Google من Authentication.',
 'auth/invalid-credential':'راجع البريد الإلكتروني وكلمة المرور.',
 'auth/user-disabled':'الحساب موقوف. تواصل مع إدارة الأكاديمية.',
 'auth/popup-closed-by-user':'نافذة تسجيل الدخول اتقفلت قبل اكتمال الدخول.',
 'auth/popup-blocked':'المتصفح منع نافذة Google. اسمح بالنوافذ المنبثقة وجرب تاني.',
 'auth/network-request-failed':'تعذّر الاتصال. راجع الإنترنت وجرب تاني.',
 'auth/too-many-requests':'محاولات كتير في وقت قصير. انتظر شوية وجرب تاني.'
} as Record<string,string>)[code]||'تعذّر تسجيل الدخول'+(code?' ('+code+')':'');}
export default function LoginScreen(){const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{try{return onAuthStateChanged(firebaseAuth(),u=>{setUser(u);setReady(true);},e=>{setError(message(e));setReady(true);});}catch(e){setError(message(e));setReady(true);}},[]);
 async function run(action:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError(message(e));}finally{setBusy(false);}}
 async function emailLogin(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget),email=String(f.get('email')||'').trim(),password=String(f.get('password')||'');await run(async()=>{const auth=firebaseAuth();await setPersistence(auth,browserSessionPersistence);await signInWithEmailAndPassword(auth,email,password);});}
 if(ready&&user)return <PortalGate user={user}/>;
 return <main className="auth-page"><section className="auth-card"><a className="auth-brand" href="/">TECHWARE <small>ACADEMY</small></a><p className="eyebrow">مساحة التعلّم والمتابعة</p>{!ready?<p role="status">جاري التحقق من تسجيل الدخول…</p>:user?<><h1>تم تسجيل الدخول</h1><p>أهلًا {user.displayName||'بيك'}</p><p dir="ltr">{user.email}</p><div className="feedback">حسابك متصل بـFirebase. تفعيل الوصول لمجموعاتك وتاسكاتك لسه منتظر ربط الصلاحيات وبيانات الأكاديمية.</div><p>رقم الحساب لاستخدام الإدارة في الربط:</p><code className="auth-uid" dir="ltr">{user.uid}</code><button className="btn" disabled={busy} onClick={()=>run(()=>signOut(firebaseAuth()))}>تسجيل الخروج</button></>:<><h1>تسجيل الدخول</h1><p>استخدم حسابك المسجل لدى الأكاديمية.</p><form onSubmit={emailLogin}><label className="field"><span>البريد الإلكتروني</span><input name="email" type="email" autoComplete="username" required dir="ltr"/></label><label className="field"><span>كلمة المرور</span><input name="password" type="password" autoComplete="current-password" required dir="ltr"/></label><button className="btn primary" disabled={busy} type="submit">{busy?'جاري الدخول…':'دخول'}</button></form><button className="btn" disabled={busy} onClick={()=>run(async()=>{const auth=firebaseAuth();await setPersistence(auth,browserSessionPersistence);const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);})}>المتابعة باستخدام Google</button></>}{error&&<p role="alert" className="auth-error">{error}</p>}<hr/><a href="/demo">فتح تجربة المنصة ببيانات توضيحية</a><small className="block">التجربة منفصلة عن حسابك وبيانات الأكاديمية.</small></section></main>;
}
