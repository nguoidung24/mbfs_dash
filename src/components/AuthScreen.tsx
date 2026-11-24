import React, { useState } from 'react';
import {
  AlertCircle,
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  ShieldCheck,
  User,
} from 'lucide-react';
import { UserProfile } from '../types/domain';
import { changeOwnPassword, loginWithUsernamePassword } from '../lib/firestoreService';

interface AuthScreenProps {
  onAuthenticated: (result: { user: UserProfile; mustChangePassword: boolean }) => Promise<void> | void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }

    setLoading(true);
    try {
      const res = await loginWithUsernamePassword(username, password);
      await onAuthenticated(res);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Không thể đăng nhập. Vui lòng kiểm tra lại thông tin tài khoản.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2.5 text-slate-900">
          <div className="w-9 h-9 rounded-lg bg-blue-700 text-white flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">Quản Trị Công Việc</span>
        </div>
        <p className="mt-2 text-center text-sm text-slate-600">
          Hệ thống điều hành nghiệp vụ & theo dõi tiến độ nội bộ phòng ban
        </p>
      </div>

      <div className="mt-7 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-slate-900">Đăng nhập hệ thống</h1>
            <p className="text-xs text-slate-500">
              Sử dụng tài khoản nội bộ do Quản trị viên cấp. Không hỗ trợ tự đăng ký.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-xs font-medium text-slate-700 mb-1.5">
                Tên đăng nhập
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Nhập tên đăng nhập"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                Mật khẩu
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Đang xác thực...' : 'Đăng nhập'}
            </button>
          </form>

          <p className="text-xs text-slate-500 text-center pt-2 border-t border-slate-100">
            Quên mật khẩu? Vui lòng liên hệ Quản trị viên phòng ban để được đặt lại mật khẩu.
          </p>
        </div>
      </div>
    </div>
  );
}

interface FirstLoginPasswordScreenProps {
  user: UserProfile;
  onPasswordChanged: () => void;
  onSignOut: () => void;
}

export function FirstLoginPasswordScreen({
  user,
  onPasswordChanged,
  onSignOut,
}: FirstLoginPasswordScreenProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setSaving(true);
    try {
      await changeOwnPassword({
        username: user.username || '',
        currentPassword,
        newPassword,
      });
      onPasswordChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật mật khẩu.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold text-slate-900">
                Đổi mật khẩu lần đầu
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                Xin chào <strong>{user.fullName}</strong> (@{user.username}). Để đảm bảo an toàn tài khoản, bạn cần đổi mật khẩu mới trước khi vào hệ thống.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="first-cur-pass" className="block text-xs font-medium text-slate-700 mb-1.5">
                Mật khẩu hiện tại
              </label>
              <input
                id="first-cur-pass"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <div>
              <label htmlFor="first-new-pass" className="block text-xs font-medium text-slate-700 mb-1.5">
                Mật khẩu mới
              </label>
              <input
                id="first-new-pass"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Tối thiểu 8 ký tự gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.
              </p>
            </div>

            <div>
              <label htmlFor="first-confirm-pass" className="block text-xs font-medium text-slate-700 mb-1.5">
                Xác nhận mật khẩu mới
              </label>
              <input
                id="first-confirm-pass"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
              />
              <span>Hiện mật khẩu</span>
            </label>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Đăng xuất
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 px-4 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Đang cập nhật...' : 'Xác nhận đổi mật khẩu'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
