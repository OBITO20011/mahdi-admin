/**
 * Nawasrah ERP - real staff account form.
 * Authentication identity creation stays in the protected Edge Function;
 * profile and role changes are committed by owner-only PostgreSQL RPCs.
 */

import React, { useState } from 'react';
import { Check, LockKeyhole, Shield, UserRound } from 'lucide-react';
import { ROLE_PERMISSIONS_MAP } from '../../constants';
import { Branch, Role, User } from '../../types';
import {
  createStaffAccount,
  getAssignableRoles,
  StaffAccountInput,
  updateStaffAccount,
} from '../../services/supabase/staffAccounts.service';

interface UserFormModalProps {
  initialUser?: User;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const roleLabels: Record<Role, string> = {
  Owner: 'مالك النظام',
  Admin: 'مدير تنفيذي',
  Accountant: 'محاسب',
  Cashier: 'كاشير',
  'Sales Employee': 'موظف مبيعات',
  'Warehouse Employee': 'مسؤول مستودع',
  'Orders Employee': 'متابع الطلبات',
  'Delivery Driver': 'سائق توصيل',
  'View Only': 'مشاهدة فقط',
};

const defaultRole: Role = 'Cashier';

export const UserFormModal: React.FC<UserFormModalProps> = ({
  initialUser,
  branches,
  onClose,
  onSaved,
}) => {
  const isEditing = Boolean(initialUser?.id);
  const [name, setName] = useState(initialUser?.name || '');
  const [email, setEmail] = useState(initialUser?.email || '');
  const [phone, setPhone] = useState(initialUser?.phone || '');
  const [jobTitle, setJobTitle] = useState(initialUser?.jobTitle || '');
  const [role, setRole] = useState<Role>(initialUser?.role || defaultRole);
  const [branchId, setBranchId] = useState(initialUser?.branchId || branches[0]?.id || '');
  const [password, setPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const input: StaffAccountInput = {
      fullName: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      jobTitle: jobTitle.trim(),
      branchId: branchId || undefined,
      role,
      password,
    };

    if (!input.fullName) {
      setError('اكتب اسم الموظف أولاً.');
      return;
    }
    if (!isEditing && !input.email) {
      setError('البريد الإلكتروني مطلوب لإنشاء حساب الدخول.');
      return;
    }
    if (!isEditing && !password) {
      setError('أدخل كلمة مرور مؤقتة للموظف.');
      return;
    }
    if (role === 'Owner' && !window.confirm(
      isEditing
        ? 'هل أنت متأكد من منح هذا الحساب صلاحية مالك النظام الكاملة؟'
        : 'هل أنت متأكد من إنشاء مالك نظام إضافي؟ سيكون له كامل الصلاحيات، بما فيها إدارة المستخدمين.',
    )) {
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing && initialUser) {
        await updateStaffAccount(initialUser.id, input);
      } else {
        await createStaffAccount(input);
      }
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'تعذر حفظ بيانات الموظف.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const currentRolePermissions = ROLE_PERMISSIONS_MAP[role] || [];

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3 text-xs" dir="rtl">
      {error && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-[11px] font-bold text-red-200">
          {error}
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-[11px] font-bold text-slate-300">اسم الموظف الكامل *</label>
        <input
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="مثال: أحمد النواصرة"
          maxLength={120}
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-slate-300">رقم الهاتف</label>
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="079XXXXXXX"
            maxLength={24}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-slate-100 outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-slate-300">البريد الإلكتروني *</label>
          <input
            type="email"
            required={!isEditing}
            disabled={isEditing}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="employee@nawasrah.jo"
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-slate-100 outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {isEditing && (
            <p className="text-[9px] text-slate-500">تعديل البريد يتم من الدعم بعد التحقق من هوية الموظف.</p>
          )}
        </div>
      </div>

      {!isEditing && (
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-[11px] font-bold text-slate-300">
            <LockKeyhole className="h-3.5 w-3.5 text-amber-300" />
            كلمة المرور المؤقتة *
          </label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="10 أحرف على الأقل، تشمل حرفًا ورقمًا"
            minLength={10}
            maxLength={128}
            className="w-full rounded-xl border border-amber-500/30 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400"
          />
          <p className="text-[9px] leading-4 text-slate-500">
            لا تُحفظ كلمة المرور في ملف الموظف أو سجل التدقيق. سلّمها للموظف بطريقة آمنة.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-slate-300">المسمى الوظيفي</label>
          <input
            type="text"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            placeholder="مثال: أمين مستودع"
            maxLength={120}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-slate-300">الفرع التابع له</label>
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2 text-slate-100 outline-none focus:border-blue-500"
          >
            <option value="">بدون فرع محدد</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-300">
          <Shield className="h-3.5 w-3.5 text-blue-300" />
          الدور والصلاحيات *
        </label>
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-bold text-blue-300 outline-none focus:border-blue-500"
        >
          {getAssignableRoles().map((option) => (
            <option key={option} value={option}>
              {roleLabels[option]}
            </option>
          ))}
        </select>
        <p className="text-[9px] leading-4 text-slate-500">
          مالك النظام يمتلك كل الصلاحيات. لا تُنشئه إلا لشخص تثق به تمامًا.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
        <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
          <UserRound className="h-3.5 w-3.5" />
          الصلاحيات الممنوحة تلقائيًا ({currentRolePermissions.length})
        </span>
        <div className="mt-2 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
          {currentRolePermissions.map((permission) => (
            <span key={permission} className="rounded-full border border-blue-500/30 bg-blue-600/15 px-2 py-0.5 font-mono text-[9px] text-blue-200">
              {permission}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={isSaving}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          <span>{isSaving ? 'جارٍ الحفظ...' : isEditing ? 'حفظ التعديلات' : 'إنشاء حساب الموظف'}</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 transition hover:bg-slate-700 disabled:opacity-60"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};
