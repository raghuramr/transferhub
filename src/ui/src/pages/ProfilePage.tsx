import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCircle, Lock, X, GraduationCap, Landmark, BookOpen, Camera, BadgeCheck, Mail, Trash2 } from 'lucide-react';
import { usersApi, api, accountApi, getErrorMessage } from '../lib/api';
import { Avatar } from '../components/shared/Avatar';
import { PhotoEditor } from '../components/shared/PhotoEditor';
import { useAuthStore } from '../store/auth';

const emptyPasswordForm = { currentPassword: '', newPassword: '', confirm: '' };

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
    zipCode: user?.zipCode ?? '',
    country: user?.country ?? '',
    countryOfOrigin: user?.countryOfOrigin ?? '',
  });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState('');
  const qc = useQueryClient();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '' });
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Fetch full profile (includes StudentProfile fields for students)
  const profileQuery = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => usersApi.get(user!.id),
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (profileQuery.data?.data && !profileLoaded) {
      const p = profileQuery.data.data as Record<string, unknown>;
      setForm({
        firstName: (p.firstName as string) ?? '',
        lastName: (p.lastName as string) ?? '',
        email: (p.email as string) ?? '',
        mobile: (p.mobile as string) ?? '',
        addressLine1: (p.addressLine1 as string) ?? '',
        addressLine2: (p.addressLine2 as string) ?? '',
        city: (p.city as string) ?? '',
        state: (p.state as string) ?? '',
        zipCode: (p.zipCode as string) ?? '',
        country: (p.country as string) ?? '',
        countryOfOrigin: (p.countryOfOrigin as string) ?? '',
      });
      setProfileLoaded(true);
    }
  }, [profileQuery.data, profileLoaded]);

  // Student profile fields (read-only display from fresh fetch)
  const profileData = profileQuery.data?.data as Record<string, unknown> | undefined;
  const isStudent = user?.role === 'student';

  // Student "University & program" overview + target picker
  const overviewQuery = useQuery({
    queryKey: ['account-overview', user?.id],
    queryFn: () => accountApi.studentOverview(),
    enabled: !!user?.id && isStudent,
  });
  const targetsQuery = useQuery({
    queryKey: ['account-targets'],
    queryFn: () => accountApi.targets(),
    enabled: !!user?.id && isStudent,
  });
  const overview = overviewQuery.data?.data;
  const targets = targetsQuery.data?.data ?? [];
  const [pickUni, setPickUni] = useState<string>('');
  const [pickProg, setPickProg] = useState<string>('');
  const [targetMsg, setTargetMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    if (overview) {
      setPickUni(overview.targetInstitutionId ? String(overview.targetInstitutionId) : '');
      setPickProg(overview.targetProgramId ? String(overview.targetProgramId) : '');
    }
  }, [overview]);
  const pickedPrograms = targets.find((t) => String(t.id) === pickUni)?.programs ?? [];

  // Student-editable "current" school details (free text — the college need not be in our list).
  const [currentInst, setCurrentInst] = useState('');
  const [currentProg, setCurrentProg] = useState('');
  const [schoolLoaded, setSchoolLoaded] = useState(false);
  const [schoolMsg, setSchoolMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    if (overview && !schoolLoaded) {
      setCurrentInst(overview.currentInstitution ?? '');
      setCurrentProg(overview.currentProgram ?? '');
      setSchoolLoaded(true);
    }
  }, [overview, schoolLoaded]);
  const schoolMutation = useMutation({
    mutationFn: () => accountApi.updateStudentProfile({ currentInstitution: currentInst, currentProgram: currentProg }),
    onSuccess: () => {
      setSchoolMsg({ kind: 'ok', text: 'Your current school details were saved.' });
      qc.invalidateQueries({ queryKey: ['account-overview', user?.id] });
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
    },
    onError: (err: unknown) => setSchoolMsg({ kind: 'err', text: getErrorMessage(err, 'Could not save your school details') }),
  });
  const targetMutation = useMutation({
    mutationFn: () => accountApi.setTarget(Number(pickUni), pickProg ? Number(pickProg) : undefined),
    onSuccess: (res) => {
      setTargetMsg({ kind: 'ok', text: res.data.warning ? `Target updated. ${res.data.warning}` : 'Your target university and program were updated.' });
      qc.invalidateQueries({ queryKey: ['account-overview', user?.id] });
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
    },
    onError: (err: unknown) => setTargetMsg({ kind: 'err', text: getErrorMessage(err, 'Could not change your target') }),
  });

  const profileMutation = useMutation({
    mutationFn: () => usersApi.update(user!.id, form),
    onSuccess: () => {
      updateUser(form);
      setProfileError('');
    },
    onError: (err: unknown) => setProfileError(getErrorMessage(err, 'Could not update profile')),
  });

  const photoMutation = useMutation({
    mutationFn: (blob: Blob) => accountApi.setPhoto(blob),
    onSuccess: () => {
      setPhotoFile(null);
      setPhotoError('');
      qc.invalidateQueries({ queryKey: ['avatar', user?.id] });
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
      updateUser({ hasAvatar: true });
    },
    onError: (err: unknown) => setPhotoError(getErrorMessage(err, 'Could not save your photo')),
  });
  const removePhotoMutation = useMutation({
    mutationFn: () => accountApi.removePhoto(),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['avatar', user?.id] });
      updateUser({ hasAvatar: false });
    },
  });
  const emailMutation = useMutation({
    mutationFn: () => accountApi.requestEmailChange(emailForm.newEmail, emailForm.password),
    onSuccess: (res) => {
      setEmailError('');
      setEmailMessage(res.data.message);
      setEmailForm({ newEmail: '', password: '' });
    },
    onError: (err: unknown) => setEmailError(getErrorMessage(err, 'Could not start the email change')),
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

  const field = (name: keyof typeof form, label: string, type: string = 'text') => (
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

  const readonlyField = (label: string, value: string | number | undefined | null) => (
    <div>
      <label className="block text-sm font-medium text-gray-500 mb-1">{label}</label>
      <div className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-700">
        {value ?? <span className="text-gray-400 italic">Not provided</span>}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
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

      {profileQuery.isError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {getErrorMessage(profileQuery.error, 'Could not load your profile details.')}
        </div>
      )}
      {profileQuery.isLoading && (
        <div className="text-center py-8 text-gray-400 text-sm">Loading profile…</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {profileError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{profileError}</div>
        )}
        {profileMutation.isSuccess && !profileMutation.isPending && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            Profile updated.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Avatar userId={user?.id} firstName={form.firstName} lastName={form.lastName} size="xl" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Profile photo</p>
            <p className="text-xs text-gray-500 mb-2">JPG, PNG or WebP. You can position and zoom it before saving.</p>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 px-3 py-2 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900">
                <Camera size={15} /> {user?.hasAvatar ? 'Change photo' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) { setPhotoError(''); setPhotoFile(f); }
                  }}
                />
              </label>
              {user?.hasAvatar && (
                <button type="button" onClick={() => removePhotoMutation.mutate()} className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
            {photoError && <p className="mt-1 text-xs text-red-600">{photoError}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('firstName', 'First Name')}
          {field('lastName', 'Last Name')}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[12rem] px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-700 flex items-center justify-between gap-2">
              <span className="truncate">{form.email}</span>
              {(profileData?.emailVerified ?? true) && (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-green-700"><BadgeCheck size={14} /> Verified</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setEmailMessage(''); setEmailError(''); setShowEmailModal(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Mail size={15} /> Change email
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400">Your email changes only after you click the confirmation link we send to the new address.</p>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <p className="text-sm font-semibold text-gray-900 mb-3">Contact &amp; Address</p>
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
            {field('zipCode', 'Zip Code')}
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

      {/* Student-only: where they are and where they are going */}
      {isStudent && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5 mt-6" data-testid="university-program">
          <div className="flex items-center gap-2">
            <Landmark className="text-brand-800" size={20} />
            <h2 className="text-lg font-semibold text-gray-900">University &amp; program</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current institution</label>
              <input
                value={currentInst}
                onChange={(e) => { setCurrentInst(e.target.value); setSchoolMsg(null); }}
                placeholder="e.g. Miami Dade College"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current program / major</label>
              <input
                value={currentProg}
                onChange={(e) => { setCurrentProg(e.target.value); setSchoolMsg(null); }}
                placeholder="e.g. Business Administration"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            {readonlyField('Target university', overview?.targetInstitutionName ?? (profileData?.targetInstitutionName as string | undefined))}
            {readonlyField('Target program',
              overview?.targetProgramName
                ? `${overview.targetProgramName}${overview.targetProgramDegree ? ` (${overview.targetProgramDegree})` : ''}`
                : (profileData?.targetProgramName as string | undefined))}
            {readonlyField('Credits completed', overview?.creditsCompleted != null ? Number(overview.creditsCompleted) : undefined)}
            {readonlyField('Courses submitted for evaluation', overview ? overview.submittedCourses : undefined)}
          </div>
          {schoolMsg && (
            <div className={`p-3 rounded-lg text-sm border ${schoolMsg.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {schoolMsg.text}
            </div>
          )}
          <button
            onClick={() => { setSchoolMsg(null); schoolMutation.mutate(); }}
            disabled={schoolMutation.isPending}
            className="px-5 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
          >
            {schoolMutation.isPending ? 'Saving…' : 'Save current school'}
          </button>

          <div className="pt-4 border-t border-gray-100">
            <p className="text-sm font-semibold text-gray-900 mb-1">Change target university</p>
            <p className="text-xs text-gray-400 mb-3">Applies to new requests and previews. Requests you already submitted keep their original target.</p>
            {targetMsg && (
              <div className={`mb-3 p-3 rounded-lg text-sm border ${targetMsg.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {targetMsg.text}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="target-uni">University</label>
                <select id="target-uni" value={pickUni}
                  onChange={(e) => { setPickUni(e.target.value); setPickProg(''); setTargetMsg(null); }}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">Select a university…</option>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="target-prog">Program</label>
                <select id="target-prog" value={pickProg} disabled={!pickUni}
                  onChange={(e) => { setPickProg(e.target.value); setTargetMsg(null); }}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">{pickedPrograms.length ? 'Select a program (optional)…' : 'No programs listed'}</option>
                  {pickedPrograms.map((p) => <option key={p.id} value={p.id}>{p.name}{p.degree ? ` (${p.degree})` : ''}</option>)}
                </select>
              </div>
            </div>
            <button
              onClick={() => { setTargetMsg(null); targetMutation.mutate(); }}
              disabled={!pickUni || targetMutation.isPending}
              className="mt-4 px-5 py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
            >
              {targetMutation.isPending ? 'Saving…' : 'Save target'}
            </button>
          </div>
        </div>
      )}

      {/* Student-only education & emergency contact section */}
      {isStudent && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5 mt-6">
          <div className="flex items-center gap-2 mb-2">
            <GraduationCap className="text-brand-800" size={20} />
            <h2 className="text-lg font-semibold text-gray-900">Education &amp; Background</h2>
          </div>
          <p className="text-xs text-gray-400 -mt-3">These fields were set during registration. Contact support to update them.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {readonlyField('Prior / Current Institution', profileData?.priorInstitutionName as string)}
            {readonlyField('Highest Education Level', profileData?.highestEducationLevel as string)}
            {readonlyField('Field of Study', profileData?.fieldOfStudy as string)}
            {readonlyField('GPA', profileData?.gpa as number)}
            {readonlyField('Graduation Year', profileData?.graduationYear as number)}
          </div>

          <div className="pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="text-brand-600" size={16} />
              <p className="text-sm font-semibold text-gray-900">Emergency Contact</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {readonlyField('Emergency Contact Name', profileData?.emergencyContactName as string)}
              {readonlyField('Emergency Contact Phone', profileData?.emergencyContactPhone as string)}
            </div>
          </div>
        </div>
      )}

      {photoFile && (
        <PhotoEditor file={photoFile} saving={photoMutation.isPending} onCancel={() => setPhotoFile(null)} onSave={(b) => photoMutation.mutate(b)} />
      )}

      {showEmailModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Change email</h2>
              <button onClick={() => setShowEmailModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {emailMessage ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{emailMessage}</div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">We will email a confirmation link to the new address. Nothing changes until you click it.</p>
                {emailError && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{emailError}</div>}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New email address</label>
                  <input type="email" value={emailForm.newEmail} onChange={(e) => setEmailForm((f) => ({ ...f, newEmail: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current password</label>
                  <input type="password" value={emailForm.password} onChange={(e) => setEmailForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <button
                  onClick={() => emailMutation.mutate()}
                  disabled={emailMutation.isPending || !emailForm.newEmail || !emailForm.password}
                  className="w-full py-2.5 bg-brand-800 text-white rounded-lg text-sm font-medium hover:bg-brand-900 disabled:bg-brand-400"
                >
                  {emailMutation.isPending ? 'Sending…' : 'Send confirmation link'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{passwordError}</div>
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
