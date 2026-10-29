// Shared look and helpers for the TransferHub decks (build-full.js, build-demo.js).
// One maroon brand, Cambria headings, Calibri body, two slide layouts (content + dark).
const fs = require('fs');
const path = require('path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');
const fi = require('react-icons/fi');
const pptxgen = require('pptxgenjs');
const TEAM = require('./team');

const HERE = path.join(__dirname, '..');
const REPO = path.join(HERE, '..', '..');
const SCREENS = path.join(HERE, 'screens');
const TEAM_DIR = path.join(REPO, '_designs', 'team');
const LINKS = {
  repo: 'https://github.com/Evoke-Hackathon-2026/Clopay-CodeCrafters',
  site: 'https://transferhub.wcubeprojects.in/',
};

const THEME = {
  name: 'TransferHub',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '2B1A1D', lt1: 'FFFFFF', dk2: '3A040B', lt2: 'FDF2F3',
    accent1: '770816', accent2: 'D9A441', accent3: 'CF3A53', accent4: '2F7D5B', accent5: '5B6B8C', accent6: 'E8C9CD',
    hlink: '770816', folHlink: '5C0712',
  },
};
const C = { maroon: '770816', deep: '3A040B', gold: 'D9A441', tint: 'FDF2F3', ink: '2B1A1D', mute: '6B5A5D', green: '2F7D5B', amber: 'C98A1B', red: 'B3261E', white: 'FFFFFF', rose: 'E8C9CD', line: 'D8B9BE' };
const W = 13.33, H = 7.5;

// apply_theme.js ships with the pptx skill; its folder name changes between sessions, so look for it.
function findApplyTheme() {
  if (process.env.APPLY_THEME) return require(process.env.APPLY_THEME).applyTheme;
  const base = '/root/.claude/skills/synced';
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'pptx', 'scripts', 'apply_theme.js');
      if (fs.existsSync(p)) return require(p).applyTheme;
    }
  }
  return null;
}

async function iconData(name, color = 'FFFFFF') {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(fi[name], { color: '#' + color, size: 256 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

// Square/circle crop of a portrait centred on the face (see team.js), downscaled to 260px.
async function facePng(m, round = true) {
  const file = path.join(TEAM_DIR, m.file);
  const md = await sharp(file).rotate().metadata();
  const iw = md.width, ih = md.height;
  const side = Math.min(Math.round(m.s * iw), iw, ih);
  const left = Math.max(0, Math.min(iw - side, Math.round(m.cx * iw - side / 2)));
  const top = Math.max(0, Math.min(ih - side, Math.round(m.cy * ih - side / 2)));
  let img = sharp(file).rotate().extract({ left, top, width: side, height: side }).resize(260, 260);
  if (round) {
    const mask = Buffer.from('<svg width="260" height="260"><circle cx="130" cy="130" r="130" fill="#fff"/></svg>');
    img = img.composite([{ input: mask, blend: 'dest-in' }]);
  }
  return 'image/png;base64,' + (await img.png().toBuffer()).toString('base64');
}

// A logo downscaled so the pptx stays small.
async function logoData(file, width = 900) {
  const buf = await sharp(path.join(TEAM_DIR, file)).resize({ width }).png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
  const md = await sharp(buf).metadata();
  return { data: 'image/png;base64,' + buf.toString('base64'), ratio: md.width / md.height };
}

function createDeck({ title, footer, titleWidth = 12.1 }) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = title;
  pres.author = 'Clopay CodeCrafters';
  pres.company = 'Clopay CodeCrafters';

  pres.defineSlideMaster({
    title: 'TH_CONTENT',
    background: { color: C.white },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.35, w: titleWidth, h: 0.95, fontFace: THEME.headFontFace, fontSize: 30, bold: true, color: C.maroon, align: 'left', valign: 'middle', margin: 0 }, text: '' } },
      { text: { text: footer, options: { x: 0.6, y: 7.05, w: 9, h: 0.3, fontSize: 10, color: C.mute, margin: 0 } } },
    ],
    slideNumber: { x: 12.3, y: 7.05, w: 0.45, h: 0.3, fontSize: 10, color: C.mute, align: 'right' },
  });
  pres.defineSlideMaster({ title: 'TH_DARK', background: { color: C.deep }, objects: [] });

  const DIMS = {};
  let section = null;

  const k = {
    pres, C, W, H, THEME, LINKS, TEAM,
    section(t) { section = t; pres.addSection({ title: t }); },
    content(t, notes) {
      const s = pres.addSlide({ masterName: 'TH_CONTENT', sectionTitle: section || undefined });
      s.addText(t, { placeholder: 'title' });
      if (notes) s.addNotes(notes);
      return s;
    },
    dark(notes) {
      const s = pres.addSlide({ masterName: 'TH_DARK', sectionTitle: section || undefined });
      if (notes) s.addNotes(notes);
      return s;
    },
    text(s, t, o) { s.addText(t, { margin: 0, isTextBox: true, ...o }); },
    card(s, x, y, w, h, fill = C.tint, name) {
      s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: 0.12, objectName: name,
        shadow: { type: 'outer', color: '000000', opacity: 0.08, blur: 8, offset: 2, angle: 90 } });
    },
    pill(s, t, x, y, w, h, fill, color = C.white, fontSize = 13) {
      s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: h / 2 });
      s.addText(t, { x, y, w, h, align: 'center', valign: 'middle', fontSize, bold: true, color, margin: 0, isTextBox: true });
    },
    async iconCircle(s, name, x, y, d = 0.7, bg = C.maroon, fg = 'FFFFFF') {
      s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: bg }, line: { color: bg, width: 0 } });
      s.addImage({ data: await iconData(name, fg), x: x + d * 0.22, y: y + d * 0.22, w: d * 0.56, h: d * 0.56, altText: name });
    },
    arrow(s, x1, y1, x2, y2, color = C.gold) {
      const o = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001),
        line: { color, width: 2, endArrowType: 'triangle' }, flipH: x2 < x1, flipV: y2 < y1 };
      s.addShape(pres.ShapeType.line, o);
    },
    // Screenshot cropped to the box's aspect ratio. top/left are fractions of the image to start from.
    async shot(s, file, x, y, w, h, name, { top = 0, left = 0, label } = {}) {
      const full = path.join(SCREENS, file);
      if (fs.existsSync(full)) {
        if (!DIMS[file]) DIMS[file] = await sharp(full).metadata();
        const { width: iw, height: ih } = DIMS[file];
        const want = w / h;
        let cw = Math.round(iw * (1 - left)), ch = Math.round(cw / want);
        const t0 = Math.round(ih * top);
        if (ch > ih - t0) { ch = ih - t0; cw = Math.round(ch * want); }
        const buf = await sharp(full).extract({ left: Math.round(iw * left), top: t0, width: cw, height: ch })
          .resize({ width: Math.min(cw, 1600) }).jpeg({ quality: 82 }).toBuffer();
        s.addImage({ data: 'image/jpeg;base64,' + buf.toString('base64'), x, y, w, h, objectName: name, altText: name,
          shadow: { type: 'outer', color: '000000', opacity: 0.22, blur: 12, offset: 3, angle: 90 } });
        s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: C.white, transparency: 100 }, line: { color: C.line, width: 0.75 } });
      } else {
        s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: C.tint }, line: { color: C.rose, width: 1, dashType: 'dash' }, rectRadius: 0.1 });
        s.addText(label || ('Screenshot to add: ' + file), { x: x + 0.2, y, w: w - 0.4, h, align: 'center', valign: 'middle', color: C.mute, fontSize: 14, margin: 0, isTextBox: true });
      }
    },
    async teamSlide(t = 'The team behind TransferHub', notes = 'Clopay CodeCrafters: two Microsoft-practice and three UI-practice engineers from Evoke Technologies.') {
      const s = k.content(t, notes);
      const cw = 2.3, gap = 0.15;
      for (let i = 0; i < TEAM.length; i++) {
        const m = TEAM[i];
        const x = 0.6 + i * (cw + gap), y = 1.55;
        k.card(s, x, y, cw, 4.55, C.tint, 'Team card ' + m.name);
        s.addImage({ data: await facePng(m), x: x + 0.35, y: y + 0.3, w: 1.6, h: 1.6, altText: 'Photo of ' + m.name });
        s.addShape(pres.ShapeType.ellipse, { x: x + 0.35, y: y + 0.3, w: 1.6, h: 1.6, fill: { color: C.white, transparency: 100 }, line: { color: C.maroon, width: 2.5 } });
        k.text(s, m.name, { x: x + 0.1, y: y + 2.05, w: cw - 0.2, h: 0.7, align: 'center', valign: 'middle', fontFace: THEME.headFontFace, fontSize: 17, bold: true, color: C.maroon });
        k.pill(s, m.practice, x + 0.25, y + 2.85, cw - 0.5, 0.36, m.practice.startsWith('Microsoft') ? C.maroon : C.gold, m.practice.startsWith('Microsoft') ? C.white : C.deep, 12);
        k.text(s, 'Emp. ID ' + m.id, { x: x + 0.1, y: y + 3.33, w: cw - 0.2, h: 0.3, align: 'center', fontSize: 12, color: C.mute });
        const [u, d] = m.email.split('@');
        k.text(s, [{ text: u, options: { breakLine: true } }, { text: '@' + d }], { x: x + 0.1, y: y + 3.68, w: cw - 0.2, h: 0.6, align: 'center', fontSize: 11, color: C.ink });
      }
      const lg = await logoData('Clopay CodeCrafters.png', 320);
      const lh = 0.75;
      s.addImage({ data: lg.data, x: 0.6, y: 6.2, w: lh * lg.ratio, h: lh, altText: 'Clopay CodeCrafters logo' });
      k.text(s, 'Clopay CodeCrafters  ·  Evoke FDE AI Hackathon 5.0  ·  Problem 1', { x: 0.6 + lh * lg.ratio + 0.3, y: 6.2, w: 8, h: lh, valign: 'middle', fontSize: 15, bold: true, color: C.ink });
      return s;
    },
    async titleSlide({ headline, sub, kicker, notes }) {
      const s = k.dark(notes);
      const th = await logoData('TransferHub.png', 700);
      s.addShape(pres.ShapeType.roundRect, { x: 0.7, y: 0.6, w: 3.8, h: 1.9, fill: { color: C.white }, line: { color: C.white, width: 0 }, rectRadius: 0.15 });
      s.addImage({ data: th.data, x: 0.85, y: 0.65, w: 1.8 * th.ratio, h: 1.8, altText: 'TransferHub logo' });
      const cc = await logoData('Clopay CodeCrafters.png', 560);
      s.addImage({ data: cc.data, x: 9.3, y: 0.45, w: 2.0 * cc.ratio, h: 2.0, altText: 'Clopay CodeCrafters logo' });
      k.text(s, headline, { x: 0.7, y: 2.85, w: 11.9, h: 1.0, fontFace: THEME.headFontFace, fontSize: 46, bold: true, color: C.white });
      k.text(s, sub, { x: 0.7, y: 3.95, w: 11.0, h: 0.9, fontSize: 22, color: C.rose, valign: 'top' });
      k.text(s, [{ text: 'Clopay CodeCrafters', options: { bold: true, color: C.gold } }, { text: '   ·   ' + kicker, options: { color: C.white } }],
        { x: 0.7, y: 5.75, w: 11.9, h: 0.5, fontSize: 18 });
      k.text(s, [{ text: LINKS.site, options: { hyperlink: { url: LINKS.site }, color: C.rose } }], { x: 0.7, y: 6.35, w: 8, h: 0.4, fontSize: 14 });
      return s;
    },
    async closeSlide({ headline, notes }) {
      const s = k.dark(notes);
      k.text(s, headline, { x: 0.8, y: 0.7, w: 11.7, h: 1.7, fontFace: THEME.headFontFace, fontSize: 36, bold: true, color: C.white, valign: 'top' });
      const rows = [['FiGithub', 'Source code', LINKS.repo], ['FiGlobe', 'Live site', LINKS.site]];
      for (let i = 0; i < rows.length; i++) {
        const y = 2.75 + i * 1.15;
        await k.iconCircle(s, rows[i][0], 0.8, y, 0.8, C.gold, C.deep);
        k.text(s, rows[i][1], { x: 1.85, y, w: 6, h: 0.35, fontSize: 15, color: C.rose });
        k.text(s, [{ text: rows[i][2], options: { hyperlink: { url: rows[i][2] } } }], { x: 1.85, y: y + 0.36, w: 7.2, h: 0.45, fontSize: 19, bold: true, color: C.white });
      }
      s.addShape(pres.ShapeType.roundRect, { x: 0.8, y: 5.25, w: 4.4, h: 1.7, fill: { color: C.white }, line: { color: C.white, width: 0 }, rectRadius: 0.15 });
      const th = await logoData('TransferHub.png', 700);
      s.addImage({ data: th.data, x: 0.8 + (4.4 - 1.55 * th.ratio) / 2, y: 5.32, w: 1.55 * th.ratio, h: 1.55, altText: 'TransferHub logo' });
      const cc = await logoData('Clopay CodeCrafters.png', 560);
      s.addImage({ data: cc.data, x: 12.7 - 2.2 * cc.ratio, y: 2.6, w: 2.2 * cc.ratio, h: 2.2, altText: 'Clopay CodeCrafters logo' });
      for (let i = 0; i < TEAM.length; i++) {
        s.addImage({ data: await facePng(TEAM[i]), x: 5.85 + i * 1.0, y: 5.6, w: 0.85, h: 0.85, altText: TEAM[i].name });
      }
      k.text(s, 'Clopay CodeCrafters', { x: 5.85, y: 6.5, w: 5, h: 0.35, fontSize: 14, bold: true, color: C.gold });
      return s;
    },
    async write(file) {
      const out = path.join(HERE, file);
      await pres.writeFile({ fileName: out });
      const applyTheme = findApplyTheme();
      if (applyTheme) await applyTheme(out, THEME);
      else console.warn('apply_theme.js not found: theme colours left at Office defaults (set APPLY_THEME=/path/to/apply_theme.js)');
      console.log('wrote', out);
    },
  };
  return k;
}

module.exports = { createDeck, C, THEME, LINKS, TEAM, iconData };
