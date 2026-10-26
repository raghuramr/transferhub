-- ============================================================
-- Seed 011 - Student registration: admin-managed extra questions
-- ============================================================
-- The registration page shows the OPEN custom form with slug
-- 'student-registration' as extra steps (one step per distinct "section"
-- value) before the review step. Super admins edit it under
-- Custom Forms - no developer needed. Answers are stored as a
-- FormSubmission linked to the new student (Custom Forms > Submissions).
-- File fields are ignored on this page (a new registrant has no login yet).
-- Idempotent: never overwrites an existing form.
-- ============================================================
USE TransferHubDB;
GO

IF NOT EXISTS (SELECT 1 FROM Forms WHERE Slug = 'student-registration')
INSERT INTO Forms (Slug, Title, Description, Status, SchemaJson, SuccessMessage)
VALUES (
    'student-registration',
    'More about you',
    N'Optional extra questions shown at the end of student registration. Edit or close this form under Custom Forms.',
    'open',
    N'{
        "fields": [
          { "key": "howHeard", "label": "How did you hear about TransferHub?", "type": "select",
            "options": ["Friend or family", "My college advisor", "Agency / recruiter", "Search engine", "Social media", "Other"],
            "section": "More about you" },
          { "key": "notes", "label": "Anything else we should know?", "type": "textarea", "section": "More about you" }
        ]
      }',
    N'Thanks for registering.'
);
GO
