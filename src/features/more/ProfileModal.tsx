/**
 * Nawasrah Business Manager - Comprehensive Profile & Settings Modal
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { isDeviceBiometricAvailable } from '../../services/deviceBiometrics.service';
import {
  beginTotpEnrollment,
  getMfaStatus,
  MfaStatus,
  removeTotpFactor,
  TotpEnrollment,
  translateMfaError,
  verifyTotpFactor,
} from '../../services/supabase/mfa.service';
import {
  User as UserIcon,
  ShieldCheck,
  Lock,
  Bell,
  Smartphone,
  Key,
  Check,
  AlertTriangle,
  Camera,
  Globe,
  MapPin,
  MessageSquare,
  LogOut,
  RefreshCw,
  CheckCircle2,
  Phone,
  Mail,
  QrCode,
  Copy,
  Trash2,
} from 'lucide-react';

export const ProfileModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { signOut } = useAuthStore();
  const {
    currentUser,
    branches,
    updateProfile,
    changePassword,
    isBiometricsEnabled,
    toggleFaceId,
    updateNotificationPreferences,
    updateDefaultBranch,
    logoutOtherSessions,
    setToast,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<'profile' | 'edit' | 'security' | 'notifications'>('profile');
  const [isBiometricSupported, setIsBiometricSupported] = useState<
    boolean | null
  >(null);
  const [isUpdatingBiometrics, setIsUpdatingBiometrics] = useState(false);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaEnrollment, setMfaEnrollment] = useState<TotpEnrollment | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [isUpdatingMfa, setIsUpdatingMfa] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void isDeviceBiometricAvailable().then((isAvailable) => {
      if (isMounted) {
        setIsBiometricSupported(isAvailable);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleBiometricToggle = async () => {
    setIsUpdatingBiometrics(true);
    await toggleFaceId();
    setIsUpdatingBiometrics(false);
  };

  const refreshMfaStatus = useCallback(async () => {
    setIsUpdatingMfa(true);
    try {
      setMfaStatus(await getMfaStatus());
    } catch (error) {
      setToast(translateMfaError(error), 'error');
    } finally {
      setIsUpdatingMfa(false);
    }
  }, [setToast]);

  useEffect(() => {
    if (activeTab === 'security') {
      void refreshMfaStatus();
    }
  }, [activeTab, refreshMfaStatus]);

  const handleBeginMfaEnrollment = async () => {
    setIsUpdatingMfa(true);
    setMfaCode('');
    try {
      setMfaEnrollment(await beginTotpEnrollment());
    } catch (error) {
      setToast(translateMfaError(error), 'error');
    } finally {
      setIsUpdatingMfa(false);
    }
  };

  const handleVerifyMfaEnrollment = async () => {
    if (!mfaEnrollment) return;

    setIsUpdatingMfa(true);
    try {
      await verifyTotpFactor(mfaEnrollment.factorId, mfaCode);
      setMfaEnrollment(null);
      setMfaCode('');
      setMfaStatus(await getMfaStatus());
      setToast('تم تفعيل المصادقة الثنائية بنجاح. سيُطلب الرمز عند تسجيل الدخول القادم.');
    } catch (error) {
      setToast(translateMfaError(error), 'error');
    } finally {
      setIsUpdatingMfa(false);
    }
  };

  const handleCancelMfaEnrollment = async () => {
    if (!mfaEnrollment) return;

    setIsUpdatingMfa(true);
    try {
      await removeTotpFactor(mfaEnrollment.factorId);
      setMfaEnrollment(null);
      setMfaCode('');
      setMfaStatus(await getMfaStatus());
      setToast('تم إلغاء إعداد تطبيق المصادقة.');
    } catch (error) {
      setToast(translateMfaError(error), 'error');
    } finally {
      setIsUpdatingMfa(false);
    }
  };

  const handleDisableMfa = async () => {
    const factor = mfaStatus?.verifiedTotpFactor;
    if (!factor) return;

    const confirmed = window.confirm(
      'هل أنت متأكد من إلغاء المصادقة الثنائية؟ سيبقى الحساب محميًا بكلمة المرور وFace ID المحلي فقط.'
    );
    if (!confirmed) return;

    setIsUpdatingMfa(true);
    try {
      await removeTotpFactor(factor.id);
      setMfaStatus(await getMfaStatus());
      setToast('تم إلغاء المصادقة الثنائية من الحساب.');
    } catch (error) {
      setToast(translateMfaError(error), 'error');
    } finally {
      setIsUpdatingMfa(false);
    }
  };

  const handleCopyMfaSecret = async () => {
    if (!mfaEnrollment) return;

    try {
      await navigator.clipboard.writeText(mfaEnrollment.secret);
      setToast('تم نسخ مفتاح الإعداد. احفظه في مكان آمن ولا تشاركه.');
    } catch {
      setToast('تعذر النسخ تلقائيًا. اضغط مطولًا على المفتاح لنسخه.', 'error');
    }
  };

  // Form Fields State
  const [name, setName] = useState(currentUser.name || '');
  const [phone, setPhoneVal] = useState(currentUser.phone || '');
  const [email, setEmailVal] = useState(currentUser.email || '');
  const [jobTitle, setJobTitle] = useState(currentUser.jobTitle || 'مدير النظام');
  const [branchId, setBranchId] = useState(currentUser.branchId || branches[0]?.id || 'b-amman-main');
  const [language, setLanguage] = useState<'ar' | 'en'>(currentUser.language || 'ar');
  const [timezone, setTimezone] = useState(currentUser.timezone || 'Asia/Amman');
  const [address, setAddress] = useState(currentUser.address || '');
  const [whatsapp, setWhatsapp] = useState(currentUser.whatsapp || '');
  const [avatarUrl, setAvatarUrl] = useState(
    currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
  );

  // Avatar presets option
  const AVATAR_PRESETS = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
    'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=200',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
  ];

  // Password state
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');

  // Notifications state
  const [notifs, setNotifs] = useState({
    newOrders: currentUser.notificationSettings?.newOrders ?? true,
    stockAlerts: currentUser.notificationSettings?.stockAlerts ?? true,
    expiryAlerts: currentUser.notificationSettings?.expiryAlerts ?? true,
    debtAlerts: currentUser.notificationSettings?.debtAlerts ?? true,
    emailAlerts: currentUser.notificationSettings?.emailAlerts ?? true,
    pushAlerts: currentUser.notificationSettings?.pushAlerts ?? true,
    smsAlerts: currentUser.notificationSettings?.smsAlerts ?? false,
    soundAlerts: currentUser.notificationSettings?.soundAlerts ?? true,
  });

  // UI status
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({});
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);

  const isOwnerOrAdmin = currentUser.role === 'Owner' || currentUser.role === 'Admin';

  // Check if form is dirty
  const isDirty =
    name !== currentUser.name ||
    phone !== currentUser.phone ||
    email !== currentUser.email ||
    jobTitle !== (currentUser.jobTitle || '') ||
    branchId !== currentUser.branchId ||
    language !== (currentUser.language || 'ar') ||
    timezone !== (currentUser.timezone || 'Asia/Amman') ||
    address !== (currentUser.address || '') ||
    whatsapp !== (currentUser.whatsapp || '') ||
    avatarUrl !== (currentUser.avatarUrl || '');

  // Reset fields on modal open
  useEffect(() => {
    setName(currentUser.name || '');
    setPhoneVal(currentUser.phone || '');
    setEmailVal(currentUser.email || '');
    setJobTitle(currentUser.jobTitle || 'مدير النظام');
    setBranchId(currentUser.branchId || branches[0]?.id || 'b-amman-main');
    setLanguage(currentUser.language || 'ar');
    setTimezone(currentUser.timezone || 'Asia/Amman');
    setAddress(currentUser.address || '');
    setWhatsapp(currentUser.whatsapp || '');
    setAvatarUrl(currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200');
  }, [currentUser, branches]);

  // Handle Safe Close
  const handleAttemptClose = () => {
    if (activeTab === 'edit' && isDirty) {
      setShowUnsavedPrompt(true);
    } else {
      onClose();
    }
  };

  // Form Validation
  const validateForm = () => {
    const errors: { [key: string]: string } = {};

    if (!name.trim()) {
      errors.name = 'الاسم الكامل مطلوب ولا يمكن أن يكون فارغاً';
    }

    if (!email.trim() || !email.includes('@') || !email.includes('.')) {
      errors.email = 'يرجى إدخال بريد إلكتروني صحيح (مثال: name@domain.jo)';
    }

    if (!phone.trim() || phone.replace(/\D/g, '').length < 9) {
      errors.phone = 'يرجى إدخال رقم هاتف صحيح (9 أرقام على الأقل)';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle Edit Profile Submission
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      setToast('يرجى تصحيح الأخطاء في النموذج قبل الحفظ', 'error');
      return;
    }

    setIsSaving(true);

    const updates = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      jobTitle: jobTitle.trim(),
      branchId,
      language,
      timezone,
      address: address.trim(),
      whatsapp: whatsapp.trim(),
      avatarUrl,
    };

    updateProfile(updates);
    if (branchId !== currentUser.branchId && isOwnerOrAdmin) {
      updateDefaultBranch(branchId);
    }
    setIsSaving(false);
    setActiveTab('profile');
    setToast('تم تحديث بيانات ملفك الشخصي بنجاح!');
  };

  // Password change submission
  const handleSavePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPass) {
      setToast('يرجى إدخال كلمة المرور الحالية', 'error');
      return;
    }
    if (newPass.length < 6) {
      setToast('كلمة المرور الجديدة يجب أن لا تقل عن 6 خانات', 'error');
      return;
    }
    if (newPass !== confirmPass) {
      setToast('كلمتا المرور الجديدة والتأكيد غير متطابقتين!', 'error');
      return;
    }

    setIsSaving(true);
    setTimeout(() => {
      const success = changePassword(oldPass, newPass);
      setIsSaving(false);
      if (success !== false) {
        setOldPass('');
        setNewPass('');
        setConfirmPass('');
      }
    }, 500);
  };

  // Save Notifications
  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setTimeout(() => {
      updateNotificationPreferences(notifs);
      setIsSaving(false);
    }, 400);
  };

  return (
    <div className="space-y-4 text-xs font-sans">
      {/* Unsaved Changes Dialog Modal Overlay */}
      {showUnsavedPrompt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl animate-scaleUp text-right">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-2.5 bg-amber-500/20 rounded-xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-100 text-sm">لديك تغييرات غير محفوظة!</h3>
                <p className="text-[11px] text-slate-400">هل أنت تأكد من الخروج وإلغاء التعديلات؟</p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  setShowUnsavedPrompt(false);
                  onClose();
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 rounded-xl text-xs transition"
              >
                تجاهل الخروج
              </button>
              <button
                onClick={() => setShowUnsavedPrompt(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 rounded-xl text-xs transition"
              >
                متابعة التعديل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Tab Navigation Bar */}
      <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-2xl border border-slate-800 shadow">
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`py-2 px-1 rounded-xl font-extrabold transition flex items-center justify-center gap-1.5 ${
            activeTab === 'profile'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <UserIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">الملف الشخصي</span>
          <span className="sm:hidden">الملف</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('edit')}
          className={`py-2 px-1 rounded-xl font-extrabold transition flex items-center justify-center gap-1.5 relative ${
            activeTab === 'edit'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span>تعديل البيانات</span>
          {isDirty && (
            <span className="absolute top-1 left-1 w-2 h-2 bg-amber-400 rounded-full animate-ping" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`py-2 px-1 rounded-xl font-extrabold transition flex items-center justify-center gap-1.5 ${
            activeTab === 'security'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>الأمان والجلسات</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('notifications')}
          className={`py-2 px-1 rounded-xl font-extrabold transition flex items-center justify-center gap-1.5 ${
            activeTab === 'notifications'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>الإشعارات</span>
        </button>
      </div>

      {/* --- TAB 1: Profile Summary Card --- */}
      {activeTab === 'profile' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Main Hero Card */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-4 rounded-2xl border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <img
                  src={
                    currentUser.avatarUrl ||
                    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
                  }
                  alt={currentUser.name}
                  className="w-16 h-16 rounded-2xl object-cover border-2 border-blue-500 shadow-md"
                />
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-black text-blue-400 bg-blue-950/80 px-2.5 py-0.5 rounded-full border border-blue-800">
                      {currentUser.role}
                    </span>
                    <span className="text-[10px] font-bold text-slate-300 bg-slate-950 px-2 py-0.5 rounded-full border border-slate-800">
                      {branches.find((b) => b.id === currentUser.branchId)?.name || 'الفرع الرئيسي'}
                    </span>
                  </div>
                  <h2 className="font-black text-slate-100 text-base">{currentUser.name}</h2>
                  <p className="text-[11px] text-slate-400 font-medium">
                    {currentUser.jobTitle || 'مدير النظام والتطبيقات'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-xl text-[11px] transition flex items-center gap-1 shadow"
              >
                <span>تعديل</span>
              </button>
            </div>

            {/* Quick Details Grid */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 space-y-0.5">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Mail className="w-3 h-3 text-blue-400" /> البريد الإلكتروني
                </span>
                <p className="font-mono text-slate-200 text-[11px] truncate">{currentUser.email}</p>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 space-y-0.5">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Phone className="w-3 h-3 text-emerald-400" /> رقم الهاتف
                </span>
                <p className="font-mono text-slate-200 text-[11px] truncate">{currentUser.phone}</p>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 space-y-0.5">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Globe className="w-3 h-3 text-purple-400" /> اللغة والمنطقة
                </span>
                <p className="text-slate-200 text-[11px]">
                  {currentUser.language === 'en' ? 'English' : 'العربية (الأردن)'} | {currentUser.timezone || 'Asia/Amman'}
                </p>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 space-y-0.5">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <MessageSquare className="w-3 h-3 text-teal-400" /> واتساب
                </span>
                <p className="font-mono text-slate-200 text-[11px]">
                  {currentUser.whatsapp || currentUser.phone || 'غير محدد'}
                </p>
              </div>
            </div>

            {currentUser.address && (
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 space-y-0.5">
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-rose-400" /> العنوان المسجل
                </span>
                <p className="text-slate-200 text-[11px]">{currentUser.address}</p>
              </div>
            )}
          </div>

          {/* Role & Permissions Banner */}
          <div className="bg-purple-950/40 border border-purple-800/60 p-3 rounded-2xl flex items-start gap-2.5 text-purple-300">
            <ShieldCheck className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h4 className="font-bold text-slate-100 text-[11px]">صلاحيات الحساب الحالية: {currentUser.role}</h4>
              <p className="text-[10px] text-purple-200 leading-relaxed">
                يتم إدارة وتعيين الصلاحيات وأدوار الموظفين حصراً من شاشة إدارة المستخدمين وصلاحيات الفروع.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 2: Edit Profile Form --- */}
      {activeTab === 'edit' && (
        <form onSubmit={handleSaveProfile} className="space-y-3 animate-fadeIn">
          {/* Avatar Choice & Upload Preview */}
          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
            <label className="text-[11px] font-extrabold text-slate-200 block">الصورة الشخصية</label>
            <div className="flex items-center gap-3">
              <img
                src={avatarUrl}
                alt="معاينة"
                className="w-14 h-14 rounded-2xl object-cover border-2 border-blue-500 shadow"
              />
              <div className="space-y-1.5 flex-1">
                <span className="text-[10px] text-slate-400 block">اختر من الصور الجاهزة أو ادخل الرابط:</span>
                <div className="flex items-center gap-2">
                  {AVATAR_PRESETS.map((url, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setAvatarUrl(url)}
                      className={`w-7 h-7 rounded-xl overflow-hidden border-2 transition ${
                        avatarUrl === url ? 'border-blue-500 scale-110' : 'border-slate-800 opacity-70'
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <input
              type="url"
              placeholder="رابط الصورة الشخصية المباشر (URL)"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-200 font-mono text-[11px] focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Full Name */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-300 block">الاسم الكامل *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: '' }));
              }}
              className={`w-full bg-slate-950 border ${
                fieldErrors.name ? 'border-rose-500' : 'border-slate-800'
              } rounded-xl px-3 py-2 text-slate-100 font-bold focus:outline-none focus:border-blue-500`}
            />
            {fieldErrors.name && (
              <p className="text-[10px] text-rose-400 font-bold">{fieldErrors.name}</p>
            )}
          </div>

          {/* Phone & Email Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">رقم الهاتف *</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => {
                  setPhoneVal(e.target.value);
                  if (fieldErrors.phone) setFieldErrors((p) => ({ ...p, phone: '' }));
                }}
                className={`w-full bg-slate-950 border ${
                  fieldErrors.phone ? 'border-rose-500' : 'border-slate-800'
                } rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500`}
              />
              {fieldErrors.phone && (
                <p className="text-[10px] text-rose-400 font-bold">{fieldErrors.phone}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">البريد الإلكتروني *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmailVal(e.target.value);
                  if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: '' }));
                }}
                className={`w-full bg-slate-950 border ${
                  fieldErrors.email ? 'border-rose-500' : 'border-slate-800'
                } rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500`}
              />
              {fieldErrors.email && (
                <p className="text-[10px] text-rose-400 font-bold">{fieldErrors.email}</p>
              )}
            </div>
          </div>

          {/* Job Title & Default Branch */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">المسمى الوظيفي</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">الفرع الافتراضي</label>
              <select
                value={branchId}
                disabled={!isOwnerOrAdmin}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 disabled:opacity-60 focus:outline-none focus:border-blue-500"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.city})
                  </option>
                ))}
              </select>
              {!isOwnerOrAdmin && (
                <p className="text-[9px] text-amber-400">تغيير الفرع مقتصر على المدير والأدمن</p>
              )}
            </div>
          </div>

          {/* Language & Timezone */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">اللغة المفضلة</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              >
                <option value="ar">العربية (Arabic)</option>
                <option value="en">English (الانجليزية)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">المنطقة الزمنية</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-blue-500"
              >
                <option value="Asia/Amman">Asia/Amman (عمّان - GMT+3)</option>
                <option value="Asia/Riyadh">Asia/Riyadh (الرياض - GMT+3)</option>
                <option value="Asia/Dubai">Asia/Dubai (دبي - GMT+4)</option>
                <option value="Africa/Cairo">Africa/Cairo (القاهرة - GMT+3)</option>
              </select>
            </div>
          </div>

          {/* Optional Address & WhatsApp */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">العنوان (اختياري)</label>
              <input
                type="text"
                placeholder="مثال: عمّان - شارع وصفي التل"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">رقم الواتساب (اختياري)</label>
              <input
                type="tel"
                placeholder="079xxxxxxx"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-black py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
            >
              {isSaving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>حفظ التعديلات</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleAttemptClose}
              className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* --- TAB 3: Security, Password & Active Sessions --- */}
      {activeTab === 'security' && (
        <div className="space-y-4 animate-fadeIn">
          {/* Server-side MFA (TOTP) */}
          <div className="space-y-3 rounded-2xl border border-blue-800/70 bg-blue-950/20 p-4">
            <div className="flex items-start justify-between gap-3 border-b border-blue-900/70 pb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-blue-600/20 p-2.5 text-blue-300">
                  <QrCode className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-100">
                    المصادقة الثنائية عبر تطبيق Authenticator
                  </h4>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                    حماية حقيقية من Supabase تتطلب كلمة المرور ورمزًا متغيرًا عند كل دخول جديد.
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black ${
                  mfaStatus?.verifiedTotpFactor
                    ? 'border-emerald-700 bg-emerald-950/70 text-emerald-300'
                    : 'border-amber-800 bg-amber-950/60 text-amber-300'
                }`}
              >
                {isUpdatingMfa && !mfaStatus
                  ? 'جاري الفحص...'
                  : mfaStatus?.verifiedTotpFactor
                  ? 'مفعلة'
                  : 'غير مفعلة'}
              </span>
            </div>

            {mfaStatus?.verifiedTotpFactor ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-900/70 bg-emerald-950/30 p-3 text-[10px] text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    الحساب محمي الآن بطبقتين. مستوى الجلسة الحالية: {mfaStatus.currentLevel || 'غير معروف'}.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDisableMfa()}
                  disabled={isUpdatingMfa}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-800 bg-rose-950/50 py-2.5 text-[11px] font-bold text-rose-300 transition hover:bg-rose-900/60 disabled:opacity-50"
                >
                  {isUpdatingMfa ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  <span>إلغاء المصادقة الثنائية</span>
                </button>
              </div>
            ) : mfaEnrollment ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                  <div className="mx-auto rounded-2xl bg-white p-2 shadow-lg">
                    <img
                      src={
                        mfaEnrollment.qrCode.startsWith('data:')
                          ? mfaEnrollment.qrCode
                          : `data:image/svg+xml;utf-8,${encodeURIComponent(mfaEnrollment.qrCode)}`
                      }
                      alt="رمز QR لتطبيق المصادقة"
                      className="h-32 w-32"
                    />
                  </div>
                  <div className="space-y-2">
                    <ol className="list-decimal space-y-1 pr-4 text-[10px] leading-relaxed text-slate-300">
                      <li>افتح Google Authenticator أو Microsoft Authenticator.</li>
                      <li>امسح رمز QR، ثم أدخل الرمز الظاهر في التطبيق.</li>
                      <li>لا تشارك صورة QR أو مفتاح الإعداد مع أي شخص.</li>
                    </ol>
                    <button
                      type="button"
                      onClick={() => void handleCopyMfaSecret()}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-[10px] text-slate-300"
                    >
                      <span className="truncate" dir="ltr">{mfaEnrollment.secret}</span>
                      <Copy className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) =>
                    setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  placeholder="000000"
                  dir="ltr"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-center font-mono text-xl font-black tracking-[0.35em] text-slate-100 focus:border-blue-500 focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleVerifyMfaEnrollment()}
                    disabled={isUpdatingMfa || mfaCode.length !== 6}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-[11px] font-black text-white transition hover:bg-blue-500 disabled:opacity-50"
                  >
                    {isUpdatingMfa && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>تأكيد وتفعيل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCancelMfaEnrollment()}
                    disabled={isUpdatingMfa}
                    className="rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-[11px] font-bold text-slate-300 disabled:opacity-50"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleBeginMfaEnrollment()}
                disabled={isUpdatingMfa || !mfaStatus}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-[11px] font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:opacity-50"
              >
                {isUpdatingMfa ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                <span>تفعيل تطبيق المصادقة</span>
              </button>
            )}
          </div>

          {/* Biometrics Face ID Switch */}
          <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-xl">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-slate-100 text-xs">
                  حماية التطبيق ببصمة الجهاز (Face ID)
                </h4>
                <p className="text-[10px] text-slate-400">
                  {isBiometricSupported === null
                    ? 'جاري فحص دعم بصمة الجهاز...'
                    : isBiometricSupported
                    ? 'قفل التطبيق والتحقق الحقيقي عند بدء جلسة جديدة'
                    : 'غير مدعومة على هذا الجهاز أو الاتصال غير آمن'}
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isBiometricsEnabled}
              onChange={() => void handleBiometricToggle()}
              disabled={
                isUpdatingBiometrics ||
                (!isBiometricsEnabled && isBiometricSupported !== true)
              }
              className="w-5 h-5 accent-blue-600 rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Password Change Box */}
          <form
            onSubmit={handleSavePassword}
            className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3"
          >
            <div className="flex items-center gap-2 text-blue-400 pb-1 border-b border-slate-800">
              <Key className="w-4 h-4" />
              <h4 className="font-extrabold text-slate-100 text-xs">تغيير كلمة المرور</h4>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 block">كلمة المرور الحالية *</label>
              <input
                type="password"
                required
                value={oldPass}
                onChange={(e) => setOldPass(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 block">كلمة المرور الجديدة *</label>
                <input
                  type="password"
                  required
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 block">تأكيد كلمة المرور الجديدة *</label>
                <input
                  type="password"
                  required
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-extrabold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>تحديث كلمة المرور</span>}
            </button>
          </form>

          {/* Active Sessions List */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2 text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
                <h4 className="font-extrabold text-slate-100 text-xs">إدارة الجلسات والأجهزة النشطة</h4>
              </div>
              <button
                type="button"
                onClick={logoutOtherSessions}
                className="bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[10px] font-bold px-2.5 py-1 rounded-lg transition flex items-center gap-1"
              >
                <LogOut className="w-3 h-3" />
                <span>تسجيل الخروج من بقية الأجهزة</span>
              </button>
            </div>

            <div className="space-y-2">
              {(currentUser.activeSessions || []).map((session) => (
                <div
                  key={session.id}
                  className={`p-2.5 rounded-xl border flex items-center justify-between ${
                    session.isCurrent
                      ? 'bg-blue-950/40 border-blue-800/80'
                      : 'bg-slate-900 border-slate-800/80'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100 text-[11px]">{session.device}</span>
                      {session.isCurrent && (
                        <span className="text-[9px] font-extrabold bg-blue-600 text-white px-2 py-0.2 rounded-full">
                          الجلسة الحالية
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 font-mono">
                      IP: {session.ip} | نشط: {session.lastActive}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Direct Supabase Sign Out Button */}
          <button
            type="button"
            onClick={async () => {
              onClose();
              await signOut();
            }}
            className="w-full bg-red-950/60 hover:bg-red-900/80 border border-red-800 text-red-300 font-bold py-3 rounded-2xl transition flex items-center justify-center gap-2 text-xs active:scale-98 shadow-lg"
          >
            <LogOut className="w-4 h-4 text-red-400" />
            <span>تسجيل الخروج النهائي من الحساب</span>
          </button>
        </div>
      )}

      {/* --- TAB 4: Notifications Preferences --- */}
      {activeTab === 'notifications' && (
        <form onSubmit={handleSaveNotifications} className="space-y-3 animate-fadeIn">
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
            <h4 className="font-extrabold text-slate-100 text-xs border-b border-slate-800 pb-2">
              إعدادات التنبيهات والإشعارات الفورية
            </h4>

            <div className="space-y-2 text-xs">
              <label className="flex items-center justify-between p-2.5 bg-slate-900 rounded-xl border border-slate-800/80 cursor-pointer">
                <div>
                  <span className="font-bold text-slate-200 block">إشعارات الطلبات المباشرة</span>
                  <span className="text-[10px] text-slate-400 block">عند ورود طلب جديد عبر الموقع الإلكتروني</span>
                </div>
                <input
                  type="checkbox"
                  checked={notifs.newOrders}
                  onChange={(e) => setNotifs((p) => ({ ...p, newOrders: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-slate-900 rounded-xl border border-slate-800/80 cursor-pointer">
                <div>
                  <span className="font-bold text-slate-200 block">تنبيهات انخفاض المخزون</span>
                  <span className="text-[10px] text-slate-400 block">عند الوصول لحد إعادة الطلب الأدنى</span>
                </div>
                <input
                  type="checkbox"
                  checked={notifs.stockAlerts}
                  onChange={(e) => setNotifs((p) => ({ ...p, stockAlerts: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-slate-900 rounded-xl border border-slate-800/80 cursor-pointer">
                <div>
                  <span className="font-bold text-slate-200 block">تنبيهات الصلاحية والتلف</span>
                  <span className="text-[10px] text-slate-400 block">قبل 30 يوماً من انتهاء صلاحية المواد</span>
                </div>
                <input
                  type="checkbox"
                  checked={notifs.expiryAlerts}
                  onChange={(e) => setNotifs((p) => ({ ...p, expiryAlerts: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-slate-900 rounded-xl border border-slate-800/80 cursor-pointer">
                <div>
                  <span className="font-bold text-slate-200 block">تنبيهات الذمم والديون المستحقة</span>
                  <span className="text-[10px] text-slate-400 block">متابعة تحصيل ذمم العملاء المتأخرة</span>
                </div>
                <input
                  type="checkbox"
                  checked={notifs.debtAlerts}
                  onChange={(e) => setNotifs((p) => ({ ...p, debtAlerts: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-slate-900 rounded-xl border border-slate-800/80 cursor-pointer">
                <div>
                  <span className="font-bold text-slate-200 block">إشعارات البريد الإلكتروني</span>
                  <span className="text-[10px] text-slate-400 block">إرسال تقارير الملخص اليومي والإقفال</span>
                </div>
                <input
                  type="checkbox"
                  checked={notifs.emailAlerts}
                  onChange={(e) => setNotifs((p) => ({ ...p, emailAlerts: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-extrabold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-lg"
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>حفظ تفضيلات الإشعارات</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
};
