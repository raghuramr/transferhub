import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff,
  Heading1, FileText, Bell, LayoutGrid, MousePointerClick, Minus, Image as ImageIcon, Sparkle,
} from 'lucide-react';
import type { Block, BlockType, CardItem } from '../../types';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

const BLOCK_META: Record<BlockType, { label: string; icon: React.ReactNode }> = {
  hero:     { label: 'Hero banner', icon: <Sparkle size={14} /> },
  heading:  { label: 'Heading',    icon: <Heading1 size={14} /> },
  richtext: { label: 'Rich text',  icon: <FileText size={14} /> },
  notice:   { label: 'Notice',     icon: <Bell size={14} /> },
  cards:    { label: 'Cards',      icon: <LayoutGrid size={14} /> },
  cta:      { label: 'Call to action', icon: <MousePointerClick size={14} /> },
  divider:  { label: 'Divider',    icon: <Minus size={14} /> },
  image:    { label: 'Image',      icon: <ImageIcon size={14} /> },
};

function newBlock(type: BlockType): Block {
  const id = `b${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const base = { id, visible: true } as const;
  switch (type) {
    case 'hero':     return { ...base, type, title: 'Welcome', subtitle: '', ctaLabel: 'Sign in', ctaHref: '/login' };
    case 'heading':  return { ...base, type, text: 'New heading', subtitle: '' };
    case 'richtext': return { ...base, type, html: '<p>Edit this text&hellip;</p>' };
    case 'notice':   return { ...base, type, tone: 'info', text: 'New announcement' };
    case 'cards':    return { ...base, type, items: [] };
    case 'cta':      return { ...base, type, text: 'Call to action text', buttonLabel: 'Go', buttonHref: '/' };
    case 'divider':  return { ...base, type };
    case 'image':    return { ...base, type, url: '', caption: '' };
  }
}

const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

export function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const update = (id: string, patch: Partial<Block>) =>
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));

  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const copy = [...blocks];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  };

  const addBlock = (type: BlockType) => {
    onChange([...blocks, newBlock(type)]);
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {blocks.map((block, index) => (
          <motion.div
            key={block.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className={`border rounded-xl p-4 ${
                block.visible ? 'border-gray-200 bg-white' : 'border-dashed border-gray-300 bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <Badge tone="brand" className="gap-1.5">
                  {BLOCK_META[block.type].icon}
                  {BLOCK_META[block.type].label}
                </Badge>
                <div className="flex items-center gap-1">
                  <button onClick={() => move(index, -1)} disabled={index === 0} className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30">
                    <ChevronUp size={16} />
                  </button>
                  <button onClick={() => move(index, 1)} disabled={index === blocks.length - 1} className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30">
                    <ChevronDown size={16} />
                  </button>
                  <button
                    onClick={() => update(block.id, { visible: !block.visible })}
                    className="p-1.5 text-gray-400 hover:text-gray-700"
                    title={block.visible ? 'Hide from visitors' : 'Show to visitors'}
                  >
                    {block.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button onClick={() => remove(block.id)} className="p-1.5 text-gray-400 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <BlockFields block={block} onChange={(patch) => update(block.id, patch)} />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {!adding ? (
        <Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
          Add block
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2 p-3 border border-dashed border-brand-200 rounded-xl bg-brand-50/40">
          {(Object.keys(BLOCK_META) as BlockType[]).map((type) => (
            <button
              key={type}
              onClick={() => addBlock(type)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:border-brand-400 hover:text-brand-800 transition-colors"
            >
              {BLOCK_META[type].icon}
              {BLOCK_META[type].label}
            </button>
          ))}
          <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (patch: Partial<Block>) => void }) {
  switch (block.type) {
    case 'hero':
      return (
        <div className="space-y-2">
          <input className={inputCls} value={block.title} placeholder="Hero title"
            onChange={(e) => onChange({ title: e.target.value } as Partial<Block>)} />
          <input className={inputCls} value={block.subtitle ?? ''} placeholder="Subtitle (optional)"
            onChange={(e) => onChange({ subtitle: e.target.value } as Partial<Block>)} />
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} value={block.ctaLabel ?? ''} placeholder="Button label (optional)"
              onChange={(e) => onChange({ ctaLabel: e.target.value } as Partial<Block>)} />
            <input className={inputCls} value={block.ctaHref ?? ''} placeholder="Button link (e.g. /login)"
              onChange={(e) => onChange({ ctaHref: e.target.value } as Partial<Block>)} />
          </div>
        </div>
      );

    case 'heading':
      return (
        <div className="space-y-2">
          <input className={inputCls} value={block.text} placeholder="Heading text"
            onChange={(e) => onChange({ text: e.target.value } as Partial<Block>)} />
          <input className={inputCls} value={block.subtitle ?? ''} placeholder="Subtitle (optional)"
            onChange={(e) => onChange({ subtitle: e.target.value } as Partial<Block>)} />
        </div>
      );

    case 'richtext':
      return (
        <textarea className={inputCls} rows={4} value={block.html} placeholder="HTML content"
          onChange={(e) => onChange({ html: e.target.value } as Partial<Block>)} />
      );

    case 'notice':
      return (
        <div className="space-y-2">
          <select className={inputCls} value={block.tone}
            onChange={(e) => onChange({ tone: e.target.value as any } as Partial<Block>)}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="success">Success</option>
          </select>
          <textarea className={inputCls} rows={2} value={block.text} placeholder="Announcement text"
            onChange={(e) => onChange({ text: e.target.value } as Partial<Block>)} />
        </div>
      );

    case 'cards':
      return <CardsFields items={block.items} onChange={(items) => onChange({ items } as Partial<Block>)} />;

    case 'cta':
      return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input className={inputCls} value={block.text} placeholder="Text"
            onChange={(e) => onChange({ text: e.target.value } as Partial<Block>)} />
          <input className={inputCls} value={block.buttonLabel} placeholder="Button label"
            onChange={(e) => onChange({ buttonLabel: e.target.value } as Partial<Block>)} />
          <input className={inputCls} value={block.buttonHref} placeholder="Button link (e.g. /student/upload)"
            onChange={(e) => onChange({ buttonHref: e.target.value } as Partial<Block>)} />
        </div>
      );

    case 'divider':
      return <p className="text-xs text-gray-400">A horizontal rule — no settings needed.</p>;

    case 'image':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className={inputCls} value={block.url} placeholder="Image URL"
            onChange={(e) => onChange({ url: e.target.value } as Partial<Block>)} />
          <input className={inputCls} value={block.caption ?? ''} placeholder="Caption (optional)"
            onChange={(e) => onChange({ caption: e.target.value } as Partial<Block>)} />
        </div>
      );

    default:
      return null;
  }
}

function CardsFields({ items, onChange }: { items: CardItem[]; onChange: (items: CardItem[]) => void }) {
  const update = (id: string, patch: Partial<CardItem>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id: string) => onChange(items.filter((i) => i.id !== id));
  const add = () =>
    onChange([...items, { id: `c${Date.now()}`, visible: true, title: 'New card', body: '' }]);

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="flex gap-2 items-start p-2 bg-gray-50 rounded-lg">
          <div className="flex-1 space-y-1.5">
            <input className={inputCls} value={item.title} placeholder="Card title"
              onChange={(e) => update(item.id, { title: e.target.value })} />
            <textarea className={inputCls} rows={2} value={item.body} placeholder="Card body"
              onChange={(e) => update(item.id, { body: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <button onClick={() => update(item.id, { visible: !item.visible })} className="p-1 text-gray-400 hover:text-gray-700">
              {item.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button onClick={() => remove(item.id)} className="p-1 text-gray-400 hover:text-red-600">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
      <Button variant="ghost" size="sm" icon={<Plus size={12} />} onClick={add}>
        Add card
      </Button>
    </div>
  );
}
