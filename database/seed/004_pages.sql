-- ============================================================
-- Seed 004 – Custom Pages (demo content for the CMS feature)
-- ============================================================
-- Unchanged from the original seed/005_pages.sql.
-- ============================================================
USE TransferHubDB;
GO

-- "home" is the public landing page shown at "/" to anonymous visitors,
-- before they sign in. Fully editable from Admin -> Custom Pages, same
-- as every other page in this system.
IF NOT EXISTS (SELECT 1 FROM Pages WHERE Slug = 'home')
INSERT INTO Pages (Slug, Title, Blocks, Published, ShowInNav, NavLabel, NavOrder)
VALUES (
    'home',
    'Home',
    N'[
        {
          "id": "b1",
          "type": "hero",
          "visible": true,
          "title": "Smarter Transfer Credit Evaluation",
          "subtitle": "Boston University''s AI-assisted platform for evaluating transfer credit — for students, faculty, agencies, and administrators.",
          "ctaLabel": "Get started",
          "ctaHref": "/login"
        },
        {
          "id": "b2",
          "type": "cards",
          "visible": true,
          "items": [
            { "id": "c1", "visible": true, "title": "For Students & Agencies", "body": "Submit transcripts and track evaluation status in real time." },
            { "id": "c2", "visible": true, "title": "For Faculty", "body": "Review AI-ranked course matches and record transfer decisions quickly." },
            { "id": "c3", "visible": true, "title": "For Administrators", "body": "Manage the course catalog, users, and system-wide content from one place." }
          ]
        }
      ]',
    1, 0, NULL, 0
);
GO

-- "dashboard-announcements" is rendered as a banner at the top of every
-- role's dashboard. Edit it from Admin -> Pages in the UI and it updates
-- live for every signed-in user — no deploy, no publish step.
IF NOT EXISTS (SELECT 1 FROM Pages WHERE Slug = 'dashboard-announcements')
INSERT INTO Pages (Slug, Title, Blocks, Published, ShowInNav, NavLabel, NavOrder)
VALUES (
    'dashboard-announcements',
    'Dashboard Announcements',
    N'[
        {
          "id": "b1",
          "type": "notice",
          "visible": true,
          "tone": "info",
          "text": "Welcome to the Smarter Transfer Credit Evaluation portal. Fall 2026 evaluations are now open."
        }
      ]',
    1, 0, NULL, 0
);
GO

-- A sample public-ish FAQ page reachable from the sidebar (ShowInNav=1),
-- demonstrating the richer block types: heading, richtext, cards, cta.
IF NOT EXISTS (SELECT 1 FROM Pages WHERE Slug = 'transfer-credit-faq')
INSERT INTO Pages (Slug, Title, Blocks, Published, ShowInNav, NavLabel, NavOrder)
VALUES (
    'transfer-credit-faq',
    'Transfer Credit FAQ',
    N'[
        {
          "id": "b1",
          "type": "heading",
          "visible": true,
          "text": "Transfer Credit FAQ",
          "subtitle": "Answers to the questions we hear most often"
        },
        {
          "id": "b2",
          "type": "richtext",
          "visible": true,
          "html": "<p>Transfer credit is evaluated course-by-course against Boston University equivalents. Most decisions are available within <strong>2-3 weeks</strong> of your transcript being received.</p>"
        },
        {
          "id": "b3",
          "type": "cards",
          "visible": true,
          "items": [
            { "id": "c1", "visible": true, "title": "Minimum grade", "body": "A grade of C or higher is required for a course to be eligible for transfer credit." },
            { "id": "c2", "visible": true, "title": "Quarter credits", "body": "Quarter-system credits are converted to semester credits by dividing by 1.5." },
            { "id": "c3", "visible": true, "title": "BU residency", "body": "A minimum number of credits must still be completed at BU (Group C residency requirement)." }
          ]
        },
        {
          "id": "b4",
          "type": "cta",
          "visible": true,
          "text": "Have a transcript ready?",
          "buttonLabel": "Submit it now",
          "buttonHref": "/student/upload"
        }
      ]',
    1, 1, 'Transfer FAQ', 10
);
GO
