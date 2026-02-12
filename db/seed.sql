SET QUOTED_IDENTIFIER ON;

DECLARE @ScheduleId int;

IF NOT EXISTS (SELECT 1 FROM dbo.Schedules WHERE Name = 'Demo Schedule' AND DeletedAt IS NULL)
BEGIN
    INSERT INTO dbo.Schedules (Name, Description)
    VALUES ('Demo Schedule', 'Seeded demo schedule');
END;

SELECT TOP 1 @ScheduleId = ScheduleId
FROM dbo.Schedules
WHERE Name = 'Demo Schedule' AND DeletedAt IS NULL
ORDER BY ScheduleId DESC;

-- Coverage codes
IF NOT EXISTS (SELECT 1 FROM dbo.CoverageCodes WHERE ScheduleId = @ScheduleId AND Code = 'DAY' AND DeletedAt IS NULL)
    INSERT INTO dbo.CoverageCodes (ScheduleId, Code, Label, Color, SortOrder)
    VALUES (@ScheduleId, 'DAY', 'Day Coverage', '#f2a900', 10);

IF NOT EXISTS (SELECT 1 FROM dbo.CoverageCodes WHERE ScheduleId = @ScheduleId AND Code = 'NIGHT' AND DeletedAt IS NULL)
    INSERT INTO dbo.CoverageCodes (ScheduleId, Code, Label, Color, SortOrder)
    VALUES (@ScheduleId, 'NIGHT', 'Night Coverage', '#00b0f0', 20);

IF NOT EXISTS (SELECT 1 FROM dbo.CoverageCodes WHERE ScheduleId = @ScheduleId AND Code = 'VAC' AND DeletedAt IS NULL)
    INSERT INTO dbo.CoverageCodes (ScheduleId, Code, Label, Color, SortOrder)
    VALUES (@ScheduleId, 'VAC', 'Vacation', '#fff2a8', 30);

IF NOT EXISTS (SELECT 1 FROM dbo.CoverageCodes WHERE ScheduleId = @ScheduleId AND Code = 'HOL' AND DeletedAt IS NULL)
    INSERT INTO dbo.CoverageCodes (ScheduleId, Code, Label, Color, SortOrder)
    VALUES (@ScheduleId, 'HOL', 'Holiday', '#ff7a7a', 40);

-- Patterns
IF NOT EXISTS (SELECT 1 FROM dbo.Patterns WHERE ScheduleId = @ScheduleId AND Name = '4on4off' AND DeletedAt IS NULL)
    INSERT INTO dbo.Patterns (ScheduleId, Name, PatternSummary, PatternJson)
    VALUES (
        @ScheduleId,
        '4on4off',
        '2 shifts',
        '{"swatches":[{"swatchIndex":0,"color":"#00c1ff","onDays":[1,2,3,4]},{"swatchIndex":1,"color":"#ffb000","onDays":[5,6,7,8]}],"noneSwatch":{"code":"NONE"}}'
    );

IF NOT EXISTS (SELECT 1 FROM dbo.Patterns WHERE ScheduleId = @ScheduleId AND Name = '5xMonFri' AND DeletedAt IS NULL)
    INSERT INTO dbo.Patterns (ScheduleId, Name, PatternSummary, PatternJson)
    VALUES (
        @ScheduleId,
        '5xMonFri',
        '1 shift',
        '{"swatches":[{"swatchIndex":0,"color":"#00c1ff","onDays":[1,2,3,4,5,8,9,10,11,12,15,16,17,18,19,22,23,24,25,26]}],"noneSwatch":{"code":"NONE"}}'
    );

DECLARE @Pattern4 int;
DECLARE @Pattern5 int;

SELECT TOP 1 @Pattern4 = PatternId FROM dbo.Patterns
WHERE ScheduleId = @ScheduleId AND Name = '4on4off' AND DeletedAt IS NULL
ORDER BY PatternId DESC;

SELECT TOP 1 @Pattern5 = PatternId FROM dbo.Patterns
WHERE ScheduleId = @ScheduleId AND Name = '5xMonFri' AND DeletedAt IS NULL
ORDER BY PatternId DESC;

-- Employee types
IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'A' AND DeletedAt IS NULL)
    INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
    VALUES (@ScheduleId, 'A', 1, @Pattern4);

IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'B' AND DeletedAt IS NULL)
    INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
    VALUES (@ScheduleId, 'B', 2, @Pattern4);

IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'C' AND DeletedAt IS NULL)
    INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
    VALUES (@ScheduleId, 'C', 3, @Pattern4);

IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'D' AND DeletedAt IS NULL)
    INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
    VALUES (@ScheduleId, 'D', 4, @Pattern4);

IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'Days' AND DeletedAt IS NULL)
    INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
    VALUES (@ScheduleId, 'Days', 5, @Pattern5);

SELECT @ScheduleId AS ScheduleId;
