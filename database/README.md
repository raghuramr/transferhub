# Database — University Manager

SQL Server 2019+ / LocalDB `(localdb)\MSSQLLocalDB`

## Run order

```
# 1. Create database + schema
sqlcmd -S "(localdb)\MSSQLLocalDB" -i migrations/001_create_database.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i migrations/002_auth_and_users.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i migrations/003_institutions_and_courses.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i migrations/004_transcripts_and_evaluations.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i migrations/005_views_and_procedures.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i migrations/006_pages.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i migrations/007_forms.sql

# 2. Seed reference data + course catalog
sqlcmd -S "(localdb)\MSSQLLocalDB" -i seed/001_reference_data.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i seed/002_bu_courses.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i seed/003_peer_courses_and_matches.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i seed/004_demo_users.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i seed/005_pages.sql
sqlcmd -S "(localdb)\MSSQLLocalDB" -i seed/006_forms.sql

# 3. Set real password hashes (run from src/api)
cd ../src/api && npm run seed:users
```

For Docker dev (used in this repo):
```
sqlcmd -S "localhost,1433" -U sa -P "Dev_Passw0rd!" -C -i migrations/001_create_database.sql
# ... same pattern
```

## Schema summary

| Table | Purpose |
|---|---|
| `Roles` | 5 roles: student, faculty, admin, agency, super_admin |
| `Departments` | Academic departments (CS, ECON, …) and EVAL for staff |
| `Users` | All users; account lock, failed login tracking |
| `RefreshTokens` | JWT refresh tokens (hashed) |
| `PasswordResetTokens` | One-time password reset tokens |
| `AuditLog` | Immutable append-only audit trail |
| `Institutions` | BU, Northeastern, NYU, synthetic schools |
| `Programs` | Program-level match data across institutions |
| `Courses` | BU + peer course catalogs (117 rows seeded) |
| `Equivalencies` | Known course matches (56 seeded from workbook) |
| `StudentProfiles` | Extended profile for student users |
| `Transcripts` | One transcript per student per institution |
| `TranscriptCourses` | Individual courses on a transcript; lane + status |
| `Syllabi` | Uploaded syllabi files + extracted text |
| `Evaluations` | Department review record; AI suggestion + human decision |
| `AIMatchCandidates` | Ranked BU course suggestions from AI |
| `Pages` | Admin-editable custom pages — one row per page, body stored as a JSON array of content "blocks" (hero, heading, richtext, notice, cards, cta, divider, image). Saving a page from Admin -> Custom Pages is immediately live for every signed-in user; `dashboard-announcements` drives the banner on every dashboard, and `home` is the public landing page shown at "/" before login. |
| `Forms` | Admin-built JSON-schema forms (text/select/radio/checkboxes/yesno/etc. questions) — no code required per form. `Status` gates whether it accepts submissions (draft/open/closed). |
| `FormSubmissions` | One row per response to a Form; `Data` is a JSON object keyed by field, reviewed/approved/rejected by staff. |

## Views

| View | Used by |
|---|---|
| `vw_StudentTranscriptSummary` | Student portal, advisor view |
| `vw_EvaluatorQueue` | Faculty workbench, admin dashboard |
| `vw_MatchSummary` | Admin statistics |

## Stored procedures

| SP | Purpose |
|---|---|
| `sp_TriageCourse` | Apply business rules (grade, credit, equivalency lookup) to assign a lane |
| `sp_RecordDecision` | Save evaluator decision; propagate to equivalency DB |

## Course lanes

| Lane | Meaning |
|---|---|
| `applied` | Exact equivalency found; auto-applied |
| `likely` | High-confidence AI candidate; pending faculty confirm |
| `needs_syllabus` | No match; syllabus required for review |
| `elective_only` | BU-only residency requirement; elective credit at most |
| `not_eligible` | Below grade threshold or past deadline |
| `pending` | Not yet triaged |
