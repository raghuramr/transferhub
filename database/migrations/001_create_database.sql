-- ============================================================
-- University Manager – Database Creation
-- Target:  SQL Server 2019+ / LocalDB (localdb)\MSSQLLocalDB
-- Run as:  sqlcmd -S "(localdb)\MSSQLLocalDB" -i 001_create_database.sql
-- ============================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'UniversityManager')
BEGIN
    CREATE DATABASE UniversityManager;
    PRINT 'Database UniversityManager created.';
END
ELSE
    PRINT 'Database UniversityManager already exists.';
GO

USE UniversityManager;
GO
