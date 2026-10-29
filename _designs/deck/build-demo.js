// Builds TransferHub-Demo.pptx: the short deck that walks the live demo (a -> g).
// Run: see README.md in this folder.
const { createDeck } = require('./lib/kit');

const k = createDeck({ title: 'TransferHub - Live demo', footer: 'TransferHub live demo  ·  Clopay CodeCrafters  ·  screenshots use synthetic data', titleWidth: 10.0 });
const { pres, C } = k;

// Step chip in the top-right corner of every demo-step slide (the deck's repeated motif).
function step(s, letter, who) {
  s.addShape(pres.ShapeType.ellipse, { x: 10.95, y: 0.47, w: 0.72, h: 0.72, fill: { color: C.maroon }, line: { color: C.maroon, width: 0 } });
  k.text(s, letter, { x: 10.95, y: 0.47, w: 0.72, h: 0.72, align: 'center', valign: 'middle', fontFace: 'Cambria', fontSize: 24, bold: true, color: C.white });
  k.text(s, who, { x: 11.75, y: 0.47, w: 1.2, h: 0.72, valign: 'middle', fontSize: 13, bold: true, color: C.mute });
}
function points(s, list, x, y, w, gap = 1.05, titleSize = 17) {
  list.forEach((p, i) => {
    const yy = y + i * gap;
    k.text(s, p[0], { x, y: yy, w, h: 0.38, fontFace: 'Cambria', fontSize: titleSize, bold: true, color: C.maroon });
    k.text(s, p[1], { x, y: yy + 0.4, w, h: gap - 0.45, fontSize: 14, color: C.ink, valign: 'top' });
  });
}

(async () => {
  k.section('Opening');
  await k.titleSlide({
    headline: 'Live demo: one transfer, end to end',
    sub: 'From a new student account to a department decision that teaches the system.',
    kicker: 'Evoke FDE AI Hackathon 5.0   ·   Problem 1 · Boston University',
    notes: 'About 8 minutes. Two browser profiles: student and staff. Login page has one-click demo login buttons, so no passwords are typed on screen.',
  });

  // Agenda
  {
    const s = k.content('What you will see', 'Seven steps, student first, then staff, then the super admin view. Data is synthetic.');
    const steps = [
      ['a', 'Create the user', 'Student self-registration', 'Student'],
      ['b', 'Upload the documents', 'Smart Upload reads them', 'Student'],
      ['c', 'Auto-capture into the request', 'Courses pre-filled, target set', 'Student'],
      ['d', 'Submit for transfer', 'Live tracker, lanes, top-3', 'Student'],
      ['e', 'Approve and decide', 'Side-by-side, learning loop', 'Faculty / Admin'],
      ['f', 'Configure the workflow', 'Stages, approvers, SLAs', 'Admin'],
      ['g', 'AI stats', 'Spend and usage, kept apart', 'Super admin'],
    ];
    const cw = 1.6, gap = 0.15;
    steps.forEach((r, i) => {
      const x = 0.6 + i * (cw + gap);
      const hl = i === 4;
      k.card(s, x, 1.75, cw, 3.6, hl ? C.maroon : C.tint);
      s.addShape(pres.ShapeType.ellipse, { x: x + cw / 2 - 0.4, y: 2.0, w: 0.8, h: 0.8, fill: { color: hl ? C.gold : C.maroon }, line: { width: 0, color: hl ? C.gold : C.maroon } });
      k.text(s, r[0], { x: x + cw / 2 - 0.4, y: 2.0, w: 0.8, h: 0.8, align: 'center', valign: 'middle', fontFace: 'Cambria', fontSize: 26, bold: true, color: hl ? C.deep : C.white });
      k.text(s, r[1], { x: x + 0.1, y: 3.0, w: cw - 0.2, h: 0.9, align: 'center', valign: 'top', fontSize: 16, bold: true, color: hl ? C.white : C.maroon });
      k.text(s, r[2], { x: x + 0.1, y: 3.9, w: cw - 0.2, h: 0.8, align: 'center', valign: 'top', fontSize: 13, color: hl ? C.rose : C.ink });
      k.text(s, r[3], { x: x + 0.1, y: 4.85, w: cw - 0.2, h: 0.35, align: 'center', fontSize: 11, bold: true, color: hl ? C.gold : C.mute });
    });
    k.card(s, 0.6, 5.75, 12.1, 0.95, C.white);
    k.text(s, [{ text: 'The story.  ', options: { bold: true, color: C.maroon } }, { text: 'Maya Rivera moves from Bay State Community College to Boston University with six courses: three known, two "maybe", one quarter-system.', options: { color: C.ink } }],
      { x: 0.9, y: 5.75, w: 11.6, h: 0.95, fontSize: 16, valign: 'middle' });
  }

  k.section('Student');
  // a
  {
    const s = k.content('Creating the user', 'Public /register. Six built-in steps plus any extra steps the admin adds through the student-registration Custom Form. The student is signed in at the end.');
    step(s, 'a', 'Student');
    await k.shot(s, '03-register-stepper.png', 0.6, 1.5, 7.6, 5.3, 'Registration stepper screenshot');
    const steps = ['Account', 'Application: target university, program, school', 'Contact and emergency contact', 'Education history, every college + AP / IB / A-level', 'Language and outside-US check', 'Review, then signed straight in'];
    steps.forEach((t, i) => {
      const y = 1.55 + i * 0.78;
      s.addShape(pres.ShapeType.ellipse, { x: 8.6, y: y + 0.08, w: 0.5, h: 0.5, fill: { color: C.maroon }, line: { width: 0, color: C.maroon } });
      k.text(s, String(i + 1), { x: 8.6, y: y + 0.08, w: 0.5, h: 0.5, align: 'center', valign: 'middle', fontSize: 15, bold: true, color: C.white });
      k.text(s, t, { x: 9.3, y, w: 3.5, h: 0.66, valign: 'middle', fontSize: 14, color: C.ink });
    });
    k.text(s, 'BU rules need this as structured data: applicant type sets the credit cap.', { x: 8.6, y: 6.25, w: 4.2, h: 0.55, fontSize: 12, italic: true, color: C.mute, valign: 'top' });
  }
  // b
  {
    const s = k.content('Uploading the documents', 'Smart Upload: drop PDFs or photos (or use the phone camera). Each file is classified and read; the student checks and confirms. Without an AI key the built-in rules reader does it, at lower confidence.');
    step(s, 'b', 'Student');
    await k.shot(s, '08-smart-upload.png', 0.6, 1.5, 7.2, 5.3, 'Smart upload screenshot');
    const kinds = [['FiFileText', 'Transcript', 'College, term, courses, credits, grades'], ['FiCreditCard', 'ID / passport', 'Name, date of birth, country'], ['FiMessageSquare', 'English test', 'Test type and scores'], ['FiBookOpen', 'Syllabus', 'Course, topics, outcomes']];
    for (let i = 0; i < kinds.length; i++) {
      const y = 1.55 + i * 0.92;
      await k.iconCircle(s, kinds[i][0], 8.2, y, 0.6);
      k.text(s, kinds[i][1], { x: 9.0, y: y - 0.04, w: 3.8, h: 0.34, fontSize: 16, bold: true, color: C.maroon });
      k.text(s, kinds[i][2], { x: 9.0, y: y + 0.3, w: 3.8, h: 0.4, fontSize: 13, color: C.ink });
    }
    k.card(s, 8.2, 5.35, 4.5, 1.45);
    k.text(s, [{ text: 'Also checks the profile. ', options: { bold: true, color: C.maroon } }, { text: 'A transcript from a college that does not match the profile is flagged; blanks in the profile (GPA, prior college, country) are filled.', options: { color: C.ink } }],
      { x: 8.4, y: 5.35, w: 4.1, h: 1.45, fontSize: 13, valign: 'middle' });
  }
  // c
  {
    const s = k.content('Auto-capture into the transfer request', 'On Submit Transcript the student picks "Use these courses" from a transcript Smart Upload already read. Nothing is retyped. Target university and program are pre-selected from the profile; each program shows its credits.');
    step(s, 'c', 'Student');
    const flow = [['FiUpload', 'Transcript read', 'Smart Upload, confirmed by the student'], ['FiList', 'Courses extracted', 'Code, title, credits, grade, term'], ['FiMousePointer', '"Use these courses"', 'One click on Submit Transcript'], ['FiEdit3', 'Request pre-filled', 'Source college + every course row']];
    const bw = 2.75, gap = 0.37;
    for (let i = 0; i < flow.length; i++) {
      const x = 0.6 + i * (bw + gap);
      k.card(s, x, 1.6, bw, 2.15, i === 3 ? C.maroon : C.tint);
      await k.iconCircle(s, flow[i][0], x + 0.25, 1.82, 0.62, i === 3 ? C.gold : C.maroon, i === 3 ? C.deep : 'FFFFFF');
      k.text(s, flow[i][1], { x: x + 0.25, y: 2.55, w: bw - 0.4, h: 0.4, fontSize: 17, bold: true, color: i === 3 ? C.white : C.maroon });
      k.text(s, flow[i][2], { x: x + 0.25, y: 2.95, w: bw - 0.4, h: 0.7, fontSize: 13, color: i === 3 ? C.rose : C.ink, valign: 'top' });
      if (i < flow.length - 1) k.arrow(s, x + bw + 0.05, 2.67, x + bw + gap - 0.05, 2.67);
    }
    await k.shot(s, '08-smart-upload.png', 0.6, 4.1, 6.4, 2.75, 'Extracted courses from Smart Upload', { top: 0.09 });
    k.card(s, 7.3, 4.1, 5.4, 2.75);
    k.text(s, 'Then the student only chooses', { x: 7.55, y: 4.25, w: 5, h: 0.4, fontSize: 17, bold: true, fontFace: 'Cambria', color: C.maroon });
    const ch = ['University to transfer to (from the profile target)', 'Program to join, with its credits and course count', 'Optional syllabus or catalogue link per course'];
    k.text(s, ch.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < ch.length - 1, paraSpaceAfter: 8 } })), { x: 7.55, y: 4.75, w: 5.0, h: 1.95, fontSize: 14, color: C.ink, valign: 'top' });
  }
  // d1
  {
    const s = k.content('Ready to submit for transfer', 'On submit every course is triaged at once (sp_TriageCourse + the BU policy engine). The student watches a live tracker (server-sent events) with notes beside each step.');
    step(s, 'd', 'Student');
    await k.shot(s, '13-mobile-request-review.png', 0.6, 1.5, 2.6, 5.3, 'Mobile request status screenshot');
    await k.shot(s, '04-student-dashboard.png', 3.5, 1.5, 5.3, 5.3, 'Student dashboard screenshot');
    points(s, [
      ['Triage lanes at upload', 'Applied, likely, needs syllabus, not eligible: per course, not "0 units".'],
      ['Top-3 suggestions', 'Each pending course shows the ranked BU candidates with a reason.'],
      ['Live tracker', 'Which stage, who owns it, notes beside it. Updates without reload.'],
      ['From → To credits', 'Degree progress: secure, likely, pending, not counted against the cap.'],
    ], 9.1, 1.5, 3.7, 1.32, 16);
  }
  // d2: the six courses
  {
    const s = k.content('What triage does with Maya\'s six courses', 'Three known equivalencies apply instantly. Two go to the CS department with ranked suggestions. The quarter course is converted 4 x 2/3 = 2.66.');
    step(s, 'd', 'Student');
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
    k.text(s, '11 credits secure the moment she submits (4 + 4 + 3); every pending course has a named next step.', { x: 0.6, y: 6.5, w: 12.1, h: 0.4, fontSize: 16, bold: true, color: C.maroon });
  }

  k.section('Staff');
  // e1
  {
    const s = k.content('Approval: the evaluator workbench', 'Sign in as faculty (one-click demo login), open the Approval queue, the Bay State request, Faculty review stage. Compare CSC 220 with CAS CS 112 and decide.');
    step(s, 'e', 'Faculty / Admin');
    await k.shot(s, '05-request-review.png', 0.6, 1.5, 8.0, 5.3, 'Request review screenshot');
    points(s, [
      ['Side-by-side compare', 'Syllabus topics next to the BU course, shared terms highlighted, overlap % and credit math.'],
      ['Decide in one click', 'Equivalent, elective, no credit or "must take at BU". Accept every suggestion ≥ X% at once.'],
      ['Department decides', 'AI and rules never reject. Admins see only their university; outgoing requests are read-only.'],
    ], 8.9, 1.5, 3.9, 1.75, 17);
  }
  // e2 learning loop
  {
    const s = k.content('Each decision makes the next one faster', 'Press "Add second student" on the Demo scenario page: Noah Chen, also CSC 220 from Bay State, is applied automatically with no review. AI Controls > Learning turns repeated faculty corrections into suggested playbook rules; an admin adds them with a click.');
    step(s, 'e', 'Faculty / Admin');
    const nodes = [
      ['FiCheckSquare', '1  Faculty decides', 'CSC 220 = CAS CS 112, 4 cr'],
      ['FiDatabase', '2  Equivalency saved', 'Reusable, with effective dates'],
      ['FiZap', '3  Next student: instant', 'Noah Chen\'s CSC 220 is applied, no review'],
      ['FiBookOpen', '4  Skills learn', 'Overrides become suggested playbook rules (AI Controls → Learning)'],
    ];
    const pos = [[0.6, 1.55], [4.35, 1.55], [4.35, 4.25], [0.6, 4.25]];
    const bw = 3.25, bh = 2.2;
    for (let i = 0; i < 4; i++) {
      const [x, y] = pos[i];
      k.card(s, x, y, bw, bh, i === 2 ? C.maroon : C.tint);
      await k.iconCircle(s, nodes[i][0], x + 0.25, y + 0.25, 0.62, i === 2 ? C.gold : C.maroon, i === 2 ? C.deep : 'FFFFFF');
      k.text(s, nodes[i][1], { x: x + 0.25, y: y + 0.95, w: bw - 0.45, h: 0.4, fontSize: 17, bold: true, color: i === 2 ? C.white : C.maroon });
      k.text(s, nodes[i][2], { x: x + 0.25, y: y + 1.35, w: bw - 0.45, h: 0.75, fontSize: 13, color: i === 2 ? C.rose : C.ink, valign: 'top' });
    }
    k.arrow(s, 3.9, 2.65, 4.3, 2.65); k.arrow(s, 5.97, 3.8, 5.97, 4.2); k.arrow(s, 4.3, 5.35, 3.9, 5.35); k.arrow(s, 2.22, 4.2, 2.22, 3.8);
    k.card(s, 8.0, 1.55, 4.7, 4.9, C.white);
    k.text(s, 'Where the system learns', { x: 8.25, y: 1.7, w: 4.3, h: 0.45, fontFace: 'Cambria', fontSize: 19, bold: true, color: C.maroon });
    const L = ['Equivalencies table: every approved decision, with start and end dates', 'Cross-student match cache: the same external course is never matched twice', 'Learned skills: mined from faculty overrides and repeated elective / no-credit choices', 'Playbook skills: editable instructions sent to whichever AI provider is active', 'Nothing is automatic: a person adds each learned rule'];
    k.text(s, L.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < L.length - 1, paraSpaceAfter: 9 } })), { x: 8.25, y: 2.25, w: 4.3, h: 4.1, fontSize: 14, color: C.ink, valign: 'top' });
  }
  // f
  {
    const s = k.content('Workflow stages you can configure', 'Workflows (super admin settings, or /admin/workflows). The default: request received → intake and AI match → faculty review → finance → first approver → final approver → completed. Each university can copy it and change it.');
    step(s, 'f', 'Admin');
    await k.shot(s, '12-workflow-designer.png', 4.9, 1.5, 7.9, 5.3, 'Workflow designer screenshot');
    const f = [['FiLayers', 'Stages', 'System, review or approval; agent task per stage'], ['FiUsers', 'Approver groups', 'Role, group or person; per university'], ['FiClock', 'SLAs', 'Overdue stages escalate once, by email'], ['FiCheckCircle', 'Auto-approve', 'Accept suggestions ≥ a threshold; never rejects'], ['FiSkipForward', 'Bypass', 'Skip one stage, or accept the whole request']];
    for (let i = 0; i < f.length; i++) {
      const y = 1.5 + i * 1.06;
      await k.iconCircle(s, f[i][0], 0.6, y + 0.05, 0.58);
      k.text(s, f[i][1], { x: 1.35, y, w: 3.35, h: 0.36, fontSize: 16, bold: true, color: C.maroon });
      k.text(s, f[i][2], { x: 1.35, y: y + 0.37, w: 3.35, h: 0.62, fontSize: 13, color: C.ink, valign: 'top' });
    }
  }

  k.section('Super admin');
  // g
  {
    const s = k.content('AI stats for the Super Admin', 'Super admin dashboard: an "AI agents" block sits under Transfer operations, separate from the regular counts. AI Controls shows the same numbers in detail: spent this month, $ spent by request (matching / documents / briefs), tokens avoided, cache hits, response times. No AI key yet, so live AI spend is zero; the rules engine is logged at no cost.');
    step(s, 'g', 'Super admin');
    await k.shot(s, '11-super-admin-dashboard.png', 0.6, 1.5, 6.0, 3.5, 'Super admin dashboard screenshot');
    await k.shot(s, '06-ai-controls.png', 6.8, 1.5, 6.0, 3.5, 'AI Controls screenshot');
    k.text(s, 'Dashboard: operations and AI agents, kept apart', { x: 0.6, y: 5.05, w: 6, h: 0.3, fontSize: 12, color: C.mute });
    k.text(s, 'AI Controls: usage, $ by request, settings, playbook', { x: 6.8, y: 5.05, w: 6, h: 0.3, fontSize: 12, color: C.mute });
    const m = [['Spent this month', 'against a monthly budget meter'], ['$ spent by request', 'matching · documents · briefs'], ['Efficiency', 'tokens avoided, cache hits, calls skipped'], ['Speed', 'average and slowest response']];
    m.forEach((r, i) => {
      const x = 0.6 + i * 3.08;
      k.card(s, x, 5.55, 2.9, 1.25);
      k.text(s, r[0], { x: x + 0.2, y: 5.65, w: 2.5, h: 0.4, fontSize: 16, bold: true, color: C.maroon });
      k.text(s, r[1], { x: x + 0.2, y: 6.05, w: 2.5, h: 0.65, fontSize: 13, color: C.ink, valign: 'top' });
    });
  }

  k.section('Close');
  await k.teamSlide();
  await k.closeSlide({ headline: 'Faster for evaluators. Clearer for students. The department still decides.', notes: 'Invite questions. Repo and live site on screen.' });

  await k.write('TransferHub-Demo.pptx');
})();
