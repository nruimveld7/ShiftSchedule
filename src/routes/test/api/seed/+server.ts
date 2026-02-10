import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

export const POST: RequestHandler = async () => {
	const pool = await GetPool();
	const request = pool.request();
	const result = await request.query(`
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

        IF NOT EXISTS (SELECT 1 FROM dbo.Patterns WHERE ScheduleId = @ScheduleId AND Name = '4on4off' AND DeletedAt IS NULL)
            INSERT INTO dbo.Patterns (ScheduleId, Name, PatternJson)
            VALUES (@ScheduleId, '4on4off', '{"type":"rotation","cycleDays":8,"workDays":[0,1,2,3],"coverage":"DAY"}');

        IF NOT EXISTS (SELECT 1 FROM dbo.Patterns WHERE ScheduleId = @ScheduleId AND Name = '5xMonFri' AND DeletedAt IS NULL)
            INSERT INTO dbo.Patterns (ScheduleId, Name, PatternJson)
            VALUES (@ScheduleId, '5xMonFri', '{"type":"weekly","daysOfWeek":[1,2,3,4,5],"coverage":"DAY"}');

        DECLARE @Pattern4 int;
        DECLARE @Pattern5 int;

        SELECT TOP 1 @Pattern4 = PatternId FROM dbo.Patterns
        WHERE ScheduleId = @ScheduleId AND Name = '4on4off' AND DeletedAt IS NULL
        ORDER BY PatternId DESC;

        SELECT TOP 1 @Pattern5 = PatternId FROM dbo.Patterns
        WHERE ScheduleId = @ScheduleId AND Name = '5xMonFri' AND DeletedAt IS NULL
        ORDER BY PatternId DESC;

        IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'A' AND DeletedAt IS NULL)
            INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
            VALUES (@ScheduleId, 'A', 10, @Pattern4);

        IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'B' AND DeletedAt IS NULL)
            INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
            VALUES (@ScheduleId, 'B', 20, @Pattern4);

        IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'C' AND DeletedAt IS NULL)
            INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
            VALUES (@ScheduleId, 'C', 30, @Pattern4);

        IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'D' AND DeletedAt IS NULL)
            INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
            VALUES (@ScheduleId, 'D', 40, @Pattern4);

        IF NOT EXISTS (SELECT 1 FROM dbo.EmployeeTypes WHERE ScheduleId = @ScheduleId AND Name = 'Days' AND DeletedAt IS NULL)
            INSERT INTO dbo.EmployeeTypes (ScheduleId, Name, DisplayOrder, PatternId)
            VALUES (@ScheduleId, 'Days', 50, @Pattern5);

        SELECT @ScheduleId AS ScheduleId;
    `);

	const scheduleId = result.recordset?.[0]?.ScheduleId ?? null;
	return json({ scheduleId });
};
