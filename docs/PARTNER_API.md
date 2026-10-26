# TransferHub partner data API

Lets another university or agency push universities, programs, courses and **student profiles** to TransferHub.
Nothing is written to the live catalogue until a TransferHub super admin reviews
the rows (Super Admin > Data Import > Submissions) and imports the ones they approve.

## Getting access
A super admin onboards you under **Data Import > Partners & API keys** (university,
university code, point of contact, email). You receive an API key and the endpoint.
The key is shown once; if lost, ask for a new one.

## Three ways to send data
1. **Excel** - sign in at `/partner` with your key, download the template (sheets Universities, Programs, Courses, Topics, Students, StudentCourses), fill it in and upload it.
2. **JSON file** - upload a `.json` file at `/partner` (same shape as the API body below).
3. **API** - POST from your own systems (below).
All three land in the same review queue.

## Sending data (API)
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
* Any of `universities`, `programs`, `courses`, `students` may be omitted. Max 5,000 rows per submission, 6 MB.
* You can only submit data for your own `universityCode` (it is filled in if omitted).
* Response: `{ reference, status, received, validation: { valid, warnings, errors } }`.
  Rows with errors cannot be imported until fixed (the reviewer can edit them).
* Limit: 60 requests/minute per key.

## Student profiles (`students`)
Send the profiles you hold for students so they can start a transfer without retyping anything.
```json
{
  "students": [{
    "universityCode": "MIT",
    "externalId": "MIT-2041877",
    "idType": "student_id",
    "email": "priya.rao@example.com",
    "firstName": "Priya", "lastName": "Rao",
    "dateOfBirth": "2003-04-18",
    "programName": "Computer Science", "degree": "BS", "gpa": 3.6,
    "graduationYear": 2027, "creditsCompleted": 62,
    "courses": [{ "code": "6.0001", "title": "Intro to CS and Programming", "credits": 3, "grade": "A-", "term": "Fall 2024" }],
    "documents": [{ "docType": "transcript", "fileName": "transcript.pdf", "contentBase64": "<base64 of the PDF>" }],
    "invite": false
  }]
}
```
* **Required:** `universityCode` (your own), `externalId`, `email`, `firstName`, `lastName`. `idType` is `student_id` (default), `passport`, `national_id` or `other`.
* **Optional:** `universityName`, `dateOfBirth` (YYYY-MM-DD), `phone`, `country`, `countryOfOrigin`, `city`, `state`, `programName`, `degree`, `fieldOfStudy`, `gpa` (0-4.33), `graduationYear`, `creditsCompleted`, `calendar` (`semester` | `quarter` | `trimester`).
* **Courses:** each needs `code`, `title`, `credits` (> 0) and `grade`; `term` is optional. Sending `courses` replaces the profile's earlier list; leaving it out keeps it.
* **Documents:** PDF, PNG or JPG, base64 encoded, max 2 MB each and 10 per student. The same `docType` + `fileName` replaces the earlier copy. They count towards the 6 MB request limit, so send documents in small batches.
* Sending the same `externalId` again updates the profile; the same `externalId` twice in one submission is an error.
* In Excel, use the **Students** sheet for the profile and the **StudentCourses** sheet (matched on `externalId`) for courses. Documents are JSON/API only.

### What happens next - "profile ready to claim"
1. Your rows wait in the review queue like any other data. A TransferHub administrator approves them.
2. An approved profile is **ready to claim**. No user account is created at this point.
3. The student claims it by entering their ID and email on the TransferHub intake page, or from an email invitation. If a row has `"invite": true`, an invitation with a one-time link is emailed to the student when the row is imported.
4. The student reviews the data, agrees to use it, and sets a password. Only then does their account get created and the courses and documents copied into their own record.
5. Your report email lists each student row as "profile ready to claim" (or why it was not accepted).

## Field reference
`GET /api/public/v1/format` (no key needed).

## Checking progress
* `GET /api/public/v1/submissions` - your submissions.
* `GET /api/public/v1/submissions/{reference}` - per-row outcome (`pending`, `created`, `updated`, `rejected`, `failed`).

You also receive an email when the submission is received and a report when it has been processed.
