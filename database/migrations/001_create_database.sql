-- ============================================================
-- CreditEvalManager – Database Creation
-- Target:  SQL Server 2019+ / LocalDB (localdb)\MSSQLLocalDB
-- Run as:  sqlcmd -S "(localdb)\MSSQLLocalDB" -i 001_create_database.sql
--
-- DEPLOYING TO AZURE SQL DATABASE? Skip this file entirely — Azure SQL
-- doesn't allow USE to switch into a different database mid-connection,
-- so CREATE DATABASE + USE in one script doesn't work there. Create the
-- database as its own Azure resource (Portal/CLI) instead, then run
-- migrations 002-007 connected directly to it. See DEPLOYMENT.md.
-- ============================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'CreditEvalManager')
BEGIN
    CREATE DATABASE CreditEvalManager;
    PRINT 'Database CreditEvalManager created.';
END
ELSE
    PRINT 'Database CreditEvalManager already exists.';
GO

USE CreditEvalManager;
GO
