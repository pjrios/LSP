(function installNavigationRuntime(runtimeWindow = window, runtimeDocument = document, runtimeValueStoreProperty = "__BUILDER_RUNTIME_VALUE_STORE__") {
	const config = runtimeWindow.__BUILDER_NAVIGATION__;
	if (!config) return () => undefined;
	const runtimeConfig = config;
	const contextParameterPrefix = "context-";
	const authDestinationAttribute = "data-builder-auth-destination";
	function elementPosition(element) {
		let position = 1;
		let sibling = element.previousElementSibling;
		while (sibling) {
			if (sibling.tagName === element.tagName) position += 1;
			sibling = sibling.previousElementSibling;
		};
		return position;
	}
	function stableElementId(element) {
		const segments = [];
		let current = element;
		while (current && current.tagName !== "BODY") {
			segments.unshift(`${current.tagName.toLowerCase()}:${elementPosition(current)}`);
			current = current.parentElement;
		};
		return `${runtimeConfig.currentPage}::${segments.join("/")}`;
	}
	runtimeDocument.body.querySelectorAll("*").forEach((element) => {
		if (![
			"SCRIPT",
			"STYLE",
			"LINK",
			"META",
			"NOSCRIPT",
			"TEMPLATE"
		].includes(element.tagName)) {
			element.dataset.builderElementId = stableElementId(element);
		}
	});
	function contextFromLocation() {
		const result = { ...runtimeConfig.currentContext };
		try {
			const parameters = new URLSearchParams(runtimeWindow.location.search);
			parameters.forEach((value, key) => {
				if (!key.startsWith(contextParameterPrefix)) return;
				const parsed = JSON.parse(value);
				if (typeof parsed.dataSourceId === "string" && typeof parsed.recordId === "string") {
					result[key.slice(contextParameterPrefix.length)] = {
						dataSourceId: parsed.dataSourceId,
						recordId: parsed.recordId
					};
				}
			});
		} catch {
			return result;
		};
		return result;
	}
	const activeContext = contextFromLocation();
	const repeatedRecordValues = new WeakMap();
	const authSource = runtimeConfig.dataSources?.find((source) => source.type === "supabase");
	const authProject = runtimeConfig.authentication ?? (authSource?.type === "supabase" ? {
		provider: "supabase",
		projectUrl: authSource.projectUrl,
		publishableKey: authSource.publishableKey,
		loginPage: runtimeConfig.currentPage,
		afterLoginPage: runtimeConfig.currentPage,
		afterLogoutPage: runtimeConfig.currentPage
	} : undefined);
	const authStorageKey = authProject ? `builder-auth:${new URL(authProject.projectUrl).hostname}` : "builder-auth";
	const authReturnStorageKey = `${authStorageKey}:return-page`;
	const practiceVideoBucket = "practice-reference-videos";
	function storedSession() {
		try {
			const raw = runtimeWindow.localStorage.getItem(authStorageKey);
			if (!raw) return undefined;
			const parsed = JSON.parse(raw);
			if (typeof parsed.access_token !== "string" || typeof parsed.refresh_token !== "string") return undefined;
			return parsed;
		} catch {
			return undefined;
		}
	}
	function saveSession(session) {
		try {
			if (session) runtimeWindow.localStorage.setItem(authStorageKey, JSON.stringify(session));
			else runtimeWindow.localStorage.removeItem(authStorageKey);
		} catch {
			return;
		}
	}
	function normalizedSession(value) {
		if (!value || typeof value !== "object") return undefined;
		const object = value;
		if (typeof object.access_token !== "string" || typeof object.refresh_token !== "string") return undefined;
		const expiresIn = typeof object.expires_in === "number" ? object.expires_in : 3600;
		return {
			access_token: object.access_token,
			refresh_token: object.refresh_token,
			expires_at: typeof object.expires_at === "number" ? object.expires_at : Math.floor(Date.now() / 1e3) + expiresIn,
			...object.user && typeof object.user === "object" ? { user: object.user } : {}
		};
	}
	async function authRequest(path, body, accessToken) {
		if (!authProject) return undefined;
		const response = await runtimeWindow.fetch(`${authProject.projectUrl.replace(/\/$/, "")}/auth/v1/${path}`, {
			method: "POST",
			headers: {
				apikey: authProject.publishableKey,
				"Content-Type": "application/json",
				...accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
			},
			...body ? { body: JSON.stringify(body) } : {}
		});
		const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
		if (!response.ok) {
			const detail = result && typeof result === "object" ? result.msg ?? result.message ?? result.error_description : undefined;
			throw new Error(typeof detail === "string" ? detail : "Supabase no pudo completar la solicitud.");
		};
		return result;
	}
	async function loadAuthSession() {
		const existing = storedSession();
		if (!existing) return undefined;
		if (existing.expires_at > Math.floor(Date.now() / 1e3) + 60) return existing;
		try {
			const refreshed = normalizedSession(await authRequest("token?grant_type=refresh_token", { refresh_token: existing.refresh_token }));
			saveSession(refreshed);
			return refreshed;
		} catch {
			saveSession();
			return undefined;
		}
	}
	const authSessionPromise = authProject ? loadAuthSession() : Promise.resolve(undefined);
	const roleVisibleElements = [...runtimeDocument.querySelectorAll("[data-builder-role-visible]")];
	roleVisibleElements.forEach((element) => {
		element.hidden = true;
	});
	let userRolesPromise;
	function currentUserRoles() {
		if (userRolesPromise) return userRolesPromise;
		userRolesPromise = (async () => {
			const session = await authSessionPromise;
			if (!session) return new Set();
			const appMetadata = session.user?.app_metadata;
			if (appMetadata && typeof appMetadata === "object" && !Array.isArray(appMetadata)) {
				const roles = [
					...typeof appMetadata.role === "string" ? [appMetadata.role] : [],
					...Array.isArray(appMetadata.roles) ? appMetadata.roles.filter((role) => typeof role === "string") : []
				];
				if (roles.length > 0) {
					const roleSet = new Set(roles);
					if (roleSet.has("admin")) roleSet.add("teacher");
					return roleSet;
				}
			}
			const source = runtimeConfig.dataSources?.find((candidate) => /(^|_)roles?($|_)/i.test(candidate.name) || candidate.type === "supabase" && /(^|_)roles?($|_)/i.test(candidate.table));
			if (!source) return new Set();
			if (source.type === "static") {
				return new Set(source.records.flatMap((record) => typeof record.role === "string" ? [record.role] : []));
			};
			if (source.type !== "supabase") return new Set();
			try {
				const request = dataRequest(source, undefined, session);
				if (!request) return new Set();
				const response = await runtimeWindow.fetch(request.url, request.options);
				if (!response.ok) return new Set();
				const result = await response.json();
				if (!Array.isArray(result)) return new Set();
				return new Set(result.flatMap((record) => {
					if (!record || typeof record !== "object") return [];
					const role = record.role;
					return typeof role === "string" ? [role] : [];
				}));
			} catch {
				return new Set();
			}
		})();
		return userRolesPromise;
	}
	async function applyRoleVisibility() {
		const roles = await currentUserRoles();
		roleVisibleElements.forEach((element) => {
			const expected = element.dataset.builderRoleVisible;
			element.hidden = !expected || !roles.has(expected);
		});
	}
	function storedReturnPage() {
		try {
			const pageId = runtimeWindow.localStorage.getItem(authReturnStorageKey);
			return pageId && runtimeConfig.pageUrls[pageId] !== undefined ? pageId : undefined;
		} catch {
			return undefined;
		}
	}
	function saveReturnPage(pageId) {
		try {
			if (pageId) runtimeWindow.localStorage.setItem(authReturnStorageKey, pageId);
			else runtimeWindow.localStorage.removeItem(authReturnStorageKey);
		} catch {
			return;
		}
	}
	function navigateToPage(pageId, replace = false) {
		if (runtimeConfig.transport === "message") {
			const message = {
				source: "builder-navigation-runtime",
				action: "navigate",
				targetPage: pageId
			};
			runtimeWindow.parent.postMessage(message, "*");
			return;
		};
		const targetUrl = runtimeConfig.pageUrls[pageId];
		if (!targetUrl) return;
		const resolvedUrl = new URL(targetUrl, runtimeWindow.location.href);
		if (replace) runtimeWindow.location.replace(resolvedUrl.href);
		else runtimeWindow.location.assign(resolvedUrl.href);
	}
	function revealDocument() {
		runtimeDocument.documentElement.style.removeProperty("visibility");
	}
	async function applyAuthPageGuard() {
		const authentication = runtimeConfig.authentication;
		if (!authentication) return true;
		runtimeDocument.documentElement.style.visibility = "hidden";
		const session = await authSessionPromise;
		const access = runtimeConfig.pageAccess?.[runtimeConfig.currentPage] ?? (runtimeConfig.currentPage === authentication.loginPage ? "guestOnly" : "authenticated");
		if (access === "authenticated" && !session) {
			saveReturnPage(runtimeConfig.currentPage);
			navigateToPage(authentication.loginPage, true);
			return false;
		};
		if (access === "role") {
			if (!session) {
				saveReturnPage(runtimeConfig.currentPage);
				navigateToPage(authentication.loginPage, true);
				return false;
			};
			const permittedRoles = runtimeConfig.pageRoles?.[runtimeConfig.currentPage] ?? [];
			const userRoles = await currentUserRoles();
			if (!permittedRoles.some((role) => userRoles.has(role))) {
				runtimeDocument.body.innerHTML = "<main role=\"main\" style=\"max-width:36rem;margin:12vh auto;padding:2rem;font-family:system-ui,sans-serif\"><h1>Acceso restringido</h1><p>Tu cuenta no tiene un rol autorizado para ver esta página.</p></main>";
				revealDocument();
				return false;
			}
		};
		if (access === "guestOnly" && session) {
			const destination = storedReturnPage() ?? authentication.afterLoginPage;
			saveReturnPage();
			if (destination !== runtimeConfig.currentPage) {
				navigateToPage(destination, true);
				return false;
			}
		};
		revealDocument();
		return true;
	}
	function dataRequest(source, recordId, session, range, query) {
		if (source.type !== "supabase") return null;
		const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
		const relatedFilterAliases = new Set([
			...query?.fixedFilters ?? [],
			...query?.controlFilters ?? [],
			...query?.searchField && query.searchTerm ? [{ field: query.searchField }] : []
		].flatMap((filter) => filter.field.includes(".") ? [filter.field.split(".")[0]] : []));
		const relationSelections = source.relations?.map((relation) => `${relation.alias}:${relation.table}!${relation.column}${relatedFilterAliases.has(relation.alias) ? "!inner" : ""}(*)`) ?? [];
		url.searchParams.set("select", ["*", ...relationSelections].join(","));
		if (recordId !== undefined) url.searchParams.set("id", `eq.${recordId}`);
		if (source.publishedOnly && !query?.includeUnpublished) url.searchParams.set("published", "eq.true");
		if (query?.userFilterColumn && session?.user?.id) {
			url.searchParams.set(query.userFilterColumn, `eq.${session.user.id}`);
		};
		const safeColumn = (value) => {
			if (!value || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$/.test(value)) return undefined;
			const [alias] = value.split(".");
			return value.includes(".") && !source.relations?.some((relation) => relation.alias === alias) ? undefined : value;
		};
		const cleanValue = (value) => value.trim().slice(0, 500);
		const addFilter = (field, operator, rawValue) => {
			const column = safeColumn(field);
			const value = operator === "contains" ? cleanValue(rawValue).replace(/[*%]/g, "").trim() : cleanValue(rawValue);
			if (!column || !value) return;
			const expression = operator === "contains" ? `ilike.*${value}*` : `${operator}.${value}`;
			url.searchParams.append(column, expression);
		};
		query?.fixedFilters?.forEach((filter) => addFilter(filter.field, filter.operator, filter.value));
		query?.controlFilters?.forEach((filter) => addFilter(filter.field, filter.operator, filter.value));
		if (query?.searchField && query.searchTerm) addFilter(query.searchField, "contains", query.searchTerm);
		const orderColumn = safeColumn(query?.orderColumn) ?? source.orderColumn;
		const orderDirection = query?.orderColumn ? query.orderDirection : source.orderDirection;
		if (orderColumn && recordId === undefined) {
			const [relation, field] = orderColumn.split(".");
			url.searchParams.set("order", field ? `${relation}(${field}).${orderDirection ?? "asc"}` : `${orderColumn}.${orderDirection ?? "asc"}`);
		};
		if (range && recordId === undefined) {
			url.searchParams.set("limit", String(range.limit));
			url.searchParams.set("offset", String(range.offset));
		};
		return {
			url: url.href,
			options: { headers: {
				apikey: source.publishableKey,
				...session ? { Authorization: `Bearer ${session.access_token}` } : {}
			} }
		};
	}
	function fieldValue(record, path) {
		let current = record;
		for (const segment of path.split(".")) {
			if (!current || typeof current !== "object") return undefined;
			current = current[segment];
		};
		return current;
	}
	async function resolveRecord(reference) {
		const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === reference.dataSourceId);
		if (!source) return undefined;
		if (source.type === "static") {
			return source.records.find((record) => record.id === reference.recordId);
		};
		try {
			const session = source.type === "supabase" ? await authSessionPromise : undefined;
			if (source.type === "supabase" && source.requiresAuth && !session) return undefined;
			const request = source.type === "supabase" ? dataRequest(source, reference.recordId, session, undefined, session ? { includeUnpublished: true } : undefined) : null;
			const response = source.type === "supabase" ? await runtimeWindow.fetch(request.url, request.options) : await runtimeWindow.fetch(source.recordUrl.replace("{id}", encodeURIComponent(reference.recordId)));
			if (!response.ok) return undefined;
			const result = await response.json();
			if (Array.isArray(result)) return result[0];
			if (result && typeof result === "object") {
				const data = result.data;
				if (data && !Array.isArray(data) && typeof data === "object") return data;
			};
			return result;
		} catch {
			return undefined;
		}
	}
	const dataSourceErrors = new Set();
	async function resolveRecords(dataSourceId, range, query) {
		const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === dataSourceId);
		if (!source) {
			dataSourceErrors.add(dataSourceId);
			return [];
		};
		if (source.type === "static") {
			return range ? source.records.slice(range.offset, range.offset + range.limit) : source.records;
		};
		if (source.type === "rest" && !source.listUrl) return [];
		try {
			const session = source.type === "supabase" && (source.requiresAuth || query?.userFilterColumn) ? await authSessionPromise : undefined;
			if (source.type === "supabase" && (source.requiresAuth || query?.userFilterColumn) && !session) {
				dataSourceErrors.add(dataSourceId);
				return [];
			};
			const request = source.type === "supabase" ? dataRequest(source, undefined, session, range, query) : null;
			const response = source.type === "supabase" ? await runtimeWindow.fetch(request.url, request.options) : await runtimeWindow.fetch(source.listUrl);
			if (!response.ok) {
				dataSourceErrors.add(dataSourceId);
				return [];
			};
			dataSourceErrors.delete(dataSourceId);
			const result = await response.json();
			if (Array.isArray(result)) return source.type === "rest" && range ? result.slice(range.offset, range.offset + range.limit) : result;
			if (result && typeof result === "object") {
				const object = result;
				if (Array.isArray(object.data)) return source.type === "rest" && range ? object.data.slice(range.offset, range.offset + range.limit) : object.data;
				if (Array.isArray(object.records)) return source.type === "rest" && range ? object.records.slice(range.offset, range.offset + range.limit) : object.records;
			};
			return [];
		} catch {
			dataSourceErrors.add(dataSourceId);
			return [];
		}
	}
	function safeUrl(value, target) {
		const normalized = value.trim().toLowerCase();
		if (normalized.startsWith("javascript:")) return false;
		if (normalized.startsWith("data:")) {
			return target === "src" && normalized.startsWith("data:image/");
		};
		return true;
	}
	async function resolvedBindingMediaUrl(binding, value) {
		if (/^https?:\/\//i.test(value)) return value;
		const storageMatch = /^storage:\/\/([^/]+)\/(.+)$/i.exec(value);
		if (!storageMatch || !binding.dataSourceId) return undefined;
		const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === binding.dataSourceId);
		if (!source || source.type !== "supabase") return undefined;
		const bucketIsPublic = source.storageBuckets?.some((bucket) => bucket.name === storageMatch[1] && bucket.public);
		const encodedPath = storageMatch[2].split("/").map((segment) => encodeURIComponent(segment)).join("/");
		if (bucketIsPublic) {
			return `${source.projectUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(storageMatch[1])}/${encodedPath}`;
		};
		const session = await authSessionPromise;
		const response = await runtimeWindow.fetch(`${source.projectUrl.replace(/\/$/, "")}/storage/v1/object/sign/${encodeURIComponent(storageMatch[1])}/${encodedPath}`, {
			method: "POST",
			headers: {
				apikey: source.publishableKey,
				Authorization: `Bearer ${session?.access_token ?? source.publishableKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({ expiresIn: 3600 })
		});
		if (!response.ok) return undefined;
		const result = await response.json().catch(() => ({}));
		const signedPath = result.signedURL ?? result.signedUrl;
		if (typeof signedPath !== "string") return undefined;
		return /^https?:\/\//i.test(signedPath) ? signedPath : `${source.projectUrl.replace(/\/$/, "")}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
	}
	async function applyBinding(element, binding, value) {
		if (binding.target === "text") element.textContent = value;
		else if (binding.target === "value" && "value" in element) {
			if (element instanceof HTMLInputElement && element.type === "checkbox") {
				element.checked = value === "true" || value === "1";
			} else if (element instanceof HTMLInputElement && element.type === "radio") {
				element.checked = element.value === value;
			} else {
				element.value = value;
			}
		} else if (binding.target === "ariaLabel") element.setAttribute("aria-label", value);
		else if (binding.target === "src" || binding.target === "href") {
			const resolvedMedia = binding.target === "src" ? await resolvedBindingMediaUrl(binding, value) : undefined;
			if (binding.target === "src" && /^storage:\/\//i.test(value) && !resolvedMedia) return;
			const resolvedValue = resolvedMedia ?? value;
			if (safeUrl(resolvedValue, binding.target)) element.setAttribute(binding.target, resolvedValue);
		} else {
			element.setAttribute(binding.target, value);
		}
	}
	async function applyRecordToRoot(root, contextKey, record) {
		const candidates = [root, ...root.querySelectorAll("[data-builder-element-id]")];
		for (const binding of runtimeConfig.bindings ?? []) {
			if (binding.pageId !== runtimeConfig.currentPage || binding.contextKey !== contextKey) continue;
			const element = candidates.find((candidate) => candidate.dataset.builderElementId === binding.elementId);
			const rawValue = fieldValue(record, binding.field) ?? binding.fallback;
			if (element && rawValue !== undefined && rawValue !== null) {
				await applyBinding(element, binding, String(rawValue));
			}
		}
	}
	async function applyRepeaters() {
		for (const repeater of runtimeConfig.repeaters ?? []) {
			if (repeater.pageId !== runtimeConfig.currentPage) continue;
			const template = [...runtimeDocument.querySelectorAll("[data-builder-element-id]")].find((candidate) => candidate.dataset.builderElementId === repeater.elementId);
			if (!template) continue;
			const pageSize = repeater.pageSize;
			const usesPagination = Boolean(repeater.pagination && pageSize);
			const repeaterHost = template.parentElement;
			const componentRoot = template.closest("[data-builder-data-component]");
			const anchor = runtimeDocument.createComment(`builder-repeater:${repeater.id}`);
			template.parentNode?.insertBefore(anchor, template);
			template.remove();
			Array.from(repeaterHost?.children ?? []).forEach((element) => {
				if (element.getAttribute("data-builder-design-placeholder") === "true") element.remove();
			});
			const controls = runtimeDocument.createElement("nav");
			controls.className = "builder-data-pagination";
			controls.setAttribute("aria-label", "Páginas de información");
			const previous = runtimeDocument.createElement("button");
			previous.type = "button";
			previous.textContent = "← Anterior";
			const pageLabel = runtimeDocument.createElement("span");
			const next = runtimeDocument.createElement("button");
			next.type = "button";
			next.textContent = "Siguiente →";
			controls.append(previous, pageLabel, next);
			let currentPage = 0;
			let renderVersion = 0;
			const currentQuery = () => {
				const query = {
					userFilterColumn: repeater.userFilterColumn,
					includeUnpublished: repeater.includeUnpublished,
					fixedFilters: repeater.fixedFilters,
					orderColumn: repeater.orderColumn,
					orderDirection: repeater.orderDirection
				};
				if (!componentRoot) return query;
				const search = componentRoot.querySelector("[data-builder-search-field]");
				if (repeater.searchField && search?.getAttribute("data-builder-search-field") === repeater.searchField) {
					query.searchField = repeater.searchField;
					query.searchTerm = search.value;
				};
				const allowedControls = new Map((repeater.filterControls ?? []).map((control) => [`${control.field}:${control.kind}`, control]));
				const controlFilters = [];
				componentRoot.querySelectorAll("[data-builder-filter-control][data-builder-filter-field]").forEach((control) => {
					const field = control.getAttribute("data-builder-filter-field") ?? "";
					const kind = control.getAttribute("data-builder-filter-control") ?? "";
					if (!allowedControls.has(`${field}:${kind}`)) return;
					if (kind === "number" || kind === "date") {
						const minimum = control.querySelector("[data-builder-filter-bound=\"min\"]")?.value;
						const maximum = control.querySelector("[data-builder-filter-bound=\"max\"]")?.value;
						if (minimum) controlFilters.push({
							field,
							operator: "gte",
							value: minimum
						});
						if (maximum) controlFilters.push({
							field,
							operator: "lte",
							value: maximum
						});
						return;
					};
					const value = control.value;
					if (value) controlFilters.push({
						field,
						operator: kind === "text" ? "contains" : "eq",
						value
					});
				});
				query.controlFilters = controlFilters;
				const sort = componentRoot.querySelector("[data-builder-sort-control]");
				const [requestedField, requestedDirection] = sort?.value.split(".") ?? [];
				if ((repeater.visitorSortFields ?? []).includes(requestedField) && (requestedDirection === "asc" || requestedDirection === "desc")) {
					query.orderColumn = requestedField;
					query.orderDirection = requestedDirection;
				};
				return query;
			};
			const renderPage = async () => {
				const requestedVersion = ++renderVersion;
				previous.disabled = true;
				next.disabled = true;
				componentRoot?.setAttribute("aria-busy", "true");
				const offset = pageSize ? currentPage * pageSize : 0;
				const requestedLimit = pageSize ? pageSize + (usesPagination ? 1 : 0) : undefined;
				const records = await resolveRecords(repeater.dataSourceId, requestedLimit ? {
					limit: requestedLimit,
					offset
				} : undefined, currentQuery());
				if (requestedVersion !== renderVersion) return;
				runtimeDocument.querySelectorAll("[data-builder-repeater-instance]").forEach((element) => {
					if (element.dataset.builderRepeaterInstance === repeater.id) element.remove();
				});
				const visibleRecords = pageSize ? records.slice(0, pageSize) : records;
				const hasNextPage = Boolean(pageSize && records.length > pageSize);
				if (!visibleRecords.length) {
					const hasError = dataSourceErrors.has(repeater.dataSourceId);
					const status = runtimeDocument.createElement("div");
					status.dataset.builderRepeaterInstance = repeater.id;
					status.dataset.builderDataStatus = hasError ? "error" : "empty";
					status.setAttribute("role", hasError ? "alert" : "status");
					status.textContent = hasError ? repeater.errorMessage ?? "No se pudo cargar esta información." : currentPage > 0 ? "No hay más elementos para mostrar." : repeater.emptyMessage ?? "Todavía no hay elementos para mostrar.";
					status.style.cssText = "grid-column:1/-1;padding:1rem;text-align:center;opacity:.8;border:1px dashed currentColor;border-radius:.5rem";
					anchor.parentNode?.insertBefore(status, anchor);
				} else {
					for (const record of visibleRecords) {
						if (!record || typeof record !== "object") continue;
						const recordId = record.id;
						if (typeof recordId !== "string" && typeof recordId !== "number") continue;
						const clone = template.cloneNode(true);
						clone.dataset.builderRepeaterInstance = repeater.id;
						clone.dataset.builderRecordId = String(recordId);
						clone.dataset.builderDataSourceId = repeater.dataSourceId;
						repeatedRecordValues.set(clone, record);
						await applyRecordToRoot(clone, repeater.itemContext, record);
						anchor.parentNode?.insertBefore(clone, anchor);
					}
				};
				if (usesPagination) {
					pageLabel.textContent = `Página ${currentPage + 1}`;
					previous.disabled = currentPage === 0;
					next.disabled = !hasNextPage;
					controls.hidden = currentPage === 0 && !hasNextPage;
					if (!controls.isConnected && repeaterHost?.parentNode) {
						repeaterHost.parentNode.insertBefore(controls, repeaterHost.nextSibling);
					}
				};
				if (repeaterHost?.classList.contains("builder-data-carousel")) {
					repeaterHost.scrollLeft = 0;
				};
				componentRoot?.removeAttribute("aria-busy");
			};
			previous.addEventListener("click", () => {
				if (currentPage === 0) return;
				currentPage -= 1;
				void renderPage();
			});
			next.addEventListener("click", () => {
				currentPage += 1;
				void renderPage();
			});
			if (componentRoot) {
				let inputTimer;
				const refresh = () => {
					currentPage = 0;
					void renderPage();
				};
				const onInput = (event) => {
					const target = event.target;
					if (!target?.matches("[data-builder-search-field], [data-builder-filter-control=\"text\"]")) return;
					runtimeWindow.clearTimeout(inputTimer);
					inputTimer = runtimeWindow.setTimeout(refresh, 250);
				};
				const onChange = (event) => {
					const target = event.target;
					if (!target?.matches("[data-builder-filter-control], [data-builder-filter-bound], [data-builder-sort-control]")) return;
					refresh();
				};
				const filterForm = componentRoot.querySelector("[data-builder-filter-form]");
				const onReset = () => runtimeWindow.setTimeout(refresh, 0);
				componentRoot.addEventListener("input", onInput);
				componentRoot.addEventListener("change", onChange);
				filterForm?.addEventListener("reset", onReset);
				dataControlDisposers.push(() => {
					runtimeWindow.clearTimeout(inputTimer);
					componentRoot.removeEventListener("input", onInput);
					componentRoot.removeEventListener("change", onChange);
					filterForm?.removeEventListener("reset", onReset);
				});
			};
			await renderPage();
		}
	}
	async function applyDataBindings() {
		const recordCache = new Map();
		const firstRecordCache = new Map();
		for (const binding of runtimeConfig.bindings ?? []) {
			if (binding.pageId !== runtimeConfig.currentPage) continue;
			const reference = activeContext[binding.contextKey];
			let recordPromise;
			if (binding.sourceMode === "first" && binding.dataSourceId) {
				recordPromise = firstRecordCache.get(binding.dataSourceId) ?? resolveRecords(binding.dataSourceId).then((records) => records[0]);
				firstRecordCache.set(binding.dataSourceId, recordPromise);
			} else if (reference) {
				const cacheKey = `${reference.dataSourceId}:${reference.recordId}`;
				recordPromise = recordCache.get(cacheKey) ?? resolveRecord(reference);
				recordCache.set(cacheKey, Promise.resolve(recordPromise));
			};
			if (!recordPromise) continue;
			const record = await recordPromise;
			if (binding.dataSourceId) applyMutationFormRecord(binding.dataSourceId, record);
			const rawValue = fieldValue(record, binding.field) ?? binding.fallback;
			if (rawValue === undefined || rawValue === null) continue;
			const element = [...runtimeDocument.querySelectorAll("[data-builder-element-id]")].find((candidate) => candidate.dataset.builderElementId === binding.elementId && !candidate.closest("[data-builder-repeater-instance]"));
			if (element) await applyBinding(element, binding, String(rawValue));
		}
	}
	function setAuthStatus(root, message, isError = false) {
		const status = root.querySelector("[data-builder-auth-status]");
		if (!status) return;
		status.textContent = message;
		status.setAttribute("role", isError ? "alert" : "status");
	}
	async function syncSignupProfileFields(session) {
		const userId = session.user?.id;
		const metadata = session.user?.user_metadata;
		if (typeof userId !== "string" || !metadata || typeof metadata !== "object") return;
		const groups = new Map();
		runtimeDocument.querySelectorAll("[data-builder-auth-metadata-definition]").forEach((definition) => {
			const tableId = definition.getAttribute("data-builder-auth-metadata-table")?.trim();
			const field = definition.getAttribute("data-builder-auth-metadata-field")?.trim();
			const key = definition.getAttribute("data-builder-auth-metadata-definition")?.trim();
			if (!tableId || !field || !key || !/^[a-z][a-z0-9_]*$/.test(field)) return;
			const value = metadata[key];
			if (value === undefined || value === null || value === "") return;
			const current = groups.get(tableId) ?? {};
			current[field] = value;
			groups.set(tableId, current);
		});
		for (const [tableId, values] of groups) {
			const normalizedTableId = tableId.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").slice(0, 63);
			const source = runtimeConfig.dataSources?.find((candidate) => candidate.type === "supabase" && (candidate.id === tableId || candidate.id === `supabase-${normalizedTableId}` || candidate.name === tableId || candidate.table === tableId));
			if (!source || source.type !== "supabase") continue;
			const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
			url.searchParams.set("select", "id");
			url.searchParams.set("user_id", `eq.${userId}`);
			url.searchParams.set("limit", "1");
			const headers = {
				apikey: source.publishableKey,
				Authorization: `Bearer ${session.access_token}`
			};
			const existingResponse = await runtimeWindow.fetch(url.href, { headers });
			if (!existingResponse.ok) throw new Error("La cuenta se creó, pero no pudimos comprobar su perfil.");
			const existing = await existingResponse.json();
			const existingId = Array.isArray(existing) && existing[0] && typeof existing[0] === "object" ? existing[0].id : undefined;
			const writeUrl = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
			if (typeof existingId === "string" || typeof existingId === "number") {
				writeUrl.searchParams.set("id", `eq.${existingId}`);
			};
			const response = await runtimeWindow.fetch(writeUrl.href, {
				method: existingId === undefined ? "POST" : "PATCH",
				headers: {
					...headers,
					"Content-Type": "application/json",
					Prefer: "return=minimal"
				},
				body: JSON.stringify({
					...existingId === undefined ? { user_id: userId } : {},
					...values
				})
			});
			if (!response.ok) throw new Error("La cuenta se creó, pero no pudimos guardar sus datos de perfil.");
		}
	}
	const authDisposers = [];
	const mutationDisposers = [];
	const wizardDisposers = [];
	const dataControlDisposers = [];
	function setMutationStatus(root, message, isError = false) {
		const status = root.querySelector("[data-builder-mutation-status]");
		if (!status) return;
		status.textContent = message;
		status.setAttribute("role", isError ? "alert" : "status");
	}
	function installPracticeWizards() {
		runtimeDocument.querySelectorAll("form[data-practice-wizard]").forEach((form) => {
			const details = form.querySelector("[data-practice-step=\"details\"]");
			const reference = form.querySelector("[data-practice-step=\"reference\"]");
			const next = form.querySelector("[data-practice-next]");
			const label = runtimeDocument.querySelector("[data-practice-step-label]");
			const pageHeader = runtimeDocument.querySelector(".create-editor-header");
			if (!details || !reference || !next) return;
			const showStep = (step, moveFocus = true) => {
				const showingDetails = step === "details";
				details.hidden = !showingDetails;
				reference.hidden = showingDetails;
				if (pageHeader) pageHeader.hidden = !showingDetails;
				details.setAttribute("aria-hidden", String(!showingDetails));
				reference.setAttribute("aria-hidden", String(showingDetails));
				if (label) label.textContent = showingDetails ? "Paso 1 de 2 · Información" : "Paso 2 de 2 · Referencia";
				if (!moveFocus) return;
				if (showingDetails) {
					form.querySelector("#practice-title")?.focus();
				} else {
					reference.querySelector("h2")?.focus();
				}
			};
			const continueToReference = () => {
				const fields = [...details.querySelectorAll("input,select,textarea")];
				const invalid = fields.find((field) => !field.checkValidity());
				if (invalid) {
					invalid.reportValidity();
					invalid.focus();
					return;
				};
				showStep("reference");
			};
			next.addEventListener("click", continueToReference);
			wizardDisposers.push(() => next.removeEventListener("click", continueToReference));
			showStep("details", false);
		});
	}
	function encodedStoragePath(path) {
		return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
	}
	async function uploadPracticeReferenceVideo(source, session, userId, practiceId, file) {
		const allowedTypes = new Set([
			"video/mp4",
			"video/webm",
			"video/quicktime"
		]);
		const mediaType = file.type.toLowerCase().split(";", 1)[0].trim();
		if (!allowedTypes.has(mediaType)) {
			throw new Error("Selecciona un video MP4, WebM o MOV.");
		};
		if (file.size > 100 * 1024 * 1024) {
			throw new Error("El video supera el límite de 100 MB.");
		};
		const objectPath = `${userId}/${practiceId}/reference`;
		const response = await runtimeWindow.fetch(`${source.projectUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(practiceVideoBucket)}/${encodedStoragePath(objectPath)}`, {
			method: "POST",
			headers: {
				apikey: source.publishableKey,
				Authorization: `Bearer ${session.access_token}`,
				"Content-Type": mediaType,
				"x-upsert": "true"
			},
			body: file
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			const detail = result.message ?? result.error;
			throw new Error(typeof detail === "string" ? `No se pudo subir el video: ${detail}` : "No se pudo subir el video de referencia.");
		};
		return `storage://${practiceVideoBucket}/${objectPath}`;
	}
	async function updatePracticeMediaUrl(source, session, practiceId, mediaUrl) {
		const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
		url.searchParams.set("id", `eq.${practiceId}`);
		url.searchParams.set("select", "*");
		const response = await runtimeWindow.fetch(url.href, {
			method: "PATCH",
			headers: {
				apikey: source.publishableKey,
				Authorization: `Bearer ${session.access_token}`,
				"Content-Type": "application/json",
				Prefer: "return=representation"
			},
			body: JSON.stringify({ media_url: mediaUrl })
		});
		const result = await response.json().catch(() => []);
		if (!response.ok) throw new Error("El video subió, pero no se pudo asociar con la práctica.");
		const updated = Array.isArray(result) ? result[0] : result;
		if (!updated || typeof updated !== "object") {
			throw new Error("El video subió, pero Supabase no devolvió la práctica actualizada.");
		};
		return updated;
	}
	function applyMutationFormRecord(dataSourceId, record) {
		if (!record || typeof record !== "object") return;
		const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === dataSourceId);
		if (!source) return;
		runtimeDocument.querySelectorAll("form[data-builder-mutation-source]").forEach((form) => {
			const sourceKey = form.dataset.builderMutationSource;
			const matches = source.id === sourceKey || source.name === sourceKey || source.type === "supabase" && source.table === sourceKey;
			if (!matches) return;
			form.querySelectorAll("[data-builder-mutation-field][name]").forEach((field) => {
				const value = fieldValue(record, field.name);
				if (value === undefined || value === null) return;
				if (field instanceof HTMLInputElement && field.type === "checkbox") {
					field.checked = Boolean(value);
				} else if (field.dataset.builderMutationType === "json" && typeof value === "object") {
					field.value = JSON.stringify(value);
				} else {
					field.value = String(value);
				};
				field.dispatchEvent(new Event("input", { bubbles: true }));
				field.dispatchEvent(new Event("change", { bubbles: true }));
			});
			const requiredTemplate = form.querySelector("[data-motion-template-field]");
			if (requiredTemplate?.value.trim()) {
				setMutationStatus(form, "Práctica y referencia existentes cargadas.");
			}
		});
	}
	async function applySourceRecord(dataSourceId, record) {
		if (!record || typeof record !== "object") return;
		applyMutationFormRecord(dataSourceId, record);
		const elements = [...runtimeDocument.querySelectorAll("[data-builder-element-id]")];
		for (const binding of runtimeConfig.bindings ?? []) {
			if (binding.pageId !== runtimeConfig.currentPage || binding.dataSourceId !== dataSourceId) continue;
			const rawValue = fieldValue(record, binding.field) ?? binding.fallback;
			if (rawValue === undefined || rawValue === null) continue;
			const element = elements.find((candidate) => candidate.dataset.builderElementId === binding.elementId);
			if (element) await applyBinding(element, binding, String(rawValue));
		}
	}
	function installDataMutations() {
		runtimeDocument.querySelectorAll("form[data-builder-mutation-source]").forEach((form) => {
			const formContextKey = form.dataset.builderMutationContext ?? "record";
			const editingContext = form.dataset.builderMutationMode === "context" ? activeContext[formContextKey] : undefined;
			if (editingContext) {
				const mode = runtimeDocument.querySelector("[data-builder-editor-mode]");
				const title = runtimeDocument.querySelector("[data-builder-editor-title]");
				const description = runtimeDocument.querySelector("[data-builder-editor-description]");
				if (mode) mode.textContent = "Editar";
				if (title) title.textContent = "Editar práctica";
				if (description) description.textContent = "Actualiza la información o la referencia de movimiento.";
			};
			const submit = async (event) => {
				event.preventDefault();
				const sourceKey = form.dataset.builderMutationSource;
				const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === sourceKey || candidate.name === sourceKey || candidate.type === "supabase" && candidate.table === sourceKey);
				if (!source || source.type !== "supabase") {
					setMutationStatus(form, "No se encontró la colección para guardar el perfil.", true);
					return;
				};
				const filterField = form.dataset.builderMutationFilter;
				const requestedMode = form.dataset.builderMutationMode;
				const contextKey = form.dataset.builderMutationContext ?? "record";
				const contextRecord = activeContext[contextKey];
				const mutationMode = requestedMode === "insert" || requestedMode === "context" && !contextRecord ? "insert" : "update";
				const session = await authSessionPromise;
				const userId = session?.user && typeof session.user.id === "string" ? session.user.id : undefined;
				const filterValue = requestedMode === "context" ? contextRecord?.recordId : userId;
				if (!session || !userId || mutationMode === "update" && (!filterField || !filterValue)) {
					setMutationStatus(form, "Tu sesión ya no está disponible. Vuelve a iniciar sesión.", true);
					return;
				};
				const requiredTemplate = form.querySelector("[data-motion-template-field]");
				if (requiredTemplate && !requiredTemplate.value.trim()) {
					setMutationStatus(form, "Graba y detén la referencia de movimiento antes de guardar.", true);
					return;
				};
				const fields = [...form.querySelectorAll("[data-builder-mutation-field][name]")];
				const parseValue = (field) => {
					const value = field.value.trim();
					if (!value) return null;
					if (field.dataset.builderMutationType === "json") return JSON.parse(value);
					if (field.dataset.builderMutationType === "boolean") return value === "true";
					if (field.dataset.builderMutationType === "number" || field instanceof HTMLInputElement && field.type === "number") return Number(value);
					return value;
				};
				const values = Object.fromEntries(fields.flatMap((field) => {
					if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio") && !field.checked) return [];
					return [[field.name, parseValue(field)]];
				}));
				const submitter = event instanceof SubmitEvent ? event.submitter : null;
				if (submitter?.name) {
					values[submitter.name] = submitter.dataset.builderMutationType === "boolean" ? submitter.value === "true" : submitter.value;
				};
				const ownerField = form.dataset.builderMutationOwnerField;
				if (mutationMode === "insert" && ownerField) values[ownerField] = userId;
				const videoInput = runtimeDocument.querySelector("[data-motion-file]");
				const selectedVideo = videoInput?.files?.[0];
				const preparedReferenceClip = videoInput?.__motionReferenceClip;
				if (selectedVideo && source.table === "practices" && !preparedReferenceClip) {
					setMutationStatus(form, "Espera a que termine el procesamiento del video antes de guardar.", true);
					return;
				};
				if (!Object.keys(values).length) {
					setMutationStatus(form, "No hay cambios para guardar.", true);
					return;
				};
				const submitButton = form.querySelector("button[type=\"submit\"]");
				if (submitButton) submitButton.disabled = true;
				setMutationStatus(form, form.dataset.builderMutationPending ?? (mutationMode === "insert" ? "Guardando práctica…" : "Guardando perfil…"));
				try {
					const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
					if (mutationMode === "update" && filterField) {
						url.searchParams.set(filterField, `eq.${filterValue}`);
					};
					url.searchParams.set("select", "*");
					const response = await runtimeWindow.fetch(url.href, {
						method: mutationMode === "insert" ? "POST" : "PATCH",
						headers: {
							apikey: source.publishableKey,
							Authorization: `Bearer ${session.access_token}`,
							"Content-Type": "application/json",
							Prefer: "return=representation"
						},
						body: JSON.stringify(values)
					});
					const result = await response.json().catch(() => []);
					if (!response.ok) {
						const object = result && typeof result === "object" ? result : undefined;
						const detail = object?.message ?? object?.details ?? object?.hint;
						throw new Error(typeof detail === "string" ? detail : "Supabase no pudo guardar el perfil.");
					};
					let updated = Array.isArray(result) ? result[0] : result;
					if (!updated || typeof updated !== "object") {
						throw new Error("No se encontró el perfil de tu cuenta.");
					};
					if (selectedVideo && source.table === "practices") {
						const practiceId = updated.id;
						if (typeof practiceId !== "string") {
							throw new Error("Supabase no devolvió el identificador de la práctica.");
						};
						setMutationStatus(form, "Subiendo el video de referencia…");
						const mediaUrl = await uploadPracticeReferenceVideo(source, session, userId, practiceId, preparedReferenceClip);
						updated = await updatePracticeMediaUrl(source, session, practiceId, mediaUrl);
					};
					await applySourceRecord(source.id, updated);
					setMutationStatus(form, form.dataset.builderMutationSuccess ?? (mutationMode === "insert" ? "Práctica guardada correctamente." : "Perfil guardado correctamente."));
				} catch (error) {
					setMutationStatus(form, error instanceof Error ? error.message : mutationMode === "insert" ? "No se pudo guardar la práctica." : "No se pudo guardar el perfil.", true);
				} finally {
					if (submitButton) submitButton.disabled = false;
				}
			};
			form.addEventListener("submit", submit);
			mutationDisposers.push(() => form.removeEventListener("submit", submit));
		});
	}
	function installAuthControls() {
		runtimeDocument.querySelectorAll("[data-builder-auth-tab]").forEach((tab) => {
			const selectTab = (event) => {
				event.preventDefault();
				const selected = tab.dataset.builderAuthTab;
				const root = tab.closest("[data-builder-auth-visible=\"signed-out\"]") ?? runtimeDocument;
				root.querySelectorAll("[data-builder-auth-tab]").forEach((candidate) => {
					const active = candidate.dataset.builderAuthTab === selected;
					candidate.setAttribute("aria-selected", String(active));
					candidate.setAttribute("tabindex", active ? "0" : "-1");
				});
				root.querySelectorAll("[data-builder-auth-panel]").forEach((panel) => {
					panel.hidden = panel.dataset.builderAuthPanel !== selected;
				});
			};
			tab.addEventListener("click", selectTab);
			authDisposers.push(() => tab.removeEventListener("click", selectTab));
		});
		runtimeDocument.querySelectorAll("form[data-builder-auth-action]").forEach((form) => {
			const submit = async (event) => {
				event.preventDefault();
				const action = form.dataset.builderAuthAction;
				if (action !== "login" && action !== "signup") return;
				const data = new FormData(form);
				const email = String(data.get("email") ?? "").trim();
				const password = String(data.get("password") ?? "");
				if (!email || !password) {
					setAuthStatus(form, "Escribe tu correo y contraseña.", true);
					return;
				};
				setAuthStatus(form, action === "login" ? "Iniciando sesión…" : "Creando cuenta…");
				try {
					const metadata = Object.fromEntries([...form.querySelectorAll("[data-builder-auth-metadata][name]")].flatMap((field) => {
						if (field instanceof HTMLInputElement && field.type === "radio" && !field.checked) return [];
						if (field instanceof HTMLInputElement && field.type === "checkbox") {
							return field.name ? [[field.name, field.checked]] : [];
						};
						const value = field.value.trim();
						return field.name && value ? [[field.name, value]] : [];
					}));
					const result = await authRequest(action === "login" ? "token?grant_type=password" : "signup", {
						email,
						password,
						...action === "signup" && Object.keys(metadata).length ? { data: metadata } : {}
					});
					const session = normalizedSession(result);
					if (!session) {
						setAuthStatus(form, "Revisa tu correo para confirmar la cuenta.");
						return;
					};
					saveSession(session);
					await syncSignupProfileFields(session);
					const destination = form.getAttribute(authDestinationAttribute)?.trim() || storedReturnPage() || runtimeConfig.authentication?.afterLoginPage;
					saveReturnPage();
					if (destination) navigateToPage(destination, true);
					else runtimeWindow.location.reload();
				} catch (error) {
					setAuthStatus(form, error instanceof Error ? error.message : "No se pudo continuar.", true);
				}
			};
			form.addEventListener("submit", submit);
			authDisposers.push(() => form.removeEventListener("submit", submit));
		});
		runtimeDocument.querySelectorAll("[data-builder-auth-action=\"logout\"]").forEach((button) => {
			const logout = async (event) => {
				event.preventDefault();
				const session = await authSessionPromise;
				try {
					if (session) await authRequest("logout", undefined, session.access_token);
				} catch {};
				saveSession();
				saveReturnPage();
				const destination = button.getAttribute(authDestinationAttribute)?.trim() || runtimeConfig.authentication?.afterLogoutPage;
				if (destination) navigateToPage(destination, true);
				else runtimeWindow.location.reload();
			};
			button.addEventListener("click", logout);
			authDisposers.push(() => button.removeEventListener("click", logout));
		});
		void authSessionPromise.then((session) => {
			runtimeDocument.querySelectorAll("[data-builder-auth-visible]").forEach((element) => {
				const expected = element.dataset.builderAuthVisible;
				element.hidden = expected === "signed-in" ? !session : Boolean(session);
			});
			runtimeDocument.querySelectorAll("[data-builder-auth-field]").forEach((element) => {
				const field = element.dataset.builderAuthField;
				const value = field && session?.user ? fieldValue(session.user, field) : undefined;
				if (value !== undefined && value !== null) element.textContent = String(value);
			});
			if (session) void syncSignupProfileFields(session).catch((error) => {
				const signupForm = runtimeDocument.querySelector("form[data-builder-auth-action=\"signup\"]");
				if (signupForm) setAuthStatus(signupForm, error instanceof Error ? error.message : "No pudimos completar los datos del perfil.", true);
			});
		});
	}
	function resolvedConnectionContext(connection, sourceElement) {
		return Object.fromEntries(Object.entries(connection.context ?? {}).flatMap(([key, value]) => {
			const dynamicField = /^\$record\.([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)$/.exec(value.recordId)?.[1];
			if (!dynamicField) return [[key, value]];
			const recordRoot = sourceElement?.closest("[data-builder-record-id]");
			const resolvedValue = dynamicField === "id" ? recordRoot?.dataset.builderRecordId : fieldValue(recordRoot && repeatedRecordValues.get(recordRoot), dynamicField);
			const recordId = typeof resolvedValue === "string" || typeof resolvedValue === "number" ? String(resolvedValue) : undefined;
			const dataSourceId = dynamicField === "id" ? recordRoot?.dataset.builderDataSourceId ?? value.dataSourceId : value.dataSourceId;
			return recordId ? [[key, {
				dataSourceId,
				recordId
			}]] : [];
		}));
	}
	function recordToggleRecordId(toggle, sourceElement) {
		const repeatedRecord = sourceElement?.closest("[data-builder-record-id]")?.dataset.builderRecordId;
		return repeatedRecord ?? activeContext[toggle.contextKey]?.recordId;
	}
	function recordToggleElement(toggle) {
		return [...runtimeDocument.querySelectorAll("[data-builder-element-id]")].find((candidate) => candidate.dataset.builderElementId === toggle.elementId);
	}
	function setRecordToggleState(element, toggle, active) {
		element.textContent = active ? toggle.activeLabel : toggle.inactiveLabel;
		element.setAttribute("aria-pressed", String(active));
		element.dataset.builderRecordToggleState = active ? "active" : "inactive";
		element.removeAttribute("title");
	}
	async function recordToggleState(toggle, sourceElement) {
		const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === toggle.dataSourceId);
		const session = await authSessionPromise;
		const userId = session?.user?.id;
		const recordId = recordToggleRecordId(toggle, sourceElement);
		if (!source || source.type !== "supabase" || !session || typeof userId !== "string" || !recordId) {
			return undefined;
		};
		const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
		url.searchParams.set("select", "id");
		url.searchParams.set(toggle.ownerField, `eq.${userId}`);
		url.searchParams.set(toggle.recordField, `eq.${recordId}`);
		url.searchParams.set("limit", "1");
		const response = await runtimeWindow.fetch(url.href, { headers: {
			apikey: source.publishableKey,
			Authorization: `Bearer ${session.access_token}`
		} });
		if (!response.ok) throw new Error("No se pudo comprobar si este elemento está guardado.");
		const rows = await response.json();
		return Array.isArray(rows) && rows.length > 0;
	}
	async function executeRecordToggle(toggle, sourceElement) {
		const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === toggle.dataSourceId);
		const session = await authSessionPromise;
		const userId = session?.user?.id;
		const recordId = recordToggleRecordId(toggle, sourceElement);
		if (!source || source.type !== "supabase") {
			sourceElement.title = "La colección para guardar no está disponible.";
			return;
		};
		if (!session || typeof userId !== "string") {
			sourceElement.title = "Inicia sesión para guardar este elemento.";
			return;
		};
		if (!recordId) {
			sourceElement.title = "Abre un registro antes de guardarlo.";
			return;
		};
		sourceElement.setAttribute("aria-busy", "true");
		sourceElement.setAttribute("disabled", "");
		try {
			const active = await recordToggleState(toggle, sourceElement);
			const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
			const headers = {
				apikey: source.publishableKey,
				Authorization: `Bearer ${session.access_token}`,
				"Content-Type": "application/json",
				Prefer: "return=minimal"
			};
			let response;
			if (active) {
				url.searchParams.set(toggle.ownerField, `eq.${userId}`);
				url.searchParams.set(toggle.recordField, `eq.${recordId}`);
				response = await runtimeWindow.fetch(url.href, {
					method: "DELETE",
					headers
				});
			} else {
				response = await runtimeWindow.fetch(url.href, {
					method: "POST",
					headers,
					body: JSON.stringify({
						[toggle.ownerField]: userId,
						[toggle.recordField]: recordId
					})
				});
			};
			if (!response.ok) throw new Error(active ? "No se pudo quitar de tus guardados." : "No se pudo guardar este elemento.");
			setRecordToggleState(sourceElement, toggle, !active);
		} catch (cause) {
			sourceElement.title = cause instanceof Error ? cause.message : "No se pudo actualizar.";
		} finally {
			sourceElement.removeAttribute("aria-busy");
			sourceElement.removeAttribute("disabled");
		}
	}
	async function initializeRecordToggles() {
		for (const toggle of runtimeConfig.recordToggles ?? []) {
			if (toggle.pageId !== runtimeConfig.currentPage) continue;
			const element = recordToggleElement(toggle);
			if (!element) continue;
			try {
				const active = await recordToggleState(toggle, element);
				if (active !== undefined) setRecordToggleState(element, toggle, active);
			} catch (cause) {
				element.title = cause instanceof Error ? cause.message : "No se pudo comprobar este elemento.";
			}
		}
	}
	function dataActionRecordReference(action, sourceElement) {
		const repeated = sourceElement.closest("[data-builder-record-id]");
		if (repeated?.dataset.builderRecordId) return {
			recordId: repeated.dataset.builderRecordId,
			dataSourceId: repeated.dataset.builderDataSourceId
		};
		return activeContext[action.contextKey];
	}
	function formActionValue(element, inputName) {
		if (!inputName) throw new Error("Elige qué respuesta del formulario se utilizará.");
		const form = element instanceof HTMLFormElement ? element : element.closest("form");
		if (!form || !form.reportValidity()) throw new Error("Completa los campos requeridos.");
		const controls = [...form.elements].filter((control) => (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) && control.name === inputName && !control.disabled);
		const control = controls.find((candidate) => candidate instanceof HTMLInputElement && candidate.type === "radio" && candidate.checked) ?? controls[0];
		if (!control) throw new Error("La respuesta conectada ya no existe en este formulario.");
		if (control instanceof HTMLInputElement && control.type === "checkbox") return control.checked;
		if (control instanceof HTMLInputElement && control.type === "number") {
			return control.value === "" ? null : control.valueAsNumber;
		};
		return control.value === "" ? null : control.value;
	}
	function fixedActionValue(value) {
		if (value === "true") return true;
		if (value === "false") return false;
		if (value === "null") return null;
		if (value !== undefined && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
		return value;
	}
	function setDataActionStatus(element, message, isError = false) {
		const host = element instanceof HTMLFormElement ? element : element.closest("form") ?? element.parentElement;
		if (!host) return;
		let status = host.querySelector("[data-builder-data-action-status]");
		if (!status) {
			status = runtimeDocument.createElement("p");
			status.dataset.builderDataActionStatus = "true";
			status.setAttribute("aria-live", "polite");
			host.append(status);
		};
		status.textContent = message;
		status.setAttribute("role", isError ? "alert" : "status");
	}
	function runtimeDataActionValue(reference) {
		const store = runtimeWindow[runtimeValueStoreProperty];
		const stored = store?.read?.(reference.key);
		if (!stored) throw new Error("La variable seleccionada todavía no tiene datos.");
		const value = reference.path.reduce((current, part) => current && typeof current === "object" ? current[part] : undefined, stored.value);
		if (value === undefined) throw new Error("La variable seleccionada no existe en la salida actual.");
		return value;
	}
	function dataActionValues(action, element) {
		const form = element instanceof HTMLFormElement ? element : element.closest("form");
		const formMappings = action.fieldMappings.filter((mapping) => Boolean(mapping.inputName));
		if (formMappings.length && !form) throw new Error("La acción necesita un formulario para leer sus campos.");
		if (form && formMappings.length && !form.checkValidity()) {
			form.reportValidity();
			return null;
		};
		const controls = [...form?.elements ?? []].filter((control) => control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement);
		const values = {};
		action.fieldMappings.forEach((mapping) => {
			if (mapping.runtimeValue) {
				values[mapping.field] = runtimeDataActionValue(mapping.runtimeValue);
				return;
			};
			const matchingControls = controls.filter((candidate) => candidate.name === mapping.inputName);
			const radio = matchingControls.find((candidate) => candidate instanceof HTMLInputElement && candidate.type === "radio" && candidate.checked);
			const control = radio ?? matchingControls[0];
			if (!control || control.disabled) return;
			if (control instanceof HTMLInputElement && control.type === "file") return;
			if (control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox")) {
				if (control.type === "radio" && !control.checked) return;
				values[mapping.field] = control.type === "checkbox" ? control.checked : control.value;
				return;
			};
			if (control instanceof HTMLInputElement && control.type === "number") {
				values[mapping.field] = control.value === "" ? null : control.valueAsNumber;
				return;
			};
			values[mapping.field] = control.value === "" ? null : control.value;
		});
		return {
			form: form ?? undefined,
			values
		};
	}
	function fillDataActionForm(action, element, record) {
		const form = element instanceof HTMLFormElement ? element : element.closest("form");
		if (!form) return;
		const controls = [...form.elements].filter((control) => control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement);
		action.fieldMappings.forEach((mapping) => {
			if (!mapping.inputName) return;
			const value = record[mapping.field];
			if (value === undefined || value === null) return;
			controls.filter((control) => control.name === mapping.inputName).forEach((control) => {
				if (control instanceof HTMLInputElement && control.type === "file") {
					control.dataset.builderUploadExisting = typeof value === "string" ? value : JSON.stringify(value);
					const feedback = control.parentElement?.querySelector("[data-builder-upload-feedback]");
					if (feedback) feedback.textContent = "Archivo guardado. Elige otro para reemplazarlo.";
					const clear = control.parentElement?.querySelector("[data-builder-upload-clear-control]");
					if (clear) clear.hidden = false;
				} else if (control instanceof HTMLInputElement && control.type === "checkbox") {
					control.checked = Boolean(value);
				} else if (control instanceof HTMLInputElement && control.type === "radio") {
					control.checked = control.value === String(value);
				} else {
					control.value = String(value);
				}
			});
		});
	}
	function storedFileAddresses(value) {
		if (!value) return [];
		let candidates = [value];
		if (value.startsWith("[")) {
			try {
				const parsed = JSON.parse(value);
				if (Array.isArray(parsed)) candidates = parsed;
			} catch {
				candidates = [value];
			}
		};
		return candidates.flatMap((candidate) => {
			if (typeof candidate !== "string") return [];
			const match = /^storage:\/\/([^/]+)\/(.+)$/.exec(candidate);
			return match ? [{
				bucket: match[1],
				path: match[2]
			}] : [];
		});
	}
	function uploadKindMatches(file, kind) {
		if (kind === "any") return true;
		if (kind === "document") return /^(application\/(pdf|msword|vnd\.)|text\/(plain|csv))/.test(file.type);
		return file.type.startsWith(`${kind}/`);
	}
	async function deleteStorageFiles(source, session, addresses) {
		const grouped = new Map();
		addresses.forEach(({ bucket, path }) => grouped.set(bucket, [...grouped.get(bucket) ?? [], path]));
		for (const [bucket, paths] of grouped) {
			await runtimeWindow.fetch(`${source.projectUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}`, {
				method: "DELETE",
				headers: {
					apikey: source.publishableKey,
					Authorization: `Bearer ${session.access_token}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify({ prefixes: paths })
			}).catch(() => undefined);
		}
	}
	async function uploadDataActionFiles(action, element, source, session, userId, changes) {
		const form = element instanceof HTMLFormElement ? element : element.closest("form");
		if (!form) return changes;
		for (const mapping of action.fieldMappings) {
			if (!mapping.inputName) continue;
			const input = [...form.querySelectorAll("input[type=\"file\"][data-builder-upload-bucket]")].find((candidate) => candidate.name === mapping.inputName);
			if (!input || input.disabled) continue;
			const existing = storedFileAddresses(input.dataset.builderUploadExisting);
			if (input.dataset.builderUploadClear === "true") {
				changes.values[mapping.field] = input.multiple ? [] : null;
				changes.stale.push(...existing);
				continue;
			};
			const files = [...input.files ?? []];
			if (!files.length) continue;
			const bucket = input.dataset.builderUploadBucket ?? "";
			const kind = input.dataset.builderUploadKind ?? "any";
			const maxBytes = Number(input.dataset.builderUploadMaxBytes) || 10 * 1024 * 1024;
			if (!bucket || !/^[a-z][a-z0-9_]*$/.test(bucket)) throw new Error("La carpeta de archivos no es válida.");
			const storedValues = [];
			for (const [index, file] of files.entries()) {
				if (file.size > maxBytes) throw new Error(`${file.name} supera el tamaño máximo permitido.`);
				if (!uploadKindMatches(file, kind)) throw new Error(`${file.name} no es un tipo de archivo permitido.`);
				setDataActionStatus(element, `Subiendo archivo ${index + 1} de ${files.length}…`);
				const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "archivo";
				const objectId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
				const objectPath = `${userId}/${objectId}-${safeName}`;
				const encodedPath = objectPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
				const response = await runtimeWindow.fetch(`${source.projectUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
					method: "POST",
					headers: {
						apikey: source.publishableKey,
						Authorization: `Bearer ${session.access_token}`,
						"Content-Type": file.type || "application/octet-stream",
						"cache-control": "3600",
						"x-upsert": "false"
					},
					body: file
				});
				if (!response.ok) {
					const result = await response.json().catch(() => ({}));
					throw new Error(typeof result.message === "string" ? result.message : `No se pudo subir ${file.name}.`);
				};
				changes.uploaded.push({
					bucket,
					path: objectPath
				});
				storedValues.push(`storage://${bucket}/${objectPath}`);
			};
			changes.values[mapping.field] = input.multiple ? storedValues : storedValues[0];
			changes.stale.push(...existing);
		};
		return changes;
	}
	function installUploadFields() {
		runtimeDocument.querySelectorAll("input[type=\"file\"][data-builder-upload-bucket]").forEach((input) => {
			const feedback = runtimeDocument.createElement("span");
			feedback.dataset.builderUploadFeedback = "true";
			feedback.setAttribute("aria-live", "polite");
			const clear = runtimeDocument.createElement("button");
			clear.type = "button";
			clear.textContent = "Quitar archivo";
			clear.dataset.builderUploadClearControl = "true";
			clear.hidden = true;
			const preview = runtimeDocument.createElement("img");
			preview.alt = "Vista previa del archivo seleccionado";
			preview.hidden = true;
			preview.style.cssText = "max-width:12rem;max-height:8rem;object-fit:cover;margin-top:.5rem";
			input.insertAdjacentElement("afterend", feedback);
			feedback.insertAdjacentElement("afterend", clear);
			clear.insertAdjacentElement("afterend", preview);
			const onChange = () => {
				input.dataset.builderUploadClear = "false";
				const files = [...input.files ?? []];
				feedback.textContent = files.length ? files.map((file) => file.name).join(", ") : "";
				clear.hidden = !files.length && !input.dataset.builderUploadExisting;
				const image = files.find((file) => file.type.startsWith("image/"));
				if (image) {
					preview.src = globalThis.URL.createObjectURL(image);
					preview.hidden = false;
				} else {
					preview.removeAttribute("src");
					preview.hidden = true;
				}
			};
			const onClear = () => {
				input.value = "";
				input.dataset.builderUploadClear = "true";
				feedback.textContent = "El archivo se quitará al guardar.";
				clear.hidden = true;
				preview.hidden = true;
			};
			input.addEventListener("change", onChange);
			clear.addEventListener("click", onClear);
			dataControlDisposers.push(() => {
				input.removeEventListener("change", onChange);
				clear.removeEventListener("click", onClear);
			});
		});
	}
	async function initializeRelationSelects() {
		const session = await authSessionPromise;
		const selects = [...runtimeDocument.querySelectorAll("select[data-builder-relation-source][data-builder-relation-label][data-builder-relation-value]")];
		for (const select of selects) {
			const sourceId = select.dataset.builderRelationSource;
			const labelField = select.dataset.builderRelationLabel;
			const valueField = select.dataset.builderRelationValue;
			const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === sourceId);
			if (!source || source.type !== "supabase" || !labelField || !/^[a-z][a-z0-9_]*$/.test(labelField) || !valueField || !/^[a-z][a-z0-9_]*$/.test(valueField)) continue;
			if (source.requiresAuth && !session) {
				select.disabled = true;
				continue;
			};
			select.setAttribute("aria-busy", "true");
			try {
				const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
				url.searchParams.set("select", `${valueField},${labelField}`);
				if (source.publishedOnly) url.searchParams.set("published", "eq.true");
				url.searchParams.set("order", `${labelField}.asc`);
				url.searchParams.set("limit", "100");
				const response = await runtimeWindow.fetch(url.href, { headers: {
					apikey: source.publishableKey,
					...session ? { Authorization: `Bearer ${session.access_token}` } : {}
				} });
				if (!response.ok) throw new Error("No se pudieron cargar las opciones relacionadas.");
				const records = await response.json();
				if (!Array.isArray(records)) continue;
				const emptyLabel = select.options[0]?.textContent ?? "Selecciona una opción";
				select.replaceChildren(new Option(emptyLabel, ""));
				records.forEach((record) => {
					if (!record || typeof record !== "object") return;
					const value = record[valueField];
					const label = record[labelField];
					if (typeof value !== "string" && typeof value !== "number" || typeof label !== "string" && typeof label !== "number") return;
					select.add(new Option(String(label), String(value)));
				});
			} catch (cause) {
				const option = new Option(cause instanceof Error ? cause.message : "No se pudieron cargar las opciones.", "");
				option.disabled = true;
				select.replaceChildren(option);
			} finally {
				select.removeAttribute("aria-busy");
			}
		}
	}
	async function initializeCurrentUserForms() {
		const session = await authSessionPromise;
		const userId = session?.user?.id;
		if (!session || typeof userId !== "string") return;
		for (const action of runtimeConfig.dataActions ?? []) {
			if (action.pageId !== runtimeConfig.currentPage || action.action !== "upsert" || !action.ownerField) continue;
			const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === action.dataSourceId);
			const element = [...runtimeDocument.querySelectorAll("[data-builder-element-id]")].find((candidate) => candidate.dataset.builderElementId === action.elementId);
			if (!source || source.type !== "supabase" || !element) continue;
			element.setAttribute("aria-busy", "true");
			try {
				const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
				url.searchParams.set("select", "*");
				url.searchParams.set(action.ownerField, `eq.${userId}`);
				url.searchParams.set("limit", "1");
				const response = await runtimeWindow.fetch(url.href, { headers: {
					apikey: source.publishableKey,
					Authorization: `Bearer ${session.access_token}`
				} });
				if (!response.ok) throw new Error("No se pudieron cargar tus datos.");
				const records = await response.json();
				if (Array.isArray(records) && records[0] && typeof records[0] === "object") {
					fillDataActionForm(action, element, records[0]);
				}
			} catch (cause) {
				setDataActionStatus(element, cause instanceof Error ? cause.message : "No se pudieron cargar tus datos.", true);
			} finally {
				element.removeAttribute("aria-busy");
			}
		}
	}
	async function executeDataAction(action, sourceElement) {
		const source = runtimeConfig.dataSources?.find((candidate) => candidate.id === action.dataSourceId);
		if (!source || source.type !== "supabase") {
			setDataActionStatus(sourceElement, "La colección seleccionada no está disponible.", true);
			return;
		};
		const session = await authSessionPromise;
		const userId = session?.user?.id;
		if (!session || typeof userId !== "string") {
			setDataActionStatus(sourceElement, "Inicia sesión para modificar esta información.", true);
			return;
		};
		if (action.action === "upsert" && !action.ownerField) {
			setDataActionStatus(sourceElement, "Esta colección no tiene un campo de propietario configurado.", true);
			return;
		};
		if (action.action === "set" && !action.fixedField) {
			setDataActionStatus(sourceElement, "Elige el campo que quieres cambiar.", true);
			return;
		};
		if (action.confirmMessage && !runtimeWindow.confirm(action.confirmMessage)) return;
		const recordReference = action.action === "create" || action.action === "upsert" ? undefined : dataActionRecordReference(action, sourceElement);
		const usesCurrentUserRecord = action.action === "set" && action.recordMode === "current_user";
		const recordId = usesCurrentUserRecord ? undefined : recordReference?.recordId;
		if (!usesCurrentUserRecord && recordReference?.dataSourceId && recordReference.dataSourceId !== action.dataSourceId) {
			setDataActionStatus(sourceElement, "El registro actual pertenece a otra colección.", true);
			return;
		};
		if (usesCurrentUserRecord && !action.ownerField) {
			setDataActionStatus(sourceElement, "Esta acción necesita el campo de la persona conectada.", true);
			return;
		};
		if (action.action !== "create" && action.action !== "upsert" && !recordId && !usesCurrentUserRecord) {
			setDataActionStatus(sourceElement, "No se encontró el registro que quieres modificar.", true);
			return;
		};
		let collected;
		try {
			collected = action.action === "delete" || action.action === "set" ? undefined : dataActionValues(action, sourceElement);
		} catch (cause) {
			setDataActionStatus(sourceElement, cause instanceof Error ? cause.message : "No se pudieron leer las variables.", true);
			return;
		};
		if (action.action !== "delete" && action.action !== "set" && !collected) {
			setDataActionStatus(sourceElement, "Completa los campos requeridos.", true);
			return;
		};
		const fileChanges = {
			values: {},
			uploaded: [],
			stale: []
		};
		const wasDisabled = sourceElement.hasAttribute("disabled");
		sourceElement.setAttribute("aria-busy", "true");
		sourceElement.setAttribute("disabled", "");
		setDataActionStatus(sourceElement, action.action === "create" ? "Creando registro…" : action.action === "update" || action.action === "upsert" || action.action === "set" ? "Guardando cambios…" : "Eliminando registro…");
		try {
			if (action.action !== "delete" && action.action !== "set") {
				await uploadDataActionFiles(action, sourceElement, source, session, userId, fileChanges);
			};
			const url = new URL(`${source.projectUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(source.table)}`);
			if (recordId) url.searchParams.set("id", `eq.${recordId}`);
			if (usesCurrentUserRecord && action.ownerField) url.searchParams.set(action.ownerField, `eq.${userId}`);
			let dynamicValue;
			if (action.action === "set" && action.fixedField) {
				const valueSource = action.valueSource ?? (action.fixedValue === "$now" ? "now" : "fixed");
				if (valueSource === "fixed") dynamicValue = fixedActionValue(action.fixedValue);
				if (valueSource === "form") dynamicValue = formActionValue(sourceElement, action.valueInputName);
				if (valueSource === "current_user") dynamicValue = userId;
				if (valueSource === "now") {
					const now = new Date().toISOString();
					dynamicValue = action.fixedValue === "$today" ? now.slice(0, 10) : now;
				};
				if (valueSource === "toggle" || valueSource === "increment") {
					const lookup = new URL(url.href);
					lookup.searchParams.set("select", action.fixedField);
					lookup.searchParams.set("limit", "1");
					const currentResponse = await runtimeWindow.fetch(lookup.href, { headers: {
						apikey: source.publishableKey,
						Authorization: `Bearer ${session.access_token}`
					} });
					if (!currentResponse.ok) throw new Error("No se pudo leer el valor actual.");
					const records = await currentResponse.json();
					const current = Array.isArray(records) && records[0] && typeof records[0] === "object" ? records[0][action.fixedField] : undefined;
					if (valueSource === "toggle") {
						if (typeof current !== "boolean") throw new Error("Solo se puede alternar un campo de Sí/No.");
						dynamicValue = !current;
					} else {
						const number = typeof current === "number" ? current : Number(current);
						if (!Number.isFinite(number)) throw new Error("Solo se puede sumar o restar en un campo numérico.");
						dynamicValue = number + (action.valueAmount ?? 1);
					}
				}
			};
			const values = action.action === "set" && action.fixedField ? { [action.fixedField]: dynamicValue } : {
				...collected?.values ?? {},
				...fileChanges.values
			};
			if (action.ownerField && (action.action === "create" || action.action === "upsert")) {
				values[action.ownerField] = userId;
			};
			if (action.action !== "delete" && !Object.keys(values).length) {
				throw new Error("Conecta al menos un campo o una variable.");
			};
			if (action.action === "upsert" && action.ownerField) {
				url.searchParams.set("on_conflict", action.ownerField);
			};
			const response = await runtimeWindow.fetch(url.href, {
				method: action.action === "create" || action.action === "upsert" ? "POST" : action.action === "update" || action.action === "set" ? "PATCH" : "DELETE",
				headers: {
					apikey: source.publishableKey,
					Authorization: `Bearer ${session.access_token}`,
					"Content-Type": "application/json",
					Prefer: action.action === "upsert" ? "resolution=merge-duplicates,return=minimal" : "return=minimal"
				},
				...action.action === "delete" ? {} : { body: JSON.stringify(values) }
			});
			if (!response.ok) {
				const result = await response.json().catch(() => ({}));
				const detail = result.message ?? result.details ?? result.hint;
				throw new Error(typeof detail === "string" ? detail : "Supabase rechazó el cambio.");
			};
			if (fileChanges.stale.length) await deleteStorageFiles(source, session, fileChanges.stale);
			setDataActionStatus(sourceElement, action.successMessage);
			if (action.action === "create") collected?.form?.reset();
			if (action.action === "delete") {
				sourceElement.closest("[data-builder-repeater-instance]")?.remove();
			}
		} catch (cause) {
			if (fileChanges.uploaded.length) await deleteStorageFiles(source, session, fileChanges.uploaded);
			setDataActionStatus(sourceElement, cause instanceof Error ? cause.message : "No se pudo completar el cambio.", true);
		} finally {
			sourceElement.removeAttribute("aria-busy");
			if (!wasDisabled) sourceElement.removeAttribute("disabled");
		}
	}
	function sendMessage(connection, context) {
		const message = {
			source: "builder-navigation-runtime",
			action: connection.action,
			...connection.targetPage ? { targetPage: connection.targetPage } : {},
			...connection.url ? { url: connection.url } : {},
			...Object.keys(context).length ? { context } : {}
		};
		runtimeWindow.parent.postMessage(message, "*");
	}
	function execute(connection, sourceElement) {
		// Keep the selected record while a multi-page activity advances. A later
		// connection may add or replace context keys without losing the rest. A
		// context-free destination can explicitly discard the current record.
		const context = {
			...connection.clearContext ? {} : activeContext,
			...resolvedConnectionContext(connection, sourceElement)
		};
		if (runtimeConfig.transport === "message") {
			sendMessage(connection, context);
			return;
		};
		if (connection.action === "navigate" && connection.targetPage) {
			const targetUrl = runtimeConfig.pageUrls[connection.targetPage];
			if (targetUrl) {
				const resolvedUrl = new URL(targetUrl, runtimeWindow.location.href);
				for (const [key, value] of Object.entries(context)) {
					resolvedUrl.searchParams.set(`${contextParameterPrefix}${key}`, JSON.stringify(value));
				};
				runtimeWindow.location.assign(resolvedUrl.href);
			};
			return;
		};
		if (connection.action === "back") {
			runtimeWindow.history.back();
			return;
		};
		if (connection.action === "url" && connection.url) {
			runtimeWindow.location.assign(connection.url);
		}
	}
	function handleClick(event) {
		const eventTarget = event.target;
		let element = eventTarget && typeof eventTarget.getAttribute === "function" ? eventTarget : null;
		let connection;
		let recordToggle;
		let dataAction;
		while (element && element !== runtimeDocument.body) {
			const elementId = element.getAttribute("data-builder-element-id");
			connection = runtimeConfig.connections.find((candidate) => candidate.sourcePage === runtimeConfig.currentPage && candidate.elementId === elementId && candidate.event === "click");
			recordToggle = runtimeConfig.recordToggles?.find((candidate) => candidate.pageId === runtimeConfig.currentPage && candidate.elementId === elementId);
			dataAction = runtimeConfig.dataActions?.find((candidate) => candidate.pageId === runtimeConfig.currentPage && candidate.elementId === elementId);
			if (!connection) {
				const declaredAction = element.getAttribute("data-builder-flow-action");
				const targetPage = element.getAttribute("data-builder-flow-target") || void 0;
				const url = element.getAttribute("data-builder-flow-url") || void 0;
				if (declaredAction === "navigate" && targetPage || declaredAction === "back" || declaredAction === "url" && url) {
					connection = {
						action: declaredAction,
						elementId: elementId || "",
						event: "click",
						sourcePage: runtimeConfig.currentPage,
						...targetPage ? { targetPage } : {},
						...url ? { url } : {}
					};
				}
			}
			if (connection || recordToggle || dataAction) break;
			element = element.parentElement;
		};
		if (dataAction && element instanceof HTMLFormElement) return;
		if (!connection && !recordToggle && !dataAction) return;
		event.preventDefault();
		event.stopPropagation();
		if (recordToggle && element instanceof HTMLElement) {
			void executeRecordToggle(recordToggle, element);
			return;
		};
		if (dataAction && element instanceof HTMLElement) {
			void executeDataAction(dataAction, element);
			return;
		};
		if (connection) execute(connection, element);
	}
	runtimeDocument.addEventListener("click", handleClick, true);
	const handleSubmit = (event) => {
		const form = event.target;
		if (!(form instanceof HTMLFormElement)) return;
		const elementId = form.dataset.builderElementId;
		const action = runtimeConfig.dataActions?.find((candidate) => candidate.pageId === runtimeConfig.currentPage && candidate.elementId === elementId);
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		void executeDataAction(action, form);
	};
	runtimeDocument.addEventListener("submit", handleSubmit, true);
	installAuthControls();
	installPracticeWizards();
	installDataMutations();
	void applyAuthPageGuard().then((allowed) => {
		if (allowed) return applyRoleVisibility().then(() => applyRepeaters()).then(() => installUploadFields()).then(() => initializeRelationSelects()).then(() => applyDataBindings()).then(() => initializeCurrentUserForms()).then(() => initializeRecordToggles());
		return undefined;
	});
	return () => {
		runtimeDocument.removeEventListener("click", handleClick, true);
		runtimeDocument.removeEventListener("submit", handleSubmit, true);
		authDisposers.forEach((dispose) => dispose());
		mutationDisposers.forEach((dispose) => dispose());
		wizardDisposers.forEach((dispose) => dispose());
		dataControlDisposers.forEach((dispose) => dispose());
	};
})(window, document, '__BUILDER_RUNTIME_VALUE_STORE__');
