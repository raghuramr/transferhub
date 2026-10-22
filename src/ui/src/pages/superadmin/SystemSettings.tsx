import { useState } from 'react';
import { Settings, Save, Info } from 'lucide-react';

type SettingGroup = {
  title: string;
  desc: string;
  fields: { key: string; label: string; type: 'number' | 'text' | 'select'; options?: string[]; help?: string }[];
};

const GROUPS: SettingGroup[] = [
  {
    title: 'AI Matching',
    desc: 'Configure Anthropic AI match thresholds and behaviour',
    fields: [
      { key: 'ai_auto_apply_threshold', label: 'Auto-apply threshold (0–1)', type: 'number', help: 'Evaluations scoring above this are auto-applied without human review.' },
      { key: 'ai_candidate_count', label: 'Max AI candidates per course', type: 'number' },
      { key: 'ai_model', label: 'Anthropic model', type: 'select', options: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'] },
    ],
  },
  {
    title: 'Transfer Credit Rules',
    desc: 'BU-level academic business rules',
    fields: [
      { key: 'min_grade_threshold', label: 'Minimum eligible grade', type: 'text', help: 'Courses graded below this are not eligible (default: C).' },
      { key: 'quarter_credit_divisor', label: 'Quarter credit divisor', type: 'number', help: 'Quarter credits ÷ this value → semester credits (default: 1.5).' },
      { key: 'group_c_min_credits', label: 'BU Group C minimum credits', type: 'number', help: 'Residency requirement — minimum credits earned at BU.' },
    ],
  },
  {
    title: 'Security',
    desc: 'Authentication and session parameters',
    fields: [
      { key: 'max_login_attempts', label: 'Max login attempts before lockout', type: 'number' },
      { key: 'access_token_ttl_minutes', label: 'Access token TTL (minutes)', type: 'number' },
      { key: 'refresh_token_ttl_days', label: 'Refresh token TTL (days)', type: 'number' },
    ],
  },
];

const DEFAULTS: Record<string, string> = {
  ai_auto_apply_threshold: '0.92',
  ai_candidate_count: '3',
  ai_model: 'claude-opus-4-5',
  min_grade_threshold: 'C',
  quarter_credit_divisor: '1.5',
  group_c_min_credits: '16',
  max_login_attempts: '5',
  access_token_ttl_minutes: '15',
  refresh_token_ttl_days: '7',
};

export default function SystemSettings() {
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In production this POSTs to /settings
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Settings className="text-gray-600" size={24} />
        <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>
      </div>
      <p className="text-gray-500 mb-8">
        Configure AI thresholds, business rules and security parameters.
      </p>

      <div className="space-y-6">
        {GROUPS.map((group) => (
          <div key={group.title} className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-1">{group.title}</h2>
            <p className="text-sm text-gray-500 mb-5">{group.desc}</p>
            <div className="space-y-4">
              {group.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {field.label}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      value={values[field.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={values[field.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      step={field.type === 'number' ? 'any' : undefined}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  )}
                  {field.help && (
                    <p className="flex items-start gap-1.5 text-xs text-gray-400 mt-1">
                      <Info size={12} className="mt-0.5 shrink-0" />
                      {field.help}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Save size={16} />
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
        {saved && <p className="text-sm text-green-600">Settings saved successfully.</p>}
      </div>
    </div>
  );
}
