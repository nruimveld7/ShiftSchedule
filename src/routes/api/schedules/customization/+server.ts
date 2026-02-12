import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GetPool } from '$lib/server/db';

type ThemeFieldKey =
	| 'background'
	| 'text'
	| 'accent'
	| 'todayColor'
	| 'weekendColor'
	| 'weekdayColor'
	| 'pageBorderColor'
	| 'scheduleBorderColor'
	| 'primaryGradient1'
	| 'primaryGradient2'
	| 'secondaryGradient1'
	| 'secondaryGradient2';
type ThemeDraft = Record<ThemeFieldKey, string>;
type ScheduleThemePayload = {
	dark: ThemeDraft;
	light: ThemeDraft;
};

const themeKeys: ThemeFieldKey[] = [
	'background',
	'text',
	'accent',
	'todayColor',
	'weekendColor',
	'weekdayColor',
	'pageBorderColor',
	'scheduleBorderColor',
	'primaryGradient1',
	'primaryGradient2',
	'secondaryGradient1',
	'secondaryGradient2'
];

const themeDefaults: Record<'dark' | 'light', ThemeDraft> = {
	dark: {
		background: '#07080b',
		text: '#ffffff',
		accent: '#c8102e',
		todayColor: '#c8102e',
		weekendColor: '#000000',
		weekdayColor: '#161a22',
		pageBorderColor: '#292a30',
		scheduleBorderColor: '#292a30',
		primaryGradient1: '#7a1b2c',
		primaryGradient2: '#2d1118',
		secondaryGradient1: '#361219',
		secondaryGradient2: '#0c0e12'
	},
	light: {
		background: '#f2f3f5',
		text: '#000000',
		accent: '#c8102e',
		todayColor: '#c8102e',
		weekendColor: '#d4d7de',
		weekdayColor: '#f5f6f8',
		pageBorderColor: '#bbbec6',
		scheduleBorderColor: '#bbbec6',
		primaryGradient1: '#f4d7dd',
		primaryGradient2: '#f8f9fb',
		secondaryGradient1: '#faeef0',
		secondaryGradient2: '#f5f6f8'
	}
};

function parseScheduleId(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw error(400, 'A valid scheduleId is required');
	}
	return value;
}

function parseScheduleName(value: unknown): string {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (!trimmed) {
		throw error(400, 'Schedule name is required');
	}
	if (trimmed.length > 200) {
		throw error(400, 'Schedule name must be 200 characters or fewer');
	}
	return trimmed;
}

function parseScheduleIsActive(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw error(400, 'A valid isActive value is required');
	}
	return value;
}

function isHexColor(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value);
}

function parseThemePayload(value: unknown): ScheduleThemePayload {
	if (!value || typeof value !== 'object') {
		throw error(400, 'A valid theme payload is required');
	}

	const candidate = value as Record<string, unknown>;
	const dark = candidate.dark as Record<string, unknown> | undefined;
	const light = candidate.light as Record<string, unknown> | undefined;
	if (!dark || !light || typeof dark !== 'object' || typeof light !== 'object') {
		throw error(400, 'Both dark and light theme values are required');
	}

	const parseMode = (mode: Record<string, unknown>, modeDefaults: ThemeDraft): ThemeDraft => {
		const parsed = {} as ThemeDraft;
		for (const key of themeKeys) {
			const raw =
				mode[key] ??
				((key === 'pageBorderColor' || key === 'scheduleBorderColor'
					? mode.borderColor
					: undefined) as unknown) ??
				modeDefaults[key];
			if (typeof raw !== 'string' || !isHexColor(raw)) {
				throw error(400, `Invalid color value for ${key}`);
			}
			parsed[key] = raw.toLowerCase();
		}
		return parsed;
	};

	return {
		dark: parseMode(dark, themeDefaults.dark),
		light: parseMode(light, themeDefaults.light)
	};
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const body = await request.json().catch(() => null);
	const scheduleId = parseScheduleId(body?.scheduleId);
	const scheduleName = parseScheduleName(body?.scheduleName);
	const isActive = parseScheduleIsActive(body?.isActive);
	const theme = parseThemePayload(body?.theme);
	const themeJson = JSON.stringify(theme);

	const pool = await GetPool();
	const managerAccessResult = await pool
		.request()
		.input('userOid', user.id)
		.input('scheduleId', scheduleId)
		.query(
			`SELECT TOP (1) 1 AS HasManagerAccess
			 FROM dbo.ScheduleUsers su
			 INNER JOIN dbo.Roles r
				ON r.RoleId = su.RoleId
			 WHERE su.UserOid = @userOid
			   AND su.ScheduleId = @scheduleId
			   AND su.IsActive = 1
			   AND su.DeletedAt IS NULL
			   AND r.RoleName = 'Manager';`
		);

	if (!managerAccessResult.recordset?.[0]?.HasManagerAccess) {
		throw error(403, 'Only schedule managers can update schedule customization');
	}

	const updateResult = await pool
		.request()
		.input('scheduleId', scheduleId)
		.input('scheduleName', scheduleName)
		.input('isActive', isActive ? 1 : 0)
		.input('themeJson', themeJson)
		.input('updatedBy', user.id)
		.query(
			`UPDATE dbo.Schedules
			 SET Name = @scheduleName,
				 IsActive = @isActive,
				 ThemeJson = @themeJson,
				 UpdatedAt = SYSUTCDATETIME(),
				 UpdatedBy = @updatedBy
			 WHERE ScheduleId = @scheduleId
			   AND DeletedAt IS NULL;

			 SELECT @@ROWCOUNT AS UpdatedRows;`
		);

	const updatedRows = Number(updateResult.recordset?.[0]?.UpdatedRows ?? 0);
	if (updatedRows === 0) {
		throw error(404, 'Schedule not found');
	}

	return json({
		ok: true,
		scheduleId,
		scheduleName,
		isActive,
		theme
	});
};
