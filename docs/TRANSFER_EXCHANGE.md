# Transfer exchange (University 1 <-> University 2 <-> student)

A transfer request has three sides: the **student**, the **source university** (`Transcripts.InstitutionId`, "University 1")
and the **target university** (`Transcripts.TargetInstitutionId`, else the student's registered target, "University 2").
Needs migration `022_transfer_exchange.sql` and (for the permission matrix) seed `016_transfer_exchange.sql`.
Before 022 is applied the Transfers summary/lists still work; document requests, uploads and reminders say so and stay off.

## Visibility
- "University staff" = admin/faculty whose `UserScopeUniversities` name the university. No scope rows = unrestricted; super admin sees all.
- A scoped admin sees a request if it is **incoming** (full access, as before) or **outgoing** (source in scope): read the request,
  its documents and document requests, upload, ask, remind - but not approve/decide, skip, accept, start/resume, change status,
  post notes, or see the receiving university's internal notes / AI brief (`ScopeService.canWorkRequest`, `transcriptVisibleInScope`).
- Which side an account may speak for: `ScopeService.partiesFor` (student/agency = student; scoped staff = their universities;
  unscoped staff and super admins = either university, chosen with `party`).
- Students only see document requests/reminders that involve them; they can read every file in their own folder.

## Tables (migration 022)
- `DocumentRequests` - TranscriptId, RequestedByParty/FromParty (`student|source_university|target_university`), RequestedByUserId,
  Requested{By,From}InstitutionId, DocTypeKey (-> DocumentTypes), Title, Message, DueDate, Status (`open|fulfilled|cancelled|declined`),
  FulfilledUploadId/By/At, ResolvedByUserId, ResolutionNote, timestamps.
- `PartyReminders` - party-to-party reminders (kept apart from `StatusReminders`): FromParty, ToParty, optional DocumentRequestId, sender, message, e-mail success.
- `Uploads` new columns: StudentUserId, TranscriptId, UploadedByParty, UploadedByInstitutionId, Note, DocumentRequestId.
  `OwnerUserId`/`Role` stay "the uploader".
- Indexes on Transcripts (InstitutionId / TargetInstitutionId, ReceivedAt) for the lists.

## Storage
Transfer uploads go in the **student's** folder, not the uploader's:
`student/{studentUserId}/transfer/{transcriptId}/{party}/{uuid}-{filename}` (blob or local disk). Download via `GET /uploads/:id`:
allowed for the uploader, the student, super admin, faculty, a scoped admin of either university, and the submitting agency.
Legacy rows keep the old owner/admin/faculty rule. A file also lands on the request's document checklist (`TranscriptDocuments`).

## Endpoints (`/transfers`)
| Method | Path | Who |
|---|---|---|
| GET | `/transfers/summary?institutionId&days` | staff: counts by status/stage, weekly trend, counterparts, open doc requests, per direction |
| GET | `/transfers?direction=incoming\|outgoing&institutionId&status&q&page&pageSize` | staff |
| GET | `/transfers/:id` (also `/:id/exchange`) | any party: transfer header, requests, files, reminders, `viewer.parties` |
| POST | `/transfers/:id/document-requests` `{fromParty, party?, docTypeKey?, title?, message?, dueDate?}` | any party; e-mails the asked side |
| POST | `/transfers/:id/document-requests/:rid/cancel` / `decline` `{note?}` | asker cancels, asked side declines |
| POST | `/transfers/:id/document-requests/:rid/fulfil` (multipart `file`, `note?`) | asked side; marks fulfilled, e-mails asker |
| POST | `/transfers/:id/uploads` (multipart `file`, `party?`, `documentType?`, `note?`) | any party |
| POST | `/transfers/:id/reminders` `{toParty, party?, documentRequestId?, message?}` | any party; 12h per sender side / recipient side / subject (429 otherwise) |

Staff operations check the `transfers` permission module (view/create/edit); until seed 016 exists they fall back to allowed.
Audit actions: `DOCUMENT_REQUEST_CREATED|CANCELLED|DECLINED`, `TRANSFER_DOCUMENT_UPLOADED`, `PARTY_REMINDER_SENT`.
E-mail failures never block; events also leave notes on the request (student-facing when the student is involved, otherwise internal).
Pure rules are tested with `npx tsx scripts/test-exchange-logic.ts` (in `src/api`).

## UI
`/transfers` (Incoming / Outgoing tabs, university + period filters), `/transfers/:id` (detail), and the same `ExchangePanel`
on the staff request review page and the student's status page, with a banner for open requests asked of the viewer.
