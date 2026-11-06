import {credentialHealth} from './waitlist.js';

// Exposes only a categorical configuration state. No keys, credentials,
// Google Sheet rows, user identifiers, or environment values are returned.
export async function GET():Promise<Response>{
 const status=await credentialHealth();
 return new Response(JSON.stringify({serviceAccountStatus:status}),{
  status:200,
  headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
 });
}
