import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { formsApi, getErrorMessage } from '../../lib/api';
import { FormRenderer, type FormFieldValue } from '../../components/forms/FormRenderer';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Reveal } from '../../components/ui/PageTransition';
import { CheckCircle2, Send, FileQuestion } from 'lucide-react';
import type { FormDef } from '../../types';

export default function FormFillView() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<Record<string, FormFieldValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [apiError, setApiError] = useState('');

  const { data: resp, isLoading } = useQuery({
    queryKey: ['forms', 'slug', slug],
    queryFn: () => formsApi.bySlug(slug!),
  });
  const form = resp?.data as FormDef | undefined;

  const submitMutation = useMutation({
    mutationFn: () => formsApi.submit(form!.id, data),
    onSuccess: (res) => {
      setSubmitted((res.data as { successMessage?: string }).successMessage ?? 'Thank you — your response has been recorded.');
    },
    onError: (err: unknown) => setApiError(getErrorMessage(err, 'Submission failed.')),
  });

  const handleChange = (key: string, value: FormFieldValue) => {
    setData((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const handleSubmit = () => {
    if (!form) return;
    const newErrors: Record<string, string> = {};
    for (const field of form.schema.fields) {
      if (field.required) {
        const v = data[field.key];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
          newErrors[field.key] = 'This field is required';
        }
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setApiError('');
    submitMutation.mutate();
  };

  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading…</div>;

  if (!form) {
    return (
      <div className="p-12 text-center text-gray-400">
        <FileQuestion size={36} className="mx-auto mb-3 opacity-40" />
        This form isn't available right now.
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="p-4 sm:p-8 max-w-xl mx-auto">
        <Card className="p-8 text-center">
          <CheckCircle2 className="mx-auto text-green-600 mb-3" size={40} />
          <p className="text-gray-900 font-medium">{submitted}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-xl mx-auto">
      <Reveal>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{form.title}</h1>
        {form.description && <p className="text-gray-500 mb-6">{form.description}</p>}
      </Reveal>

      <Card className="p-6">
        {apiError && (
          <div className="p-3 mb-5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{apiError}</div>
        )}
        <FormRenderer fields={form.schema.fields} data={data} onChange={handleChange} errors={errors} />
        <Button
          className="w-full mt-6"
          icon={<Send size={16} />}
          onClick={handleSubmit}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? 'Submitting…' : 'Submit'}
        </Button>
      </Card>
    </div>
  );
}
