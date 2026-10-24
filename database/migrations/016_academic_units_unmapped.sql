-- ============================================================
-- Migration 016 – allow Institutions (AcademicUnits) to exist without
-- a University mapping
-- ============================================================
-- Naming note (see CLAUDE.md): "Institutions" in the UI == the SQL
-- AcademicUnits table; "Universities" in the UI == the SQL Institutions
-- table.
--
-- User ask: an AcademicUnit (UI "Institution") should be creatable before
-- it's been assigned to a University (UI "Institution" record not yet
-- mapped to a "University"). AcademicUnits.InstitutionId is currently
-- NOT NULL (migration 008) — this makes it nullable.
--
-- FK note: FK_AcademicUnits_Institution (migration 008) is a plain
-- REFERENCES constraint with no special behavior tied to nullability —
-- SQL Server allows a FK column to hold NULL regardless of the FK
-- definition (NULL simply isn't checked against the referenced table),
-- so the constraint does not need to be dropped/recreated here.
--
-- Idempotency note: ALTER COLUMN to the same (already-nullable) type is
-- itself a safe no-op in SQL Server, so this is safe to re-run as-is
-- without an explicit IF-guard.
-- ============================================================
USE CreditEvalManager;
GO

ALTER TABLE AcademicUnits ALTER COLUMN InstitutionId INT NULL;
GO
