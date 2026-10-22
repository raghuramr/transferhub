import type { FormField } from '../../types';

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
