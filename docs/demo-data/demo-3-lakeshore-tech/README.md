# Demo 3: Lakeshore Institute of Technology (`LIT`)

Third fictional demo university, for showing applied and technical fields (engineering, cybersecurity, information systems, design, aviation, construction, biomedical technology, supply chain, renewable energy, statistics): 10 programs, 50 courses with 164 topics, and 30 student profiles (213 course rows, 69 PDFs). Use it exactly like demo 1 - see [`../demo-1-pacific-ridge/README.md`](../demo-1-pacific-ridge/README.md) for the presenter steps, reset and claim flow - but onboard a partner with code **`LIT`** (a key only accepts its own code).

| File | Purpose |
|---|---|
| `catalogue.json` | 1 university, 10 programs x 5 courses, 3-4 topics each |
| `students.json` / `students-no-documents.json` | 30 students with / without base64 PDFs |
| `postman.collection.json` | Postman collection (full catalogue, step by step, students) |
| `roster.json`, `set.json` | Generator inputs |

Student IDs: `LIT-2023-NNNN` (student ID), passports, national IDs, `ALT-LIT-NNNN` (other). Emails use `students.lakeshoretech.example`.
Regenerate: `node docs/demo-data/tools/{validate,build-students,build-postman}.js demo-3-lakeshore-tech`.
