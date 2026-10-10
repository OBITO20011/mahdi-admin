import {Card, FormFields, UiButton} from '../../components/ui';
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
    <FormFields className="nw-batch5-fields"><form onSubmit={(event) => void handleSubmit(event)} aria-busy={isSaving} className="space-y-4 text-sm" dir="rtl">
      {error && (
        <div role="alert" className="rounded-xl border border-nw-bad bg-nw-bad-bg px-3 py-2 text-xs font-bold text-nw-bad">
          {error}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="staff-name" className="block text-xs font-bold text-nw-text">اسم الموظف الكامل *</label>
        <input
          type="text"
          id="staff-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="مثال: أحمد النواصرة"
          maxLength={120}
          className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2 text-nw-text outline-none focus:border-nw-primary"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="staff-phone" className="block text-xs font-bold text-nw-text">رقم الهاتف</label>
          <input
            type="tel"
            id="staff-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="079XXXXXXX"
            maxLength={24}
            className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2 font-mono text-nw-text outline-none focus:border-nw-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="staff-email" className="block text-xs font-bold text-nw-text">البريد الإلكتروني *</label>
          <input
            type="email"
            id="staff-email"
            dir="ltr"
            required={!isEditing}
            disabled={isEditing}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="employee@nawasrah.jo"
            className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2 font-mono text-nw-text outline-none focus:border-nw-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
          {isEditing && (
            <p className="text-xs text-nw-muted">تعديل البريد يتم من الدعم بعد التحقق من هوية الموظف.</p>
          )}
        </div>
      </div>

      {!isEditing && (
        <div className="space-y-1">
          <label htmlFor="staff-password" className="flex items-center gap-1 text-xs font-bold text-nw-text">
            <LockKeyhole className="h-3.5 w-3.5 text-nw-warn" />
            كلمة المرور المؤقتة *
          </label>
          <input
            type="password"
            id="staff-password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="10 أحرف على الأقل، تشمل حرفًا ورقمًا"
            minLength={10}
            maxLength={128}
            className="w-full rounded-xl border border-nw-warn bg-nw-surface-2 px-3 py-2 text-nw-text outline-none focus:border-nw-primary"
          />
          <p className="text-xs leading-4 text-nw-muted">
            لا تُحفظ كلمة المرور في ملف الموظف أو سجل التدقيق. سلّمها للموظف بطريقة آمنة.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="staff-job" className="block text-xs font-bold text-nw-text">المسمى الوظيفي</label>
          <input
            type="text"
            id="staff-job"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            placeholder="مثال: أمين مستودع"
            maxLength={120}
            className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2 text-nw-text outline-none focus:border-nw-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="staff-branch" className="block text-xs font-bold text-nw-text">الفرع التابع له</label>
          <select
            id="staff-branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2.5 py-2 text-nw-text outline-none focus:border-nw-primary"
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
        <label htmlFor="staff-role" className="flex items-center gap-1 text-xs font-bold text-nw-text">
          <Shield className="h-3.5 w-3.5 text-nw-info" />
          الدور والصلاحيات *
        </label>
        <select
          id="staff-role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2 font-bold text-nw-info outline-none focus:border-nw-primary"
        >
          {getAssignableRoles().map((option) => (
            <option key={option} value={option}>
              {roleLabels[option]}
            </option>
          ))}
        </select>
        <p className="text-xs leading-4 text-nw-muted">
          مالك النظام يمتلك كل الصلاحيات. لا تُنشئه إلا لشخص تثق به تمامًا.
        </p>
      </div>

      <Card>
        <span className="flex items-center gap-1 text-xs font-bold text-nw-muted">
          <UserRound className="h-3.5 w-3.5" />
          الصلاحيات الممنوحة تلقائيًا ({currentRolePermissions.length})
        </span>
        <div className="mt-2 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
          {currentRolePermissions.map((permission) => (
            <span key={permission} className="max-w-full break-all rounded-full border border-nw-info bg-nw-info-bg px-2 py-0.5 font-mono text-xs text-nw-info">
              {permission}
            </span>
          ))}
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 flex gap-2 bg-nw-surface py-2">
        <UiButton variant="plain"
          type="submit"
          disabled={isSaving}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-nw-primary py-2.5 text-xs font-bold text-nw-on-primary transition hover:bg-nw-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          <span>{isSaving ? 'جارٍ الحفظ...' : isEditing ? 'حفظ التعديلات' : 'إنشاء حساب الموظف'}</span>
        </UiButton>
        <UiButton variant="plain"
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="rounded-xl bg-nw-surface px-4 py-2.5 text-xs font-bold text-nw-text transition hover:bg-nw-mute-bg disabled:opacity-60"
        >
          إلغاء
        </UiButton>
      </div>
    </form></FormFields>
  );
};
