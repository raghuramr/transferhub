import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { accountApi, getErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth';

/** Landing page for the link in the "confirm your new email" message. */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');
  const { user, updateUser } = useAuthStore();

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('This link is missing its token.');
      return;
    }
    let cancelled = false;
    accountApi
      .confirmEmailChange(token)
      .then((res) => {
        if (cancelled) return;
        setState('done');
        setMessage(res.data.email);
        if (user) updateUser({ email: res.data.email });
      })
      .catch((e) => {
        if (cancelled) return;
        setState('error');
        setMessage(getErrorMessage(e, 'This link is invalid or has expired.'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-950 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
        {state === 'working' && (<><Loader2 className="mx-auto mb-3 animate-spin text-brand-800" size={36} /><p className="text-gray-600">Confirming your new email…</p></>)}
        {state === 'done' && (
          <>
            <CheckCircle2 className="mx-auto mb-3 text-green-600" size={40} />
            <h1 className="text-xl font-bold text-gray-900">Email confirmed</h1>
            <p className="mt-2 text-sm text-gray-600">Your sign-in email is now <strong>{message}</strong>.</p>
          </>
        )}
        {state === 'error' && (
          <>
            <AlertCircle className="mx-auto mb-3 text-red-500" size={40} />
            <h1 className="text-xl font-bold text-gray-900">Could not confirm</h1>
            <p className="mt-2 text-sm text-gray-600">{message}</p>
          </>
        )}
        <Link to={user ? '/profile' : '/login'} className="mt-6 inline-block text-sm font-medium text-brand-800 hover:underline">
          {user ? 'Back to my profile' : 'Go to sign in'}
        </Link>
      </div>
    </div>
  );
}
