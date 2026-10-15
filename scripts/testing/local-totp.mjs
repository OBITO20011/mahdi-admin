// Disposable local test factors only. Never log a TOTP secret or URI.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
export function localTotp(secret,now=Date.now()){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';
 for(const c of secret.toUpperCase().replace(/=+$/u,'')){const n=alphabet.indexOf(c);assert.ok(n>=0,'INVALID_LOCAL_TOTP_BASE32');bits+=n.toString(2).padStart(5,'0');}
 const bytes=[];for(let n=0;n+8<=bits.length;n+=8)bytes.push(Number.parseInt(bits.slice(n,n+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(now/30000)));
 const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),at=digest[digest.length-1]&15;
 return String((digest.readUInt32BE(at)&0x7fffffff)%1000000).padStart(6,'0');
}
