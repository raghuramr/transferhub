# Demo 1: Pacific Ridge University (`PRU`) - partner import demo

A fictional university (code `PRU`) with 10 programs, 50 courses and 200 syllabus topics, pushed through the public partner API from Postman.

| File | Purpose |
|---|---|
| `catalogue.json` | Request body (1 university, 10 programs x 5 courses, 3-4 topics each) |
| `postman.collection.json` | Postman collection, generated from the JSON |
| `students.json` | 30 student profiles with every field filled, 207 course rows and 72 small PDF documents (base64) |
| `students-no-documents.json` | The same 30 students without documents (small, easy to read and edit) |
| `roster.json`, `set.json` | Inputs for the student generator (names, ID types, cities, seed) |

Regenerate with the shared tools (from the repo root): `node docs/demo-data/tools/validate.js demo-1-pacific-ridge`, `build-students.js demo-1-pacific-ridge`, `build-postman.js demo-1-pacific-ridge`. The students are also checked against the importer's own rules by `npx tsx scripts/test-demo-students.ts` in `src/api`.

## Presenter steps
1. **Create the partner key.** Sign in as super admin, go to Data Import > Partners & API keys > Onboard a partner. Use university `Pacific Ridge University`, code `PRU`, plus a contact name and email. Copy the key (`th_live_...`). It is shown once.
2. **Set up Postman.** Import `postman.collection.json`. In the collection's Variables tab set `apiKey` to the key. `baseUrl` defaults to `https://transferhub.wcubeprojects.in`.
3. **Send the data.** Run "Who am I" to confirm the key, then either "POST full catalogue" or the three requests in "Step by step" (1 University only, 2 Programs only, 3 Courses with topics only). The POST requests save `reference` automatically and log the validation summary in the Postman console.
4. **Review.** In Data Import > Submissions open the new batch. Show the validation status per row, edit a row, then select rows and import. Universities are imported first, then programs, then courses. "Submission detail" in Postman shows per-row outcomes (`created`, `updated`, ...).
5. **Show the result.** The data appears under Universities (Pacific Ridge University), Programs (10, filter by university) and the Course Database (50 courses; the Topics action shows each course's topics and reference links). The partner also gets a report email.
6. **Reset the demo.** As super admin open **Universities**, click **Delete permanently** on the Pacific Ridge University row, tick *also delete its programs, courses, topics and imported student profiles*, review the preview (it lists exactly what will be removed and what, if anything, blocks it), type `DELETE` and confirm. It is refused if students have submitted courses from it, or if a student has already claimed a profile into a real account, because that history must be kept; use Deactivate in that case. The partner record for `PRU` is separate: remove it under Data Import > Partners & API keys (it can only be deleted when it has no submissions, otherwise deactivate it). You can also delete a single program, course or topic the same way.

## Student profiles (optional second demo)
30 Pacific Ridge students, three per program: US and international (passport, national ID and `other` ID types), with phone, location, country of origin, program, degree, concentration, GPA, graduation year, credits completed, calendar and a six-to-eight course history taken from the PRU catalogue (grades from A to C-, a few pass/fail). Each has a transcript PDF and an ID or passport PDF; international students also have a TOEFL report. The PDFs have a text layer, so Smart Upload's built-in reader classifies them and reads the courses.

1. Send the catalogue first (steps above) so the course codes mean something, then use the **Students** folder in Postman: *first 5 (quick demo)*, *all 30 (no documents)*, or *all 30 WITH documents* (in Postman choose `students.json` as the request body).
2. Review under Data Import > Submissions and import. Importing does **not** create accounts: each profile becomes **ready to claim**.
3. A student claims their profile on the public `/intake` page with their ID and email, then confirms, agrees and sets a password. The emails use the fictional `students.pacificridge.example` domain, so no real mailbox receives anything. **To show the claim end to end, change the `email` of one or two students to a mailbox you control before sending** (edit the request body in Postman), then use that student's ID and email on `/intake`.
4. `invite` is `false` for everyone so nothing is emailed during the import. Set `"invite": true` on a student whose email is real to have the claim link sent when the row is imported.
5. The ID numbers: `PRU-2023-NNNN` for student IDs, `I07...` style for passports, `NID-...` for national IDs and `ALT-PRU-NNNN` for the `other` type.

## Notes
- Limits: 60 requests per minute per key (per `docs/PARTNER_API.md`), 6 MB per request, 5,000 rows per submission. This catalogue is about 55 KB.
- Sending the same data again is allowed: rows whose code or name already exists show as `update` instead of `create`.
- The key only accepts `universityCode` `PRU`. Anything else is rejected as outside the allowed university.
- If you import step 2 or 3 alone before the university exists, rows show a warning or error until the university is imported, so keep the step order.
- Course titles and topics are written to resemble common first- and second-year courses elsewhere, so the equivalency matcher has realistic material. All URLs use the fictional `.example` domain.
