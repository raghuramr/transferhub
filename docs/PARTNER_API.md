# TransferHub partner data API

Lets another university push universities, programs and courses to TransferHub.
Nothing is written to the live catalogue until a TransferHub super admin reviews
the rows (Super Admin > Data Import > Submissions) and imports the ones they approve.

## Getting access
A super admin onboards you under **Data Import > Partners & API keys** (university,
university code, point of contact, email). You receive an API key and the endpoint.
The key is shown once; if lost, ask for a new one.

## Sending data
```
POST /api/public/v1/submissions
X-API-Key: th_live_...
Content-Type: application/json
```
```json
{
  "note": "Spring 2027 catalogue update",
  "universities": [{ "code": "MIT", "name": "Massachusetts Institute of Technology" }],
  "programs":     [{ "universityCode": "MIT", "name": "Computer Science", "degree": "BS" }],
  "courses":      [{ "universityCode": "MIT", "code": "6.0001", "name": "Intro to CS", "credits": 3,
                     "programName": "Computer Science",
                     "topics": [{ "title": "Variables", "description": "Basic types" }] }]
}
```
* Any of `universities`, `programs`, `courses` may be omitted. Max 5,000 rows per submission, 6 MB.
* You can only submit data for your own `universityCode` (it is filled in if omitted).
* Response: `{ reference, status, received, validation: { valid, warnings, errors } }`.
  Rows with errors cannot be imported until fixed (the reviewer can edit them).
* Limit: 60 requests/minute per key.

## Field reference
`GET /api/public/v1/format` (no key needed).

## Checking progress
* `GET /api/public/v1/submissions` - your submissions.
* `GET /api/public/v1/submissions/{reference}` - per-row outcome (`pending`, `created`, `updated`, `rejected`, `failed`).

You also receive an email when the submission is received and a report when it has been processed.
