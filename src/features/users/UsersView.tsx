/** Owner-only staff accounts and permission management. */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  History,
  KeyRound,
  LoaderCircle,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { Role, User } from '../../types';
import {
  branchNameForStaffAccount,
  fetchStaffAccounts,
  fetchStaffAuditRecords,
  setStaffAccountActive,
  setStaffAccountPassword,
  StaffAuditRecord,
} from '../../services/supabase/staffAccounts.service';
import { UserFormModal } from './UserFormModal';

const roleLabels: Record<Role, string> = {
  Owner: 'المالك',
  Admin: 'مدير تنفيذي',
  Accountant: 'محاسب',
  Cashier: 'كاشير',
  'Sales Employee': 'موظف مبيعات',
  'Warehouse Employee': 'مسؤول مستودع',
  'Orders Employee': 'متابع الطلبات',
  'Delivery Driver': 'سائق توصيل',
  'View Only': 'مشاهدة فقط',
};

const dateFormatter = new Intl.DateTimeFormat('ar-JO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function getAuditDetails(record: StaffAuditRecord): string {
  const details = record.details || {};
  const name = typeof details.full_name === 'string' ? details.full_name : null;
  const role = typeof details.role_code === 'string' ? details.role_code : null;
  const enabled = typeof details.is_active === 'boolean' ? details.is_active : null;
  const fragments = [name, role ? `الدور: ${role}` : null];
  if (enabled !== null) fragments.push(enabled ? 'الحالة: مفعّل' : 'الحالة: معطّل');
  return fragments.filter(Boolean).join(' · ') || 'تم حفظ العملية في سجل الأمان.';
}

export const UsersView: React.FC = () => {
  const { branches } = useAppStore();
  const { roleName } = useAuthStore();
  const isOwner = roleName === 'owner';
  const [staff, setStaff] = useState<User[]>([]);
  const [audits, setAudits] = useState<StaffAuditRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isOwner) return;
    setIsLoading(true);
    setError(null);
    try {
      const [accounts, records] = await Promise.all([
        fetchStaffAccounts(),
        fetchStaffAuditRecords(),
      ]);
      setStaff(accounts);
      setAudits(records);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل حسابات الموظفين.');
    } finally {
      setIsLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('ar');
    return staff.filter((user) => {
      const matchesSearch = !query || [user.name, user.email, user.phone]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase('ar').includes(query));
      return matchesSearch && (roleFilter === 'all' || user.role === roleFilter);
    });
  }, [roleFilter, searchQuery, staff]);

  const handleAccountState = async (user: User) => {
    const nextState = !user.isActive;
    const approved = window.confirm(
      nextState
        ? `هل تريد تفعيل حساب ${user.name}؟`
        : `هل أنت متأكد من تعطيل حساب ${user.name}؟ لن يتمكن من تنفيذ أي عملية بعد التعطيل.`,
    );
    if (!approved) return;

    setPendingUserId(user.id);
    setError(null);
    try {
      await setStaffAccountActive(user.id, nextState);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'تعذر تحديث حالة الحساب.');
    } finally {
      setPendingUserId(null);
    }
  };

  const handlePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordTarget) return;
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('كلمة المرور يجب أن تكون 10 أحرف على الأقل وتشمل حرفًا ورقمًا.');
      return;
    }

    setIsSavingPassword(true);
    setError(null);
    try {
      await setStaffAccountPassword(passwordTarget.id, newPassword);
      setPasswordTarget(null);
      setNewPassword('');
      await refresh();
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : 'تعذر تغيير كلمة المرور.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (!isOwner) {
    return (
      <div dir="rtl" className="mx-auto max-w-lg p-4 pb-28">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-950/25 p-5 text-center">
          <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-amber-300" />
          <h2 className="text-sm font-black text-amber-100">هذه الشاشة للمالك فقط</h2>
          <p className="mt-1 text-[11px] leading-5 text-amber-200/70">
            إنشاء حسابات الموظفين وتغيير أدوارهم عملية حساسة لا تظهر إلا لمالك النظام.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-3 p-3 pb-28 sm:p-4">
      <header className="flex items-start justify-between gap-3 px-1 pt-1">
        <div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            <h2 className="text-base font-black text-slate-100">المستخدمون والصلاحيات</h2>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            أنشئ حساب الموظف وحدد دوره وفرعه من مكان واحد آمن.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingUser(null);
            setIsFormOpen(true);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-blue-950/30 transition hover:bg-blue-500 active:scale-95"
        >
          <Plus className="h-4 w-4" />
          إضافة موظف
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-950/35 p-3 text-[11px] font-bold text-red-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-black transition ${
            activeTab === 'users' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          فريق العمل ({staff.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-black transition ${
            activeTab === 'audit' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          سجل الأمان ({audits.length})
        </button>
      </div>

      {activeTab === 'users' ? (
        <section className="space-y-3">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="ابحث بالاسم أو البريد أو الهاتف"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pr-9 pl-3 text-xs text-slate-100 outline-none focus:border-blue-500"
              />
            </label>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as 'all' | Role)}
              className="max-w-32 rounded-xl border border-slate-800 bg-slate-950 px-2 text-[10px] font-bold text-slate-200 outline-none focus:border-blue-500"
            >
              <option value="all">كل الأدوار</option>
              {(Object.keys(roleLabels) as Role[]).map((role) => (
                <option key={role} value={role}>{roleLabels[role]}</option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <div className="flex justify-center rounded-2xl border border-slate-800 bg-slate-900/70 p-10">
              <LoaderCircle className="h-6 w-6 animate-spin text-blue-400" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
              <Users className="mx-auto mb-2 h-7 w-7 text-slate-500" />
              <h3 className="text-xs font-black text-slate-200">لا توجد حسابات مطابقة</h3>
              <p className="mt-1 text-[10px] text-slate-500">أضف الموظف الأول أو غيّر البحث.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => {
                const isProtectedOwner = user.role === 'Owner';
                const isPending = pendingUserId === user.id;
                return (
                  <article
                    key={user.id}
                    className={`rounded-2xl border bg-slate-900/75 p-3 transition ${
                      user.isActive ? 'border-slate-800' : 'border-red-900/50 opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-500/25 bg-blue-500/10 text-sm font-black text-blue-200">
                          {user.name.trim().slice(0, 1) || 'م'}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="truncate text-xs font-black text-slate-100">{user.name}</h3>
                            <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold text-blue-200">
                              {roleLabels[user.role]}
                            </span>
                            {!user.isActive && (
                              <span className="rounded-full border border-red-500/25 bg-red-950/30 px-2 py-0.5 text-[9px] font-bold text-red-200">معطّل</span>
                            )}
                          </div>
                          <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{user.email || 'بريد غير متوفر'}</p>
                          <p className="mt-0.5 truncate text-[9px] text-slate-500">
                            {user.phone || 'بدون هاتف'} · {branchNameForStaffAccount(user, branches)}{user.jobTitle ? ` · ${user.jobTitle}` : ''}
                          </p>
                        </div>
                      </div>

                      {!isProtectedOwner && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUser(user);
                              setIsFormOpen(true);
                            }}
                            className="rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-slate-300 transition hover:bg-slate-800"
                            title="تعديل بيانات الموظف"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNewPassword('');
                              setPasswordTarget(user);
                            }}
                            className="rounded-lg border border-amber-500/25 bg-amber-950/20 p-1.5 text-amber-300 transition hover:bg-amber-950/45"
                            title="تغيير كلمة المرور"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleAccountState(user)}
                            disabled={isPending}
                            className={`rounded-lg border p-1.5 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              user.isActive
                                ? 'border-red-500/25 bg-red-950/20 text-red-300 hover:bg-red-950/45'
                                : 'border-emerald-500/25 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/45'
                            }`}
                            title={user.isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                          >
                            {isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : user.isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                    {isProtectedOwner && (
                      <p className="mt-2 rounded-lg border border-amber-500/15 bg-amber-500/5 px-2 py-1.5 text-[9px] text-amber-200/80">
                        حساب المالك محمي؛ لا يمكن تغييره أو تعطيله أو إعادة كلمة مروره من هذه الشاشة.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          {isLoading ? (
            <div className="flex justify-center rounded-2xl border border-slate-800 bg-slate-900/70 p-10">
              <LoaderCircle className="h-6 w-6 animate-spin text-blue-400" />
            </div>
          ) : audits.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-[11px] text-slate-500">
              لا توجد عمليات إدارة موظفين مسجلة بعد.
            </div>
          ) : audits.map((record) => (
            <article key={record.id} className="rounded-xl border border-slate-800 bg-slate-900/75 p-3">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-[11px] text-blue-200">{record.actorName}</strong>
                <time className="text-[9px] text-slate-500">{dateFormatter.format(new Date(record.createdAt))}</time>
              </div>
              <p className="mt-1 text-xs font-black text-slate-100">{record.action}</p>
              <p className="mt-1 text-[10px] text-slate-400">{getAuditDetails(record)}</p>
            </article>
          ))}
        </section>
      )}

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingUser ? 'تعديل بيانات موظف' : 'إضافة موظف جديد'}
        subtitle="حساب دخول حقيقي مرتبط بالدور والفرع في قاعدة البيانات"
      >
        <UserFormModal
          initialUser={editingUser || undefined}
          branches={branches}
          onClose={() => setIsFormOpen(false)}
          onSaved={refresh}
        />
      </Modal>

      <Modal
        isOpen={Boolean(passwordTarget)}
        onClose={() => {
          if (!isSavingPassword) setPasswordTarget(null);
        }}
        title="تغيير كلمة مرور الموظف"
        subtitle="لا تُحفظ كلمة المرور في النظام؛ سلّمها للموظف بطريقة آمنة"
      >
        <form onSubmit={(event) => void handlePasswordReset(event)} className="space-y-3 text-xs" dir="rtl">
          <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-100">
            الحساب: <strong>{passwordTarget?.name}</strong>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-slate-300">كلمة المرور الجديدة</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="10 أحرف على الأقل، تشمل حرفًا ورقمًا"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={isSavingPassword} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-amber-500 py-2.5 text-xs font-black text-slate-950 transition hover:bg-amber-400 disabled:opacity-60">
              {isSavingPassword ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {isSavingPassword ? 'جارٍ التغيير...' : 'تغيير كلمة المرور'}
            </button>
            <button type="button" disabled={isSavingPassword} onClick={() => setPasswordTarget(null)} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300">إلغاء</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
