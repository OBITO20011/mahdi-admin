import {Card, FormFields, UiButton, formatUiDate} from '../../components/ui';
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
  Users,
  XCircle,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAppStoreSelector } from '../../stores/useAppStore';
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
  const branches = useAppStoreSelector((state) => state.branches);
  const { roleName, user: authenticatedUser } = useAuthStore();
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
        <Card className="text-center">
          <ShieldAlert className="mx-auto mb-2 h-11 w-11 text-nw-warn" />
          <h2 className="text-sm font-black text-nw-warn">هذه الشاشة للمالك فقط</h2>
          <p className="mt-1 text-xs leading-5 text-nw-warn">
            إنشاء حسابات الموظفين وتغيير أدوارهم عملية حساسة لا تظهر إلا لمالك النظام.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <FormFields dir="rtl" data-testid="users-screen" className="nw-batch5-fields mx-auto max-w-6xl space-y-4 p-4 pb-28 text-nw-text sm:p-6">
      <header className="flex items-start justify-between gap-3 px-1 pt-1">
        <div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-nw-ok" />
            <h1 className="text-[22px] font-bold text-nw-text">المستخدمون والصلاحيات</h1>
          </div>
          <p className="mt-1 text-xs text-nw-muted">
            أنشئ حساب الموظف أو مالك نظام إضافيًا وحدد دوره وفرعه من مكان واحد آمن.
          </p>
        </div>
        <UiButton variant="plain"
          type="button"
          onClick={() => {
            setEditingUser(null);
            setIsFormOpen(true);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-nw-primary px-3 py-2 text-xs font-black text-nw-on-primary shadow-lg  transition hover:bg-nw-primary active:scale-95"
        >
          <Plus className="h-4 w-4" />
          إضافة مستخدم
        </UiButton>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-nw-bad bg-nw-bad-bg p-3 text-xs font-bold text-nw-bad">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex rounded-xl border border-nw-border bg-nw-surface-2 p-1">
        <UiButton variant="plain"
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-black transition ${
            activeTab === 'users' ? 'bg-nw-primary text-nw-on-primary' : 'text-nw-muted hover:text-nw-text'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          فريق العمل ({staff.length})
        </UiButton>
        <UiButton variant="plain"
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-black transition ${
            activeTab === 'audit' ? 'bg-nw-primary text-nw-on-primary' : 'text-nw-muted hover:text-nw-text'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          سجل الأمان ({audits.length})
        </UiButton>
      </div>

      {activeTab === 'users' ? (
        <section className="space-y-3">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute right-3 top-2.5 h-3.5 w-3.5 text-nw-muted" />
              <input
                type="search"
                aria-label="البحث عن الموظفين"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="ابحث بالاسم أو البريد أو الهاتف"
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 py-2 pr-9 pl-3 text-xs text-nw-text outline-none focus:border-nw-primary"
              />
            </label>
            <select
              value={roleFilter}
              aria-label="تصفية حسب الدور"
              onChange={(event) => setRoleFilter(event.target.value as 'all' | Role)}
              className="max-w-32 rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-xs font-bold text-nw-text outline-none focus:border-nw-primary"
            >
              <option value="all">كل الأدوار</option>
              {(Object.keys(roleLabels) as Role[]).map((role) => (
                <option key={role} value={role}>{roleLabels[role]}</option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <div className="flex justify-center rounded-2xl border border-nw-border bg-nw-surface p-10">
              <LoaderCircle className="h-6 w-6 animate-spin text-nw-info" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-nw-border bg-nw-surface p-8 text-center">
              <Users className="mx-auto mb-2 h-7 w-7 text-nw-muted" />
              <h3 className="text-xs font-black text-nw-text">لا توجد حسابات مطابقة</h3>
              <p className="mt-1 text-xs text-nw-muted">أضف الموظف الأول أو غيّر البحث.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => {
                const isSystemOwner = user.role === 'Owner';
                const isCurrentAccount = user.id === authenticatedUser?.id;
                const isPending = pendingUserId === user.id;
                return (
                  <Card padded={false} role="article"
                    key={user.id}
                    className={`rounded-2xl border bg-nw-surface p-3 transition ${
                      user.isActive ? 'border-nw-border' : 'border-nw-bad '
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-nw-info bg-nw-info-bg text-sm font-black text-nw-info">
                          {user.name.trim().slice(0, 1) || 'م'}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="truncate text-xs font-black text-nw-text">{user.name}</h3>
                            <span className="rounded-full border border-nw-info bg-nw-info-bg px-2 py-0.5 text-xs font-bold text-nw-info">
                              {roleLabels[user.role]}
                            </span>
                            {!user.isActive && (
                              <span className="rounded-full border border-nw-bad bg-nw-bad-bg px-2 py-0.5 text-xs font-bold text-nw-bad">معطّل</span>
                            )}
                          </div>
                          <p dir="ltr" title={user.email} className="mt-1 truncate text-right font-mono text-xs text-nw-muted">{user.email || 'بريد غير متوفر'}</p>
                          <p className="mt-0.5 truncate text-xs text-nw-muted">
                            {user.phone || 'بدون هاتف'} · {branchNameForStaffAccount(user, branches)}{user.jobTitle ? ` · ${user.jobTitle}` : ''}
                          </p>
                        </div>
                      </div>

                      {!isCurrentAccount && (
                        <div className="flex shrink-0 items-center gap-1">
                          <UiButton variant="plain"
                            type="button"
                            onClick={() => {
                              setEditingUser(user);
                              setIsFormOpen(true);
                            }}
                            className="rounded-lg border border-nw-border bg-nw-surface-2 p-1.5 text-nw-text transition hover:bg-nw-surface"
                            title="تعديل بيانات المستخدم"
                            aria-label="تعديل بيانات المستخدم"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </UiButton>
                          <UiButton variant="plain"
                            type="button"
                            onClick={() => {
                              setNewPassword('');
                              setPasswordTarget(user);
                            }}
                            className="rounded-lg border border-nw-warn bg-nw-warn-bg p-1.5 text-nw-warn transition hover:bg-nw-warn-bg"
                            title="تغيير كلمة المرور"
                            aria-label="تغيير كلمة المرور"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </UiButton>
                          <UiButton variant="plain"
                            type="button"
                            onClick={() => void handleAccountState(user)}
                            disabled={isPending}
                            className={`rounded-lg border p-1.5 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              user.isActive
                                ? 'border-nw-bad bg-nw-bad-bg text-nw-bad hover:bg-nw-bad-bg'
                                : 'border-nw-ok bg-nw-ok-bg text-nw-ok hover:bg-nw-ok-bg'
                            }`}
                            title={user.isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                            aria-label={user.isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                          >
                            {isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : user.isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          </UiButton>
                        </div>
                      )}
                    </div>
                    {isSystemOwner && (
                      <p className="mt-2 rounded-lg border border-nw-warn bg-nw-warn-bg px-2 py-1.5 text-xs text-nw-warn">
                        مالك نظام بصلاحية كاملة. لا يمكن تعديل حسابك الحالي من هذه الشاشة، ولا يمكن تعطيل آخر مالك نشط.
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          {isLoading ? (
            <div className="flex justify-center rounded-2xl border border-nw-border bg-nw-surface p-10">
              <LoaderCircle className="h-6 w-6 animate-spin text-nw-info" />
            </div>
          ) : audits.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-nw-border bg-nw-surface p-8 text-center text-xs text-nw-muted">
              لا توجد عمليات إدارة موظفين مسجلة بعد.
            </div>
          ) : audits.map((record) => (
            <Card padded={false} key={record.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-xs text-nw-info">{record.actorName}</strong>
                <time className="text-xs text-nw-muted">{formatUiDate(record.createdAt, {dateStyle:'medium',timeStyle:'short'})}</time>
              </div>
              <p className="mt-1 text-xs font-black text-nw-text">{record.action}</p>
              <p className="mt-1 text-xs text-nw-muted">{getAuditDetails(record)}</p>
            </Card>
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
        <form onSubmit={(event) => void handlePasswordReset(event)} aria-busy={isSavingPassword} className="space-y-3 text-xs" dir="rtl">
          <div className="rounded-xl border border-nw-warn bg-nw-warn-bg px-3 py-2 text-xs text-nw-warn">
            الحساب: <strong>{passwordTarget?.name}</strong>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-nw-text">كلمة المرور الجديدة</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="10 أحرف على الأقل، تشمل حرفًا ورقمًا"
              className="w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2 text-nw-text outline-none focus:border-nw-primary"
            />
          </label>
          <div className="flex gap-2">
            <UiButton variant="plain" type="submit" disabled={isSavingPassword} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-nw-warn-bg py-2.5 text-xs font-black text-nw-muted transition hover:bg-nw-warn-bg disabled:opacity-60">
              {isSavingPassword ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {isSavingPassword ? 'جارٍ التغيير...' : 'تغيير كلمة المرور'}
            </UiButton>
            <UiButton variant="plain" type="button" disabled={isSavingPassword} onClick={() => setPasswordTarget(null)} className="rounded-xl bg-nw-surface px-4 py-2.5 text-xs font-bold text-nw-text">إلغاء</UiButton>
          </div>
        </form>
      </Modal>
    </FormFields>
  );
};
