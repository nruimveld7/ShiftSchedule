-- Core schema for schedules, users, roles, patterns, and events.
-- Idempotent: safe to run multiple times.

IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserOid nvarchar(64) NOT NULL PRIMARY KEY,
        FullName nvarchar(200) NULL,
        DisplayName nvarchar(200) NULL,
        Email nvarchar(320) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT sysutcdatetime(),
        UpdatedAt datetime2 NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL
    );
END;

IF OBJECT_ID('dbo.BootstrapManagers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BootstrapManagers (
        UserOid nvarchar(64) NOT NULL PRIMARY KEY,
        Source nvarchar(50) NOT NULL CONSTRAINT DF_BootstrapManagers_Source DEFAULT 'env',
        GrantedAt datetime2 NOT NULL CONSTRAINT DF_BootstrapManagers_GrantedAt DEFAULT sysutcdatetime(),
        IsActive bit NOT NULL CONSTRAINT DF_BootstrapManagers_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_BootstrapManagers_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid)
    );
END;

IF OBJECT_ID('dbo.Schedules', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Schedules (
        ScheduleId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Name nvarchar(200) NOT NULL,
        Description nvarchar(400) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Schedules_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Schedules_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL
    );
END;

IF OBJECT_ID('dbo.Roles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Roles (
        RoleId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        RoleName nvarchar(50) NOT NULL
    );

    CREATE UNIQUE INDEX UX_Roles_RoleName ON dbo.Roles(RoleName);
END;

IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName = 'Member')
    INSERT INTO dbo.Roles (RoleName) VALUES ('Member');
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName = 'Maintainer')
    INSERT INTO dbo.Roles (RoleName) VALUES ('Maintainer');
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE RoleName = 'Manager')
    INSERT INTO dbo.Roles (RoleName) VALUES ('Manager');

IF OBJECT_ID('dbo.Patterns', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Patterns (
        PatternId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ScheduleId int NOT NULL,
        Name nvarchar(100) NOT NULL,
        PatternJson nvarchar(max) NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_Patterns_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_Patterns_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_Patterns_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId)
    );
END;

IF OBJECT_ID('dbo.EmployeeTypes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EmployeeTypes (
        EmployeeTypeId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ScheduleId int NOT NULL,
        Name nvarchar(50) NOT NULL,
        DisplayOrder int NOT NULL CONSTRAINT DF_EmployeeTypes_DisplayOrder DEFAULT 0,
        PatternId int NULL,
        IsActive bit NOT NULL CONSTRAINT DF_EmployeeTypes_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_EmployeeTypes_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        UpdatedAt datetime2 NULL,
        UpdatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_EmployeeTypes_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_EmployeeTypes_Patterns FOREIGN KEY (PatternId) REFERENCES dbo.Patterns(PatternId)
    );
END;

IF OBJECT_ID('dbo.CoverageCodes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CoverageCodes (
        CoverageCodeId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ScheduleId int NOT NULL,
        Code nvarchar(20) NOT NULL,
        Label nvarchar(100) NULL,
        Color nvarchar(20) NULL,
        SortOrder int NOT NULL CONSTRAINT DF_CoverageCodes_SortOrder DEFAULT 0,
        IsActive bit NOT NULL CONSTRAINT DF_CoverageCodes_IsActive DEFAULT 1,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_CoverageCodes_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_CoverageCodes_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId)
    );
END;

IF OBJECT_ID('dbo.ScheduleUsers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScheduleUsers (
        ScheduleId int NOT NULL,
        UserOid nvarchar(64) NOT NULL,
        RoleId int NOT NULL,
        GrantedAt datetime2 NOT NULL CONSTRAINT DF_ScheduleUsers_GrantedAt DEFAULT sysutcdatetime(),
        GrantedBy nvarchar(64) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_ScheduleUsers_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT PK_ScheduleUsers PRIMARY KEY (ScheduleId, UserOid, RoleId),
        CONSTRAINT FK_ScheduleUsers_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_ScheduleUsers_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_ScheduleUsers_Roles FOREIGN KEY (RoleId) REFERENCES dbo.Roles(RoleId)
    );
END;

IF OBJECT_ID('dbo.ScheduleUserTypes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScheduleUserTypes (
        ScheduleId int NOT NULL,
        UserOid nvarchar(64) NOT NULL,
        EmployeeTypeId int NOT NULL,
        StartDate date NOT NULL,
        EndDate date NULL,
        DisplayOrder int NOT NULL CONSTRAINT DF_ScheduleUserTypes_DisplayOrder DEFAULT 0,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ScheduleUserTypes_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        EndedAt datetime2 NULL,
        EndedBy nvarchar(64) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_ScheduleUserTypes_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT PK_ScheduleUserTypes PRIMARY KEY (ScheduleId, UserOid, EmployeeTypeId, StartDate),
        CONSTRAINT FK_ScheduleUserTypes_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_ScheduleUserTypes_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_ScheduleUserTypes_EmployeeTypes FOREIGN KEY (EmployeeTypeId) REFERENCES dbo.EmployeeTypes(EmployeeTypeId),
        CONSTRAINT CK_ScheduleUserTypes_DateRange CHECK (EndDate IS NULL OR EndDate >= StartDate)
    );
END;

IF OBJECT_ID('dbo.ScheduleEvents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScheduleEvents (
        EventId int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ScheduleId int NOT NULL,
        UserOid nvarchar(64) NULL,
        StartDate date NOT NULL,
        EndDate date NOT NULL,
        CoverageCodeId int NULL,
        Title nvarchar(200) NULL,
        Notes nvarchar(max) NULL,
        CreatedAt datetime2 NOT NULL CONSTRAINT DF_ScheduleEvents_CreatedAt DEFAULT sysutcdatetime(),
        CreatedBy nvarchar(64) NULL,
        IsActive bit NOT NULL CONSTRAINT DF_ScheduleEvents_IsActive DEFAULT 1,
        DeletedAt datetime2 NULL,
        DeletedBy nvarchar(64) NULL,
        CONSTRAINT FK_ScheduleEvents_Schedules FOREIGN KEY (ScheduleId) REFERENCES dbo.Schedules(ScheduleId),
        CONSTRAINT FK_ScheduleEvents_Users FOREIGN KEY (UserOid) REFERENCES dbo.Users(UserOid),
        CONSTRAINT FK_ScheduleEvents_CoverageCodes FOREIGN KEY (CoverageCodeId) REFERENCES dbo.CoverageCodes(CoverageCodeId),
        CONSTRAINT CK_ScheduleEvents_DateRange CHECK (EndDate >= StartDate)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleUserTypes_Range' AND object_id = OBJECT_ID('dbo.ScheduleUserTypes')
)
    CREATE INDEX IX_ScheduleUserTypes_Range
    ON dbo.ScheduleUserTypes (ScheduleId, StartDate, EndDate);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleUserTypes_User' AND object_id = OBJECT_ID('dbo.ScheduleUserTypes')
)
    CREATE INDEX IX_ScheduleUserTypes_User
    ON dbo.ScheduleUserTypes (ScheduleId, UserOid, StartDate, EndDate);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleEvents_Range' AND object_id = OBJECT_ID('dbo.ScheduleEvents')
)
    CREATE INDEX IX_ScheduleEvents_Range
    ON dbo.ScheduleEvents (ScheduleId, StartDate, EndDate);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes WHERE name = 'IX_ScheduleUsers_BySchedule' AND object_id = OBJECT_ID('dbo.ScheduleUsers')
)
    CREATE INDEX IX_ScheduleUsers_BySchedule
    ON dbo.ScheduleUsers (ScheduleId, RoleId);

IF OBJECT_ID('dbo.TR_ScheduleUserTypes_NoOverlap', 'TR') IS NULL
BEGIN
    EXEC('
        CREATE TRIGGER dbo.TR_ScheduleUserTypes_NoOverlap
        ON dbo.ScheduleUserTypes
        AFTER INSERT, UPDATE
        AS
        BEGIN
            SET NOCOUNT ON;

            IF EXISTS (
                SELECT 1
                FROM dbo.ScheduleUserTypes t
                JOIN inserted i
                  ON t.ScheduleId = i.ScheduleId
                 AND t.UserOid = i.UserOid
                 AND t.EmployeeTypeId = i.EmployeeTypeId
                 AND t.StartDate <> i.StartDate
                WHERE
                    t.DeletedAt IS NULL
                    AND t.IsActive = 1
                    AND i.DeletedAt IS NULL
                    AND i.IsActive = 1
                    AND t.StartDate <= ISNULL(i.EndDate, ''9999-12-31'')
                    AND ISNULL(t.EndDate, ''9999-12-31'') >= i.StartDate
            )
            BEGIN
                RAISERROR (''Overlapping ScheduleUserTypes range for this user/type.'', 16, 1);
                ROLLBACK TRANSACTION;
                RETURN;
            END
        END
    ');
END;
