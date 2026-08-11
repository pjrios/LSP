(function installRuntimeValueStore(runtimeWindow = window, runtimeDocument = document, propertyName = __vite_ssr_import_0__.RUNTIME_VALUE_STORE_PROPERTY, eventName = __vite_ssr_import_0__.RUNTIME_VALUE_EVENT) {
	const host = runtimeWindow;
	const existing = host[propertyName];
	if (typeof existing?.publish === "function" && typeof existing.read === "function" && existing.__document === runtimeDocument) {
		return {
			dispose: () => undefined,
			store: existing
		};
	};
	const values = new Map();
	const cloneStructuredValue = (value) => {
		if (typeof runtimeWindow.structuredClone === "function") return runtimeWindow.structuredClone(value);
		const active = new Set();
		const clone = (current) => {
			if (current === null || typeof current === "string" || typeof current === "boolean") return current;
			if (typeof current === "number") {
				if (!Number.isFinite(current)) throw new Error("Los datos contienen un número no finito.");
				return current;
			};
			if (!current || typeof current !== "object") throw new Error("Los datos no son compatibles con JSON.");
			if (active.has(current)) throw new Error("Los datos contienen una referencia circular.");
			active.add(current);
			let copied;
			if (Array.isArray(current)) {
				copied = current.map((item) => clone(item));
			} else {
				const prototype = Object.getPrototypeOf(current);
				if (prototype !== Object.prototype && prototype !== null) {
					throw new Error("Los datos contienen un objeto no compatible con JSON.");
				};
				const record = {};
				Object.keys(current).forEach((key) => {
					record[key] = clone(current[key]);
				});
				copied = record;
			};
			active.delete(current);
			return copied;
		};
		return clone(value);
	};
	const validDetail = (detail) => Boolean(detail && typeof detail === "object" && typeof detail.sourceId === "string" && detail.sourceId && typeof detail.outputId === "string" && detail.outputId && [
		"number",
		"number[]",
		"number[][]",
		"json"
	].includes(detail.type));
	const retain = (detail) => {
		if (!validDetail(detail)) return false;
		values.set(`${detail.sourceId}::${detail.outputId}`, {
			outputId: detail.outputId,
			sourceId: detail.sourceId,
			type: detail.type,
			value: detail.value
		});
		return true;
	};
	const store = {
		has: (key) => values.has(key),
		list: () => [...values.values()].map(({ outputId, sourceId, type }) => ({
			outputId,
			sourceId,
			type
		})),
		publish: (detail) => {
			if (!retain(detail)) return false;
			runtimeDocument.dispatchEvent(new CustomEvent(eventName, { detail }));
			return true;
		},
		read: (key) => {
			const retained = values.get(key);
			if (!retained) return undefined;
			return {
				...retained,
				value: cloneStructuredValue(retained.value)
			};
		}
	};
	Object.defineProperty(store, "__document", { value: runtimeDocument });
	const handleLegacyPublication = (event) => {
		retain(event.detail);
	};
	Object.defineProperty(host, propertyName, {
		configurable: true,
		value: store
	});
	runtimeDocument.addEventListener(eventName, handleLegacyPublication);
	return {
		store,
		dispose: () => {
			runtimeDocument.removeEventListener(eventName, handleLegacyPublication);
			if (host[propertyName] === store) delete host[propertyName];
		}
	};
})(window, document, "__BUILDER_RUNTIME_VALUE_STORE__", "builder:runtime-value");
(function installRuntimeValueDisplays(runtimeWindow = window, runtimeDocument = document, propertyName = __vite_ssr_import_0__.RUNTIME_VALUE_STORE_PROPERTY, eventName = __vite_ssr_import_0__.RUNTIME_VALUE_EVENT) {
	const bindingAttribute = "data-builder-variable-binding";
	const labelAttribute = "data-builder-variable-label";
	const formatAttribute = "data-builder-variable-format";
	const maxAttribute = "data-builder-variable-max";
	const roots = [...runtimeDocument.querySelectorAll("[data-builder-variable-display]")];
	const store = runtimeWindow[propertyName];
	const parseBinding = (value) => {
		try {
			const parsed = JSON.parse(value);
			return typeof parsed.key === "string" && Array.isArray(parsed.path) ? {
				key: parsed.key,
				path: parsed.path.filter((part) => typeof part === "string")
			} : undefined;
		} catch {
			return undefined;
		}
	};
	const nestedValue = (value, path) => path.reduce((current, part) => current && typeof current === "object" ? current[part] : undefined, value);
	const numberText = (value) => new Intl.NumberFormat("es-PA", { maximumFractionDigits: 4 }).format(value);
	const displayText = (value, format) => {
		if (format === "number" || typeof value === "number") {
			const number = Number(value);
			return Number.isFinite(number) ? numberText(number) : "—";
		};
		if (format === "json") {
			const serialized = JSON.stringify(value, null, 2);
			return serialized && serialized.length > 1200 ? `${serialized.slice(0, 1200)}…` : serialized || "—";
		};
		if (typeof value === "string") return value;
		if (typeof value === "boolean") return value ? "Sí" : "No";
		if (Array.isArray(value)) return `${value.length} valor(es)`;
		if (value && typeof value === "object") return `${Object.keys(value).length} campo(s)`;
		return value == null ? "—" : String(value);
	};
	const render = (root) => {
		const label = root.querySelector("[data-builder-variable-display-label]");
		const output = root.querySelector("[data-builder-variable-display-value]");
		const progress = root.querySelector("[data-builder-variable-display-progress]");
		const status = root.querySelector("[data-builder-variable-display-status]");
		if (label) label.textContent = root.getAttribute(labelAttribute)?.trim() || "Variable";
		const binding = parseBinding(root.getAttribute(bindingAttribute) || "");
		if (!binding) {
			if (output) output.textContent = "Selecciona una variable";
			if (progress) progress.hidden = true;
			if (status) status.textContent = "Configura esta tarjeta en el editor.";
			return;
		};
		const stored = store?.read(binding.key);
		if (!stored) {
			if (output) output.textContent = "Esperando datos…";
			if (progress) progress.hidden = true;
			if (status) status.textContent = "La fuente todavía no ha publicado un valor.";
			return;
		};
		const value = nestedValue(stored.value, binding.path);
		const format = root.getAttribute(formatAttribute) || "auto";
		if (output) output.textContent = displayText(value, format);
		if (progress) {
			const maximum = Number(root.getAttribute(maxAttribute) || 1);
			const number = Number(value);
			progress.hidden = format !== "progress" || !Number.isFinite(number);
			progress.max = Number.isFinite(maximum) && maximum > 0 ? maximum : 1;
			progress.value = Number.isFinite(number) ? Math.max(0, number) : 0;
		};
		if (status) status.textContent = value === undefined ? "La variable seleccionada no existe en la salida." : "Actualizado en vivo.";
	};
	const renderAll = () => roots.forEach(render);
	const handleValue = () => renderAll();
	runtimeDocument.addEventListener(eventName, handleValue);
	renderAll();
	return {
		dispose: () => runtimeDocument.removeEventListener(eventName, handleValue),
		renderAll
	};
})(window, document, "__BUILDER_RUNTIME_VALUE_STORE__", "builder:runtime-value");