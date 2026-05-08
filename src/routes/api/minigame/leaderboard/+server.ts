import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Cookies } from '@sveltejs/kit';
import { GetPool } from '$lib/server/db';
import { getActiveScheduleId } from '$lib/server/auth';
import { requireScheduleRole } from '$lib/server/schedule-access';

type LeaderboardRow = {
	displayName: string;
	score: number;
	createdAt: string;
};

function toNonNegativeScore(raw: unknown): number {
	const numeric = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(numeric)) {
		throw error(400, 'Score must be a number');
	}
	const rounded = Math.max(0, Math.floor(numeric));
	return Math.min(rounded, 2147483647);
}

async function getActorContext(localsUserOid: string, cookies: Cookies) {
	const scheduleId = await getActiveScheduleId(cookies);
	if (!scheduleId) {
		throw error(400, 'No active schedule selected');
	}
	const pool = await GetPool();
	await requireScheduleRole({
		userOid: localsUserOid,
		scheduleId,
		minRole: 'Member',
		pool,
		errorMessage: 'Insufficient permissions'
	});
	return { pool };
}

async function ensureMinigameTables() {
	const pool = await GetPool();
	await pool.request().query(`
		IF COL_LENGTH('dbo.Users', 'MinigamePersonalBest') IS NULL
		BEGIN
			ALTER TABLE dbo.Users
			ADD MinigamePersonalBest int NOT NULL
				CONSTRAINT DF_Users_MinigamePersonalBest DEFAULT 0;
		END
		IF OBJECT_ID('dbo.CK_Users_MinigamePersonalBest_NonNegative', 'C') IS NULL
		BEGIN
			ALTER TABLE dbo.Users
			ADD CONSTRAINT CK_Users_MinigamePersonalBest_NonNegative
			CHECK (MinigamePersonalBest >= 0);
		END
		IF OBJECT_ID('dbo.MinigameLeaderboard', 'U') IS NULL
		BEGIN
			CREATE TABLE dbo.MinigameLeaderboard (
				LeaderboardEntryId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
				DisplayName nvarchar(200) NOT NULL,
				Score int NOT NULL,
				IsActive bit NOT NULL CONSTRAINT DF_MinigameLeaderboard_IsActive DEFAULT 1,
				CreatedAt datetime2 NOT NULL CONSTRAINT DF_MinigameLeaderboard_CreatedAt DEFAULT sysutcdatetime(),
				CreatedBy nvarchar(64) NULL,
				DeletedAt datetime2 NULL,
				DeletedBy nvarchar(64) NULL,
				CONSTRAINT CK_MinigameLeaderboard_Score_NonNegative CHECK (Score >= 0)
			);
		END
	`);
}

async function loadTop10AndPersonalBest(userOid: string): Promise<{
	top10: LeaderboardRow[];
	personalBest: number;
}> {
	const pool = await GetPool();
	const [top10Result, personalBestResult] = await Promise.all([
		pool.request().query(`
			SELECT TOP (10)
				DisplayName,
				Score,
				CreatedAt
			FROM dbo.MinigameLeaderboard
			WHERE IsActive = 1
			  AND DeletedAt IS NULL
			ORDER BY Score DESC, CreatedAt ASC;
		`),
		pool
			.request()
			.input('userOid', userOid)
			.query(`
				SELECT TOP (1) MinigamePersonalBest
				FROM dbo.Users
				WHERE UserOid = @userOid
				  AND DeletedAt IS NULL;
			`)
	]);

	return {
		top10: (top10Result.recordset ?? []).map((row) => ({
			displayName: String(row.DisplayName ?? '').trim() || 'Unknown Player',
			score: Number(row.Score ?? 0),
			createdAt: new Date(row.CreatedAt ?? Date.now()).toISOString()
		})),
		personalBest: Number(personalBestResult.recordset?.[0]?.MinigamePersonalBest ?? 0)
	};
}

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const currentUser = locals.user;
	if (!currentUser) throw error(401, 'Unauthorized');

	await ensureMinigameTables();
	await getActorContext(currentUser.id, cookies);
	const payload = await loadTop10AndPersonalBest(currentUser.id);
	return json(payload);
};

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
	const currentUser = locals.user;
	if (!currentUser) throw error(401, 'Unauthorized');

	await ensureMinigameTables();
	const { pool } = await getActorContext(currentUser.id, cookies);

	const body = await request.json().catch(() => null);
	const score = toNonNegativeScore(body?.score);

	await pool
		.request()
		.input('userOid', currentUser.id)
		.input('score', score)
		.query(`
			DECLARE @displayName nvarchar(200) = (
				SELECT TOP (1)
					NULLIF(LTRIM(RTRIM(COALESCE(
						u.DisplayName,
						u.FullName,
						CONCAT(NULLIF(LTRIM(RTRIM(u.EntraFirstName)), ''), ' ', NULLIF(LTRIM(RTRIM(u.EntraLastName)), '')),
						u.Email,
						u.UserOid
					))), '')
				FROM dbo.Users u
				WHERE u.UserOid = @userOid
			);

			IF @displayName IS NULL
			BEGIN
				SET @displayName = N'Unknown Player';
			END

			INSERT INTO dbo.MinigameLeaderboard (DisplayName, Score, CreatedBy)
			VALUES (@displayName, @score, @userOid);

			UPDATE dbo.Users
			   SET MinigamePersonalBest = CASE
					WHEN MinigamePersonalBest < @score THEN @score
					ELSE MinigamePersonalBest
				   END,
				   UpdatedAt = SYSUTCDATETIME()
			 WHERE UserOid = @userOid
			   AND DeletedAt IS NULL;
		`);

	const payload = await loadTop10AndPersonalBest(currentUser.id);
	return json(payload);
};
