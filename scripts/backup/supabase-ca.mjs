import {readFileSync} from 'node:fs';
import {X509Certificate,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {classifiedError} from './postgres-diagnostic.mjs';
export const SUPABASE_CA_PATH=fileURLToPath(new URL('./certs/supabase-root-2021.crt',import.meta.url));
export const SUPABASE_CA_SHA256='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
export const SUPABASE_CA_DER_SHA256='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
export function verifiedSupabaseCa(){
  let pem;
  try{pem=readFileSync(SUPABASE_CA_PATH,'utf8').replaceAll('\r\n','\n');}
  catch{throw classifiedError('TLS_ROOT_CERT_MISSING',{tool:'filesystem',stage:'tls-config'});}
  try{
    const cert=new X509Certificate(pem),now=Date.now();
    if(createHash('sha256').update(pem).digest('hex')!==SUPABASE_CA_SHA256
      ||createHash('sha256').update(cert.raw).digest('hex')!==SUPABASE_CA_DER_SHA256
      ||!cert.ca||!cert.verify(cert.publicKey)||Date.parse(cert.validFrom)>now||Date.parse(cert.validTo)<=now)throw new Error();
    return {path:SUPABASE_CA_PATH,sha256:SUPABASE_CA_SHA256,derSha256:SUPABASE_CA_DER_SHA256,subject:'Supabase Root 2021 CA',expiresAt:'2031-04-26T10:56:53.000Z'};
  }catch{throw classifiedError('TLS_CA_BUNDLE_INVALID',{tool:'filesystem',stage:'tls-config'});}
}
