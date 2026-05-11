<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import AppShell from '$lib/components/AppShell.svelte';
	import { fetchWithAuthRedirect } from '$lib/utils/fetchWithAuthRedirect';

	type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';
	type OnboardingSlide = {
		id: string;
		role: ScheduleRole;
		roleTier: number;
		title: string;
		description: string;
		imageUrl: string | null;
	};
	type ThemePreference = 'system' | 'dark' | 'light';
	type ScheduleMembership = {
		ScheduleId: number;
		Name: string;
		RoleName: ScheduleRole;
		IsBootstrapOnly: boolean;
		IsDefault: boolean;
		IsActive: boolean;
		ThemeJson?: string | null;
		VersionAt?: string | null;
	};
	type LeaderboardEntry = {
		displayName: string;
		score: number;
		createdAt: string;
	};
	type GameDirection = 'up' | 'down' | 'left' | 'right';
	type BoardCell = {
		index: number;
		row: number;
		col: number;
		cx: number;
		cy: number;
		w: number;
		h: number;
		el: HTMLElement;
	};
	type SpawnedItem = {
		cell: number;
		expiresAt: number;
		kind: 'fire' | 'roller' | 'water' | 'shear';
	};
	type GameOverCause = 'collision' | 'cropped' | 'cooling';

	export let data: {
		schedule: { ScheduleId: number; Name: string } | null;
		userRole: ScheduleRole | null;
		scheduleMemberships: ScheduleMembership[];
		currentUserOid: string | null;
		collapsedGroupsBySchedule: Record<number, Record<string, boolean>>;
		themePreference: ThemePreference;
		onboarding: {
			currentTier: number;
			targetTier: number;
			slides: OnboardingSlide[];
		};
	};

	let scheduleName = 'Shift Schedule';
	let canMaintainTeam = false;
	let canAssignManagerRole = false;
	let canOpenScheduleSetup = false;
	let gameLaunched = false;
	let gameActive = false;
	let gameOverlayVisible = false;
	let leaderboardLoading = false;
	let leaderboardError = '';
	let leaderboardTop10: LeaderboardEntry[] = [];
	let personalBest = 0;
	let score = 0;
	let gameStatus = '';
	let snake: number[] = [];
	let snakeDirection: GameDirection | null = null;
	let pendingDirection: GameDirection | null = null;
	let goodItems: SpawnedItem[] = [];
	let badItems: SpawnedItem[] = [];
	let boardCells: BoardCell[] = [];
	let boardIndexByKey = new Map<string, number>();
	let gameTickTimer: ReturnType<typeof setTimeout> | null = null;
	let goodRespawnTimer: ReturnType<typeof setTimeout> | null = null;
	let badRespawnTimer: ReturnType<typeof setTimeout> | null = null;
	let boardRecalcScheduled = false;
	let boardObserver: ResizeObserver | null = null;
	let lastGameScore = 0;
	let awaitingFirstMove = false;
	let lastGameOverMessage = '';
	let runPeakLength = 0;
	let temperatureLevel = 5;
	let largestPlayableCellSize = 24;
	let lastPassiveHeatDecayAt = 0;

	$: scheduleName = data.schedule?.Name ?? 'Shift Schedule';
	$: canMaintainTeam = data.userRole === 'Maintainer' || data.userRole === 'Manager';
	$: canAssignManagerRole = data.userRole === 'Manager';
	$: canOpenScheduleSetup = canAssignManagerRole || data.scheduleMemberships.length > 1;
	$: score = snake.length;
	$: runPeakLength = Math.max(runPeakLength, snake.length);

	const GOOD_ITEM_TTL_MS = 11000;
	const BAD_ITEM_TTL_MS = 10000;
	const GOOD_RESPAWN_MS = 700;
	const BAD_RESPAWN_MS = 1200;
	const BASE_TICK_MS = 420;
	const MIN_TICK_MS = 120;
	const TICK_ACCEL_PER_POINT = 7;
	const MAX_TEMPERATURE = 5;
	const MIN_TEMPERATURE = 0;
	const MIN_PASSIVE_HEAT = 1;
	const PASSIVE_HEAT_DECAY_MS = 9000;

	function cellKey(row: number, col: number): string {
		return `${row}:${col}`;
	}

	function clearTimers() {
		if (gameTickTimer) {
			clearTimeout(gameTickTimer);
			gameTickTimer = null;
		}
		if (goodRespawnTimer) {
			clearTimeout(goodRespawnTimer);
			goodRespawnTimer = null;
		}
		if (badRespawnTimer) {
			clearTimeout(badRespawnTimer);
			badRespawnTimer = null;
		}
	}

	function updateBoardCellGeometry() {
		if (!browser || boardCells.length === 0) return;
		boardCells = boardCells.map((cell) => {
			const rect = cell.el.getBoundingClientRect();
			return {
				...cell,
				cx: rect.left + rect.width / 2,
				cy: rect.top + rect.height / 2,
				w: rect.width,
				h: rect.height
			};
		});
		largestPlayableCellSize = Math.max(
			10,
			...boardCells.map((cell) => Math.min(cell.w, cell.h))
		);
	}

	function scheduleBoardGeometryUpdate() {
		if (!browser || boardRecalcScheduled) return;
		boardRecalcScheduled = true;
		requestAnimationFrame(() => {
			boardRecalcScheduled = false;
			updateBoardCellGeometry();
		});
	}

	function setupBoardGeometryListeners() {
		if (!browser) return;
		window.addEventListener('resize', scheduleBoardGeometryUpdate);
		window.addEventListener('scroll', scheduleBoardGeometryUpdate, true);
		const gridWrap = document.querySelector('.gridwrap');
		if (typeof ResizeObserver !== 'undefined' && gridWrap instanceof HTMLElement) {
			boardObserver = new ResizeObserver(() => scheduleBoardGeometryUpdate());
			boardObserver.observe(gridWrap);
		}
	}

	function teardownBoardGeometryListeners() {
		if (!browser) return;
		window.removeEventListener('resize', scheduleBoardGeometryUpdate);
		window.removeEventListener('scroll', scheduleBoardGeometryUpdate, true);
		if (boardObserver) {
			boardObserver.disconnect();
			boardObserver = null;
		}
	}

	function buildPlayableBoard(): boolean {
		if (!browser) return false;
		const nodes = Array.from(
			document.querySelectorAll<HTMLElement>(
				'.grid .cell[data-day][data-scope="employee-day"], .grid .cell[data-day][data-scope="shift-day"]'
			)
		);
		if (nodes.length === 0) return false;
		const headerNodes = Array.from(
			document.querySelectorAll<HTMLElement>('.grid .dayhdr[data-day]')
		);
		if (headerNodes.length === 0) return false;
		const headerTop = Math.min(...headerNodes.map((el) => el.getBoundingClientRect().top));

		const sortedByTop = nodes
			.map((el) => ({ el, rect: el.getBoundingClientRect() }))
			.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

		const rowTops: number[] = [];
		for (const entry of sortedByTop) {
			const existing = rowTops.find((top) => Math.abs(top - entry.rect.top) < 4);
			if (existing === undefined) rowTops.push(entry.rect.top);
		}
		rowTops.sort((a, b) => a - b);
		const playableRows = rowTops.filter((top) => Math.abs(top - headerTop) >= 4);
		if (playableRows.length === 0) return false;
		const colLefts: number[] = [];
		for (const entry of sortedByTop) {
			if (!playableRows.some((top) => Math.abs(top - entry.rect.top) < 4)) continue;
			const existing = colLefts.find((left) => Math.abs(left - entry.rect.left) < 4);
			if (existing === undefined) colLefts.push(entry.rect.left);
		}
		colLefts.sort((a, b) => a - b);
		if (colLefts.length === 0) return false;

		const nextCells: BoardCell[] = [];
		for (const entry of sortedByTop) {
			const row = playableRows.findIndex((top) => Math.abs(top - entry.rect.top) < 4);
			if (row < 0) continue;
			const col = colLefts.findIndex((left) => Math.abs(left - entry.rect.left) < 4);
			if (col < 0) continue;
			nextCells.push({
				index: nextCells.length,
				row,
				col,
				cx: entry.rect.left + entry.rect.width / 2,
				cy: entry.rect.top + entry.rect.height / 2,
				w: entry.rect.width,
				h: entry.rect.height,
				el: entry.el
			});
		}

		if (nextCells.length === 0) return false;
		const indexMap = new Map<string, number>();
		for (const cell of nextCells) {
			indexMap.set(cellKey(cell.row, cell.col), cell.index);
		}
		boardCells = nextCells;
		boardIndexByKey = indexMap;
		largestPlayableCellSize = Math.max(
			10,
			...nextCells.map((cell) => Math.min(cell.w, cell.h))
		);
		return true;
	}

	function randomInt(maxExclusive: number): number {
		return Math.floor(Math.random() * maxExclusive);
	}

	function randomChoice<T>(values: T[]): T | null {
		if (values.length === 0) return null;
		return values[randomInt(values.length)] ?? null;
	}

	function slabColorForTemperature(level: number): string {
		const clamped = Math.max(MIN_TEMPERATURE, Math.min(MAX_TEMPERATURE, level));
		const legacyScaled = (clamped + 5) / 10;
		const ratio = Math.pow(legacyScaled, 1.75);
		const start = { r: 86, g: 90, b: 98 };
		const end = { r: 255, g: 112, b: 20 };
		const r = Math.round(start.r + (end.r - start.r) * ratio);
		const g = Math.round(start.g + (end.g - start.g) * ratio);
		const b = Math.round(start.b + (end.b - start.b) * ratio);
		return `rgb(${r}, ${g}, ${b})`;
	}

	function slabGlowForTemperature(level: number): string {
		const clamped = Math.max(MIN_TEMPERATURE, Math.min(MAX_TEMPERATURE, level));
		const legacyScaled = (clamped + 5) / 10;
		const ratio = Math.pow(legacyScaled, 2.1);
		const alpha = 0.08 + ratio * 0.72;
		return `rgba(255, 110, 24, ${alpha.toFixed(3)})`;
	}

	function slabConnectorStyle(fromIndex: number, toIndex: number): string | null {
		const from = boardCells[fromIndex];
		const to = boardCells[toIndex];
		if (!from || !to) return null;
		const dx = to.cx - from.cx;
		const dy = to.cy - from.cy;
		const distance = Math.hypot(dx, dy);
		if (!Number.isFinite(distance) || distance <= 0) return null;
		const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
		const segmentWidth = Math.max(12, largestPlayableCellSize * 0.62);
		const segmentHeight = Math.max(9, largestPlayableCellSize * 0.42);
		const movingVertically = Math.abs(dy) > Math.abs(dx);
		const thickness = movingVertically ? segmentWidth : segmentHeight;
		return `left:${from.cx}px;top:${from.cy}px;width:${distance}px;height:${thickness}px;transform:translateY(-50%) rotate(${angleDeg}deg);transform-origin:0 50%;--slab-color:${slabColorForTemperature(temperatureLevel)};--slab-glow:${slabGlowForTemperature(temperatureLevel)};`;
	}

	function currentTickMs(): number {
		return Math.max(MIN_TICK_MS, BASE_TICK_MS - Math.max(0, score - 1) * TICK_ACCEL_PER_POINT);
	}

	function isReverseDirection(a: GameDirection, b: GameDirection): boolean {
		return (
			(a === 'up' && b === 'down') ||
			(a === 'down' && b === 'up') ||
			(a === 'left' && b === 'right') ||
			(a === 'right' && b === 'left')
		);
	}

	function nextIndexFromDirection(currentIndex: number, direction: GameDirection): number | null {
		const current = boardCells[currentIndex];
		if (!current) return null;
		let nextRow = current.row;
		let nextCol = current.col;
		if (direction === 'up') nextRow -= 1;
		if (direction === 'down') nextRow += 1;
		if (direction === 'left') nextCol -= 1;
		if (direction === 'right') nextCol += 1;
		return boardIndexByKey.get(cellKey(nextRow, nextCol)) ?? null;
	}

	function safeNextDirections(): GameDirection[] {
		if (snake.length === 0) return [];
		const head = snake[0];
		if (head === undefined) return [];
		const candidates: GameDirection[] = ['up', 'down', 'left', 'right'];
		const occupied = new Set(snake);
		return candidates.filter((direction) => {
			const next = nextIndexFromDirection(head, direction);
			if (next === null) return false;
			return !occupied.has(next);
		});
	}

	function targetItemCounts(): { good: number; bad: number } {
		if (awaitingFirstMove) {
			return { good: 1, bad: 0 };
		}
		const freeCells = Math.max(0, boardCells.length - snake.length);
		if (freeCells <= 0) return { good: 0, bad: 0 };
		const good = Math.max(1, Math.min(8, Math.floor(freeCells / 18)));
		const bad = Math.max(1, Math.min(8, Math.floor(freeCells / 22)));
		return { good, bad };
	}

	function spawnSingleItem(kind: 'good' | 'bad'): SpawnedItem | null {
		if ((!gameActive && !awaitingFirstMove) || boardCells.length === 0) return null;
		const blocked = new Set<number>(snake);
		for (const item of goodItems) blocked.add(item.cell);
		for (const item of badItems) blocked.add(item.cell);
		const head = snake[0] ?? null;
		if (head !== null && snakeDirection) {
			const front = nextIndexFromDirection(head, snakeDirection);
			if (front !== null) blocked.add(front);
		}
		if (kind === 'bad') {
			const legalMoves = safeNextDirections();
			if (legalMoves.length <= 1) return null;
		}
		const available = boardCells.map((cell) => cell.index).filter((idx) => !blocked.has(idx));
		const picked = randomChoice(available);
		if (picked === null) return null;
		const itemKind =
			kind === 'good'
				? Math.random() < 0.5
					? 'fire'
					: 'roller'
				: Math.random() < 0.5
					? 'water'
					: 'shear';
		return {
			cell: picked,
			expiresAt: Date.now() + (kind === 'good' ? GOOD_ITEM_TTL_MS : BAD_ITEM_TTL_MS),
			kind: itemKind
		};
	}

	function fillItemsToTarget() {
		const target = targetItemCounts();
		while (goodItems.length < target.good) {
			const next = spawnSingleItem('good');
			if (!next) break;
			goodItems = [...goodItems, next];
		}
		while (badItems.length < target.bad) {
			const next = spawnSingleItem('bad');
			if (!next) break;
			badItems = [...badItems, next];
		}
		if (goodItems.length > target.good) {
			goodItems = goodItems.slice(0, target.good);
		}
		if (badItems.length > target.bad) {
			badItems = badItems.slice(0, target.bad);
		}
	}

	function maybeExpireItems() {
		const now = Date.now();
		const expiredGood = goodItems.some((item) => now >= item.expiresAt);
		const expiredBad = badItems.some((item) => now >= item.expiresAt);
		if (expiredGood) {
			goodItems = goodItems.filter((item) => now < item.expiresAt);
			if (goodRespawnTimer) clearTimeout(goodRespawnTimer);
			goodRespawnTimer = setTimeout(() => fillItemsToTarget(), GOOD_RESPAWN_MS);
		}
		if (expiredBad) {
			badItems = badItems.filter((item) => now < item.expiresAt);
			if (badRespawnTimer) clearTimeout(badRespawnTimer);
			badRespawnTimer = setTimeout(() => fillItemsToTarget(), BAD_RESPAWN_MS);
		}
		fillItemsToTarget();
	}

	function maybeApplyPassiveHeatDecay() {
		if (!gameActive || awaitingFirstMove) return;
		const now = Date.now();
		if (lastPassiveHeatDecayAt <= 0) {
			lastPassiveHeatDecayAt = now;
			return;
		}
		if (now - lastPassiveHeatDecayAt < PASSIVE_HEAT_DECAY_MS) return;
		const steps = Math.floor((now - lastPassiveHeatDecayAt) / PASSIVE_HEAT_DECAY_MS);
		if (steps <= 0) return;
		lastPassiveHeatDecayAt += steps * PASSIVE_HEAT_DECAY_MS;
		if (temperatureLevel > MIN_PASSIVE_HEAT) {
			temperatureLevel = Math.max(MIN_PASSIVE_HEAT, temperatureLevel - steps);
		}
	}

	function queueNextTick() {
		if (!gameActive) return;
		if (awaitingFirstMove) return;
		if (gameTickTimer) clearTimeout(gameTickTimer);
		gameTickTimer = setTimeout(() => {
			void runGameTick();
		}, currentTickMs());
	}

	function gameOverMessageForCause(cause: GameOverCause): string {
		if (cause === 'collision') return 'Cobble In The Mill!';
		if (cause === 'cooling') return 'Improper Cooling Strategy';
		return 'Cropped Too Many Times';
	}

	async function finishGameOver(cause: GameOverCause, statusMessage: string) {
		lastGameScore = runPeakLength;
		gameStatus = statusMessage;
		lastGameOverMessage = gameOverMessageForCause(cause);
		await handleGameOver(lastGameScore);
	}

	async function runGameTick() {
		if (!gameActive) return;
		maybeApplyPassiveHeatDecay();
		maybeExpireItems();
		if (awaitingFirstMove) return;
		if (pendingDirection) {
			if (!snakeDirection || !isReverseDirection(pendingDirection, snakeDirection)) {
				snakeDirection = pendingDirection;
			}
			pendingDirection = null;
		}
		if (!snakeDirection) {
			queueNextTick();
			return;
		}
		const head = snake[0];
		if (head === undefined) {
			queueNextTick();
			return;
		}
		const next = nextIndexFromDirection(head, snakeDirection);
		if (next === null) {
			await finishGameOver('collision', 'Crashed into a wall.');
			return;
		}
		const body = new Set(snake);
		if (body.has(next)) {
			await finishGameOver('collision', 'Caught your own tail.');
			return;
		}

		const hitGoodItem = goodItems.find((item) => item.cell === next) ?? null;
		const hitBadItem = badItems.find((item) => item.cell === next) ?? null;
		const hitGood = Boolean(hitGoodItem);
		const hitBad = Boolean(hitBadItem);
		const hitFire = hitGoodItem?.kind === 'fire';
		const hitRoller = hitGoodItem?.kind === 'roller';
		const hitWater = hitBadItem?.kind === 'water';
		const hitShear = hitBadItem?.kind === 'shear';
		if (hitShear && snake.length === 1) {
			await finishGameOver('cropped', 'Hazard impact at minimum length.');
			return;
		}

		const nextSnake = [next, ...snake];
		if (!hitRoller) {
			nextSnake.pop();
		}
		if (hitShear) {
			nextSnake.pop();
		}
		snake = nextSnake;

		if (hitGood) {
			goodItems = goodItems.filter((item) => item.cell !== next);
			if (hitFire) {
				temperatureLevel = Math.min(MAX_TEMPERATURE, temperatureLevel + 1);
			}
		}
		if (hitBad) {
			badItems = badItems.filter((item) => item.cell !== next);
			if (hitWater) {
				if (temperatureLevel <= MIN_PASSIVE_HEAT) {
					await finishGameOver('cooling', 'Steel temperature dropped too low.');
					return;
				}
				temperatureLevel = Math.max(MIN_TEMPERATURE, temperatureLevel - 1);
			}
		}

		maybeExpireItems();
		queueNextTick();
	}

	function initializeGameState() {
		const start = randomChoice(boardCells.map((cell) => cell.index));
		if (start === null) return false;
		snake = [start];
		snakeDirection = null;
		pendingDirection = null;
		awaitingFirstMove = true;
		goodItems = [];
		badItems = [];
		temperatureLevel = MAX_TEMPERATURE;
		lastPassiveHeatDecayAt = Date.now();
		lastGameScore = 0;
		runPeakLength = 1;
		gameStatus = 'Press an arrow key to start.';
		const starterGood = spawnSingleItem('good');
		if (starterGood) {
			goodItems = [starterGood];
		}
		return true;
	}

	async function refreshLeaderboard() {
		leaderboardLoading = true;
		leaderboardError = '';
		try {
			const response = await fetchWithAuthRedirect(
				`${base}/api/minigame/leaderboard`,
				{ headers: { accept: 'application/json' } },
				base
			);
			if (!response) return;
			if (!response.ok) throw new Error(`Unable to load leaderboard (${response.status})`);
			const payload = (await response.json()) as {
				top10?: LeaderboardEntry[];
				personalBest?: number;
			};
			leaderboardTop10 = Array.isArray(payload.top10) ? payload.top10.slice(0, 10) : [];
			personalBest = typeof payload.personalBest === 'number' ? payload.personalBest : 0;
		} catch {
			leaderboardError = 'Unable to load leaderboard right now.';
		} finally {
			leaderboardLoading = false;
		}
	}

	async function launchGame() {
		const playable = buildPlayableBoard();
		if (!playable) return;
		gameLaunched = true;
		gameActive = false;
		gameOverlayVisible = true;
		gameStatus = '';
		clearTimers();
		await refreshLeaderboard();
	}

	function startGame() {
		const playable = buildPlayableBoard();
		if (!playable) return;
		const initialized = initializeGameState();
		if (!initialized) return;
		gameActive = true;
		gameOverlayVisible = false;
		queueNextTick();
		setupBoardGeometryListeners();
		scheduleBoardGeometryUpdate();
	}

	async function submitScore(score: number) {
		const response = await fetchWithAuthRedirect(
			`${base}/api/minigame/leaderboard`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ score })
			},
			base
		);
		if (!response || !response.ok) {
			throw new Error('Unable to submit score');
		}
		const payload = (await response.json()) as { top10?: LeaderboardEntry[]; personalBest?: number };
		leaderboardTop10 = Array.isArray(payload.top10) ? payload.top10.slice(0, 10) : [];
		personalBest = typeof payload.personalBest === 'number' ? payload.personalBest : personalBest;
	}

	async function handleGameOver(score: number) {
		gameActive = false;
		gameOverlayVisible = true;
		clearTimers();
		teardownBoardGeometryListeners();
		try {
			await submitScore(score);
			leaderboardError = '';
		} catch {
			leaderboardError = 'Game ended, but score sync failed.';
		}
	}

	function exitGame() {
		gameLaunched = false;
		gameActive = false;
		gameOverlayVisible = false;
		leaderboardError = '';
		gameStatus = '';
		lastGameOverMessage = '';
		runPeakLength = 0;
		lastPassiveHeatDecayAt = 0;
		snake = [];
		snakeDirection = null;
		pendingDirection = null;
		awaitingFirstMove = false;
		goodItems = [];
		badItems = [];
		clearTimers();
		teardownBoardGeometryListeners();
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!gameLaunched) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			exitGame();
			return;
		}
		if (!gameActive) return;
		let nextDirection: GameDirection | null = null;
		if (event.key === 'ArrowUp') nextDirection = 'up';
		if (event.key === 'ArrowDown') nextDirection = 'down';
		if (event.key === 'ArrowLeft') nextDirection = 'left';
		if (event.key === 'ArrowRight') nextDirection = 'right';
		if (!nextDirection) return;
		event.preventDefault();
		event.stopPropagation();
		const baseline = pendingDirection ?? snakeDirection;
		if (baseline && isReverseDirection(nextDirection, baseline)) return;
		pendingDirection = nextDirection;
		if (awaitingFirstMove) {
			awaitingFirstMove = false;
			lastPassiveHeatDecayAt = Date.now();
			gameStatus = 'Steel line in motion.';
			fillItemsToTarget();
			queueNextTick();
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleWindowKeydown, true);
	});

	onDestroy(() => {
		clearTimers();
		teardownBoardGeometryListeners();
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', handleWindowKeydown, true);
		}
	});
</script>

<div class="schedulePage">
	<AppShell
		{scheduleName}
		activeScheduleId={data.schedule?.ScheduleId ?? null}
		scheduleMemberships={data.scheduleMemberships}
		groups={[]}
		overrides={{}}
		showLegend={false}
		{canMaintainTeam}
		{canAssignManagerRole}
		{canOpenScheduleSetup}
		currentUserOid={data.currentUserOid ?? ''}
		collapsedGroupsBySchedule={data.collapsedGroupsBySchedule}
		themePreference={data.themePreference}
		onboarding={data.onboarding}
	/>

	<button
		type="button"
		class="minigameLaunchButton"
		on:click={() => void launchGame()}
		aria-label="Launch schedule minigame"
		title="Launch schedule minigame"
	></button>

	{#if gameLaunched && gameOverlayVisible}
		<div class="minigameOverlay" aria-hidden="false">
			<div class="minigameBackdropGlow" aria-hidden="true"></div>
			<div class="minigameSplash" role="dialog" aria-modal="true" aria-label="Schedule Minigame" tabindex="-1">
				<header class="minigameHero">
					<h2>Mill Operator Showdown</h2>
					{#if lastGameOverMessage}
						<p class="minigameGameOverMessage">{lastGameOverMessage}</p>
					{/if}
					<div class="minigameBestBadge">
						<span>Personal Best</span>
						<strong>{personalBest}</strong>
					</div>
				</header>

				<div class="minigameSplashBody">
					<section class="minigamePanel minigamePanelInstructions" aria-label="How to play">
						<h3>Mission Brief</h3>
						<ul>
							<li>The slab can only travel on schedule cells.</li>
							<li>Fire and rollers are beneficial. Water and shears are hazardous.</li>
							<li>Keep the steel hot. Water cools it; fire reheats it.</li>
							<li>Press <strong>Esc</strong> any time to exit minigame mode.</li>
							<li>Compete to see who the best mill operator is.</li>
							<li>Press <strong>Start Game</strong> to test your <strong>metal</strong>.</li>
						</ul>
					</section>

					<section class="minigamePanel minigamePanelLeaderboard" aria-label="Top 10 leaderboard">
						<h3>Leaderboard Top 10</h3>
						{#if leaderboardLoading}
							<p class="minigameStatus">Syncing leaderboard...</p>
						{:else if leaderboardError}
							<p class="minigameError">{leaderboardError}</p>
						{:else if leaderboardTop10.length === 0}
							<p class="minigameStatus">No scores yet. Be the first on the board.</p>
						{:else}
							<ol class="minigameLeaderboardList">
								{#each leaderboardTop10 as entry, index}
									<li class="minigameLeaderboardRow">
										<span class="minigameLeaderboardRank">#{index + 1}</span>
										<span class="minigameLeaderboardName">{entry.displayName}</span>
										<span class="minigameLeaderboardScore">{entry.score}</span>
									</li>
								{/each}
							</ol>
						{/if}
					</section>
				</div>

				<div class="minigameActions">
					<button type="button" class="btn primary minigameStartButton" on:click={startGame}
						>{lastGameOverMessage ? 'Try Again' : 'Start Game'}</button
					>
					<button type="button" class="btn minigameCloseButton" on:click={exitGame}>Exit Minigame</button>
				</div>
			</div>
		</div>
	{/if}

	{#if gameLaunched && gameActive}
		<div class="minigameInputCapture" role="presentation" aria-hidden="true">
			<div class="minigameBoardOverlay" aria-hidden="true">
				{#each goodItems as item (item.cell)}
					{#if boardCells[item.cell]}
						<div
							class={`minigameItem ${item.kind === 'fire' ? 'minigameItemFire' : 'minigameItemRoller'}`}
							style={`left:${boardCells[item.cell].cx}px;top:${boardCells[item.cell].cy}px;width:${Math.max(10, largestPlayableCellSize * 0.35)}px;height:${Math.max(10, largestPlayableCellSize * 0.35)}px;`}
						></div>
					{/if}
				{/each}
				{#each badItems as item (item.cell)}
					{#if boardCells[item.cell]}
						<div
							class={`minigameItem ${item.kind === 'water' ? 'minigameItemWater' : 'minigameItemShear'}`}
							style={`left:${boardCells[item.cell].cx}px;top:${boardCells[item.cell].cy}px;width:${Math.max(10, largestPlayableCellSize * 0.35)}px;height:${Math.max(10, largestPlayableCellSize * 0.35)}px;`}
						></div>
					{/if}
				{/each}
				{#each snake as segment, idx}
					{#if boardCells[segment]}
							<div
								class={`minigameSnakeSegment${idx === 0 ? ' head' : ''}`}
								style={`left:${boardCells[segment].cx}px;top:${boardCells[segment].cy}px;width:${Math.max(12, largestPlayableCellSize * 0.62)}px;height:${Math.max(9, largestPlayableCellSize * 0.42)}px;--slab-color:${slabColorForTemperature(temperatureLevel)};--slab-glow:${slabGlowForTemperature(temperatureLevel)};`}
							></div>
					{/if}
					{#if idx < snake.length - 1}
						{@const connectorStyle = slabConnectorStyle(segment, snake[idx + 1])}
						{#if connectorStyle}
							<div class="minigameSnakeConnector" style={connectorStyle}></div>
						{/if}
					{/if}
				{/each}
			</div>
			{#if awaitingFirstMove}
				<div class="minigameStartPrompt" role="status" aria-live="polite">
					Press an arrow key to start the mill line
				</div>
			{/if}
			<div class="minigameHud">
				<span class="minigameHudScore">Score: {runPeakLength} • Heat: {temperatureLevel}/5</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.schedulePage {
		position: relative;
	}

	.minigameLaunchButton {
		position: fixed;
		right: 8px;
		bottom: 8px;
		width: 22px;
		height: 22px;
		border: 0;
		background: transparent;
		opacity: 0;
		z-index: 8;
		cursor: default;
	}

	.minigameOverlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background:
			radial-gradient(circle at 15% 20%, var(--accent-2) 0%, transparent 38%),
			radial-gradient(circle at 85% 25%, var(--accent-3) 0%, transparent 36%),
			var(--modal-backdrop);
	}

	.minigameBackdropGlow {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			linear-gradient(135deg, transparent 0%, var(--accent-2) 50%, transparent 100%),
			linear-gradient(300deg, transparent 0%, var(--accent-3) 48%, transparent 100%);
		opacity: 0.55;
	}

	.minigameSplash {
		position: relative;
		z-index: 1;
		width: min(1040px, 96vw);
		max-height: min(90vh, 880px);
		display: grid;
		grid-template-rows: auto 1fr auto;
		gap: 18px;
		padding: 22px;
		border-radius: 16px;
		border: 1px solid var(--border-accent-medium);
		box-shadow:
			0 28px 70px rgba(0, 0, 0, 0.42),
			inset 0 0 0 1px var(--grid-2);
		background:
			linear-gradient(160deg, var(--gradient-modal-start), var(--gradient-modal-end)),
			var(--surface-1);
		color: var(--text);
		overflow: hidden;
	}

	.minigameHero {
		display: grid;
		gap: 8px;
		padding: 14px 14px 16px;
		border-radius: 12px;
		border: 1px solid var(--border-accent-soft);
		background:
			linear-gradient(130deg, var(--gradient-primary-start), var(--gradient-primary-end)),
			var(--surface-0);
		box-shadow: inset 0 0 0 1px var(--grid-2);
		justify-items: center;
		text-align: center;
	}

	.minigameKicker {
		margin: 0;
		font-size: 11px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--faint);
	}

	.minigameHero h2 {
		margin: 0;
		font-size: clamp(1.6rem, 2.7vw, 2.2rem);
		line-height: 1.05;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.minigameSubtitle {
		margin: 0;
		color: var(--muted);
		font-size: 0.95rem;
	}

	.minigameGameOverMessage {
		margin: 2px 0 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.minigameBestBadge {
		justify-self: center;
		display: inline-flex;
		align-items: baseline;
		gap: 10px;
		padding: 8px 12px;
		border-radius: 999px;
		border: 1px solid var(--border-accent-medium);
		background: var(--surface-0);
	}

	.minigameBestBadge span {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--faint);
	}

	.minigameBestBadge strong {
		font-size: 1.05rem;
		color: var(--text);
	}

	.minigameSplashBody {
		display: grid;
		grid-template-columns: 1fr 1.2fr;
		gap: 14px;
		overflow: auto;
		padding-right: 2px;
	}

	.minigamePanel {
		border: 1px solid var(--border-accent-soft);
		border-radius: 12px;
		padding: 14px;
		background: var(--panel-bg);
		box-shadow: inset 0 0 0 1px var(--grid-2);
	}

	.minigamePanel h3 {
		margin: 0 0 10px;
		font-size: 0.95rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
		text-align: center;
	}

	.minigamePanelInstructions ul {
		margin: 0 auto;
		padding-left: 18px;
		display: grid;
		gap: 8px;
		color: var(--text);
		max-width: 42ch;
	}

	.minigameStatus {
		margin: 0;
		color: var(--muted);
		text-align: center;
	}

	.minigameLeaderboardList {
		list-style: none;
		margin: 0 auto;
		padding: 0;
		display: grid;
		gap: 7px;
		width: min(100%, 560px);
	}

	.minigameLeaderboardRow {
		display: grid;
		grid-template-columns: 56px 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 10px;
		background: var(--surface-0);
		border: 1px solid var(--grid-1);
	}

	.minigameLeaderboardRank {
		color: var(--muted);
		font-weight: 700;
	}

	.minigameLeaderboardName {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.minigameLeaderboardScore {
		font-weight: 700;
		color: var(--accent);
	}

	.minigameError {
		margin: 0;
		color: var(--accent);
		text-align: center;
	}

	.minigameActions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		justify-content: center;
	}

	.minigameInputCapture {
		position: fixed;
		inset: 0;
		z-index: 900;
		background: transparent;
		pointer-events: auto;
	}

	.minigameBoardOverlay {
		position: fixed;
		inset: 0;
		pointer-events: none;
	}

	.minigameItem,
	.minigameSnakeSegment {
		position: fixed;
		transform: translate(-50%, -50%);
		border-radius: 3px;
		pointer-events: none;
	}

	.minigameSnakeConnector {
		position: fixed;
		border-radius: 3px;
		background: var(--slab-color);
		border: 0;
		box-shadow: 0 0 15px var(--slab-glow);
		pointer-events: none;
		z-index: 912;
		transition:
			background-color 140ms linear,
			box-shadow 140ms linear;
	}

	.minigameSnakeSegment {
		background: var(--slab-color);
		border: 0;
		box-shadow: 0 0 15px var(--slab-glow);
		z-index: 912;
		transition:
			background-color 140ms linear,
			box-shadow 140ms linear;
	}

	.minigameSnakeSegment.head {
		box-shadow: 0 0 24px var(--slab-glow);
	}

	.minigameItemFire {
		background: linear-gradient(180deg, #ffcf73 0%, #ff8f21 52%, #c82300 100%);
		clip-path: polygon(50% 0%, 68% 20%, 80% 42%, 74% 66%, 56% 88%, 50% 100%, 44% 88%, 26% 66%, 20% 42%, 32% 20%);
		border-radius: 0;
		transform: translate(-50%, -50%) rotate(180deg);
		box-shadow: 0 0 16px rgba(255, 107, 29, 0.62);
		z-index: 911;
	}

	.minigameItemFire::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 56%;
		width: 44%;
		height: 50%;
		background: linear-gradient(180deg, #fff0bc 0%, #ffd36b 62%, #ff9818 100%);
		clip-path: polygon(50% 0%, 70% 25%, 76% 52%, 50% 100%, 24% 52%, 30% 25%);
		transform: translate(-50%, -50%);
	}

	.minigameItemFire::before {
		content: '';
		position: absolute;
		left: 50%;
		bottom: 4%;
		width: 64%;
		height: 20%;
		background: rgba(255, 129, 42, 0.5);
		border-radius: 999px;
		transform: translateX(-50%);
	}

	.minigameItemRoller {
		background: transparent;
		border-radius: 0;
		box-shadow: none;
		z-index: 911;
	}

	.minigameItemRoller::before,
	.minigameItemRoller::after {
		content: '';
		position: absolute;
		left: 50%;
		width: 62%;
		height: 62%;
		border-radius: 999px;
		border: 1px solid rgba(0, 0, 0, 0.35);
		background:
			conic-gradient(
				from 0deg,
				#e6ebf2 0deg 90deg,
				#6f7b89 90deg 180deg,
				#e6ebf2 180deg 270deg,
				#6f7b89 270deg 360deg
			);
		box-shadow:
			inset 0 0 0 1px rgba(255, 255, 255, 0.25),
			0 0 10px rgba(210, 216, 223, 0.45);
		transform: translateX(-50%);
	}

	.minigameItemRoller::before {
		top: -25%;
		animation: rollerSpinClockwise 650ms linear infinite;
	}

	.minigameItemRoller::after {
		bottom: -25%;
		animation: rollerSpinCounterClockwise 650ms linear infinite;
	}

	@keyframes rollerSpinClockwise {
		from {
			transform: translateX(-50%) rotate(0deg);
		}
		to {
			transform: translateX(-50%) rotate(360deg);
		}
	}

	@keyframes rollerSpinCounterClockwise {
		from {
			transform: translateX(-50%) rotate(0deg);
		}
		to {
			transform: translateX(-50%) rotate(-360deg);
		}
	}

	.minigameItemWater {
		background: linear-gradient(180deg, #a8e7ff 0%, #4ea9ff 48%, #1f6fda 100%);
		clip-path: polygon(50% 0%, 74% 30%, 88% 52%, 86% 72%, 74% 87%, 50% 100%, 26% 87%, 14% 72%, 12% 52%, 26% 30%);
		border-radius: 0;
		box-shadow: 0 0 14px rgba(63, 157, 255, 0.55);
		z-index: 911;
	}

	.minigameItemWater::after {
		content: '';
		position: absolute;
		left: 38%;
		top: 30%;
		width: 26%;
		height: 26%;
		border-radius: 999px 999px 999px 999px;
		background: rgba(255, 255, 255, 0.75);
		transform: rotate(-14deg);
	}

	.minigameItemWater::before {
		content: '';
		position: absolute;
		left: 52%;
		top: 52%;
		width: 38%;
		height: 30%;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.2);
		transform: translate(-50%, -50%);
	}

	.minigameItemShear {
		background: transparent;
		border-radius: 0;
		box-shadow: none;
		overflow: hidden;
		z-index: 911;
	}

	.minigameItemShear::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 18%;
		width: 74%;
		height: 56%;
		transform: translateX(-50%);
		background: linear-gradient(140deg, #f1f5fb 0%, #a8b2c0 42%, #727d8b 100%);
		clip-path: polygon(18% 0, 100% 0, 82% 100%, 0 100%);
		box-shadow:
			0 0 0 1px rgba(26, 33, 44, 0.52),
			0 0 12px rgba(196, 205, 218, 0.34);
		animation: guillotineCut 860ms ease-in-out infinite;
	}

	.minigameItemShear::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 24%;
		width: 30%;
		height: 40%;
		transform: translateX(-50%) skewX(-18deg);
		background: linear-gradient(
			180deg,
			rgba(255, 255, 255, 0.82) 0%,
			rgba(255, 255, 255, 0.26) 52%,
			rgba(255, 255, 255, 0) 100%
		);
		mix-blend-mode: screen;
		pointer-events: none;
		animation: guillotineSheenCut 860ms ease-in-out infinite;
	}

	@keyframes guillotineCut {
		0%,
		100% {
			transform: translateX(-50%) translateY(-24%);
		}
		38% {
			transform: translateX(-50%) translateY(42%);
		}
		56% {
			transform: translateX(-50%) translateY(42%);
		}
		78% {
			transform: translateX(-50%) translateY(-10%);
		}
	}

	@keyframes guillotineSheenCut {
		0%,
		100% {
			transform: translateX(-50%) translateY(-24%) skewX(-18deg);
		}
		38% {
			transform: translateX(-50%) translateY(42%) skewX(-18deg);
		}
		56% {
			transform: translateX(-50%) translateY(42%) skewX(-18deg);
		}
		78% {
			transform: translateX(-50%) translateY(-10%) skewX(-18deg);
		}
	}

	.minigameHud {
		position: fixed;
		top: 10px;
		right: 10px;
		z-index: 901;
		display: inline-flex;
		align-items: baseline;
		padding: 8px 10px;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		font-size: 13px;
	}

	.minigameHudScore {
		font-weight: 700;
		color: #fff;
	}

	.minigameStartPrompt {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		z-index: 901;
		padding: 12px 18px;
		border-radius: 999px;
		border: 1px solid var(--border-accent-medium);
		background: color-mix(in srgb, var(--surface-0) 80%, transparent);
		color: var(--text);
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		box-shadow:
			0 10px 26px rgba(0, 0, 0, 0.3),
			inset 0 0 0 1px var(--grid-2);
		pointer-events: none;
	}

	.btn {
		border: 1px solid rgba(255, 255, 255, 0.35);
		background: rgba(255, 255, 255, 0.08);
		color: inherit;
		border-radius: 6px;
		padding: 8px 12px;
		cursor: pointer;
		font-weight: 600;
	}

	.btn.primary {
		border-color: var(--border-accent-focus);
		background: var(--accent-2);
	}

	.minigameStartButton {
		min-width: 130px;
	}

	.minigameCloseButton {
		background: var(--interactive-bg);
		border-color: var(--interactive-border);
	}

	@media (max-width: 900px) {
		.minigameSplashBody {
			grid-template-columns: 1fr;
		}
		.minigameSplash {
			padding: 16px;
			gap: 14px;
		}
		.minigameHero h2 {
			font-size: clamp(1.35rem, 8vw, 1.8rem);
		}
	}
</style>
