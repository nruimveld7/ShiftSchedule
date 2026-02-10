<script lang="ts">
  export let theme: 'light' | 'dark' = 'dark';
  export let onToggle: () => void = () => {};

  const SUN = {
    viewBox: '0 0 24 24',
    circle: { cx: 12, cy: 12, r: 4 },
    path:
      'M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12'
  };

  const MOON = {
    viewBox: '0 0 24 24',
    path: 'M21 14.5A8.5 8.5 0 0 1 9.5 3a6.5 6.5 0 1 0 11.5 11.5Z'
  };

  $: isLight = theme === 'light';
  $: nextTheme = isLight ? 'dark' : 'light';
</script>

<button
  class="modeToggle"
  type="button"
  aria-label={`Switch to ${nextTheme} theme`}
  aria-pressed={isLight}
  title={`Switch to ${nextTheme} theme`}
  on:click={onToggle}
>
  <span class="modeIcon" aria-hidden="true">
    {#if isLight}
      <svg viewBox={SUN.viewBox} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx={SUN.circle.cx} cy={SUN.circle.cy} r={SUN.circle.r} stroke="currentColor" stroke-width="2" />
        <path
          d={SUN.path}
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    {:else}
      <svg viewBox={MOON.viewBox} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d={MOON.path} stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      </svg>
    {/if}
  </span>
  <span class="modeText">{isLight ? 'Light' : 'Dark'}</span>
</button>
