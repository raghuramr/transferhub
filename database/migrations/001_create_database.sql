-- ============================================================
-- CreditEvalManager – Database Creation
-- Target:  SQL Server 2019+ / LocalDB (localdb)\MSSQLLocalDB
-- Run as:  sqlcmd -S "(localdb)\MSSQLLocalDB" -i 001_create_database.sql
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
