import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formsApi, getErrorMessage } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FieldEditor } from '../../components/forms/FieldEditor';
import { Save, ArrowLeft, Trash2, ClipboardList } from 'lucide-react';
import type { FormDef, FormField, FormStatus } from '../../types';

const inputCls =
  'w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

export default function FormEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<FormStatus>('draft');
  const [successMessage, setSuccessMessage] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['forms', id],
    queryFn: () => formsApi.get(Number(id)),
    enabled: !isNew,
  });

  useEffect(() => {
    const form = data?.data as FormDef | undefined;
    if (form) {
      setSlug(form.slug);
      setTitle(form.title);
      setDescription(form.description ?? '');
      setStatus(form.status);
      setSuccessMessage(form.successMessage ?? '');
      setFields(form.schema.fields);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { slug, title, description, status, successMessage, schema: { fields } };
      return isNew ? formsApi.create(payload) : formsApi.update(Number(id), payload);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['forms'] });
      const saved = res.data as FormDef;
      if (isNew) navigate(`/admin/forms/${saved.id}`, { replace: true });
    },
    onError: (err: unknown) => setError(getErrorMessage(err, 'Save failed')),
  });

  const deleteMutation = useMutation({
    mutationFn: () => formsApi.remove(Number(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms'] });
      navigate('/admin/forms');
    },
  });

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate('/admin/forms')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft size={16} /> Back to Forms
        </button>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Link to={`/admin/forms/${id}/submissions`}>
              <Button variant="outline" size="sm" icon={<ClipboardList size={14} />}>Submissions</Button>
            </Link>
          )}
          {!isNew && (
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => deleteMutation.mutate()}>
              Delete
            </Button>
          )}
          <Button size="sm" icon={<Save size={14} />} onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {error && <div className="p-3 mb-5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

      <Card className="p-5 space-y-3 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Slug</label>
            <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-form-slug" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
          <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as FormStatus)}>
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Success message</label>
            <input className={inputCls} value={successMessage} onChange={(e) => setSuccessMessage(e.target.value)} placeholder="Thank you! ..." />
          </div>
        </div>
      </Card>

      <h2 className="font-semibold text-gray-900 mb-3">Questions</h2>
      <FieldEditor fields={fields} onChange={setFields} />
    </div>
  );
}
