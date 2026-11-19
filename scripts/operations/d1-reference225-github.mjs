// Public GitHub metadata only; persist no response, headers, message, cause or credentials.
const diagnostics=new WeakMap();
const failureCode='D1_CI_UNVERIFIED_MANUAL_REVIEW_REQUIRED';
const allowedRoute=route=>route==='git/ref/heads/main'
 ||/^actions\/runs\?head_sha=[a-f0-9]{40}&per_page=(?:50|100)&page=[1-9]\d*$/u.test(route)
 ||/^actions\/runs\/[1-9]\d*\/jobs\?filter=latest&per_page=(?:50|100)&page=[1-9]\d*$/u.test(route);
const networkClass=error=>['TimeoutError','AbortError','TypeError'].includes(error?.name)?error.name:'NetworkError';
function failure(route,httpStatus,error){
 const safe=httpStatus===null?{route,networkErrorClass:networkClass(error)}:{route,httpStatus};
 const result=new Error(failureCode);
 diagnostics.set(result,Object.freeze(safe));
 return result;
}
/** Return only metadata minted here, never arbitrary error properties. */
export function d1GithubDiagnostic(error){
 const value=error instanceof Error?diagnostics.get(error):null;
 return value?{...value}:null;
}
/** @param {string} route @param {{fetch?:typeof globalThis.fetch}} [dependencies] */
export async function readD1Github225(route,{fetch:fetcher=globalThis.fetch}={}){
 if(typeof route!=='string'||!allowedRoute(route))throw new Error('D1_GITHUB_ROUTE_REFUSED');
 let httpStatus=null;
 try{
  const response=await fetcher('https://api.github.com/repos/OBITO20011/mahdi-admin/'+route,{
   headers:{Accept:'application/vnd.github+json','User-Agent':'Nawasrah-D1-reference-kit'},
   signal:AbortSignal.timeout(30000),
  });
  if(Number.isInteger(response.status)&&response.status>=100&&response.status<=599)httpStatus=response.status;
  if(!response.ok)throw failure(route,httpStatus,null);
  return await response.json();
 }catch(error){
  if(diagnostics.has(error))throw error;
  throw failure(route,httpStatus,error);
 }
}
