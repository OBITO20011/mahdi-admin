/**
 * Nawasrah Business Manager - Users & Team Management View
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import {
  Users,
  Plus,
  Shield,
  Search,
  CheckCircle,
  XCircle,
  KeyRound,
  Edit,
  Building,
  History,
} from 'lucide-react';

export const UsersView: React.FC = () => {
  const { users, currentUser, openModal, disableUser, resetUserPassword, branches, auditLogs } =
    useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.phone.includes(searchQuery);

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-4 p-3 text-xs">
      {/* Header & Tabs */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-extrabold text-slate-100">إدارة المستخدمين والصلاحيات</h2>
          <p className="text-[10px] text-slate-400">إدارة فريق العمل، الفروع، وتتبع السجلات الأمنية</p>
        </div>

        <button
          onClick={() => openModal('add_user')}
          className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition active:scale-95 shadow-lg shadow-blue-600/20"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة موظف</span>
        </button>
      </div>

      {/* Main Mode Toggle */}
      <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
            activeTab === 'users' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>فريق العمل ({users.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex-1 py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
            activeTab === 'audit' ? 'bg-blue-600 text-white' : 'text-slate-400'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>سجل الحركات والأمان ({auditLogs.length})</span>
        </button>
      </div>

      {activeTab === 'users' ? (
        <div className="space-y-3">
          {/* Search & Filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-2.5" />
              <input
                type="text"
                placeholder="بحث بالاسم، الهاتف أو البريد..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 text-slate-200 text-xs focus:outline-none"
            >
              <option value="all">كل الأدوار</option>
              <option value="Owner">Owner</option>
              <option value="Admin">Admin</option>
              <option value="Cashier">Cashier</option>
              <option value="Accountant">Accountant</option>
              <option value="Warehouse Employee">Warehouse</option>
            </select>
          </div>

          {/* Users Cards Grid */}
          <div className="space-y-2">
            {filteredUsers.map((u) => {
              const userBranch = branches.find((b) => b.id === u.branchId);

              return (
                <div
                  key={u.id}
                  className={`bg-slate-950 p-3 rounded-2xl border transition ${
                    u.isActive ? 'border-slate-800' : 'border-red-900/40 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src={u.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200'}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover border border-slate-700"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-slate-100 text-xs">{u.name}</h4>
                          <span className="bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full font-bold text-[9px] border border-blue-500/30">
                            {u.role}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono">{u.phone} • {u.email || 'بدون إيميل'}</p>
                        <span className="text-[9px] text-slate-500 block">الفرع: {userBranch?.name || 'الفرع الرئيسي'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openModal('edit_user', u)}
                        className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-lg transition"
                        title="تعديل المستخدم"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => resetUserPassword(u.id)}
                        className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-amber-400 rounded-lg transition"
                        title="إعادة تعيين كلمة المرور"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>

                      {u.id !== currentUser.id && (
                        <button
                          onClick={() => disableUser(u.id)}
                          className={`p-1.5 border rounded-lg transition ${
                            u.isActive
                              ? 'bg-red-950/40 border-red-800 text-red-400 hover:bg-red-900/60'
                              : 'bg-emerald-950/40 border-emerald-800 text-emerald-400 hover:bg-emerald-900/60'
                          }`}
                          title={u.isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                        >
                          {u.isActive ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Audit History Logs */
        <div className="space-y-2">
          {auditLogs.map((log) => (
            <div key={log.id} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <strong className="text-blue-400 font-bold">{log.userName}</strong>
                <span className="text-slate-500 font-mono">
                  {new Date(log.timestamp).toLocaleTimeString('ar-JO')}
                </span>
              </div>
              <p className="font-bold text-slate-200 text-xs">{log.action}</p>
              <p className="text-[10px] text-slate-400">{log.details}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
