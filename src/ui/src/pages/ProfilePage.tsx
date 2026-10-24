import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { UserCircle, Lock, X } from 'lucide-react';
import { usersApi, api, getErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth';

const emptyPasswordForm = { currentPassword: '', newPassword: '', confirm: '' };

/**
 * Own-profile editor — lives in the page content area (not a modal), per
 * the user's request. Password changes stay a popup, since that's a
 * narrow, occasional action that doesn't need page real estate.
 */
export default function ProfilePage() {
  const { user, updateUser } = useAuthStore();
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    mobile: user?.mobile ?? '',
    addressLine1: user?.addressLine1 ?? '',
    addressLine2: user?.addressLine2 ?? '',
    city: user?.city ?? '',
    state: user?.state ?? '',
    postalCode: user?.postalCode ?? '',
    country: user?.country ?? '',
    countryOfOrigin: user?.countryOfOrigin ?? '',
  });
  const [profileError, setProfileError] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const profileMutation = useMutation({
    mutationFn: () => usersApi.update(user!.id, form),
    onSuccess: () => {
      updateUser(form);
      setProfileError('');
    },
    onError: (err: unknown) => setProfileError(getErrorMessage(err, 'Could not update profile')),
  });

  const openPasswordModal = () => {
    setPasswordForm(emptyPasswordForm);
    setPasswordError('');
    setPasswordSuccess(false);
    setShowPasswordModal(true);
  };

  const passwordMutation = useMutation({
    mutationFn: () => {
      if (passwordForm.newPassword !== passwordForm.confirm) {
        return Promise.reject(new Error('New passwords do not match'));
      }
      return api.post('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
    },
    onSuccess: () => {
      setPasswordForm(emptyPasswordForm);
      setPasswordError('');
      setPasswordSuccess(true);
    },
    onError: (err: unknown) =>
      setPasswordError(getErrorMessage(err, 'Could not change password')),
  });

  const field = (
    name: keyof typeof form,
    label: string,
    type: string = 'text',
  ) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={form[name]}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </div>
  );

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <UserCircle className="text-brand-800" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
            <p className="text-gray-500">Update your personal details and contact information</p>
          </div>
        </div>
        <button
          onClick={openPasswordModal}
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Lock size={16} /> Change Password
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {profileError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{profileError}</div>
        )}
        {profileMutation.isSuccess && !profileMutation.isPending && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            Profile updated.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('firstName', 'First Name')}
          {field('lastName', 'Last Name')}
        </div>
        {field('email', 'Email', 'email')}

        <div className="pt-4 border-t border-gray-100">
          <p className="text-sm font-semibold text-gray-900 mb-3">Contact & Address</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('mobile', 'Mobile')}
            {field('countryOfOrigin', 'Country of Origin')}
          </div>
          <div className="mt-4">{field('addressLine1', 'Address Line 1')}</div>
          <div className="mt-4">{field('addressLine2', 'Address Line 2')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {field('city', 'City')}
            {field('state', 'State/Province')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {field('postalCode', 'Postal Code')}
            {field('country', 'Country')}
          </div>
        </div>

        <button
          onClick={() => profileMutation.mutate()}
          disabled={profileMutation.isPending}
          className="px-5 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          {profileMutation.isPending ? 'Saving…' : 'Save Profile'}
        </button>
      </div>

      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">Change Password</h2>
              <button onClick={() => setShowPasswordModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {passwordError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div className="p-2.5 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs">
                  Password changed successfully.
                </div>
              )}
              {[
                { name: 'currentPassword' as const, label: 'Current Password' },
                { name: 'newPassword' as const, label: 'New Password' },
                { name: 'confirm' as const, label: 'Confirm New Password' },
              ].map(({ name, label }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type="password"
                    value={passwordForm[name]}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, [name]: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              ))}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowPasswordModal(false)}
                className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => passwordMutation.mutate()}
                disabled={passwordMutation.isPending}
                className="flex-1 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
              >
                {passwordMutation.isPending ? 'Changing…' : 'Change Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
