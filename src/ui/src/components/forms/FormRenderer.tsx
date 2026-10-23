import { useState } from 'react';
import type { FormField } from '../../types';
import { uploadsApi } from '../../lib/api';
import { Paperclip, Loader2, CheckCircle2 } from 'lucide-react';

const inputCls =
  'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

/** Renders a fillable form from a field schema, controlled by the parent's `data` state. */
export function FormRenderer({
  fields,
  data,
  onChange,
  errors,
}: {
  fields: FormField[];
  data: Record<string, any>;
  onChange: (key: string, value: any) => void;
  errors?: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {field.label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>

          <FieldInput field={field} value={data[field.key]} onChange={(v) => onChange(field.key, v)} />

          {field.placeholder && !['select', 'radio', 'checkboxes'].includes(field.type) && (
            <p className="text-xs text-gray-400 mt-1">{field.placeholder}</p>
          )}
          {errors?.[field.key] && <p className="text-xs text-red-600 mt-1">{errors[field.key]}</p>}
        </div>
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
}) {
  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          className={inputCls}
          rows={4}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'select':
      return (
        <select className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case 'radio':
      return (
        <div className="flex flex-wrap gap-3">
          {(field.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="radio"
                name={field.key}
                checked={value === opt}
                onChange={() => onChange(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      );

    case 'checkboxes': {
      const selected: string[] = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-3">
          {(field.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, opt] : selected.filter((s) => s !== opt))
                }
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }

    case 'yesno':
      return (
        <div className="flex gap-3">
          {['Yes', 'No'].map((opt) => (
            <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="radio"
                name={field.key}
                checked={value === opt}
                onChange={() => onChange(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      );

    case 'file':
      return <FileFieldInput field={field} value={value} onChange={onChange} />;

    case 'number':
      return (
        <input
          type="number"
          className={inputCls}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          className={inputCls}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'email':
    case 'phone':
    case 'text':
    default:
      return (
        <input
          type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
          className={inputCls}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/**
 * Uploads the selected file immediately (private, owner-only — see
 * uploads module / CLAUDE.md "Uploads subsystem") and stores the
 * resulting { id, url, name } in the field's submission value.
 */
function FileFieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: { id: string; url: string; name: string } | undefined;
  onChange: (value: any) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadsApi.upload(file, { entityType: 'form_submission' });
      const { id, url } = res.data as { id: string; url: string };
      onChange({ id, url, name: file.name });
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 cursor-pointer hover:bg-gray-50 w-fit">
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
        {uploading ? 'Uploading…' : value ? 'Replace file' : 'Choose file'}
        <input type="file" className="hidden" onChange={handleFile} />
      </label>
      {value && !uploading && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
          <CheckCircle2 size={13} className="text-green-600" /> {value.name}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {field.helpText && !value && <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>}
    </div>
  );
}
