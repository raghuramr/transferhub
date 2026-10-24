-- ============================================================
-- TransferHubDB – Database Creation
-- Target:  SQL Server 2019+ / LocalDB (localdb)\MSSQLLocalDB
-- Run as:  sqlcmd -S "(localdb)\MSSQLLocalDB" -i 001_database.sql
--
-- DEPLOYING TO AZURE SQL DATABASE? Skip this file entirely — Azure SQL
-- doesn't allow USE to switch into a different database mid-connection,
-- so CREATE DATABASE + USE in one script doesn't work there. Create the
-- database as its own Azure resource (Portal/CLI) instead, then run the
-- rest of the migrations connected directly to it. See DEPLOYMENT.md.
--
-- Consolidation note (see CLAUDE.md "DB Script Runner tool" section): this
-- replaces the old per-feature migration file set (002-017) with one
-- idempotent file per entity. This file itself is unchanged in substance
-- from the old 001_create_database.sql — database creation is special
-- (it runs against `master`) and doesn't belong in the entity grouping.
-- ============================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'TransferHubDB')
BEGIN
    CREATE DATABASE TransferHubDB;
    PRINT 'Database TransferHubDB created.';
END
ELSE
    PRINT 'Database TransferHubDB already exists.';
GO

USE TransferHubDB;
GO
