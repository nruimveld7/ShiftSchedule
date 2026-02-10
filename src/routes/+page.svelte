<script lang="ts">
  import AppShell from '$lib/components/AppShell.svelte';
  type ScheduleRole = 'Member' | 'Maintainer' | 'Manager';
  export let data: {
    schedule: { ScheduleId: number; Name: string } | null;
    userRole: ScheduleRole | null;
  };

  const scheduleName = data.schedule?.Name ?? 'Shift Schedule';
  const canMaintainTeam = data.userRole === 'Maintainer' || data.userRole === 'Manager';
  const canAssignManagerRole = data.userRole === 'Manager';
</script>

<AppShell
  scheduleName={scheduleName}
  groups={[]}
  overrides={{}}
  showLegend={false}
  {canMaintainTeam}
  {canAssignManagerRole}
/>
