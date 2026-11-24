import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { changeOwnPassword } from '../lib/firestoreService';

export function ChangePasswordModal({
  isOpen,
  username,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  username: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!currentPass) {
      setError('Vui lòng nhập mật khẩu hiện tại.');
      return;
    }
    if (newPass !== confirmPass) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setSaving(true);
    try {
      await changeOwnPassword({
        username,
        currentPassword: currentPass,
        newPassword: newPass,
      });
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
      onSuccess('Đã cập nhật mật khẩu thành công.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật mật khẩu.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
            <KeyRound className="w-4 h-4 text-blue-700" />
            Đổi mật khẩu
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Mật khẩu hiện tại
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Mật khẩu mới
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Ít nhất 8 ký tự gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Nhập lại mật khẩu mới
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-700"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : 'Cập nhật mật khẩu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
