# Pacific Ridge University - partner import demo

A fictional university (code `PRU`) with 10 programs, 50 courses and 200 syllabus topics, pushed through the public partner API from Postman.

| File | Purpose |
|---|---|
| `pacific-ridge-catalogue.json` | Request body (1 university, 10 programs x 5 courses, 3-4 topics each) |
| `TransferHub-Partner-API.postman_collection.json` | Postman collection, generated from the JSON |
| `build-postman.js` | Regenerates the collection: `node docs/demo-data/build-postman.js` |
| `validate.js` | Checks the JSON against the importer rules: `node docs/demo-data/validate.js` |

If you edit the JSON, run `validate.js`, then `build-postman.js`, and re-import the collection.

## Presenter steps
1. **Create the partner key.** Sign in as super admin, go to Data Import > Partners & API keys > Onboard a partner. Use university `Pacific Ridge University`, code `PRU`, plus a contact name and email. Copy the key (`th_live_...`). It is shown once.
2. **Set up Postman.** Import `TransferHub-Partner-API.postman_collection.json`. In the collection's Variables tab set `apiKey` to the key. `baseUrl` defaults to `https://transferhub.wcubeprojects.in`.
3. **Send the data.** Run "Who am I" to confirm the key, then either "POST full catalogue" or the three requests in "Step by step" (1 University only, 2 Programs only, 3 Courses with topics only). The POST requests save `reference` automatically and log the validation summary in the Postman console.
4. **Review.** In Data Import > Submissions open the new batch. Show the validation status per row, edit a row, then select rows and import. Universities are imported first, then programs, then courses. "Submission detail" in Postman shows per-row outcomes (`created`, `updated`, ...).
5. **Show the result.** The data appears under Universities (Pacific Ridge University), Programs (10, filter by university) and the Course Database (50 courses; the Topics action shows each course's topics and reference links). The partner also gets a report email.
6. **Reset the demo.** As super admin open **Universities**, click **Delete permanently** on the Pacific Ridge University row, tick *also delete its programs, courses and topics*, review the preview (it lists exactly what will be removed and what, if anything, blocks it), type `DELETE` and confirm. It is refused if students have submitted courses from it, because that history must be kept; use Deactivate in that case. You can also delete a single program, course or topic the same way.

## Notes
- Limits: 60 requests per minute per key (per `docs/PARTNER_API.md`), 6 MB per request, 5,000 rows per submission. This catalogue is about 55 KB.
- Sending the same data again is allowed: rows whose code or name already exists show as `update` instead of `create`.
- The key only accepts `universityCode` `PRU`. Anything else is rejected as outside the allowed university.
- If you import step 2 or 3 alone before the university exists, rows show a warning or error until the university is imported, so keep the step order.
- Course titles and topics are written to resemble common first- and second-year courses elsewhere, so the equivalency matcher has realistic material. All URLs use the fictional `.example` domain.
