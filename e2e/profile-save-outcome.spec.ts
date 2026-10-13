import {test,expect} from './isolated-test';

for(const theme of ['light','dark']) test(`profile ${theme}: saved with missing email refreshes account without confirmation claim`,async({page})=>{
  await page.setViewportSize({width:390,height:900});
  const writes:Array<{name:string;payload:unknown}>=[];
  const reads:string[]=[];
  await page.route('**/rest/v1/rpc/update_my_erp_profile',async route=>{
    writes.push({name:'update_my_erp_profile',payload:route.request().postDataJSON()});
    await route.fulfill({json:{success:true}});
  });
  await page.route('**/rest/v1/profiles?**',async route=>{
    reads.push('profiles');await route.fulfill({json:{id:'more-fixture-user',full_name:'اسم محفوظ',phone:'0790000000',avatar_url:'',branch_id:'more-fixture-branch',job_title:'مدير المحل',is_active:true}});
  });
  await page.route('**/rest/v1/user_roles?**',async route=>{
    reads.push('user_roles');await route.fulfill({json:[{role_id:'fixture-owner',roles:{id:'fixture-owner',name_ar:'المالك',code:'owner'}}]});
  });
  await page.goto(`/e2e/package-f-more-harness.html?theme=${theme}&view=profile`);
  await page.evaluate(async()=>{
    const path='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */path);
    const calls:unknown[]=[];
    (window as typeof window & {profileAuthCalls:unknown[]}).profileAuthCalls=calls;
    const user={id:'more-fixture-user',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-13T00:00:00Z'};
    supabase.auth.getUser=async()=>({data:{user:{...user,email:'fixture@example.invalid'}},error:null});
    supabase.auth.updateUser=async(payload:unknown)=>{calls.push(payload);return {data:{user},error:null};};
    supabase.auth.getSession=async()=>({data:{session:{access_token:'local-fixture',refresh_token:'local-fixture',token_type:'bearer',expires_in:3600,user:{...user,email:'fixture@example.invalid'}}},error:null});
  });
  const dialog=page.getByRole('dialog',{name:'الملف الشخصي وإعدادات الحساب',exact:true});
  await dialog.getByRole('button',{name:'تعديل البيانات',exact:true}).click();
  await dialog.getByLabel('الاسم الكامل *',{exact:true}).fill('اسم محفوظ');
  await dialog.getByLabel('البريد الإلكتروني *',{exact:true}).fill('new@example.invalid');
  await dialog.getByRole('button',{name:'حفظ التعديلات',exact:true}).click();
  await expect(page.getByText('تم الحفظ؛ تعذر التحقق من حالة تأكيد البريد.',{exact:true})).toBeVisible();
  await expect(dialog.getByText('اسم محفوظ',{exact:true}).first()).toBeVisible();
  await expect(dialog.getByRole('button',{name:'تعديل البيانات',exact:true})).toBeVisible();
  expect(reads).toEqual(['profiles','user_roles']);
  expect(writes).toEqual([{name:'update_my_erp_profile',payload:{p_full_name:'اسم محفوظ',p_phone:'0790000000',p_avatar_url:null}}]);
  expect(await page.evaluate(()=>(window as typeof window & {profileAuthCalls:unknown[]}).profileAuthCalls)).toEqual([
    {email:'new@example.invalid',data:{language:'ar',timezone:'Asia/Amman',address:'الرمثا — وسط البلد',whatsapp:'0790000000'}}
  ]);
  await expect(page.getByText(/أرسل Supabase رسالة لتأكيد البريد/)).toHaveCount(0);
});
