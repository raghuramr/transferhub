-- ============================================================
-- Seed 005 – Custom Forms (demo content for the JSON-schema forms feature)
-- ============================================================
-- Unchanged from the original seed/006_forms.sql (already idempotent).
-- ============================================================
USE CreditEvalManager;
GO

IF NOT EXISTS (SELECT 1 FROM Forms WHERE Slug = 'agency-student-referral')
INSERT INTO Forms (Slug, Title, Description, Status, SchemaJson, SuccessMessage)
VALUES (
    'agency-student-referral',
    'Agency Student Referral',
    N'Partner agencies use this form to refer a prospective transfer student to BU Credit Evaluation before submitting a full transcript.',
    'open',
    N'{
        "fields": [
          { "key": "studentName",   "label": "Student full name",        "type": "text",     "required": true },
          { "key": "studentEmail",  "label": "Student email",            "type": "email",    "required": true },
          { "key": "homeInstitution", "label": "Home institution",       "type": "text",     "required": true },
          { "key": "intendedTerm",  "label": "Intended entry term",      "type": "select",   "required": true,
            "options": ["Fall", "Spring", "Summer"] },
          { "key": "programArea",  "label": "Intended program area",     "type": "text",     "required": false,
            "placeholder": "e.g. Computer Science" },
          { "key": "hasTranscript", "label": "Transcript available now?", "type": "yesno",    "required": true },
          { "key": "notes",        "label": "Additional notes",          "type": "textarea", "required": false }
        ]
      }',
    'Thank you — the referral has been logged. BU Credit Evaluation staff will follow up with next steps.'
);
GO
