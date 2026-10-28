# Test set: Harborview Test College (`HTC`) - throw-away

The smallest useful data set, for quick tests of the import, review and purge flow: 1 university, 2 programs (Computing Basics, Writing Basics), 4 courses (9 topics) and 3 students (US student ID, international passport with an English test, and an `other` ID type; 9 course rows, 7 PDFs, about 21 KB with documents).

| File | Purpose |
|---|---|
| `catalogue.json` | The whole catalogue in one request |
| `students.json` / `students-no-documents.json` | 3 students with / without PDFs |
| `postman.collection.json` | Postman collection |
| `roster.json`, `set.json` | Generator inputs |

Onboard a partner with code **`HTC`**, send the catalogue, then the students, review under Data Import > Submissions, and clean up with **Delete permanently** on the university (tick *also delete its programs, courses, topics and imported student profiles*). Same steps as demo 1.
Regenerate: `node docs/demo-data/tools/{validate,build-students,build-postman}.js test-mini`.
