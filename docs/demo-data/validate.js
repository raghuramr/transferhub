#!/usr/bin/env node
// Dependency-free check of pacific-ridge-catalogue.json against the importer's rules
// (src/api/src/import/import.service.ts: KNOWN_FIELDS + checkRow). Usage: node docs/demo-data/validate.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'pacific-ridge-catalogue.json');
const body = JSON.parse(fs.readFileSync(file, 'utf8'));

const KNOWN = {
  body: ['note', 'universities', 'programs', 'courses'],
  universities: ['code', 'name', 'type', 'calendar', 'website'],
  programs: ['universityCode', 'name', 'area', 'degree', 'school', 'description', 'website'],
  courses: ['universityCode', 'code', 'name', 'title', 'credits', 'programName', 'department', 'level', 'requirementType', 'description', 'learningOutcomes', 'source', 'topics'],
};
const errors = [];
const err = (m) => errors.push(m);
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isUrl = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };
const need = (where, field, v, max) => {
  const s = str(v);
  if (!s) err(`${where}: ${field} is required`);
  else if (s.length > max) err(`${where}: ${field} is longer than ${max} characters`);
};
const opt = (where, field, v, max) => { if (str(v).length > max) err(`${where}: ${field} is longer than ${max} characters`); };
const unknown = (where, obj, list) => {
  const u = Object.keys(obj).filter((k) => !list.includes(k));
  if (u.length) err(`${where}: unknown field(s) ${u.join(', ')}`);
};

unknown('body', body, KNOWN.body);
if (!Array.isArray(body.universities) || body.universities.length !== 1) err('expected exactly 1 university');
if (!Array.isArray(body.programs) || body.programs.length !== 10) err('expected exactly 10 programs');
if (!Array.isArray(body.courses) || body.courses.length !== 50) err('expected exactly 50 courses');
const unis = body.universities || [], progs = body.programs || [], courses = body.courses || [];

unis.forEach((u) => {
  const w = `university ${u.code}`;
  unknown(w, u, KNOWN.universities);
  need(w, 'code', u.code, 20); need(w, 'name', u.name, 200);
  if (u.type && !['university', 'community_college'].includes(u.type)) err(`${w}: bad type`);
  if (u.calendar && !['semester', 'quarter'].includes(u.calendar)) err(`${w}: bad calendar`);
  if (u.website && !isUrl(u.website)) err(`${w}: website is not http(s)`);
  if (u.code !== 'PRU') err(`${w}: code must be PRU`);
});

const progNames = new Set();
progs.forEach((p) => {
  const w = `program ${p.name}`;
  unknown(w, p, KNOWN.programs);
  need(w, 'universityCode', p.universityCode, 20); need(w, 'name', p.name, 200);
  opt(w, 'area', p.area, 100); opt(w, 'degree', p.degree, 10); opt(w, 'school', p.school, 200);
  if (p.universityCode !== 'PRU') err(`${w}: universityCode must be PRU`);
  if (progNames.has(p.name)) err(`${w}: duplicate program name`);
  progNames.add(p.name);
});

const codes = new Set();
const perProgram = {};
let topicCount = 0, linkCount = 0;
courses.forEach((c) => {
  const w = `course ${c.code}`;
  unknown(w, c, KNOWN.courses);
  need(w, 'universityCode', c.universityCode, 20); need(w, 'code', c.code, 30); need(w, 'name', c.name || c.title, 300);
  opt(w, 'department', c.department, 100); opt(w, 'requirementType', c.requirementType, 100); opt(w, 'source', c.source, 500);
  if (c.universityCode !== 'PRU') err(`${w}: universityCode must be PRU`);
  const cr = Number(c.credits);
  if (c.credits === undefined || c.credits === null || c.credits === '') err(`${w}: credits is required`);
  else if (!Number.isFinite(cr) || cr <= 0 || cr > 30) err(`${w}: credits must be > 0 and <= 30`);
  if (!['intro', 'lower', 'upper'].includes(c.level)) err(`${w}: level must be intro, lower or upper`);
  if (!str(c.description)) err(`${w}: description missing`);
  if (!str(c.learningOutcomes)) err(`${w}: learningOutcomes missing`);
  if (!str(c.requirementType)) err(`${w}: requirementType missing`);
  if (!str(c.department)) err(`${w}: department missing`);
  if (codes.has(c.code)) err(`${w}: duplicate course code`);
  codes.add(c.code);
  if (!progNames.has(c.programName)) err(`${w}: programName "${c.programName}" not found in programs`);
  perProgram[c.programName] = (perProgram[c.programName] || 0) + 1;
  if (!Array.isArray(c.topics)) { err(`${w}: topics must be a list`); return; }
  if (c.topics.length < 3 || c.topics.length > 4) err(`${w}: expected 3 or 4 topics, found ${c.topics.length}`);
  c.topics.forEach((t, i) => {
    topicCount++;
    if (!t || !str(t.title)) err(`${w}: topic ${i + 1} needs a title`);
    else if (str(t.title).length > 200) err(`${w}: topic ${i + 1} title is longer than 200 characters`);
    if (!t || !str(t.description)) err(`${w}: topic ${i + 1} needs a description`);
    unknown(`${w} topic ${i + 1}`, t || {}, ['title', 'description', 'referenceLinks']);
    if (t && t.referenceLinks !== undefined) {
      if (!Array.isArray(t.referenceLinks) || t.referenceLinks.some((l) => !l || !isUrl(str(l.url)) || !str(l.label))) {
        err(`${w}: topic ${i + 1} referenceLinks must be a list of {label, url} with http(s) URLs`);
      } else linkCount += t.referenceLinks.length;
    }
  });
});
progs.forEach((p) => { if (perProgram[p.name] !== 5) err(`program ${p.name}: expected 5 courses, found ${perProgram[p.name] || 0}`); });

console.log(`universities: ${unis.length}`);
console.log(`programs:     ${progs.length}`);
console.log(`courses:      ${courses.length}`);
console.log(`topics:       ${topicCount} (${linkCount} with reference links)`);
console.log(`payload size: ${(Buffer.byteLength(JSON.stringify(body)) / 1024).toFixed(1)} KB (limit 6 MB)`);
if (errors.length) {
  errors.forEach((e) => console.log('  - ' + e));
  console.log(`FAIL (${errors.length} problem${errors.length === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('PASS');
