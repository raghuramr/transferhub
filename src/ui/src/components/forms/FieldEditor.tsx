import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { FormField, FormFieldType } from '../../types';
import { Button } from '../ui/Button';

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio buttons' },
  { value: 'checkboxes', label: 'Checkboxes' },
  { value: 'yesno', label: 'Yes / No' },
  { value: 'file', label: 'File upload' },
];

const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function newField(): FormField {
  return { key: `field_${Date.now()}`, label: 'New question', type: 'text', required: false };
}

export function FieldEditor({
  fields,
  onChange,
}: {
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
}) {
  const update = (index: number, patch: Partial<FormField>) =>
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));

  const remove = (index: number) => onChange(fields.filter((_, i) => i !== index));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const copy = [...fields];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  };

  const add = () => onChange([...fields, newField()]);

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {fields.map((field, index) => (
          <motion.div
            key={field.key + index}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-400">Question {index + 1}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => move(index, -1)} disabled={index === 0} className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30">
                    <ChevronUp size={15} />
                  </button>
                  <button onClick={() => move(index, 1)} disabled={index === fields.length - 1} className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30">
                    <ChevronDown size={15} />
                  </button>
                  <button onClick={() => remove(index)} className="p-1.5 text-gray-400 hover:text-red-600">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  value={field.label}
                  placeholder="Question label"
                  onChange={(e) => update(index, { label: e.target.value })}
                />
                <input
                  className={inputCls}
                  value={field.key}
                  placeholder="field_key (unique)"
                  onChange={(e) => update(index, { key: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-3">
                <select
                  className={inputCls}
                  value={field.type}
                  onChange={(e) => update(index, { type: e.target.value as FormFieldType })}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-sm text-gray-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={!!field.required}
                    onChange={(e) => update(index, { required: e.target.checked })}
                  />
                  Required
                </label>
              </div>

              {['select', 'radio', 'checkboxes'].includes(field.type) && (
                <input
                  className={inputCls}
                  value={(field.options ?? []).join(', ')}
                  placeholder="Options, comma separated"
                  onChange={(e) =>
                    update(index, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                  }
                />
              )}

              <input
                className={inputCls}
                value={field.placeholder ?? ''}
                placeholder="Placeholder / help text (optional)"
                onChange={(e) => update(index, { placeholder: e.target.value })}
              />
              <input
                className={inputCls}
                value={field.section ?? ''}
                placeholder="Step / section name (registration form only, optional)"
                onChange={(e) => update(index, { section: e.target.value })}
              />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={add}>
        Add question
      </Button>
    </div>
  );
}
