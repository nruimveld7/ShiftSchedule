<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';

	type DayCell = {
		iso: string;
		day: number;
		inMonth: boolean;
		isToday: boolean;
		isSelected: boolean;
		isDisabled: boolean;
	};

	export let id = '';
	export let menuId = '';
	export let label = 'Date';
	export let value = '';
	export let open = false;
	export let disabled = false;
	export let placeholder = 'Select date';
	export let min = '';
	export let max = '';
	export let onOpenChange: (next: boolean) => void = () => {};

	const dispatch = createEventDispatcher<{ select: string; change: string }>();
	const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
	const monthShortFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' });
	const selectedFormatter = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
	const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

	let rootEl: HTMLDivElement | null = null;
	let lastOpen = false;
	let viewYear = 0;
	let viewMonth = 0;
	let yearGridDecadeStart = 0;
	let viewMode: 'days' | 'months' | 'years' = 'days';
	let isTriggerPressed = false;

	$: resolvedMenuId = menuId || `${id}-menu`;
	$: selectedDate = parseIsoDate(value);
	$: selectedLabel = selectedDate ? selectedFormatter.format(selectedDate) : placeholder;
	$: monthLabel = monthFormatter.format(new Date(viewYear, viewMonth, 1));
	$: yearLabel = String(viewYear);
	$: yearGridStart = yearGridDecadeStart - 1;
	$: yearRangeLabel = `${yearGridStart} - ${yearGridStart + 11}`;
	$: dayCells = buildCalendarCells(viewYear, viewMonth, selectedDate, min, max);
	$: monthCells = buildMonthCells(viewYear, viewMonth, min, max);
	$: yearCells = buildYearCells(yearGridStart, viewYear, min, max);
	$: {
		if (open && !lastOpen) {
			const base = selectedDate ?? new Date();
			viewYear = base.getFullYear();
			viewMonth = base.getMonth();
			yearGridDecadeStart = decadeStartForYear(viewYear);
			viewMode = 'days';
		}
		lastOpen = open;
	}

	function parseIsoDate(iso: string): Date | null {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
		const [yearRaw, monthRaw, dayRaw] = iso.split('-');
		const year = Number(yearRaw);
		const month = Number(monthRaw);
		const day = Number(dayRaw);
		if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
		const parsed = new Date(year, month - 1, day);
		if (
			parsed.getFullYear() !== year ||
			parsed.getMonth() !== month - 1 ||
			parsed.getDate() !== day
		) {
			return null;
		}
		return parsed;
	}

	function toIsoDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function buildCalendarCells(
		year: number,
		month: number,
		selected: Date | null,
		minValue: string,
		maxValue: string
	): DayCell[] {
		const firstOfMonth = new Date(year, month, 1);
		const startOffset = firstOfMonth.getDay();
		const firstCellDate = new Date(year, month, 1 - startOffset);
		const todayIso = toIsoDate(new Date());
		const selectedIso = selected ? toIsoDate(selected) : '';
		const cells: DayCell[] = [];

		for (let index = 0; index < 42; index += 1) {
			const cellDate = new Date(firstCellDate);
			cellDate.setDate(firstCellDate.getDate() + index);
			const iso = toIsoDate(cellDate);
			const inMonth = cellDate.getMonth() === month && cellDate.getFullYear() === year;
			const belowMin = Boolean(minValue) && iso < minValue;
			const aboveMax = Boolean(maxValue) && iso > maxValue;
			cells.push({
				iso,
				day: cellDate.getDate(),
				inMonth,
				isToday: iso === todayIso,
				isSelected: iso === selectedIso,
				isDisabled: belowMin || aboveMax
			});
		}

		return cells;
	}

	function buildMonthCells(
		year: number,
		currentMonth: number,
		minValue: string,
		maxValue: string
	): Array<{ monthIndex: number; label: string; isCurrent: boolean; isDisabled: boolean }> {
		const cells: Array<{
			monthIndex: number;
			label: string;
			isCurrent: boolean;
			isDisabled: boolean;
		}> = [];
		for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
			cells.push({
				monthIndex,
				label: monthShortFormatter.format(new Date(year, monthIndex, 1)),
				isCurrent: monthIndex === currentMonth,
				isDisabled: isMonthDisabled(year, monthIndex, minValue, maxValue)
			});
		}
		return cells;
	}

	function isMonthDisabled(year: number, month: number, minValue: string, maxValue: string) {
		const monthStart = toIsoDate(new Date(year, month, 1));
		const monthEnd = toIsoDate(new Date(year, month + 1, 0));
		const belowMin = Boolean(minValue) && monthEnd < minValue;
		const aboveMax = Boolean(maxValue) && monthStart > maxValue;
		return belowMin || aboveMax;
	}

	function buildYearCells(
		startYear: number,
		currentYear: number,
		minValue: string,
		maxValue: string
	): Array<{ year: number; isCurrent: boolean; isDisabled: boolean }> {
		const cells: Array<{ year: number; isCurrent: boolean; isDisabled: boolean }> = [];
		for (let offset = 0; offset < 12; offset += 1) {
			const year = startYear + offset;
			cells.push({
				year,
				isCurrent: year === currentYear,
				isDisabled: isYearDisabled(year, minValue, maxValue)
			});
		}
		return cells;
	}

	function decadeStartForYear(year: number) {
		return Math.floor(year / 10) * 10;
	}

	function isYearDisabled(year: number, minValue: string, maxValue: string) {
		const yearStart = toIsoDate(new Date(year, 0, 1));
		const yearEnd = toIsoDate(new Date(year, 11, 31));
		const belowMin = Boolean(minValue) && yearEnd < minValue;
		const aboveMax = Boolean(maxValue) && yearStart > maxValue;
		return belowMin || aboveMax;
	}

	function setOpen(next: boolean) {
		if (disabled && next) return;
		if (open === next) return;
		open = next;
		onOpenChange(next);
	}

	function toggle() {
		setOpen(!open);
	}

	function onTriggerPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		isTriggerPressed = true;
	}

	function onTriggerPointerUp() {
		isTriggerPressed = false;
	}

	function selectDate(iso: string) {
		value = iso;
		dispatch('select', iso);
		dispatch('change', iso);
		setOpen(false);
	}

	function shiftMonth(delta: number) {
		const next = new Date(viewYear, viewMonth + delta, 1);
		viewYear = next.getFullYear();
		viewMonth = next.getMonth();
	}

	function shiftYear(delta: number) {
		viewYear += delta;
	}

	function shiftDecade(delta: number) {
		yearGridDecadeStart += delta;
	}

	function toggleHeaderView() {
		if (viewMode === 'days') {
			viewMode = 'months';
			return;
		}
		if (viewMode === 'months') {
			yearGridDecadeStart = decadeStartForYear(viewYear);
			viewMode = 'years';
			return;
		}
		viewMode = 'months';
	}

	function selectMonth(monthIndex: number) {
		viewMonth = monthIndex;
		viewMode = 'days';
	}

	function selectYear(year: number) {
		viewYear = year;
		yearGridDecadeStart = decadeStartForYear(year);
		viewMode = 'months';
	}

	function selectToday() {
		const today = new Date();
		const iso = toIsoDate(today);
		if ((min && iso < min) || (max && iso > max)) return;
		viewYear = today.getFullYear();
		viewMonth = today.getMonth();
		selectDate(iso);
	}

	function handleDocMouseDown(event: MouseEvent) {
		if (!open || !rootEl) return;
		const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
		if (path.includes(rootEl)) return;
		const target = event.target as Node | null;
		if (target && rootEl.contains(target)) return;
		setOpen(false);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			setOpen(false);
		}
	}

	onMount(() => {
		document.addEventListener('mousedown', handleDocMouseDown);
		document.addEventListener('keydown', handleKeydown);
		return () => {
			document.removeEventListener('mousedown', handleDocMouseDown);
			document.removeEventListener('keydown', handleKeydown);
		};
	});

	onDestroy(() => {
		if (typeof document !== 'undefined' && !document.body.dataset.scrollbarDragCount) {
			document.body.classList.remove('scrollbar-dragging');
		}
	});
</script>

<div
	class="datePicker picker"
	class:open
	bind:this={rootEl}
	on:mousedown|stopPropagation
	on:click|stopPropagation
>
	<button
		class="datePickerBtn pickerBtn"
		class:pressed={isTriggerPressed}
		{id}
		type="button"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-controls={resolvedMenuId}
		on:click|stopPropagation={toggle}
		on:pointerdown={onTriggerPointerDown}
		on:pointerup={onTriggerPointerUp}
		on:pointercancel={onTriggerPointerUp}
		on:pointerleave={onTriggerPointerUp}
		on:blur={onTriggerPointerUp}
		{disabled}
	>
		<span>{selectedLabel}</span>
		<span class="chev" aria-hidden="true">▾</span>
	</button>

	<div
		class={`datePickerMenu pickerMenu${open ? ' open' : ''}`}
		id={resolvedMenuId}
		role="dialog"
		aria-label={label}
		on:mousedown|stopPropagation
		on:click|stopPropagation
	>
		<div class="datePickerHeader">
			<button
				type="button"
				class="datePickerNavBtn"
				on:click={() =>
					viewMode === 'years'
						? shiftDecade(-10)
						: viewMode === 'months'
							? shiftYear(-1)
							: shiftMonth(-1)}
				aria-label={viewMode === 'years'
					? 'Previous decade'
					: viewMode === 'months'
						? 'Previous year'
						: 'Previous month'}
			>
				‹
			</button>
			<button
				type="button"
				class="datePickerMonthLabel datePickerHeaderLabelBtn"
				on:click={toggleHeaderView}
				aria-label={viewMode === 'days'
					? 'Choose month'
					: viewMode === 'months'
						? 'Choose year'
						: 'Show month selection'}
				aria-pressed={viewMode !== 'days'}
			>
				{viewMode === 'years' ? yearRangeLabel : viewMode === 'months' ? yearLabel : monthLabel}
			</button>
			<button
				type="button"
				class="datePickerNavBtn"
				on:click={() =>
					viewMode === 'years'
						? shiftDecade(10)
						: viewMode === 'months'
							? shiftYear(1)
							: shiftMonth(1)}
				aria-label={viewMode === 'years'
					? 'Next decade'
					: viewMode === 'months'
						? 'Next year'
						: 'Next month'}
			>
				›
			</button>
		</div>

		{#if viewMode === 'years'}
			<div class="datePickerYearGrid" role="grid" aria-label={yearRangeLabel}>
				{#each yearCells as cell (cell.year)}
					<button
						type="button"
						class="datePickerYearCell"
						class:selected={cell.isCurrent}
						disabled={cell.isDisabled}
						aria-current={cell.isCurrent ? 'date' : undefined}
						on:click={() => selectYear(cell.year)}
					>
						{cell.year}
					</button>
				{/each}
			</div>
		{:else if viewMode === 'months'}
			<div class="datePickerMonthGrid" role="grid" aria-label={yearLabel}>
				{#each monthCells as cell (cell.monthIndex)}
					<button
						type="button"
						class="datePickerMonthCell"
						class:selected={cell.isCurrent}
						disabled={cell.isDisabled}
						aria-current={cell.isCurrent ? 'date' : undefined}
						on:click={() => selectMonth(cell.monthIndex)}
					>
						{cell.label}
					</button>
				{/each}
			</div>
		{:else}
			<div class="datePickerWeekdays" aria-hidden="true">
				{#each weekdayLabels as dayLabel (dayLabel)}
					<span>{dayLabel}</span>
				{/each}
			</div>

			<div class="datePickerGrid" role="grid" aria-label={monthLabel}>
				{#each dayCells as cell (cell.iso)}
					<button
						type="button"
						class="datePickerDay"
						class:outside={!cell.inMonth}
						class:selected={cell.isSelected}
						class:today={cell.isToday}
						disabled={cell.isDisabled}
						aria-selected={cell.isSelected}
						aria-label={cell.iso}
						on:click={() => selectDate(cell.iso)}
					>
						{cell.day}
					</button>
				{/each}
			</div>
		{/if}

		<div class="datePickerFooter">
			<button type="button" class="datePickerFooterBtn" on:click={selectToday}>Today</button>
		</div>
	</div>
</div>
