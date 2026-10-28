# Demo data sets

Fictional, throw-away universities for the partner import demo (Data Import > Partners > Postman / `/partner` portal). Every set has the same file layout and is safe to delete again with super admin's **Delete permanently**.

| Folder | University (code) | Size | Use |
|---|---|---|---|
| [`test-mini/`](test-mini/) | Harborview Test College (`HTC`) | 2 programs, 4 courses, 3 students | quick tests |
| [`demo-1-pacific-ridge/`](demo-1-pacific-ridge/) | Pacific Ridge University (`PRU`) | 10 programs, 50 courses, 200 topics, 30 students | full demo (tech/business/science) |
| [`demo-2-cascade-valley/`](demo-2-cascade-valley/) | Cascade Valley University (`CVU`) | 10 programs, 50 courses, 180 topics, 30 students | full demo (health/humanities/engineering) |
| [`demo-3-lakeshore-tech/`](demo-3-lakeshore-tech/) | Lakeshore Institute of Technology (`LIT`) | 10 programs, 50 courses, 164 topics, 30 students | full demo (applied/technical fields) |

Each folder: `catalogue.json` (universities, programs, courses with topics), `students.json` (with base64 PDFs), `students-no-documents.json`, `postman.collection.json`, plus `roster.json` and `set.json`, the inputs to the generator. A partner key is scoped to one university code, so onboard one partner per set. The full sets use different codes, so they can all be loaded at once.

`tools/` holds the shared scripts; each takes a set folder (run from the repo root, `build-students` needs `npm install` in `src/api` for pdfkit):
- `node docs/demo-data/tools/validate.js <set>` - checks `catalogue.json` against the importer's rules
- `node docs/demo-data/tools/build-students.js <set>` - regenerates the two student files (deterministic)
- `node docs/demo-data/tools/build-postman.js <set>` - regenerates `postman.collection.json`
- `npx tsx scripts/test-demo-students.ts` (in `src/api`) - runs the importer's own validation over every set's students

To add a set: copy a folder, edit `catalogue.json`, `roster.json` and `set.json` (code, seed, cities, concentrations, general courses), then run the three tools.
