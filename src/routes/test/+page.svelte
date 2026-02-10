<script lang="ts">
	import './test.css';
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	let value = 0;
	let users: Array<{
		id: string;
		displayName?: string;
		mail?: string;
		userPrincipalName?: string;
	}> = [];
	let selectedUserId = '';
	let usersError = '';
	let usersLoading = false;
	let userQuery = '';
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let showUserResults = false;
	let comboEl: HTMLDivElement | null = null;

	const userLabel = (user: {
		id: string;
		displayName?: string;
		mail?: string;
		userPrincipalName?: string;
	}) => {
		const email = user.mail ?? user.userPrincipalName ?? '';
		const name = (user.displayName ?? '').trim();
		let formattedName = name;
		if (name) {
			if (name.includes(',')) {
				formattedName = name;
			} else {
				const parts = name.split(/\s+/);
				if (parts.length >= 2) {
					const last = parts.pop();
					const first = parts.join(' ');
					formattedName = `${last}, ${first}`;
				}
			}
		}
		if (formattedName && email) {
			return `${formattedName} <${email}>`;
		}
		return formattedName || email || user.id;
	};

	const OnInput = (event: Event) => {
		const target = event.target as HTMLInputElement;
		value = Number(target.value);
	};

	const LoadInitial = async () => {
		const result = await fetch(`${base}/test/api/health`, {
			method: 'POST'
		});
		const data = await result.json();
		value = data.value;
	};

	const LoadRandom = async () => {
		const result = await fetch(`${base}/test/api/health`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ value })
		});
		const data = await result.json();
		value = data.value;
	};

	const LoadDB = async () => {
		const result = await fetch(`${base}/test/api/db`, {
			method: 'GET'
		});
		const data = await result.json();
		value = data.value;
	};

	const SaveDB = async () => {
		const result = await fetch(`${base}/test/api/db`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ value })
		});
		const data = await result.json();
		if (data.value === value) {
			alert('SUCCESS!');
		} else {
			alert('FAIL!');
		}
	};

	const LoadUsers = async (query = userQuery) => {
		usersLoading = true;
		usersError = '';
		try {
			const queryParam = query ? `?q=${encodeURIComponent(query)}` : '';
			const result = await fetch(`${base}/test/api/users${queryParam}`, {
				method: 'GET'
			});
			if (!result.ok) {
				const text = await result.text();
				throw new Error(text || `Request failed: ${result.status}`);
			}
			const data = await result.json();
			users = data.users ?? [];
		} catch (err) {
			usersError = err instanceof Error ? err.message : 'Failed to load users';
		} finally {
			usersLoading = false;
		}
	};

	const OnUserQuery = (event: Event) => {
		const target = event.target as HTMLInputElement;
		userQuery = target.value;
		selectedUserId = '';
		showUserResults = true;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			void LoadUsers(userQuery);
		}, 300);
	};

	const OnSelectUser = (user: { id: string }) => {
		selectedUserId = user.id;
		const match = users.find((u) => u.id === user.id);
		if (match) {
			userQuery = userLabel(match);
		}
		showUserResults = false;
	};

	const CloseResults = () => {
		showUserResults = false;
	};

	const OnUserFocus = () => {
		showUserResults = true;
		if (users.length === 0 && userQuery.trim().length > 0) {
			void LoadUsers(userQuery);
		}
	};

	const OnDocumentMouseDown = (event: MouseEvent) => {
		if (!showUserResults) return;
		const target = event.target as Node;
		if (comboEl && !comboEl.contains(target)) {
			showUserResults = false;
		}
	};

	onMount(() => {
		document.addEventListener('mousedown', OnDocumentMouseDown);
	});

	onDestroy(() => {
		document.removeEventListener('mousedown', OnDocumentMouseDown);
	});


</script>

<svelte:head>
	<title>Shift Schedule</title>
	<meta name="description" content="Simple number input demo" />
</svelte:head>

<main class="container">
		<section class="card">
			<h1>Number Echo</h1>
			<p>Type any number below and see it echoed back.</p>

		<label>
			Number input
			<input type="number" value={value} on:input={OnInput} />
		</label>

		<div class="readout">Current value: {value}</div>
		<button on:click={LoadInitial}>Load Initial Value</button>
		<button on:click={LoadRandom}>Load Random Value</button>
			<button on:click={LoadDB}>Load Database Value</button>
			<button on:click={SaveDB}>Save Database Value</button>
		</section>
		<section class="card">
			<h2>Tenant Users</h2>
			<p>Search Entra users and select one.</p>
			<label>
				User
				<div
					class="combo"
					role="combobox"
					aria-expanded={showUserResults}
					bind:this={comboEl}
				>
					<input
						type="text"
						placeholder="Type a name or email"
						value={userQuery}
						on:input={OnUserQuery}
						on:focus={OnUserFocus}
						aria-autocomplete="list"
						aria-controls="user-results"
					/>
					{#if showUserResults}
						<div id="user-results" class="combo-list" role="listbox">
							{#if usersLoading}
								<div class="combo-item">Loading...</div>
							{:else if usersError}
								<div class="combo-item error">{usersError}</div>
							{:else if users.length === 0}
								<button
									class="combo-item"
									type="button"
									on:mousedown|preventDefault={CloseResults}
								>
									No matches
								</button>
							{:else}
								{#each users as user}
									<button
										class="combo-item"
										role="option"
										type="button"
										on:mousedown|preventDefault={() => OnSelectUser(user)}
									>
										{userLabel(user)}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			</label>
			{#if selectedUserId}
				<p class="muted">Selected: {selectedUserId}</p>
			{/if}
		</section>
	</main>
