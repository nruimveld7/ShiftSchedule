<script lang="ts">
  import { afterUpdate, onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import MonthYearBar from '$lib/components/MonthYearBar.svelte';
  import ScheduleGrid from '$lib/components/ScheduleGrid.svelte';
  import TeamSetupModal from '$lib/components/TeamSetupModal.svelte';
  import { demo, overrides as demoOverrides } from '$lib/data/demoData';
  import { buildMonthDays, monthNames } from '$lib/utils/date';

  type Theme = 'light' | 'dark';

  const now = () => new Date();
  const initialDate = now();
  let selectedYear = initialDate.getFullYear();
  let selectedMonthIndex = initialDate.getMonth();
  let theme: Theme = 'dark';
  let collapsed: Record<string, boolean> = {};

  export let scheduleName = 'Shift Schedule';
  export let groups = demo;
  export let overrides = demoOverrides;
  export let showLegend = true;
  export let canMaintainTeam = false;
  export let canAssignManagerRole = false;
  export let currentUserOid = '';

  let teamSetupOpen = false;
  let cardScrollEl: HTMLDivElement | null = null;
  let appRailEl: HTMLDivElement | null = null;
  let showAppScrollbar = false;
  let appThumbHeightPx = 0;
  let appThumbTopPx = 0;
  let isDraggingAppScrollbar = false;
  let appDragStartY = 0;
  let appDragStartThumbTopPx = 0;

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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

  function updateAppScrollbar() {
    if (!cardScrollEl) return;
    const scrollHeight = cardScrollEl.scrollHeight;
    const clientHeight = cardScrollEl.clientHeight;
    const scrollTop = cardScrollEl.scrollTop;
    const hasOverflow = scrollHeight > clientHeight + 1;
    showAppScrollbar = hasOverflow;
    if (!hasOverflow) {
      appThumbHeightPx = 0;
      appThumbTopPx = 0;
      return;
    }

    const railHeight = appRailEl?.clientHeight ?? Math.max(clientHeight - 24, 0);
    if (railHeight <= 0) return;

    const minThumbHeight = 36;
    const nextThumbHeight = Math.max(minThumbHeight, (railHeight * clientHeight) / scrollHeight);
    const maxThumbTop = Math.max(railHeight - nextThumbHeight, 0);
    const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
    const nextThumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

    appThumbHeightPx = nextThumbHeight;
    appThumbTopPx = clamp(nextThumbTop, 0, maxThumbTop);
  }

  function onCardScroll() {
    if (!isDraggingAppScrollbar) {
      updateAppScrollbar();
    }
  }

  function onAppDragMove(event: MouseEvent) {
    if (!isDraggingAppScrollbar || !cardScrollEl || !appRailEl) return;
    const railHeight = appRailEl.clientHeight;
    const maxThumbTop = Math.max(railHeight - appThumbHeightPx, 0);
    const nextThumbTop = clamp(appDragStartThumbTopPx + (event.clientY - appDragStartY), 0, maxThumbTop);
    const maxScrollTop = Math.max(cardScrollEl.scrollHeight - cardScrollEl.clientHeight, 0);
    appThumbTopPx = nextThumbTop;
    cardScrollEl.scrollTop = maxThumbTop > 0 ? (nextThumbTop / maxThumbTop) * maxScrollTop : 0;
  }

  function stopAppDragging() {
    if (isDraggingAppScrollbar) {
      setGlobalScrollbarDragging(false);
    }
    isDraggingAppScrollbar = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousemove', onAppDragMove);
      window.removeEventListener('mouseup', stopAppDragging);
    }
  }

  function startAppThumbDrag(event: MouseEvent) {
    if (!showAppScrollbar) return;
    event.preventDefault();
    event.stopPropagation();
    isDraggingAppScrollbar = true;
    setGlobalScrollbarDragging(true);
    appDragStartY = event.clientY;
    appDragStartThumbTopPx = appThumbTopPx;
    window.addEventListener('mousemove', onAppDragMove);
    window.addEventListener('mouseup', stopAppDragging);
  }

  function handleAppRailClick(event: MouseEvent) {
    if (!cardScrollEl || !appRailEl || !showAppScrollbar) return;
    if (event.target !== appRailEl) return;

    const rect = appRailEl.getBoundingClientRect();
    const desiredTop = clamp(
      event.clientY - rect.top - appThumbHeightPx / 2,
      0,
      Math.max(rect.height - appThumbHeightPx, 0)
    );
    const maxThumbTop = Math.max(rect.height - appThumbHeightPx, 1);
    const maxScrollTop = Math.max(cardScrollEl.scrollHeight - cardScrollEl.clientHeight, 0);
    cardScrollEl.scrollTop = (desiredTop / maxThumbTop) * maxScrollTop;
    updateAppScrollbar();
  }

  $: monthDays = buildMonthDays(
    selectedYear,
    selectedMonthIndex,
    browser ? now() : null
  );
  $: monthLabel = `${monthNames[selectedMonthIndex]} ${selectedYear}`;

  $: if (browser) {
    document.title = `${scheduleName} — ${monthNames[selectedMonthIndex]} ${selectedYear}`;
  }

  $: if (browser) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('shiftTheme', theme);
    } catch {
      // ignore storage failures
    }
  }

  const months = monthNames.map((label, value) => ({ label, value }));

  $: years = (() => {
    const nowYear = now().getFullYear();
    return Array.from({ length: 9 }, (_, i) => {
      const value = nowYear - 3 + i;
      return { label: String(value), value };
    });
  })();

  function setTheme(next: Theme) {
    theme = next;
  }

  function toggleTheme() {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }

  function setToToday() {
    const d = now();
    selectedYear = d.getFullYear();
    selectedMonthIndex = d.getMonth();
  }

  function toggleGroup(groupName: string) {
    collapsed = { ...collapsed, [groupName]: !collapsed[groupName] };
  }

  function openTeamSetup() {
    if (!canMaintainTeam) return;
    teamSetupOpen = true;
  }

  function closeTeamSetup() {
    teamSetupOpen = false;
  }

  onMount(() => {
    document.body.classList.add('app-shell-route');
    setToToday();
    collapsed = Object.fromEntries(groups.map((group) => [group.category, false]));
    let nextTheme: Theme = 'dark';
    try {
      const saved = localStorage.getItem('shiftTheme');
      if (saved === 'light' || saved === 'dark') nextTheme = saved;
    } catch {
      // ignore storage failures
    }
    setTheme(nextTheme);
    requestAnimationFrame(updateAppScrollbar);
    const onResize = () => updateAppScrollbar();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  afterUpdate(() => {
    if (typeof window !== 'undefined') {
      requestAnimationFrame(updateAppScrollbar);
    }
  });

  onDestroy(() => {
    stopAppDragging();
    if (typeof document !== 'undefined') {
      document.body.classList.remove('app-shell-route');
    }
  });
</script>

<div class="app">
  <div class="card">
    <div class="cardScroll" bind:this={cardScrollEl} on:scroll={onCardScroll}>
      <div class="topbar">
        <div class="title">{scheduleName}</div>
        <ThemeToggle {theme} onToggle={toggleTheme} />
      </div>

      {#if showLegend}
        <div class="legend" aria-label="Legend">
          <span class="pill work"><span class="dot"></span>WORK</span>
          <span class="pill off"><span class="dot"></span>OFF</span>
          <span class="pill vac"><span class="dot"></span>VAC</span>
          <span class="pill hldy"><span class="dot"></span>HLDY</span>
          <span class="pill oot"><span class="dot"></span>OOT</span>
        </div>
      {/if}

      <MonthYearBar
        {monthLabel}
        months={months}
        years={years}
        {selectedMonthIndex}
        {selectedYear}
        onMonthSelect={(value) => (selectedMonthIndex = value)}
        onYearSelect={(value) => (selectedYear = value)}
        onToday={setToToday}
      />

      <ScheduleGrid
        {groups}
        {overrides}
        {collapsed}
        {monthDays}
        {theme}
        onToggleGroup={toggleGroup}
        {canMaintainTeam}
        onTeamClick={openTeamSetup}
      />
    </div>
    {#if showAppScrollbar}
      <div
        class="appScrollRail"
        role="presentation"
        aria-hidden="true"
        bind:this={appRailEl}
        on:mousedown={handleAppRailClick}
      >
        <div
          class="appScrollThumb"
          class:dragging={isDraggingAppScrollbar}
          role="presentation"
          style={`height:${appThumbHeightPx}px;transform:translateY(${appThumbTopPx}px);`}
          on:mousedown={startAppThumbDrag}
        ></div>
      </div>
    {/if}
  </div>
</div>

<TeamSetupModal
  open={teamSetupOpen}
  canAssignManagerRole={canAssignManagerRole}
  currentUserOid={currentUserOid}
  onClose={closeTeamSetup}
/>
