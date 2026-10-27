// Builds TransferHub-Hackathon.pptx  (run: node build-deck.js)
const fs = require('fs');
const path = require('path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');
const fi = require('react-icons/fi');
const pptxgen = require('pptxgenjs');
const { applyTheme } = require('/root/.claude/skills/synced/91d05a95-25d9-4cff-8a46-6acfec20958e_50c7f75c-4a17-4adc-b70b-10538016e0e0/pptx/scripts/apply_theme.js');

const HERE = __dirname;
const SCREENS = path.join(HERE, 'screens');
const REPO = path.join(HERE, '..', '..');

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
const C = { maroon: '770816', deep: '3A040B', gold: 'D9A441', tint: 'FDF2F3', ink: '2B1A1D', mute: '6B5A5D', green: '2F7D5B', amber: 'C98A1B', red: 'B3261E', white: 'FFFFFF', rose: 'E8C9CD' };

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'TransferHub - Smarter Transfer Credit Evaluation';
pres.author = 'Clopay Code Crafters';
const W = 13.33, H = 7.5;

async function icon(name, color = 'FFFFFF') {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(fi[name], { color: '#' + color, size: 256 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}
const DIMS = {};
const has = (f) => fs.existsSync(path.join(SCREENS, f));
async function shot(slide, file, x, y, w, h, name) {
  if (has(file)) {
    // crop the top of the screenshot to the box's aspect ratio so tall pages fill the frame
    const { width: iw, height: ih } = DIMS[file];
    const want = w / h;
    let cw = iw, ch = Math.round(iw / want);
    if (ch > ih) { ch = ih; cw = Math.round(ih * want); }
    const buf = await sharp(path.join(SCREENS, file)).extract({ left: 0, top: 0, width: cw, height: ch }).png().toBuffer();
    slide.addImage({ data: 'image/png;base64,' + buf.toString('base64'), x, y, w, h, objectName: name, altText: name,
      shadow: { type: 'outer', color: '000000', opacity: 0.25, blur: 12, offset: 3, angle: 90 } });
  } else {
    slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: C.tint }, line: { color: C.rose, width: 1 }, rectRadius: 0.1 });
    slide.addText('screenshot: ' + file, { x, y, w, h, align: 'center', valign: 'middle', color: C.mute, fontSize: 14, isTextBox: true });
  }
}

const TITLE = { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: 'Cambria', fontSize: 34, bold: true, color: C.maroon, margin: 0, isTextBox: true, valign: 'middle' };
function content(title, notes) {
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addText(title, { ...TITLE });
  if (notes) s.addNotes(notes);
  s.addText('TransferHub  ·  Clopay Code Crafters', { x: 0.6, y: 7.05, w: 6, h: 0.3, fontSize: 10, color: C.mute, margin: 0, isTextBox: true });
  return s;
}
function dark(notes) {
  const s = pres.addSlide();
  s.background = { color: C.deep };
  if (notes) s.addNotes(notes);
  return s;
}
function card(s, x, y, w, h, fill = C.tint) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: 0.12,
    shadow: { type: 'outer', color: '000000', opacity: 0.08, blur: 8, offset: 2, angle: 90 } });
}
async function iconCircle(s, name, x, y, d = 0.7, bg = C.maroon, fg = 'FFFFFF') {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: bg }, line: { color: bg, width: 0 } });
  s.addImage({ data: await icon(name, fg), x: x + d * 0.22, y: y + d * 0.22, w: d * 0.56, h: d * 0.56, altText: name });
}

(async () => {
  for (const f of fs.existsSync(SCREENS) ? fs.readdirSync(SCREENS) : []) if (f.endsWith('.png')) DIMS[f] = await sharp(path.join(SCREENS, f)).metadata();
  // 1 ─ Title
  {
    const s = dark('Open with the one-line promise: faster for evaluators, clearer for students, and the department still decides.');
    s.addShape(pres.ShapeType.roundRect, { x: 0.7, y: 0.6, w: 3.6, h: 1.9, fill: { color: C.white }, line: { color: C.white, width: 0 }, rectRadius: 0.15 });
    s.addImage({ path: path.join(REPO, 'src/ui/public/logo.png'), x: 0.7, y: 0.6, w: 3.6, h: 1.89, altText: 'TransferHub logo' });
    s.addText('Smarter Transfer Credit Evaluation', { x: 0.7, y: 2.7, w: 11.5, h: 1.0, fontFace: 'Cambria', fontSize: 48, bold: true, color: C.white, margin: 0, isTextBox: true });
    s.addText('From zero units and weeks of waiting to a clear status for every course, on day one.', { x: 0.7, y: 3.8, w: 10.5, h: 0.9, fontSize: 22, color: C.rose, margin: 0, isTextBox: true });
    s.addText([{ text: 'Clopay Code Crafters', options: { bold: true, color: C.gold } }, { text: '   ·   FDE AI Hackathon 5.0   ·   Problem 1 · Boston University', options: { color: C.white } }],
      { x: 0.7, y: 5.9, w: 11.5, h: 0.5, fontSize: 18, margin: 0, isTextBox: true });
  }

  // 2 ─ Problem in numbers
  {
    const s = content('Every course, every student, one syllabus at a time',
      'BU takes 800+ transfers a year. Courses without an equivalency show 0 units, students chase syllabi, evaluators compare by hand.');
    const stats = [['800+', 'transfer students a year at BU'], ['0 units', 'shown for every pending course'], ['1 by 1', 'manual syllabus comparisons'], ['12 mo', 'to settle all credit']];
    stats.forEach((st, i) => {
      const x = 0.6 + i * 3.08;
      card(s, x, 1.7, 2.85, 2.2);
      s.addText(st[0], { x, y: 1.9, w: 2.85, h: 1.0, align: 'center', fontFace: 'Cambria', fontSize: 44, bold: true, color: C.maroon, margin: 0, isTextBox: true });
      s.addText(st[1], { x: x + 0.2, y: 2.95, w: 2.45, h: 0.8, align: 'center', fontSize: 16, color: C.ink, margin: 0, isTextBox: true });
    });
    const col = [['Students', 'Cannot tell what is happening, chase old syllabi, and do not know how much degree progress is secure.', 'FiUser'],
                 ['Evaluators', 'Compare descriptions, outcomes and credit hours manually, again for every student.', 'FiClipboard'],
                 ['Departments', 'Must keep the final say. Any tool may recommend, never decide.', 'FiShield']];
    for (let i = 0; i < 3; i++) {
      const x = 0.6 + i * 4.1;
      await iconCircle(s, col[i][2], x, 4.4, 0.7);
      s.addText(col[i][0], { x: x + 0.85, y: 4.4, w: 3, h: 0.7, fontSize: 20, bold: true, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
      s.addText(col[i][1], { x, y: 5.25, w: 3.8, h: 1.4, fontSize: 15, color: C.mute, margin: 0, valign: 'top', isTextBox: true });
    }
  }

  // 3 ─ Ask vs answer
  {
    const s = content('What they asked for, and what we built', 'Four tests in the brief. Each has a concrete feature you can click.');
    const rows = [
      ['FiZap', 'Faster', 'Every course triaged into a lane at upload. Known equivalencies apply instantly. Everything else arrives pre-ranked with reasons. Decisions feed back so the next student is instant.'],
      ['FiEye', 'More transparent', 'Per-course status, an animated timeline, notes, reminders and role dashboards replace "0 units".'],
      ['FiHeart', 'Less stressful', 'Syllabi are asked for only where they matter. Applicants get a preview before admission. Documents are read for them.'],
      ['FiShield', 'Department decides', 'Configurable approval stages. AI and rules never reject and never exceed 70% confidence on their own.'],
    ];
    for (let i = 0; i < 4; i++) {
      const y = 1.6 + i * 1.35;
      card(s, 0.6, y, 12.1, 1.2);
      await iconCircle(s, rows[i][0], 0.85, y + 0.27, 0.66);
      s.addText(rows[i][1], { x: 1.8, y, w: 3.1, h: 1.2, fontSize: 20, bold: true, fontFace: 'Cambria', color: C.maroon, margin: 0, valign: 'middle', isTextBox: true });
      s.addText(rows[i][2], { x: 5.0, y: y + 0.05, w: 7.5, h: 1.1, fontSize: 15, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
    }
  }

  // 4 ─ How it works (flow)
  {
    const s = content('One pipeline from upload to posting', 'Walk left to right. Rules first, then known equivalencies, then AI or built-in rules, then the people.');
    const steps = [['Upload', 'Transcript or documents', 'FiUpload'], ['Rules', 'Grade, credits, age, caps', 'FiSliders'], ['Equivalency', 'Known match applies', 'FiCheckCircle'], ['Match', 'AI or built-in rules rank', 'FiCpu'], ['People', 'Faculty to final approver', 'FiUsers'], ['Posted', 'Grade T, student notified', 'FiFlag']];
    const bw = 1.82, gap = 0.24;
    for (let i = 0; i < steps.length; i++) {
      const x = 0.6 + i * (bw + gap);
      card(s, x, 2.0, bw, 2.5, i === 3 ? C.maroon : C.tint);
      await iconCircle(s, steps[i][2], x + bw / 2 - 0.4, 2.2, 0.8, i === 3 ? C.gold : C.maroon, i === 3 ? C.deep : 'FFFFFF');
      s.addText(steps[i][0], { x, y: 3.1, w: bw, h: 0.5, align: 'center', fontSize: 18, bold: true, color: i === 3 ? C.white : C.maroon, margin: 0, isTextBox: true });
      s.addText(steps[i][1], { x: x + 0.1, y: 3.6, w: bw - 0.2, h: 0.8, align: 'center', fontSize: 13, color: i === 3 ? C.rose : C.mute, margin: 0, valign: 'top', isTextBox: true });
      if (i < steps.length - 1) s.addText('›', { x: x + bw - 0.02, y: 2.9, w: gap + 0.04, h: 0.6, align: 'center', fontSize: 26, bold: true, color: C.gold, margin: 0, isTextBox: true });
    }
    s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 5.0, w: 12.1, h: 1.5, fill: { color: C.tint }, line: { color: C.tint, width: 0 }, rectRadius: 0.12 });
    s.addText([{ text: 'The learning loop.  ', options: { bold: true, color: C.maroon } }, { text: 'Every approved decision is saved as a reusable equivalency with effective dates, and AI results are cached across students, so the second student with the same course never waits.', options: { color: C.ink } }],
      { x: 0.9, y: 5.05, w: 11.5, h: 1.4, fontSize: 17, margin: 0, valign: 'middle', isTextBox: true });
  }

  // 5 ─ Six-course demo
  {
    const s = content('The six-course story, upload to posting', 'Maya Rivera moves from Bay State Community College. Three known, two maybe, one quarter-system course converted 4 x 2/3 = 2.66.');
    const rows = [
      ['CSC 110  Intro to Programming', 'Applied', 'BU CS 111 · 4 cr', C.green],
      ['MAT 210  Calculus I', 'Applied', 'BU MA 123 · 4 cr', C.green],
      ['ECO 101  Microeconomics', 'Applied', 'BU EC 101', C.green],
      ['CSC 220  Data Structures', 'Likely match', 'Suggested CS 112 · pending CS dept', C.amber],
      ['CSC 240  Discrete Math', 'Needs syllabus', 'CS 131 or MA 293 · evaluator picks', C.amber],
      ['CIS 150  Linear Algebra (quarter)', '4 qtr → 2.66 cr', 'Elective or MA 242 · evaluator decides', C.maroon],
    ];
    s.addText('External course', { x: 0.9, y: 1.5, w: 4.6, h: 0.4, fontSize: 13, bold: true, color: C.mute, margin: 0, isTextBox: true });
    s.addText('Lane', { x: 5.6, y: 1.5, w: 2.3, h: 0.4, fontSize: 13, bold: true, color: C.mute, margin: 0, isTextBox: true });
    s.addText('What the student sees', { x: 8.0, y: 1.5, w: 4.5, h: 0.4, fontSize: 13, bold: true, color: C.mute, margin: 0, isTextBox: true });
    rows.forEach((r, i) => {
      const y = 1.95 + i * 0.78;
      card(s, 0.6, y, 12.1, 0.68, i % 2 ? C.white : C.tint);
      s.addText(r[0], { x: 0.9, y, w: 4.6, h: 0.68, fontSize: 16, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
      s.addShape(pres.ShapeType.roundRect, { x: 5.6, y: y + 0.13, w: 2.2, h: 0.42, fill: { color: r[3] }, line: { color: r[3], width: 0 }, rectRadius: 0.2 });
      s.addText(r[1], { x: 5.6, y: y + 0.13, w: 2.2, h: 0.42, align: 'center', valign: 'middle', fontSize: 13, bold: true, color: C.white, margin: 0, isTextBox: true });
      s.addText(r[2], { x: 8.0, y, w: 4.6, h: 0.68, fontSize: 15, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
    });
    s.addText('Result: 12 credits secure at upload, three pending items each with a named next step.', { x: 0.6, y: 6.6, w: 12, h: 0.4, fontSize: 16, bold: true, color: C.maroon, margin: 0, isTextBox: true });
  }

  // 6 ─ Evaluator screenshot
  {
    const s = content('Evaluators: everything in one place', 'Request review: timeline, reviewer brief, ranked suggestions with rationale, one-click accept above a threshold, bulk approve in the queue.');
    await shot(s, '05-request-review.png', 0.6, 1.45, 8.3, 5.3, 'Request review screenshot');
    const pts = [['Reviewer brief', 'Policy flags, credit math and Hub rule, generated for free.'], ['Ranked suggestions', 'Each with a plain-language reason. One click accepts all above X%.'], ['Approve in bulk', 'Queue-level approve for clean requests.'], ['Always overridable', 'Faculty can change any match by hand.']];
    pts.forEach((p, i) => {
      const y = 1.55 + i * 1.3;
      s.addText(p[0], { x: 9.2, y, w: 3.6, h: 0.4, fontSize: 18, bold: true, color: C.maroon, fontFace: 'Cambria', margin: 0, isTextBox: true });
      s.addText(p[1], { x: 9.2, y: y + 0.42, w: 3.6, h: 0.8, fontSize: 14, color: C.ink, margin: 0, valign: 'top', isTextBox: true });
    });
  }

  // 7 ─ Student experience
  {
    const s = content('Students: no more black box', 'Per-course lanes, timeline, internal vs student notes, nudge reminders, dashboards.');
    await shot(s, '04-student-dashboard.png', 4.9, 1.45, 7.9, 5.3, 'Student dashboard screenshot');
    const pts = [['FiEye', 'See every course', 'Status and next action per course.'], ['FiClock', 'Live timeline', 'Which stage, who owns it, how long.'], ['FiBell', 'Nudge', 'Ask for an update, rate-limited.'], ['FiFileText', 'Only needed syllabi', 'And why each one matters.']];
    for (let i = 0; i < 4; i++) {
      const y = 1.55 + i * 1.3;
      await iconCircle(s, pts[i][0], 0.6, y, 0.6);
      s.addText(pts[i][1], { x: 1.4, y, w: 3.3, h: 0.35, fontSize: 18, bold: true, color: C.maroon, fontFace: 'Cambria', margin: 0, isTextBox: true });
      s.addText(pts[i][2], { x: 1.4, y: y + 0.38, w: 3.3, h: 0.7, fontSize: 14, color: C.ink, margin: 0, valign: 'top', isTextBox: true });
    }
  }

  // 8 ─ WOW divider
  {
    const s = dark('Now the part nobody asked for.');
    s.addText('Beyond the ask', { x: 0.8, y: 2.4, w: 11.5, h: 1.2, fontFace: 'Cambria', fontSize: 60, bold: true, color: C.gold, margin: 0, isTextBox: true });
    s.addText('What turns an evaluator tool into a platform', { x: 0.8, y: 3.8, w: 11.5, h: 0.8, fontSize: 26, color: C.white, margin: 0, isTextBox: true });
  }

  // 9 ─ AI that works without AI
  {
    const s = content('AI that keeps working when AI is off', 'No API key yet, budget exhausted, or an outage: the built-in rules engine reads documents and suggests matches. One super-admin switch.');
    const tiers = [['1', 'Claude', 'Cheap model first, stronger one only when unsure. Reads PDFs and photos, ranks matches.', C.maroon, C.white],
                   ['2', 'Built-in rules', 'Zero tokens. Reads text PDFs, classifies, extracts fields, ranks courses by title, topic, code and credits. Capped at 70% confidence.', C.gold, C.deep],
                   ['3', 'Human', 'Faculty and students can always edit or override. Nothing is ever auto-rejected.', C.tint, C.ink]];
    tiers.forEach((t, i) => {
      const y = 1.6 + i * 1.65;
      s.addShape(pres.ShapeType.roundRect, { x: 0.6, y, w: 7.2, h: 1.45, fill: { color: t[3] }, line: { color: t[3], width: 0 }, rectRadius: 0.12 });
      s.addText(t[0], { x: 0.8, y, w: 0.7, h: 1.45, fontSize: 40, bold: true, fontFace: 'Cambria', color: t[4], margin: 0, valign: 'middle', isTextBox: true });
      s.addText([{ text: t[1], options: { bold: true, fontSize: 20, breakLine: true } }, { text: t[2], options: { fontSize: 14 } }], { x: 1.6, y: y + 0.05, w: 6.0, h: 1.35, color: t[4], margin: 0, valign: 'middle', isTextBox: true });
    });
    await shot(s, '06-ai-controls.png', 8.1, 1.6, 4.7, 4.9, 'AI Controls screenshot');
    s.addText('Falls through automatically: key missing, switch off, budget used, or API error.', { x: 0.6, y: 6.55, w: 7.2, h: 0.4, fontSize: 14, italic: true, color: C.mute, margin: 0, isTextBox: true });
  }

  // 10 ─ Documents + intake
  {
    const s = content('Reads the documents. Gets students in five ways', 'Smart upload classifies and extracts. Intake channels all end at a confirm step before an account exists.');
    await shot(s, '08-smart-upload.png', 0.6, 1.45, 5.9, 3.7, 'Smart upload screenshot');
    await shot(s, '09-intake-lookup.png', 6.9, 1.45, 5.9, 3.7, 'Intake lookup screenshot');
    const ch = [['Self-register', 'FiUserPlus'], ['Email link', 'FiMail'], ['QR code', 'FiGrid'], ['Registrar profile', 'FiDatabase'], ['Agency bulk API', 'FiUploadCloud']];
    for (let i = 0; i < ch.length; i++) {
      const x = 0.6 + i * 2.45;
      card(s, x, 5.45, 2.25, 1.2);
      await iconCircle(s, ch[i][1], x + 0.2, 5.75, 0.6);
      s.addText(ch[i][0], { x: x + 0.9, y: 5.45, w: 1.3, h: 1.2, fontSize: 14, bold: true, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
    }
  }

  // 11 ─ Policy + workflow
  {
    const s = content("BU's actual rules, enforced and explained", "Policy engine mirrors BU's published rules. Workflow engine is configured per university.");
    const left = [['Credit cap', '68 transfer / 60 first-year / 80 MET, incl. AP, IB, A-level'], ['Grades', 'C or better. P/F and S/U go to review, with exceptions'], ['Age and accreditation', 'Over 5 years or unaccredited goes to review'], ['Not eligible', 'Internships, research, military and life experience'], ['Hub', 'Transfer courses never satisfy it. Always stated']];
    left.forEach((r, i) => {
      const y = 1.55 + i * 0.98;
      card(s, 0.6, y, 6.0, 0.86);
      s.addText([{ text: r[0] + '  ', options: { bold: true, color: C.maroon } }, { text: r[1], options: { color: C.ink } }], { x: 0.85, y, w: 5.6, h: 0.86, fontSize: 14, margin: 0, valign: 'middle', isTextBox: true });
    });
    await shot(s, '12-workflow-designer.png', 6.9, 1.5, 5.9, 4.6, 'Workflow designer screenshot');
    s.addText('Stages, owners, SLAs, auto-approve, bypass and appeals are configured per university.', { x: 6.9, y: 6.2, w: 5.9, h: 0.6, fontSize: 14, color: C.mute, italic: true, margin: 0, isTextBox: true });
  }

  // 12 ─ Platform
  {
    const s = content('Built as a platform, not a prototype', 'Multi-university master data, permissions matrix, partner API, dashboards, Azure deployment.');
    const items = [['FiLayers', 'Multi-university', 'Universities, programs, courses and topics, shared many-to-many with per-university switches.'],
                   ['FiLock', 'Live permissions', 'Role by module by operation matrix, enforced on every change. Admins are scoped to their universities.'],
                   ['FiGlobe', 'Partner API', 'Hashed keys, Excel templates, a review queue and per-row email reports.'],
                   ['FiBarChart2', 'Dashboards', 'Animated analytics for every role, on desktop and mobile.'],
                   ['FiCloud', 'Azure-ready', 'App Service, Azure SQL, Blob storage, GitHub Actions deploy.'],
                   ['FiRepeat', 'Two-university exchange', 'Source and target both see each transfer, request and upload documents into the student folder, and remind each other.']];
    for (let i = 0; i < 6; i++) {
      const x = 0.6 + (i % 3) * 4.1, y = 1.6 + Math.floor(i / 3) * 2.6;
      card(s, x, y, 3.9, 2.35);
      await iconCircle(s, items[i][0], x + 0.25, y + 0.25, 0.65);
      s.addText(items[i][1], { x: x + 1.05, y: y + 0.25, w: 2.7, h: 0.65, fontSize: 19, bold: true, fontFace: 'Cambria', color: C.maroon, margin: 0, valign: 'middle', isTextBox: true });
      s.addText(items[i][2], { x: x + 0.25, y: y + 1.05, w: 3.45, h: 1.2, fontSize: 14, color: C.ink, margin: 0, valign: 'top', isTextBox: true });
    }
  }

  // 13 ─ Token frugal
  {
    const s = content('Cheap to run: every token has to earn its place', 'Shortlist is lexical and free. Cache means the same external course costs one call ever.');
    const steps = [['Lexical shortlist', 'Catalogue ranked locally, only top N sent'], ['Cross-student cache', 'Same course, one model call, ever'], ['Cheap model first', 'Escalate only when unsure'], ['Prompt caching', 'Playbook reused across calls'], ['Budgets', 'Monthly and per-request caps, then fallback to rules']];
    steps.forEach((r, i) => {
      const y = 1.55 + i * 1.05;
      s.addShape(pres.ShapeType.ellipse, { x: 0.6, y: y + 0.1, w: 0.6, h: 0.6, fill: { color: C.maroon }, line: { color: C.maroon, width: 0 } });
      s.addText(String(i + 1), { x: 0.6, y: y + 0.1, w: 0.6, h: 0.6, align: 'center', valign: 'middle', fontSize: 18, bold: true, color: C.white, margin: 0, isTextBox: true });
      s.addText([{ text: r[0], options: { bold: true, color: C.maroon, fontSize: 19, breakLine: true } }, { text: r[1], options: { color: C.ink, fontSize: 14 } }], { x: 1.5, y, w: 5.6, h: 0.85, margin: 0, valign: 'middle', isTextBox: true });
    });
    await shot(s, '11-super-admin-dashboard.png', 7.4, 1.5, 5.4, 4.8, 'Dashboard screenshot');
  }

  // 14 ─ Scorecard (native chart)
  {
    const s = content('Scorecard: 22 requirements vs. the code', 'We compared every rule and ask in the design docs with the code. 17 built, 3 partial, 2 open. Full table in _designs/GAP_ANALYSIS.md.');
    s.addChart(pres.charts.DOUGHNUT, [{ name: 'Status', labels: ['Built', 'Partial', 'Open'], values: [17, 3, 2] }], {
      x: 0.6, y: 1.5, w: 5.2, h: 4.9, holeSize: 62, chartColors: [C.green, C.amber, C.red], showLegend: true, legendPos: 'b', legendFontSize: 14, legendColor: C.ink,
      showPercent: false, showValue: true, dataLabelColor: C.white, dataLabelFontSize: 16, dataLabelFontBold: true, showTitle: false,
    });
    const g = [['Open', C.red, 'One-year deadline tracker · programme rules (Econ/Bio caps, substitutions)'],
               ['Partial', C.amber, 'Side-by-side course diff · one-to-many mappings · 5-credit lab rule (BU to confirm)'],
               ['Built', C.green, 'Lanes, quarter 2/3, grade rules, BU caps, Hub, appeals, workflow, learning loop, degree progress, accuracy backtest, Maya demo data']];
    g.forEach((r, i) => {
      const y = 1.6 + i * 1.6;
      card(s, 6.2, y, 6.5, 1.4);
      s.addShape(pres.ShapeType.ellipse, { x: 6.45, y: y + 0.5, w: 0.4, h: 0.4, fill: { color: r[1] }, line: { color: r[1], width: 0 } });
      s.addText([{ text: r[0], options: { bold: true, fontSize: 18, color: r[1], breakLine: true } }, { text: r[2], options: { fontSize: 13, color: C.ink } }], { x: 7.05, y, w: 5.5, h: 1.4, margin: 0, valign: 'middle', isTextBox: true });
    });
  }

  // 15 ─ What we don't know + next
  {
    const s = content('What we have not proven yet, and what comes next', 'Be honest: no live Claude key, no BU baseline numbers. Plan to close the gaps.');
    const L = ['No Anthropic key yet: AI paths are unverified, the rules fallback carries the demo', 'No BU baseline for evaluator minutes or turnaround, so the saving is not yet quantified', 'SQL logic was written and reviewed but has no automated tests', 'Quarter rounding (2.66) follows the brief; BU to confirm'];
    s.addText('Not proven yet', { x: 0.6, y: 1.55, w: 5.8, h: 0.5, fontSize: 22, bold: true, fontFace: 'Cambria', color: C.maroon, margin: 0, isTextBox: true });
    s.addText(L.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < L.length - 1, paraSpaceAfter: 10 } })), { x: 0.6, y: 2.15, w: 5.8, h: 4.4, fontSize: 16, color: C.ink, margin: 0, valign: 'top', isTextBox: true });
    const N = [['1', 'Apply migrations and seeds, then rehearse the demo'], ['2', 'Run the backtest on live data and publish the top-3 rate'], ['3', 'Side-by-side course comparison'], ['4', 'One-year deadline and programme rules'], ['5', 'Turn on Claude and measure']];
    s.addText('Next', { x: 6.9, y: 1.55, w: 5.8, h: 0.5, fontSize: 22, bold: true, fontFace: 'Cambria', color: C.maroon, margin: 0, isTextBox: true });
    N.forEach((r, i) => {
      const y = 2.2 + i * 0.85;
      card(s, 6.9, y, 5.8, 0.72);
      s.addText(r[0], { x: 7.05, y, w: 0.5, h: 0.72, fontSize: 22, bold: true, fontFace: 'Cambria', color: C.gold, margin: 0, valign: 'middle', isTextBox: true });
      s.addText(r[1], { x: 7.65, y, w: 4.9, h: 0.72, fontSize: 15, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
    });
  }

  // 16 ─ Close
  {
    const s = dark('Close on the promise and invite the live demo.');
    s.addText('Faster for evaluators. Clearer for students. Final say stays with the department.', { x: 0.8, y: 0.9, w: 11.7, h: 1.8, fontFace: 'Cambria', fontSize: 38, bold: true, color: C.white, margin: 0, isTextBox: true });
    s.addText('Live demo next', { x: 0.8, y: 2.9, w: 6, h: 0.6, fontSize: 24, color: C.gold, bold: true, margin: 0, isTextBox: true });
    s.addShape(pres.ShapeType.roundRect, { x: 0.8, y: 3.8, w: 11.7, h: 3.0, fill: { color: C.white }, line: { color: C.white, width: 0 }, rectRadius: 0.15 });
    s.addImage({ path: path.join(REPO, '_designs/team/Clopay Code Crafters.png'), x: 1.4, y: 4.0, w: 7.4, h: 7.4 * 491 / 1333, altText: 'Clopay Code Crafters team' });
    s.addText([{ text: 'Raghuram Raichooti', options: { breakLine: true } }, { text: 'Sankara Varaprasad', options: { breakLine: true } }, { text: 'Swetha Katkkoori', options: { breakLine: true } }, { text: 'Harshil Shah Parimal' }],
      { x: 9.8, y: 4.1, w: 2.6, h: 2.4, fontSize: 15, color: C.ink, margin: 0, valign: 'middle', isTextBox: true });
  }

  const out = path.join(HERE, 'TransferHub-Hackathon.pptx');
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log('wrote', out);
})();
