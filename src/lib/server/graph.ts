type GraphUser = {
	id: string;
	displayName?: string;
	mail?: string;
	userPrincipalName?: string;
};

function escapeODataLiteral(value: string): string {
	return value.replace(/'/g, "''");
}

export async function searchTenantUsers(
	token: string,
	query: string,
	limit = 50
): Promise<GraphUser[]> {
	const safeQuery = escapeODataLiteral(query.trim());
	if (!safeQuery) return [];
	const filter = [
		`startswith(displayName,'${safeQuery}')`,
		`startswith(userPrincipalName,'${safeQuery}')`,
		`startswith(mail,'${safeQuery}')`
	].join(' or ');

	const url = new URL('https://graph.microsoft.com/v1.0/users');
	url.searchParams.set('$select', 'id,displayName,mail,userPrincipalName');
	url.searchParams.set('$top', String(Math.max(1, Math.min(limit, 100))));
	url.searchParams.set('$filter', filter);

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Graph users search failed: ${res.status} ${text}`);
	}
	const data = (await res.json()) as { value: GraphUser[] };
	return data.value ?? [];
}

export async function listTenantUsers(token: string): Promise<GraphUser[]> {
	const users: GraphUser[] = [];

	let nextUrl =
		'https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=999';
	let pages = 0;

	while (nextUrl && pages < 10) {
		const res = await fetch(nextUrl, {
			headers: { Authorization: `Bearer ${token}` }
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Graph users request failed: ${res.status} ${text}`);
		}

		const data = (await res.json()) as {
			value: GraphUser[];
			'@odata.nextLink'?: string;
		};

		users.push(...data.value);
		nextUrl = data['@odata.nextLink'] ?? '';
		pages += 1;
	}

	return users;
}
