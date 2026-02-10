<script lang="ts">
  import { onMount } from 'svelte';
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

  let teamSetupOpen = false;

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
  });
</script>

<div class="app">
  <div class="card">
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
</div>

<TeamSetupModal
  open={teamSetupOpen}
  canAssignManagerRole={canAssignManagerRole}
  onClose={closeTeamSetup}
/>
