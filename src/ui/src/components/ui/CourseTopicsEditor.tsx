import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Link as LinkIcon } from 'lucide-react';
import { courseTopicsApi } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { PermanentDeleteDialog } from '../shared/PermanentDeleteDialog';
import type { CourseTopic, TopicReferenceLink } from '../../types';

type ReferenceLink = TopicReferenceLink;

interface TopicFormState {
  title: string;
  description: string;
  referenceLinks: ReferenceLink[];
}

const emptyForm: TopicFormState = { title: '', description: '', referenceLinks: [] };

interface Props {
  courseId: number;
  courseLabel: string;
  canEdit: boolean;
  /** Optional "Collapse" affordance — inline panels are usually closed by re-collapsing the row itself. */
  onClose?: () => void;
}

/**
 * Per-course topic breakdown with reference links — editable only by
 * SuperAdmin/Admin/Faculty (enforced server-side too; `canEdit` here just
 * hides the controls for other roles who can still view topics read-only).
 *
 * Rendered inline (via DataTable's `renderExpanded`) directly under the
 * course's row — not as a popup modal.
 */
export function CourseTopicsEditor({ courseId, courseLabel, canEdit, onClose }: Props) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<TopicFormState>(emptyForm);
  const isSuperAdmin = useAuthStore((s) => s.user?.role) === 'super_admin';
  const [purgeTopic, setPurgeTopic] = useState<CourseTopic | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['course-topics', courseId],
    queryFn: () => courseTopicsApi.list(courseId),
  });
  const topics: CourseTopic[] = data?.data ?? [];

  const createMutation = useMutation({
    mutationFn: () => courseTopicsApi.create(courseId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-topics', courseId] });
      setEditingId(null);
      setForm(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (id: number) => courseTopicsApi.update(id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-topics', courseId] });
      setEditingId(null);
      setForm(emptyForm);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => courseTopicsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['course-topics', courseId] }),
  });

  const startEdit = (topic: CourseTopic) => {
    setEditingId(topic.id);
    setForm({
      title: topic.title,
      description: topic.description ?? '',
      referenceLinks: topic.referenceLinks ?? [],
    });
  };

  const startNew = () => {
    setEditingId('new');
    setForm(emptyForm);
  };

  const addLink = () => setForm((f) => ({ ...f, referenceLinks: [...f.referenceLinks, { label: '', url: '' }] }));
  const removeLink = (i: number) =>
    setForm((f) => ({ ...f, referenceLinks: f.referenceLinks.filter((_, idx) => idx !== i) }));
  const updateLink = (i: number, patch: Partial<ReferenceLink>) =>
    setForm((f) => ({
      ...f,
      referenceLinks: f.referenceLinks.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));

  const save = () => {
    if (editingId === 'new') createMutation.mutate();
    else if (typeof editingId === 'number') updateMutation.mutate(editingId);
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-semibold text-gray-900">Topics — {courseLabel}</h2>
          <p className="text-xs text-gray-500">Topic-level detail with reference links, used for finer-grained transfer matching.</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-xs font-medium text-gray-400 hover:text-gray-600">
            Collapse
          </button>
        )}
      </div>

      {isSuperAdmin && purgeTopic && (
        <PermanentDeleteDialog
          entity="topics"
          id={purgeTopic.id}
          fallbackLabel={purgeTopic.title}
          onClose={() => setPurgeTopic(null)}
          onDeleted={() => {
            setPurgeTopic(null);
            qc.invalidateQueries({ queryKey: ['course-topics'] });
          }}
        />
      )}

      {isLoading && <div className="text-center text-gray-400 py-8">Loading…</div>}

        <div className="space-y-3 mb-4">
          {topics.map((t) => (
            <div key={t.id} className="border border-gray-200 rounded-lg p-4">
              {editingId === t.id ? (
                <TopicForm
                  form={form}
                  setForm={setForm}
                  addLink={addLink}
                  removeLink={removeLink}
                  updateLink={updateLink}
                  onCancel={() => setEditingId(null)}
                  onSave={save}
                  saving={saving}
                />
              ) : (
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-gray-900">{t.title}</h3>
                    {canEdit && (
                      <div className="flex items-center gap-3 text-xs">
                        <button onClick={() => startEdit(t)} className="text-brand-700 hover:underline">Edit</button>
                        <button onClick={() => removeMutation.mutate(t.id)} className="text-red-500 hover:underline">Delete</button>
                        {isSuperAdmin && (
                          <button onClick={() => setPurgeTopic(t)} className="font-medium text-red-700 hover:underline">Delete permanently</button>
                        )}
                      </div>
                    )}
                  </div>
                  {t.description && <p className="text-sm text-gray-600 mt-1">{t.description}</p>}
                  {t.referenceLinks?.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {t.referenceLinks.map((l: ReferenceLink, i: number) => (
                        <li key={i} className="flex items-center gap-1.5 text-xs">
                          <LinkIcon size={12} className="text-gray-400" />
                          <a href={l.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            {l.label || l.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}

          {topics.length === 0 && !isLoading && editingId !== 'new' && (
            <div className="text-center text-gray-400 py-6 text-sm">No topics added yet.</div>
          )}

          {editingId === 'new' && (
            <div className="border border-brand-200 rounded-lg p-4">
              <TopicForm
                form={form}
                setForm={setForm}
                addLink={addLink}
                removeLink={removeLink}
                updateLink={updateLink}
                onCancel={() => setEditingId(null)}
                onSave={save}
                saving={saving}
              />
            </div>
          )}
        </div>

      {canEdit && editingId === null && (
        <button
          onClick={startNew}
          className="flex items-center gap-2 text-sm font-medium text-brand-700 hover:text-brand-900"
        >
          <Plus size={16} /> Add Topic
        </button>
      )}
    </div>
  );
}

function TopicForm({
  form,
  setForm,
  addLink,
  removeLink,
  updateLink,
  onCancel,
  onSave,
  saving,
}: {
  form: TopicFormState;
  setForm: (updater: (f: TopicFormState) => TopicFormState) => void;
  addLink: () => void;
  removeLink: (i: number) => void;
  updateLink: (i: number, patch: Partial<ReferenceLink>) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3">
      <input
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        placeholder="Topic title"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <textarea
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="Description (what this topic covers)"
        rows={2}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500">Reference links (syllabus, catalog page, etc.)</p>
        {form.referenceLinks.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={l.label}
              onChange={(e) => updateLink(i, { label: e.target.value })}
              placeholder="Label"
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <input
              value={l.url}
              onChange={(e) => updateLink(i, { url: e.target.value })}
              placeholder="https://…"
              className="flex-[2] px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button onClick={() => removeLink(i)} className="text-red-400 hover:text-red-600">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button onClick={addLink} className="flex items-center gap-1 text-xs text-brand-700 hover:underline">
          <Plus size={12} /> Add link
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-2 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving || !form.title.trim()}
          className="flex-1 py-2 bg-brand-800 text-white rounded-lg text-xs font-medium hover:bg-brand-900 disabled:bg-brand-400"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
