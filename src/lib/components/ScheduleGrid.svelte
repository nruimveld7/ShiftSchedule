<script lang="ts">
	import { afterUpdate, onDestroy, onMount } from 'svelte';
	import { dowShort } from '$lib/utils/date';
	import type { MonthDay } from '$lib/utils/date';
	import GroupRow from '$lib/components/GroupRow.svelte';
	import EmployeeRow from '$lib/components/EmployeeRow.svelte';
	import type { Group, Status } from '$lib/data/demoData';

	export let groups: Group[] = [];
	export let overrides: Record<string, { day: number; status: Status }[]> = {};
	export let collapsed: Record<string, boolean> = {};
	export let monthDays: MonthDay[] = [];
	export let theme: 'light' | 'dark' = 'dark';
	export let onToggleGroup: (groupName: string) => void = () => {};
	export let canMaintainTeam = false;
	export let onTeamClick: () => void = () => {};

	let gridEl: HTMLDivElement | null = null;
	let bandEl: HTMLDivElement | null = null;
	let gridWrapEl: HTMLDivElement | null = null;
	let horizontalRailEl: HTMLDivElement | null = null;
	let resizeQueued = false;
	let mounted = false;
	let showHorizontalScrollbar = false;
	let horizontalThumbWidthPx = 0;
	let horizontalThumbLeftPx = 0;
	let isDraggingHorizontalScrollbar = false;
	let dragStartX = 0;
	let dragStartHorizontalThumbLeftPx = 0;

	$: days = monthDays;
	$: dim = monthDays.length;
	$: gridStyle = `grid-template-columns: clamp(220px, 20vw, 360px) repeat(${dim}, minmax(34px, 1fr)); min-width: ${Math.max(260 + dim * 40, 1100)}px;`;
	$: activeTodayDay = monthDays.find((item) => item.isToday)?.day ?? null;

	function dayHeaderClass(day: MonthDay) {
		let cls = `cell hdr dayhdr${day.isWeekend ? ' wknd' : ''}`;
		if (day.isToday) cls += ' todayhdr';
		return cls;
	}

	function dayAriaLabel(day: MonthDay) {
		return `Day ${day.day} ${dowShort[day.dow]}`;
	}

	function dayDowShort(day: MonthDay) {
		return dowShort[day.dow];
	}

	function activateTeamCell() {
		if (!canMaintainTeam) return;
		onTeamClick();
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function measureBand() {
		if (!gridEl || !bandEl || !activeTodayDay) return;
		const headerCell = gridEl.querySelector(
			`.dayhdr[data-day='${activeTodayDay}']`
		) as HTMLDivElement | null;
		if (!headerCell) return;
		bandEl.style.left = `${headerCell.offsetLeft}px`;
		bandEl.style.width = `${headerCell.offsetWidth}px`;
	}

	function queueMeasure() {
		if (!activeTodayDay) return;
		if (resizeQueued) return;
		resizeQueued = true;
		requestAnimationFrame(() => {
			resizeQueued = false;
			measureBand();
		});
	}

	function updateCustomScrollbar() {
		if (!gridWrapEl) return;

		const scrollWidth = gridWrapEl.scrollWidth;
		const clientWidth = gridWrapEl.clientWidth;
		const scrollLeft = gridWrapEl.scrollLeft;
		const hasHorizontalOverflow = scrollWidth > clientWidth + 1;

		showHorizontalScrollbar = hasHorizontalOverflow;
		if (!hasHorizontalOverflow) {
			horizontalThumbWidthPx = 0;
			horizontalThumbLeftPx = 0;
			return;
		}

		const horizontalRailWidth = horizontalRailEl?.clientWidth ?? Math.max(clientWidth - 24, 0);
		if (horizontalRailWidth <= 0) return;

		const minThumbWidth = 48;
		const nextThumbWidth = Math.max(
			minThumbWidth,
			(horizontalRailWidth * clientWidth) / scrollWidth
		);
		const maxThumbLeft = Math.max(horizontalRailWidth - nextThumbWidth, 0);
		const maxScrollLeft = Math.max(scrollWidth - clientWidth, 1);
		const nextThumbLeft = (scrollLeft / maxScrollLeft) * maxThumbLeft;

		horizontalThumbWidthPx = nextThumbWidth;
		horizontalThumbLeftPx = clamp(nextThumbLeft, 0, maxThumbLeft);
	}

	function onGridScroll() {
		if (!isDraggingHorizontalScrollbar) {
			updateCustomScrollbar();
		}
	}

	function setGlobalScrollbarDragging(active: boolean) {
		if (typeof document === 'undefined') return;
		const body = document.body;
		const current = Number(body.dataset.scrollbarDragCount ?? '0');
		const next = Math.max(0, current + (active ? 1 : -1));
		if (next === 0) {
			delete body.dataset.scrollbarDragCount;
		} else {
			body.dataset.scrollbarDragCount = String(next);
		}
		body.classList.toggle('scrollbar-dragging', next > 0);
	}

	function onHorizontalDragMove(event: MouseEvent) {
		if (!isDraggingHorizontalScrollbar || !gridWrapEl || !horizontalRailEl) return;

		const railWidth = horizontalRailEl.clientWidth;
		const maxThumbLeft = Math.max(railWidth - horizontalThumbWidthPx, 0);
		const nextThumbLeft = clamp(
			dragStartHorizontalThumbLeftPx + (event.clientX - dragStartX),
			0,
			maxThumbLeft
		);
		const maxScrollLeft = Math.max(gridWrapEl.scrollWidth - gridWrapEl.clientWidth, 0);

		horizontalThumbLeftPx = nextThumbLeft;
		gridWrapEl.scrollLeft = maxThumbLeft > 0 ? (nextThumbLeft / maxThumbLeft) * maxScrollLeft : 0;
	}

	function stopHorizontalDragging() {
		if (isDraggingHorizontalScrollbar) {
			setGlobalScrollbarDragging(false);
		}
		isDraggingHorizontalScrollbar = false;
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', onHorizontalDragMove);
			window.removeEventListener('mouseup', stopHorizontalDragging);
		}
	}

	function startHorizontalThumbDrag(event: MouseEvent) {
		if (!showHorizontalScrollbar) return;
		event.preventDefault();
		event.stopPropagation();
		isDraggingHorizontalScrollbar = true;
		setGlobalScrollbarDragging(true);
		dragStartX = event.clientX;
		dragStartHorizontalThumbLeftPx = horizontalThumbLeftPx;
		window.addEventListener('mousemove', onHorizontalDragMove);
		window.addEventListener('mouseup', stopHorizontalDragging);
	}

	function handleHorizontalRailClick(event: MouseEvent) {
		if (!gridWrapEl || !horizontalRailEl || !showHorizontalScrollbar) return;
		if (event.target !== horizontalRailEl) return;

		const rect = horizontalRailEl.getBoundingClientRect();
		const desiredLeft = clamp(
			event.clientX - rect.left - horizontalThumbWidthPx / 2,
			0,
			Math.max(rect.width - horizontalThumbWidthPx, 0)
		);
		const maxThumbLeft = Math.max(rect.width - horizontalThumbWidthPx, 1);
		const maxScrollLeft = Math.max(gridWrapEl.scrollWidth - gridWrapEl.clientWidth, 0);
		gridWrapEl.scrollLeft = (desiredLeft / maxThumbLeft) * maxScrollLeft;
		updateCustomScrollbar();
	}

	onMount(() => {
		mounted = true;
		queueMeasure();
		requestAnimationFrame(updateCustomScrollbar);
		const onResize = () => {
			queueMeasure();
			updateCustomScrollbar();
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	afterUpdate(() => {
		queueMeasure();
		updateCustomScrollbar();
	});

	$: if (mounted) {
		theme;
		monthDays;
		activeTodayDay;
		queueMeasure();
	}

	$: {
		groups;
		collapsed;
		monthDays;
		if (typeof window !== 'undefined') {
			requestAnimationFrame(updateCustomScrollbar);
		}
	}

	onDestroy(() => {
		stopHorizontalDragging();
	});
</script>

<div class="gridwrapShell">
	<div class="gridwrap" bind:this={gridWrapEl} on:scroll={onGridScroll}>
		<div
			class="grid"
			role="grid"
			aria-label="Shift schedule grid"
			style={gridStyle}
			bind:this={gridEl}
		>
			{#if activeTodayDay}
				<div class="today-band" bind:this={bandEl}></div>
			{/if}

			{#if canMaintainTeam}
				<div
					class="cell hdr namecol teamHeader clickable"
					role="button"
					tabindex="0"
					aria-label="Configure team and schedule setup"
					on:click={activateTeamCell}
					on:keydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							activateTeamCell();
						}
					}}
				>
					<div class="groupRow">Team</div>
				</div>
			{:else}
				<div class="cell hdr namecol teamHeader" role="columnheader">
					<div class="groupRow">Team</div>
				</div>
			{/if}

			{#each days as day}
				<div
					class={dayHeaderClass(day)}
					data-day={day.day}
					role="columnheader"
					aria-label={dayAriaLabel(day)}
				>
					{day.day}
					<span class="dow">{dayDowShort(day)}</span>
				</div>
			{/each}

			{#each groups as group}
				<GroupRow
					groupName={group.category}
					employeeCount={group.employees.length}
					collapsed={collapsed[group.category] === true}
					{monthDays}
					onToggle={() => onToggleGroup(group.category)}
				/>

				{#if !collapsed[group.category]}
					{#each group.employees as employee}
						<EmployeeRow {employee} {monthDays} {overrides} />
					{/each}
				{/if}
			{/each}

			<div class="footerBar"></div>
		</div>
	</div>
	{#if showHorizontalScrollbar}
		<div
			class="gridScrollRailHorizontal"
			role="presentation"
			aria-hidden="true"
			bind:this={horizontalRailEl}
			on:mousedown={handleHorizontalRailClick}
		>
			<div
				class="gridScrollThumbHorizontal"
				class:dragging={isDraggingHorizontalScrollbar}
				role="presentation"
				style={`width:${horizontalThumbWidthPx}px;transform:translateX(${horizontalThumbLeftPx}px);`}
				on:mousedown={startHorizontalThumbDrag}
			></div>
		</div>
	{/if}
</div>
