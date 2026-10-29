// Builds TransferHub-Full.pptx: the full-detail deck for the panel.
// Run: see README.md in this folder.
const { createDeck } = require('./lib/kit');

const k = createDeck({ title: 'TransferHub - Smarter Transfer Credit Evaluation', footer: 'TransferHub  ·  Clopay CodeCrafters  ·  screenshots use synthetic data' });
const { pres, C } = k;

function divider(title, sub, notes) {
  const s = k.dark(notes);
  k.text(s, title, { x: 0.8, y: 2.4, w: 11.7, h: 1.2, fontFace: 'Cambria', fontSize: 54, bold: true, color: C.gold });
  k.text(s, sub, { x: 0.8, y: 3.75, w: 11.7, h: 0.8, fontSize: 24, color: C.white, valign: 'top' });
  return s;
}
function bullets(s, list, o) {
  k.text(s, list.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < list.length - 1, paraSpaceAfter: 8 } })), { fontSize: 15, color: C.ink, valign: 'top', ...o });
}
async function iconRows(s, rows, x, y, w, gap, d = 0.6) {
  for (let i = 0; i < rows.length; i++) {
    const yy = y + i * gap;
    await k.iconCircle(s, rows[i][0], x, yy, d);
    k.text(s, rows[i][1], { x: x + d + 0.2, y: yy - 0.03, w: w - d - 0.2, h: 0.36, fontSize: 17, bold: true, color: C.maroon });
    k.text(s, rows[i][2], { x: x + d + 0.2, y: yy + 0.35, w: w - d - 0.2, h: gap - 0.4, fontSize: 14, color: C.ink, valign: 'top' });
  }
}

(async () => {
  k.section('Opening');
  await k.titleSlide({
    headline: 'Smarter Transfer Credit Evaluation',
    sub: 'From "0 units" and weeks of waiting to a clear status for every course, on the day a student submits.',
    kicker: 'Evoke FDE AI Hackathon 5.0   ·   Problem 1 · Boston University',
    notes: 'One-line promise: faster for evaluators, clearer for students, and the department still decides.',
  });

  k.section('The problem');
  // Problem
  {
    const s = k.content('Every course, every student, one syllabus at a time', 'BU takes 800+ transfers a year. Courses without an equivalency show 0 units, students chase syllabi, evaluators compare by hand. All credit must be settled within one year of starting.');
    const stats = [['800+', 'transfer students a year at BU'], ['0 units', 'shown for every pending course'], ['1 by 1', 'manual syllabus comparisons'], ['1 year', 'to settle all transfer credit']];
    stats.forEach((st, i) => {
      const x = 0.6 + i * 3.08;
      k.card(s, x, 1.6, 2.85, 2.1);
      k.text(s, st[0], { x, y: 1.8, w: 2.85, h: 0.95, align: 'center', fontFace: 'Cambria', fontSize: 42, bold: true, color: C.maroon });
      k.text(s, st[1], { x: x + 0.2, y: 2.8, w: 2.45, h: 0.7, align: 'center', fontSize: 15, color: C.ink });
    });
    k.text(s, 'Root causes', { x: 0.6, y: 4.05, w: 6, h: 0.4, fontFace: 'Cambria', fontSize: 19, bold: true, color: C.maroon });
    const rc = [['The "maybe" path is manual', 'Evaluator time goes into lookups and side-by-side reading.'], ['Status is binary and late', 'Students cannot plan registration or graduation.'], ['Evidence falls on the student', 'Old syllabi are chased even when they would not change the outcome.'], ['Decisions are not reused', 'The same external course is compared again for every student.']];
    rc.forEach((r, i) => {
      const x = 0.6 + (i % 2) * 6.15, y = 4.55 + Math.floor(i / 2) * 1.15;
      k.card(s, x, y, 5.95, 1.0, C.white);
      k.text(s, [{ text: r[0], options: { bold: true, color: C.maroon, breakLine: true } }, { text: r[1], options: { color: C.ink } }], { x: x + 0.25, y, w: 5.5, h: 1.0, fontSize: 14, valign: 'middle' });
    });
  }
  // Users
  {
    const s = k.content('Five kinds of user, one source of truth', 'Personas from DISCOVERY.md. Custom roles are built on one of the base roles with their own permission grants.');
    const P = [['FiUser', 'Maya', 'Transfer student', 'student', 'Know which credits are secure, what to do, and by when.'],
      ['FiClipboard', 'Dan', 'Credit evaluation staff', 'admin', 'Clean queue, fast lookups, little chasing. Scoped to his university.'],
      ['FiBookOpen', 'Dr. Lee', 'Department evaluator', 'faculty', 'All evidence in one place; consistent with past decisions.'],
      ['FiBriefcase', 'Partner', 'Agency or college', 'agency', 'Submit students and catalogues in bulk; see outcomes.'],
      ['FiSettings', 'Owner', 'Platform owner', 'super_admin', 'Configure universities, workflows, AI, roles; see cost and throughput.']];
    const cw = 2.3, gap = 0.15;
    for (let i = 0; i < P.length; i++) {
      const x = 0.6 + i * (cw + gap);
      k.card(s, x, 1.6, cw, 4.3);
      await k.iconCircle(s, P[i][0], x + cw / 2 - 0.4, 1.85, 0.8);
      k.text(s, P[i][1], { x, y: 2.8, w: cw, h: 0.45, align: 'center', fontFace: 'Cambria', fontSize: 20, bold: true, color: C.maroon });
      k.text(s, P[i][2], { x: x + 0.1, y: 3.25, w: cw - 0.2, h: 0.35, align: 'center', fontSize: 13, color: C.mute });
      k.pill(s, P[i][3], x + 0.35, 3.7, cw - 0.7, 0.36, C.deep, C.white, 12);
      k.text(s, P[i][4], { x: x + 0.2, y: 4.25, w: cw - 0.4, h: 1.5, fontSize: 13, color: C.ink, valign: 'top' });
    }
    k.card(s, 0.6, 6.15, 12.1, 0.7, C.white);
    k.text(s, [{ text: 'Hard constraint.  ', options: { bold: true, color: C.maroon } }, { text: 'Academic departments make the final decision. The system ranks, pre-fills, explains and routes; it never rejects on its own.', options: { color: C.ink } }], { x: 0.85, y: 6.15, w: 11.7, h: 0.7, fontSize: 15, valign: 'middle' });
  }
  // Ask vs built
  {
    const s = k.content('What they asked for, and what we built', 'Four tests in the brief. Each has a concrete feature you can click.');
    const rows = [
      ['FiZap', 'Faster', 'Every course triaged into a lane at upload. Known equivalencies apply instantly. The rest arrive pre-ranked with reasons. Decisions feed back so the next student is instant.'],
      ['FiEye', 'More transparent', 'Per-course status, a live tracker with notes beside each step, From → To credits and degree progress replace "0 units".'],
      ['FiHeart', 'Less stressful', 'Syllabi asked for only where they matter. Documents are read for the student. Applicants get a preview before admission.'],
      ['FiShield', 'Department decides', 'Configurable approval stages. AI and rules never reject; rules confidence is capped at 70%; auto-approve is opt-in per stage.'],
    ];
    for (let i = 0; i < 4; i++) {
      const y = 1.6 + i * 1.33;
      k.card(s, 0.6, y, 12.1, 1.18);
      await k.iconCircle(s, rows[i][0], 0.85, y + 0.26, 0.66);
      k.text(s, rows[i][1], { x: 1.8, y, w: 3.0, h: 1.18, fontSize: 20, bold: true, fontFace: 'Cambria', color: C.maroon, valign: 'middle' });
      k.text(s, rows[i][2], { x: 4.9, y: y + 0.04, w: 7.6, h: 1.1, fontSize: 15, color: C.ink, valign: 'middle' });
    }
  }

  k.section('The solution');
  divider('How it works', 'One pipeline from a student\'s documents to posted credit', 'Section: solution and architecture.');
  // Pipeline
  {
    const s = k.content('One pipeline from upload to posting', 'Rules first, then known equivalencies, then AI or built-in rules, then the people.');
    const steps = [['Upload', 'Documents read, courses captured', 'FiUpload'], ['Rules', 'Grade, credits, age, caps, Hub', 'FiSliders'], ['Equivalency', 'Known match applies at once', 'FiCheckCircle'], ['Match', 'AI or built-in rules rank top 3', 'FiCpu'], ['People', 'Faculty to final approver', 'FiUsers'], ['Posted', 'Student and source notified', 'FiFlag']];
    const bw = 1.82, gap = 0.24;
    for (let i = 0; i < steps.length; i++) {
      const x = 0.6 + i * (bw + gap), hl = i === 3;
      k.card(s, x, 1.7, bw, 2.6, hl ? C.maroon : C.tint);
      await k.iconCircle(s, steps[i][2], x + bw / 2 - 0.4, 1.9, 0.8, hl ? C.gold : C.maroon, hl ? C.deep : 'FFFFFF');
      k.text(s, steps[i][0], { x, y: 2.85, w: bw, h: 0.45, align: 'center', fontSize: 18, bold: true, color: hl ? C.white : C.maroon });
      k.text(s, steps[i][1], { x: x + 0.12, y: 3.3, w: bw - 0.24, h: 0.9, align: 'center', fontSize: 13, color: hl ? C.rose : C.ink, valign: 'top' });
      if (i < steps.length - 1) k.arrow(s, x + bw + 0.03, 3.0, x + bw + gap - 0.03, 3.0);
    }
    const lanes = [['Applied', C.green], ['Likely match', C.amber], ['Needs syllabus', C.amber], ['Elective only', C.maroon], ['Not eligible', C.red], ['International', C.mute]];
    k.text(s, 'Every course lands in a lane the student can see', { x: 0.6, y: 4.65, w: 8, h: 0.4, fontSize: 16, bold: true, color: C.maroon });
    lanes.forEach((l, i) => k.pill(s, l[0], 0.6 + i * 2.05, 5.15, 1.85, 0.45, l[1], C.white, 13));
    k.card(s, 0.6, 5.9, 12.1, 0.9, C.white);
    k.text(s, [{ text: 'The learning loop.  ', options: { bold: true, color: C.maroon } }, { text: 'Every approved decision is saved as a reusable equivalency with effective dates, and match results are cached across students.', options: { color: C.ink } }], { x: 0.85, y: 5.9, w: 11.6, h: 0.9, fontSize: 15, valign: 'middle' });
  }
  // Architecture
  {
    const s = k.content('Architecture: one Node app on Azure', 'Single Azure App Service serves the React SPA and the NestJS API. Azure SQL holds data and the two core stored procedures; Blob holds documents; Resend sends email; AI providers are pluggable with a zero-token fallback.');
    // users
    k.card(s, 0.6, 1.6, 2.3, 4.9);
    k.text(s, 'Browser and phone', { x: 0.75, y: 1.75, w: 2.0, h: 0.4, fontSize: 15, bold: true, color: C.maroon });
    ['Student', 'Faculty', 'Admin', 'Agency', 'Super admin', 'Partner API (key)'].forEach((r, i) => k.pill(s, r, 0.8, 2.3 + i * 0.66, 1.9, 0.44, i === 5 ? C.gold : C.maroon, i === 5 ? C.deep : C.white, 12));
    // app service
    s.addShape(pres.ShapeType.roundRect, { x: 3.4, y: 1.6, w: 5.2, h: 4.9, fill: { color: C.white }, line: { color: C.maroon, width: 1.5 }, rectRadius: 0.12 });
    k.text(s, 'Azure App Service (Linux, Node 20)', { x: 3.6, y: 1.7, w: 4.8, h: 0.4, fontSize: 15, bold: true, color: C.maroon });
    k.card(s, 3.6, 2.2, 4.8, 0.8);
    k.text(s, [{ text: 'React 19 SPA  ', options: { bold: true, color: C.maroon } }, { text: 'Vite, Tailwind, TanStack Query', options: { color: C.ink } }], { x: 3.8, y: 2.2, w: 4.5, h: 0.8, fontSize: 13, valign: 'middle' });
    k.card(s, 3.6, 3.15, 4.8, 3.15);
    k.text(s, [{ text: 'NestJS API  ', options: { bold: true, color: C.maroon } }, { text: 'JWT, permission matrix, Swagger', options: { color: C.ink } }], { x: 3.8, y: 3.2, w: 4.5, h: 0.45, fontSize: 13, valign: 'middle' });
    const mods = ['Workflow engine', 'Policy engine', 'AI service', 'Document reader', 'Live events (SSE)', 'Partner API', 'Exchange', 'Rules fallback'];
    mods.forEach((m, i) => k.pill(s, m, 3.8 + (i % 2) * 2.3, 3.75 + Math.floor(i / 2) * 0.62, 2.15, 0.44, i === 7 ? C.gold : C.deep, i === 7 ? C.deep : C.white, 11));
    // services
    const sv = [['FiDatabase', 'Azure SQL', 'sp_TriageCourse, sp_RecordDecision, 33 migrations'], ['FiArchive', 'Azure Blob Storage', 'Private documents, public logos'], ['FiMail', 'Resend', 'Branded, editable emails'], ['FiCpu', 'AI providers', 'Claude · Azure OpenAI · custom · Azure DI']];
    for (let i = 0; i < sv.length; i++) {
      const y = 1.6 + i * 1.25;
      k.card(s, 9.1, y, 3.6, 1.1);
      await k.iconCircle(s, sv[i][0], 9.25, y + 0.25, 0.6);
      k.text(s, sv[i][1], { x: 10.0, y: y + 0.1, w: 2.6, h: 0.35, fontSize: 14, bold: true, color: C.maroon });
      k.text(s, sv[i][2], { x: 10.0, y: y + 0.45, w: 2.6, h: 0.6, fontSize: 11, color: C.ink, valign: 'top' });
      k.arrow(s, 8.62, y + 0.55, 9.08, y + 0.55);
    }
    k.arrow(s, 2.92, 4.05, 3.38, 4.05);
    k.text(s, 'GitHub Actions builds and deploys on every push to main', { x: 3.4, y: 6.55, w: 9.3, h: 0.35, fontSize: 13, italic: true, color: C.mute });
  }

  k.section('Student journey');
  // Registration + smart upload
  {
    const s = k.content('Students: register, then let the documents do the typing', 'Six-step registration aligned with BU policy, plus admin-defined Custom Form steps. Smart Upload reads transcripts, IDs, English tests and syllabi, fills profile blanks and flags a college that does not match.');
    await k.shot(s, '03-register-stepper.png', 0.6, 1.5, 6.0, 3.6, 'Registration screenshot');
    await k.shot(s, '08-smart-upload.png', 6.8, 1.5, 6.0, 3.6, 'Smart upload screenshot');
    const p = [['Six-step registration', 'Account, application, contact, every college + AP / IB / A-level, language, review.'], ['Smart Upload', 'Classify and extract from PDFs and photos; phone camera capture; scan view highlights each value.'], ['Five ways in', 'Self-register, claim link, QR code, registrar profile, agency bulk API.']];
    p.forEach((r, i) => {
      const x = 0.6 + i * 4.1;
      k.card(s, x, 5.35, 3.9, 1.45);
      k.text(s, [{ text: r[0], options: { bold: true, color: C.maroon, fontSize: 16, breakLine: true } }, { text: r[1], options: { color: C.ink, fontSize: 13 } }], { x: x + 0.2, y: 5.4, w: 3.5, h: 1.35, valign: 'middle' });
    });
  }
  // Submit + track
  {
    const s = k.content('Students: submit once, then watch it move', 'Courses captured from Smart Upload, target university and program chosen with their credits, live tracker by server-sent events, degree progress, Explore and compare up to three universities.');
    await k.shot(s, '04-student-dashboard.png', 4.9, 1.5, 5.2, 5.3, 'Student dashboard screenshot');
    await k.shot(s, '13-mobile-request-review.png', 10.3, 1.5, 2.45, 5.3, 'Mobile status screenshot');
    await iconRows(s, [
      ['FiEdit3', 'No retyping', 'Courses from the read transcript; target university + program.'],
      ['FiActivity', 'Live tracker', 'Stage, owner, notes beside each step; no reload.'],
      ['FiPieChart', 'Degree progress', 'Secure, likely, pending, not counted vs the cap.'],
      ['FiColumns', 'Explore', 'Compare up to 3 universities, then apply.'],
      ['FiRotateCcw', 'Stay in control', 'Edit pending courses, appeal, cancel.'],
    ], 0.6, 1.5, 4.1, 1.06, 0.55);
  }
  // Six courses
  {
    const s = k.content('The six-course story, upload to posting', 'Maya Rivera, Bay State Community College (semester) and Pioneer Valley Technical College (quarter). Three known, two maybe, one quarter course converted 4 x 2/3 = 2.66.');
    const rows = [
      ['CSC 110  Intro to Programming', 'Applied', 'BU CAS CS 111 · 4 cr', C.green],
      ['MAT 210  Calculus I', 'Applied', 'BU CAS MA 123 · 4 cr', C.green],
      ['ECO 101  Microeconomics', 'Applied', 'BU CAS EC 101 · 3 cr as taken', C.green],
      ['CSC 220  Data Structures', 'Likely match', 'CS 112 ranked first · CS dept decides', C.amber],
      ['CSC 240  Discrete Math', 'Needs syllabus', 'CS 131 or MA 293 · evaluator picks', C.amber],
      ['CIS 150  Linear Algebra (quarter)', '4 qtr → 2.66 cr', 'vs MA 242 (4) · evaluator decides', C.maroon],
    ];
    [['External course', 0.9, 4.6], ['Lane', 5.6, 2.3], ['What the student sees', 8.1, 4.5]].forEach((h) => k.text(s, h[0], { x: h[1], y: 1.45, w: h[2], h: 0.4, fontSize: 13, bold: true, color: C.mute }));
    rows.forEach((r, i) => {
      const y = 1.9 + i * 0.75;
      k.card(s, 0.6, y, 12.1, 0.65, i % 2 ? C.white : C.tint);
      k.text(s, r[0], { x: 0.9, y, w: 4.6, h: 0.65, fontSize: 16, color: C.ink, valign: 'middle' });
      k.pill(s, r[1], 5.6, y + 0.12, 2.3, 0.42, r[3]);
      k.text(s, r[2], { x: 8.1, y, w: 4.5, h: 0.65, fontSize: 15, color: C.ink, valign: 'middle' });
    });
    k.text(s, '11 credits secure at upload (4 + 4 + 3); three pending courses, each with a named next step.', { x: 0.6, y: 6.5, w: 12.1, h: 0.4, fontSize: 16, bold: true, color: C.maroon });
  }

  k.section('Staff and workflow');
  // Evaluator
  {
    const s = k.content('Evaluators: everything in one place', 'Request review: decision brief, timeline, ranked suggestions with reasons, side-by-side compare with credit math, accept all above a threshold, bulk approve in the queue.');
    await k.shot(s, '05-request-review.png', 0.6, 1.5, 8.0, 5.3, 'Request review screenshot');
    const pts = [['Decision brief', 'Policy flags, credit math and the Hub rule, for every stage a reviewer can see.'], ['Side-by-side compare', 'Shared topics highlighted, overlap %, credit math, candidates 1 to 3.'], ['One click or bulk', 'Accept all suggestions ≥ X%; approve clean requests from the queue.'], ['Scoped and safe', 'Staff see their university; outgoing requests are read-only.']];
    pts.forEach((p, i) => {
      const y = 1.5 + i * 1.33;
      k.text(s, p[0], { x: 8.9, y, w: 3.9, h: 0.38, fontSize: 17, bold: true, color: C.maroon, fontFace: 'Cambria' });
      k.text(s, p[1], { x: 8.9, y: y + 0.4, w: 3.9, h: 0.85, fontSize: 14, color: C.ink, valign: 'top' });
    });
  }
  // Learning loop
  {
    const s = k.content('Each decision makes the next one faster', 'Decide CSC 220 for Maya; the second Bay State student with CSC 220 is applied automatically. Learned skills are suggestions only.');
    const nodes = [['FiCheckSquare', '1  Faculty decides', 'Equivalent, elective, no credit or BU-only'], ['FiDatabase', '2  Equivalency saved', 'With effective dates; one-to-many supported'], ['FiZap', '3  Next student: instant', 'Known match applies at triage, no review'], ['FiBookOpen', '4  Skills learn', 'Overrides become suggested playbook rules']];
    const pos = [[0.6, 1.55], [4.35, 1.55], [4.35, 4.25], [0.6, 4.25]];
    const bw = 3.25, bh = 2.2;
    for (let i = 0; i < 4; i++) {
      const [x, y] = pos[i], hl = i === 2;
      k.card(s, x, y, bw, bh, hl ? C.maroon : C.tint);
      await k.iconCircle(s, nodes[i][0], x + 0.25, y + 0.25, 0.62, hl ? C.gold : C.maroon, hl ? C.deep : 'FFFFFF');
      k.text(s, nodes[i][1], { x: x + 0.25, y: y + 0.95, w: bw - 0.45, h: 0.4, fontSize: 17, bold: true, color: hl ? C.white : C.maroon });
      k.text(s, nodes[i][2], { x: x + 0.25, y: y + 1.35, w: bw - 0.45, h: 0.75, fontSize: 13, color: hl ? C.rose : C.ink, valign: 'top' });
    }
    k.arrow(s, 3.9, 2.65, 4.3, 2.65); k.arrow(s, 5.97, 3.8, 5.97, 4.2); k.arrow(s, 4.3, 5.35, 3.9, 5.35); k.arrow(s, 2.22, 4.2, 2.22, 3.8);
    k.card(s, 8.0, 1.55, 4.7, 4.9, C.white);
    k.text(s, 'Beyond one university', { x: 8.25, y: 1.7, w: 4.3, h: 0.45, fontFace: 'Cambria', fontSize: 19, bold: true, color: C.maroon });
    bullets(s, ['Cross-student match cache: one external course, one model call', 'Equivalency network: anonymised history from other universities, optional confidence boost (off by default)', 'Learning tab: weekly agreement, top-3 rate and recurring mistakes', 'A person adds every learned rule; nothing changes on its own'], { x: 8.25, y: 2.25, w: 4.3, h: 4.1, fontSize: 14 });
  }
  // Workflow
  {
    const s = k.content('A workflow per university, designed not coded', 'Default: received → intake and AI match → faculty → finance → first approver → final approver → completed. Copy per university; approver groups are cloned with the university code.');
    await k.shot(s, '12-workflow-designer.png', 4.9, 1.5, 7.9, 5.3, 'Workflow designer screenshot');
    await iconRows(s, [
      ['FiLayers', 'Stages', 'System, review or approval; agent task per stage.'],
      ['FiUsers', 'Approver groups', 'Role, group or person, per university.'],
      ['FiClock', 'SLAs', 'Overdue stages escalate once by email.'],
      ['FiCheckCircle', 'Auto-approve', 'Accept suggestions ≥ a threshold; never rejects.'],
      ['FiSkipForward', 'Bypass and notes', 'Skip a stage; internal vs student notes.'],
    ], 0.6, 1.5, 4.1, 1.06, 0.55);
  }
  // Policy
  {
    const s = k.content("BU's published rules, enforced and explained", 'TransferPolicyService runs after sp_TriageCourse and only tightens lanes. Flags are shown to both the student and the reviewer. Thresholds are per university.');
    const P = [['FiPercent', 'Credit cap', 'Per applicant type (68 for transfers), including AP, IB and A-level'], ['FiAward', 'Grades', 'C or better; P/F and S/U go to review, with the Spring 2020 exception'], ['FiCalendar', 'Age and accreditation', 'Old or unaccredited coursework goes to review'], ['FiXCircle', 'Not eligible', 'Internships, research, military and life experience'], ['FiGlobe', 'International', 'Outside-US coursework routed to International Admissions'], ['FiRepeat', 'Quarter credits', '× 2/3, truncated: 4 quarter = 2.66 semester'], ['FiBook', 'Programme rules', '12 BU rules, e.g. Econ at most 4 courses at 200+'], ['FiClock', 'One-year deadline', 'Reminders at 90 / 30 / 7 days, then review']];
    for (let i = 0; i < P.length; i++) {
      const x = 0.6 + (i % 2) * 6.15, y = 1.55 + Math.floor(i / 2) * 1.3;
      k.card(s, x, y, 5.95, 1.15);
      await k.iconCircle(s, P[i][0], x + 0.22, y + 0.25, 0.62);
      k.text(s, [{ text: P[i][1], options: { bold: true, color: C.maroon, fontSize: 16, breakLine: true } }, { text: P[i][2], options: { color: C.ink, fontSize: 13 } }], { x: x + 1.05, y, w: 4.75, h: 1.15, valign: 'middle' });
    }
  }

  k.section('AI');
  divider('AI, on a leash', 'It ranks and reads. People decide. It keeps working when it is off.', 'Section: AI approach and controls.');
  // AI tiers
  {
    const s = k.content('AI that keeps working when AI is off', 'Order: AI if a provider is set up, switched on and within budget; else the built-in rules if the fallback is on; else paused. A person can always override.');
    const tiers = [['1', 'AI provider', 'Azure OpenAI via Azure AI Foundry (in use) and Anthropic Claude (configured); any OpenAI-compatible service can be added when required. Azure Document Intelligence for reading. Cheap model first, escalates only when unsure.', C.maroon, C.white],
      ['2', 'Built-in rules', 'Zero tokens. Reads text PDFs, classifies, extracts fields; ranks courses by title, topics, code and credits. Confidence capped at 70%, so it never auto-approves at default thresholds.', C.gold, C.deep],
      ['3', 'Human', 'Faculty and students can edit or override every result. Nothing is ever auto-rejected.', C.tint, C.ink]];
    tiers.forEach((t, i) => {
      const y = 1.55 + i * 1.6;
      s.addShape(pres.ShapeType.roundRect, { x: 0.6, y, w: 7.3, h: 1.45, fill: { color: t[3] }, line: { color: t[3], width: 0 }, rectRadius: 0.12 });
      k.text(s, t[0], { x: 0.8, y, w: 0.7, h: 1.45, fontSize: 40, bold: true, fontFace: 'Cambria', color: t[4], valign: 'middle' });
      k.text(s, [{ text: t[1], options: { bold: true, fontSize: 19, breakLine: true } }, { text: t[2], options: { fontSize: 13 } }], { x: 1.6, y: y + 0.05, w: 6.1, h: 1.35, color: t[4], valign: 'middle' });
    });
    await k.shot(s, '06-ai-controls.png', 8.2, 1.55, 4.6, 4.65, 'AI Controls screenshot');
    k.text(s, 'In use today: Azure OpenAI through Azure AI Foundry. Anthropic is also configured, and providers can be switched or added when required.', { x: 0.6, y: 6.4, w: 12.1, h: 0.5, fontSize: 14, italic: true, color: C.maroon, valign: 'middle' });
  }
  // Cost + controls
  {
    const s = k.content('Cheap to run, and every dollar is visible', 'Shortlist is lexical and free; cache means one call per external course; budgets fall back to rules. Super admin sees AI spend separately from operations.');
    const steps = [['Lexical shortlist', 'Catalogue ranked locally; only top N sent'], ['Cross-student cache', 'Same course, one model call'], ['Cheap model first', 'Escalate only when unsure'], ['Prompt caching', 'Playbook reused across calls'], ['Budgets', 'Monthly and per-request caps, then rules']];
    steps.forEach((r, i) => {
      const y = 1.5 + i * 1.0;
      s.addShape(pres.ShapeType.ellipse, { x: 0.6, y: y + 0.1, w: 0.58, h: 0.58, fill: { color: C.maroon }, line: { color: C.maroon, width: 0 } });
      k.text(s, String(i + 1), { x: 0.6, y: y + 0.1, w: 0.58, h: 0.58, align: 'center', valign: 'middle', fontSize: 17, bold: true, color: C.white });
      k.text(s, [{ text: r[0], options: { bold: true, color: C.maroon, fontSize: 17, breakLine: true } }, { text: r[1], options: { color: C.ink, fontSize: 14 } }], { x: 1.4, y, w: 4.6, h: 0.8, valign: 'middle' });
    });
    k.card(s, 6.4, 1.5, 6.3, 5.3);
    k.text(s, 'What the super admin sees', { x: 6.7, y: 1.65, w: 5.8, h: 0.45, fontFace: 'Cambria', fontSize: 19, bold: true, color: C.maroon });
    bullets(s, ['Dashboard "AI agents" block, separate from transfer operations', 'AI Controls → Usage: tokens, cost, tokens avoided, cache hits, response times, by model', '"$ Spent by request": matching, documents and briefs split', 'Spent this month against a budget meter', 'Providers: switch Claude, Azure OpenAI or a custom service; test the connection', 'Benchmark: dry-run every ready engine on real students; Learning: agreement trend', 'Playbook skills: editable instructions per agent'], { x: 6.7, y: 2.2, w: 5.8, h: 4.5, fontSize: 14 });
  }
  // Measured
  {
    const s = k.content('Measured, not claimed', 'Backtest: for each of 63 past decisions, hide it from the matcher and ask whether the right BU course is in its top 1 or top 3. Built-in rules engine, the floor any AI provider must beat. The same harness and the Benchmark tab score Azure OpenAI and Anthropic.');
    const stats = [['96.8%', 'right BU course in the top 3'], ['88.9%', 'right BU course ranked first'], ['63', 'held-out past decisions']];
    stats.forEach((st, i) => {
      const x = 0.6 + i * 4.1;
      k.card(s, x, 1.6, 3.9, 2.4);
      k.text(s, st[0], { x, y: 1.8, w: 3.9, h: 1.3, align: 'center', fontFace: 'Cambria', fontSize: 58, bold: true, color: i === 2 ? C.deep : C.maroon });
      k.text(s, st[1], { x: x + 0.2, y: 3.15, w: 3.5, h: 0.7, align: 'center', fontSize: 16, color: C.ink });
    });
    const pts = [['Matcher', 'Built-in rules matcher (zero tokens). No AI accuracy figure is claimed yet; live AI runs on Azure OpenAI and will be scored with the same harness.'],
      ['Live smoke test', '39 of 40 HTTP checks pass on the deployed app, 1 write check skipped, 0 failed.'],
      ['Database checks', '243 SQL smoke checks and all 11 triage contract cases pass, including the 2.66 quarter rule.']];
    pts.forEach((p, i) => k.text(s, [{ text: p[0] + '  ', options: { bold: true, color: C.maroon } }, { text: p[1], options: { color: C.ink } }], { x: 0.6, y: 4.35 + i * 0.82, w: 12.1, h: 0.75, fontSize: 15, valign: 'middle' }));
  }

  k.section('Platform');
  // Roles
  {
    const s = k.content('Roles and permissions, changed without a deploy', 'Role × module × operation matrix, enforced on every change endpoint with a 30-second cache. Custom roles sit on a base role with their own grants. Staff are scoped to their universities; super admins are invisible to admins.');
    await k.shot(s, '07-roles-permissions.png', 6.2, 1.5, 6.6, 5.3, 'Roles and permissions screenshot');
    const R = [['student', 'Registers, uploads, submits, tracks, appeals'], ['faculty', 'Department evaluator; decides at review stages'], ['admin', 'Credit evaluation staff, scoped to a university'], ['agency', 'Partner agency; submits for its students'], ['super_admin', 'Platform owner: data, workflows, AI, roles'], ['custom', 'Built on a base role, with its own grants']];
    R.forEach((r, i) => {
      const y = 1.55 + i * 0.88;
      k.pill(s, r[0], 0.6, y + 0.17, 1.6, 0.42, i === 5 ? C.gold : C.maroon, i === 5 ? C.deep : C.white, 12);
      k.text(s, r[1], { x: 2.4, y, w: 3.6, h: 0.76, fontSize: 14, color: C.ink, valign: 'middle' });
    });
  }
  // Data in
  {
    const s = k.content('Data in from everywhere, checked before it lands', 'Partner API with hashed keys and a review queue; partner portal with Excel templates; student intake by claim link where the account exists only after the student confirms.');
    await k.shot(s, '10-partner-portal.png', 0.6, 1.5, 6.0, 3.5, 'Partner portal screenshot');
    await k.shot(s, '09-intake-lookup.png', 6.8, 1.5, 6.0, 3.5, 'Intake lookup screenshot');
    k.text(s, 'Partner portal: universities, programs, courses, topics, students', { x: 0.6, y: 5.05, w: 6, h: 0.3, fontSize: 12, color: C.mute });
    k.text(s, 'Intake: ID or passport + email, then a claim link', { x: 6.8, y: 5.05, w: 6, h: 0.3, fontSize: 12, color: C.mute });
    const ch = [['Self-register', 'FiUserPlus'], ['Claim link', 'FiMail'], ['QR code', 'FiGrid'], ['Registrar profile', 'FiDatabase'], ['Agency bulk API', 'FiUploadCloud']];
    for (let i = 0; i < ch.length; i++) {
      const x = 0.6 + i * 2.45;
      k.card(s, x, 5.55, 2.25, 1.15);
      await k.iconCircle(s, ch[i][1], x + 0.2, 5.82, 0.6);
      k.text(s, ch[i][0], { x: x + 0.9, y: 5.55, w: 1.3, h: 1.15, fontSize: 14, bold: true, color: C.ink, valign: 'middle' });
    }
  }
  // Platform
  {
    const s = k.content('Built as a platform, not a prototype', 'Multi-university master data, exchange between universities, dashboards, emails, storage, demo tooling.');
    const items = [['FiLayers', 'Multi-university', 'Universities → programs → courses → topics, shared many-to-many with per-university switches.'],
      ['FiRepeat', 'University exchange', 'Source and target both see a transfer, request documents and remind each other.'],
      ['FiBarChart2', 'Dashboards', 'Analytics for every role; live updates; mobile-ready with a PWA manifest.'],
      ['FiMail', 'Branded emails', 'Every template editable by the super admin; custom templates too.'],
      ['FiArchive', 'Private documents', 'Azure Blob, one folder per student; images compressed on upload.'],
      ['FiPlayCircle', 'Repeatable demo', 'Reset Maya, add a second student, generate demo documents.']];
    for (let i = 0; i < 6; i++) {
      const x = 0.6 + (i % 3) * 4.1, y = 1.55 + Math.floor(i / 3) * 2.6;
      k.card(s, x, y, 3.9, 2.4);
      await k.iconCircle(s, items[i][0], x + 0.25, y + 0.25, 0.65);
      k.text(s, items[i][1], { x: x + 1.05, y: y + 0.25, w: 2.7, h: 0.65, fontSize: 18, bold: true, fontFace: 'Cambria', color: C.maroon, valign: 'middle' });
      k.text(s, items[i][2], { x: x + 0.25, y: y + 1.05, w: 3.45, h: 1.2, fontSize: 14, color: C.ink, valign: 'top' });
    }
  }
  // Tech stack
  {
    const s = k.content('Tech stack', 'Everything runs as one Node app on Azure App Service; database changes are 33 idempotent numbered SQL scripts.');
    const T = [['FiMonitor', 'UI', 'React 19 · Vite · Tailwind v4 · TanStack Query · framer-motion · recharts · zustand'],
      ['FiServer', 'API', 'NestJS 10 · TypeScript · JWT (passport) · argon2 · Swagger · helmet · throttler'],
      ['FiDatabase', 'Database', 'Azure SQL / SQL Server via mssql + tedious · sp_TriageCourse · sp_RecordDecision · 33 idempotent migrations'],
      ['FiArchive', 'Storage and email', 'Azure Blob Storage · Resend'],
      ['FiCpu', 'AI', 'Anthropic Claude (direct API) · Azure OpenAI · custom OpenAI-compatible · Azure Document Intelligence · zero-token rules fallback'],
      ['FiCloud', 'Hosting and CI/CD', 'Azure App Service (single Node app serving API + SPA) · GitHub Actions']];
    for (let i = 0; i < T.length; i++) {
      const y = 1.5 + i * 0.9;
      k.card(s, 0.6, y, 12.1, 0.78, i % 2 ? C.white : C.tint);
      await k.iconCircle(s, T[i][0], 0.8, y + 0.12, 0.54);
      k.text(s, T[i][1], { x: 1.55, y, w: 2.4, h: 0.78, fontSize: 16, bold: true, color: C.maroon, valign: 'middle' });
      k.text(s, T[i][2], { x: 4.0, y, w: 8.5, h: 0.78, fontSize: 14, color: C.ink, valign: 'middle' });
    }
  }

  k.section('Proof and next');
  // Scorecard
  {
    const s = k.content('Scorecard: the brief and its rules vs. the code', 'From GAP_ANALYSIS.md: 22 brief tests and business rules. 20 built, 2 partial (faculty screen to pick several BU courses for one external course; the 5-credit lab rule awaiting BU), 0 open.');
    s.addChart(pres.charts.DOUGHNUT, [{ name: 'Status', labels: ['Built', 'Partial', 'Open'], values: [20, 2, 0] }], {
      x: 0.6, y: 1.5, w: 5.2, h: 4.9, holeSize: 62, chartColors: [C.green, C.amber, C.red], showLegend: true, legendPos: 'b', legendFontSize: 14, legendColor: C.ink, legendFontFace: '+mn-lt',
      showPercent: false, showValue: true, dataLabelColor: C.white, dataLabelFontSize: 16, dataLabelFontBold: true, dataLabelFontFace: '+mn-lt', showTitle: false,
    });
    const g = [['Open', C.red, 'No requirement is left open'],
      ['Partial', C.amber, 'Faculty screen for one external course → several BU courses (API ready) · 5-credit lab rule (BU to answer)'],
      ['Built', C.green, 'Lanes, quarter 2/3, grades, caps, Hub, appeals, workflow, learning loop, degree progress, side-by-side, programme and exam rules, one-year deadline, backtest, repeatable demo']];
    g.forEach((r, i) => {
      const y = 1.6 + i * 1.6;
      k.card(s, 6.2, y, 6.5, 1.4);
      s.addShape(pres.ShapeType.ellipse, { x: 6.45, y: y + 0.5, w: 0.4, h: 0.4, fill: { color: r[1] }, line: { color: r[1], width: 0 } });
      k.text(s, [{ text: r[0], options: { bold: true, fontSize: 18, color: r[1], breakLine: true } }, { text: r[2], options: { fontSize: 13, color: C.ink } }], { x: 7.05, y, w: 5.5, h: 1.4, valign: 'middle' });
    });
  }
  await k.teamSlide();
  // Next
  {
    const s = k.content('What we have not proven yet, and what comes next', 'No published AI accuracy yet, no BU baseline numbers. Plan to close the gaps.');
    k.text(s, 'Not proven yet', { x: 0.6, y: 1.5, w: 5.8, h: 0.5, fontSize: 21, bold: true, fontFace: 'Cambria', color: C.maroon });
    bullets(s, ['AI accuracy not published yet: live AI runs on Azure OpenAI (Azure AI Foundry), Anthropic is configured, neither has been scored with the backtest', 'No BU baseline for evaluator minutes or turnaround, so time saved is not yet quantified', 'No API integration tests; coverage is unit scripts, an HTTP smoke suite and SQL contract tests', 'Exam thresholds and quarter rounding follow defaults; BU to confirm'], { x: 0.6, y: 2.1, w: 5.8, h: 4.6, fontSize: 15 });
    const N = [['1', 'Score Azure OpenAI and Anthropic with the same backtest'], ['2', 'BU answers: 5-credit lab rule, exam thresholds'], ['3', 'Faculty screen for one-to-many mappings'], ['4', 'Measure evaluator minutes against a BU baseline'], ['5', 'SIS connector; turn demo login off for launch']];
    k.text(s, 'Next', { x: 6.9, y: 1.5, w: 5.8, h: 0.5, fontSize: 21, bold: true, fontFace: 'Cambria', color: C.maroon });
    N.forEach((r, i) => {
      const y = 2.15 + i * 0.88;
      k.card(s, 6.9, y, 5.8, 0.74);
      k.text(s, r[0], { x: 7.05, y, w: 0.5, h: 0.74, fontSize: 22, bold: true, fontFace: 'Cambria', color: C.gold, valign: 'middle' });
      k.text(s, r[1], { x: 7.65, y, w: 4.9, h: 0.74, fontSize: 15, color: C.ink, valign: 'middle' });
    });
  }
  await k.closeSlide({ headline: 'Faster for evaluators. Clearer for students. The department still decides.', notes: 'Close on the promise and move to the live demo.' });

  await k.write('TransferHub-Full.pptx');
})();
