const createExternalFunctionRegistry = function createExternalFunctionRegistry() {
	const registrations = new Map();
	const identifier = /^[a-z][a-z0-9-]*$/;
	// Runtime limits are intentionally much larger than the manual JSON control
	// limit. They must accommodate future programmatic landmark sequences.
	const MAX_NUMERIC_LEAVES = 2e6;
	const MAX_MATRIX_ROWS = 2e4;
	const MAX_NUMBERS_PER_ROW = 2e4;
	const MAX_JSON_DEPTH = 64;
	const MAX_JSON_NODES = 21e5;
	const valueError = (type, value) => {
		if (type === "number") {
			return typeof value === "number" && Number.isFinite(value) ? undefined : "debe ser un número finito.";
		};
		if (!Array.isArray(value)) {
			if (type === "json") {
				const stack = [{
					depth: 0,
					value
				}];
				const visited = new Set();
				let nodes = 0;
				while (stack.length) {
					const current = stack.pop();
					nodes += 1;
					if (nodes > MAX_JSON_NODES) return `supera el límite de ${MAX_JSON_NODES} valores JSON.`;
					if (current.depth > MAX_JSON_DEPTH) return `supera la profundidad JSON máxima de ${MAX_JSON_DEPTH}.`;
					if (current.value === null || typeof current.value === "string" || typeof current.value === "boolean") continue;
					if (typeof current.value === "number") {
						if (!Number.isFinite(current.value)) return "debe contener solamente números finitos.";
						continue;
					};
					if (!current.value || typeof current.value !== "object") return "debe ser un valor JSON válido.";
					if (visited.has(current.value)) return "no puede contener referencias circulares.";
					visited.add(current.value);
					if (Array.isArray(current.value)) {
						for (let index = 0; index < current.value.length; index += 1) {
							if (!(index in current.value)) return "no puede contener espacios vacíos.";
							stack.push({
								depth: current.depth + 1,
								value: current.value[index]
							});
						};
						continue;
					};
					const prototype = Object.getPrototypeOf(current.value);
					if (prototype !== Object.prototype && prototype !== null) return "debe contener solamente objetos JSON simples.";
					Object.keys(current.value).forEach((key) => {
						stack.push({
							depth: current.depth + 1,
							value: current.value[key]
						});
					});
				};
				return undefined;
			};
			return type === "number[]" ? "debe ser un arreglo de números finitos." : "debe ser una matriz de números finitos.";
		};
		if (type === "json") {
			const stack = [{
				depth: 0,
				value
			}];
			const visited = new Set();
			let nodes = 0;
			while (stack.length) {
				const current = stack.pop();
				nodes += 1;
				if (nodes > MAX_JSON_NODES) return `supera el límite de ${MAX_JSON_NODES} valores JSON.`;
				if (current.depth > MAX_JSON_DEPTH) return `supera la profundidad JSON máxima de ${MAX_JSON_DEPTH}.`;
				if (current.value === null || typeof current.value === "string" || typeof current.value === "boolean") continue;
				if (typeof current.value === "number") {
					if (!Number.isFinite(current.value)) return "debe contener solamente números finitos.";
					continue;
				};
				if (!current.value || typeof current.value !== "object") return "debe ser un valor JSON válido.";
				if (visited.has(current.value)) return "no puede contener referencias circulares.";
				visited.add(current.value);
				if (Array.isArray(current.value)) {
					for (let index = 0; index < current.value.length; index += 1) {
						if (!(index in current.value)) return "no puede contener espacios vacíos.";
						stack.push({
							depth: current.depth + 1,
							value: current.value[index]
						});
					};
					continue;
				};
				const prototype = Object.getPrototypeOf(current.value);
				if (prototype !== Object.prototype && prototype !== null) return "debe contener solamente objetos JSON simples.";
				Object.keys(current.value).forEach((key) => {
					stack.push({
						depth: current.depth + 1,
						value: current.value[key]
					});
				});
			};
			return undefined;
		};
		if (type === "number[]") {
			if (value.length > MAX_NUMERIC_LEAVES) {
				return `supera el límite de ${MAX_NUMERIC_LEAVES} números.`;
			};
			for (let index = 0; index < value.length; index += 1) {
				if (!(index in value) || typeof value[index] !== "number" || !Number.isFinite(value[index])) {
					return "debe contener solamente números finitos y no puede tener espacios vacíos.";
				}
			};
			return undefined;
		};
		if (value.length > MAX_MATRIX_ROWS) {
			return `supera el límite de ${MAX_MATRIX_ROWS} filas.`;
		};
		let numericLeaves = 0;
		for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
			if (!(rowIndex in value) || !Array.isArray(value[rowIndex])) {
				return "debe contener solamente filas de números finitos.";
			};
			const row = value[rowIndex];
			if (row.length > MAX_NUMBERS_PER_ROW) {
				return `contiene una fila que supera ${MAX_NUMBERS_PER_ROW} números.`;
			};
			numericLeaves += row.length;
			if (numericLeaves > MAX_NUMERIC_LEAVES) {
				return `supera el límite total de ${MAX_NUMERIC_LEAVES} números.`;
			};
			for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
				if (!(columnIndex in row) || typeof row[columnIndex] !== "number" || !Number.isFinite(row[columnIndex])) {
					return "debe contener solamente filas de números finitos y no puede tener espacios vacíos.";
				}
			}
		};
		return undefined;
	};
	const registrationError = (metadata, implementation) => {
		if (!metadata || typeof metadata !== "object") return "La definición de la función no es válida.";
		if (typeof metadata.id !== "string" || !identifier.test(metadata.id)) {
			return "La función necesita un identificador válido.";
		};
		if (typeof metadata.name !== "string" || !metadata.name.trim()) {
			return "La función necesita un nombre.";
		};
		if (typeof metadata.description !== "string") return "La descripción de la función no es válida.";
		if (metadata.exposedFunction !== undefined && (typeof metadata.exposedFunction !== "string" || !/^[A-Za-z_$][\w$]*$/.test(metadata.exposedFunction))) {
			return "La función expuesta no es válida.";
		};
		if (metadata.source !== undefined && (typeof metadata.source !== "string" || !metadata.source.trim())) {
			return "El código fuente documentado no es válido.";
		};
		if (metadata.usage !== undefined && (typeof metadata.usage !== "string" || !metadata.usage.trim())) {
			return "El ejemplo de uso de la función no es válido.";
		};
		if (metadata.library && (typeof metadata.library !== "object" || typeof metadata.library.id !== "string" || !identifier.test(metadata.library.id) || typeof metadata.library.name !== "string" || !metadata.library.name.trim() || typeof metadata.library.description !== "string" || metadata.library.provenance !== undefined && metadata.library.provenance !== "built-in" && metadata.library.provenance !== "imported")) return "La biblioteca de origen de la función no es válida.";
		if (!Array.isArray(metadata.inputs) || !metadata.inputs.every((input) => input && typeof input === "object" && typeof input.name === "string" && identifier.test(input.name) && (input.type === "number" || input.type === "number[]" || input.type === "number[][]" || input.type === "json") && (input.defaultValue === undefined || !valueError(input.type, input.defaultValue)))) return "Las entradas de la función no son válidas.";
		if (new Set(metadata.inputs.map((input) => input.name)).size !== metadata.inputs.length) {
			return "Las entradas de la función no pueden repetirse.";
		};
		if (!metadata.output || ![
			"number",
			"number[]",
			"number[][]",
			"json"
		].includes(metadata.output.type)) {
			return "La salida de la función no es válida.";
		};
		if (typeof implementation !== "function") return "La implementación de la función no es válida.";
		if (registrations.has(metadata.id)) return `La función “${metadata.id}” ya está registrada.`;
		return undefined;
	};
	const registerFunction = (metadata, implementation) => {
		const error = registrationError(metadata, implementation);
		if (error) return {
			error,
			ok: false
		};
		registrations.set(metadata.id, {
			metadata,
			implementation
		});
		return {
			ok: true,
			value: metadata
		};
	};
	const findFunction = (id) => registrations.get(id)?.metadata;
	const executeRegisteredFunction = async (id, inputs) => {
		const registration = registrations.get(id);
		if (!registration) return {
			error: `No se encontró la función “${id}”.`,
			ok: false
		};
		const orderedInputs = [];
		for (const input of registration.metadata.inputs) {
			const value = inputs[input.name];
			const error = valueError(input.type, value);
			if (error) return {
				error: `La entrada “${input.name}” ${error}`,
				ok: false
			};
			orderedInputs.push(value);
		};
		try {
			const implementation = registration.implementation;
			const value = await implementation(...orderedInputs);
			const outputError = valueError(registration.metadata.output.type, value);
			if (outputError) return {
				error: `La salida de la función ${outputError}`,
				ok: false
			};
			return {
				ok: true,
				value
			};
		} catch (cause) {
			return {
				error: cause instanceof Error ? cause.message : "La función no pudo ejecutarse.",
				ok: false
			};
		}
	};
	return {
		executeRegisteredFunction,
		findFunction,
		registerFunction
	};
};
const installRuntimeValueStore = function installRuntimeValueStore(runtimeWindow = window, runtimeDocument = document, propertyName = __vite_ssr_import_0__.RUNTIME_VALUE_STORE_PROPERTY, eventName = __vite_ssr_import_0__.RUNTIME_VALUE_EVENT) {
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
};
const externalFunctionRegistrations = [{
    metadata: {"id":"manhattan","name":"Manhattan","description":"Manhattan distance between equally-sized numeric vectors.","inputs":[{"name":"a","type":"number[]"},{"name":"b","type":"number[]"}],"output":{"type":"number"}},
    implementation: ((a, b) => {
				if (a.length !== b.length) throw new Error("Los vectores deben tener la misma longitud.");
				let distance = 0;
				for (let index = 0; index < a.length; index += 1) distance += Math.abs(a[index] - b[index]);
				return distance;
			})
  }];
const rawJavaScriptLibraries = [{"id":"dynamic-time-warping","source":"( function() {\n  \"use strict\";\n  function DynamicTimeWarping(ts1, ts2, distanceFunction) {\n    var ser1 = ts1;\n    var ser2 = ts2;\n    var distFunc = distanceFunction;\n    var distance;\n    var matrix;\n    var path;\n    this.getDistance = function() {\n      if (distance !== undefined) return distance;\n      matrix = [];\n      for (var i = 0; i \u003c ser1.length; i++) {\n        matrix[i] = [];\n        for (var j = 0; j \u003c ser2.length; j++) {\n          var cost = Infinity;\n          if (i > 0) {\n            cost = Math.min(cost, matrix[i - 1][j]);\n            if (j > 0) {\n              cost = Math.min(cost, matrix[i - 1][j - 1]);\n              cost = Math.min(cost, matrix[i][j - 1]);\n            }\n          } else if (j > 0) cost = Math.min(cost, matrix[i][j - 1]);\n          else cost = 0;\n          matrix[i][j] = cost + distFunc(ser1[i], ser2[j]);\n        }\n      }\n      distance = matrix[ser1.length - 1][ser2.length - 1];\n      return distance;\n    };\n    this.getPath = function() {\n      if (path !== undefined) return path;\n      if (matrix === undefined) this.getDistance();\n      var i = ser1.length - 1;\n      var j = ser2.length - 1;\n      path = [[i, j]];\n      while (i > 0 || j > 0) {\n        if (i > 0 && j > 0) {\n          var up = matrix[i - 1][j];\n          var diagonal = matrix[i - 1][j - 1];\n          var left = matrix[i][j - 1];\n          if (diagonal \u003c= up && diagonal \u003c= left) { i--; j--; }\n          else if (up \u003c= left) i--;\n          else j--;\n        } else if (i > 0) i--;\n        else j--;\n        path.push([i, j]);\n      }\n      path.reverse();\n      return path;\n    };\n  }\n  var root = typeof self === \"object\" && self.self === self && self || this;\n  root.DynamicTimeWarping = DynamicTimeWarping;\n}() );","globalApis":[{"name":"DynamicTimeWarping"}]}];
(function installFunctionBlockRuntime(runtimeWindow, runtimeDocument, registrations, registryFactory, runtimeValueStoreInstaller, maxJsonCharacters, runtimeValueEventName, runtimeValueStoreProperty, functionInputSourceAttributePrefix, runtimeSourceIdAttribute, runtimeOutputIdAttribute, functionResultOutputId) {
	const registry = registryFactory();
	const registrationErrors = new Map();
	registrations.forEach((registration) => {
		const result = registry.registerFunction(registration.metadata, registration.implementation);
		if (!result.ok) registrationErrors.set(registration.metadata?.id ?? "", result.error);
	});
	const runtimeValueStore = runtimeValueStoreInstaller(runtimeWindow, runtimeDocument, runtimeValueStoreProperty, runtimeValueEventName);
	const setStatus = (root, message, isError = false) => {
		const status = root.querySelector("[data-builder-function-status]");
		if (!status) return;
		status.textContent = message;
		status.setAttribute("role", isError ? "alert" : "status");
	};
	const readInputs = (root, metadata) => {
		const controls = [...root.querySelectorAll("[data-builder-function-input]")];
		const values = {};
		for (const input of metadata.inputs) {
			const sourceKey = root.getAttribute(`${functionInputSourceAttributePrefix}${input.name}`)?.trim();
			if (sourceKey) {
				let runtimeValue;
				try {
					runtimeValue = runtimeValueStore.store.read(sourceKey);
				} catch (cause) {
					return {
						error: cause instanceof Error ? cause.message : `No se pudo copiar la entrada “${input.name}”.`,
						values
					};
				};
				if (!runtimeValue) return {
					error: `Ejecuta primero la fuente seleccionada para “${input.name}”.`,
					values
				};
				if (runtimeValue.type !== input.type) {
					return {
						error: `La fuente de “${input.name}” produce ${runtimeValue.type}, no ${input.type}.`,
						values
					};
				};
				values[input.name] = runtimeValue.value;
				continue;
			};
			if (input.type === "json") {
				return {
					error: `Selecciona una fuente de datos para “${input.name}”.`,
					values
				};
			};
			const control = controls.find((candidate) => candidate.getAttribute("data-builder-function-input") === input.name);
			if (!control) return {
				error: `Falta la entrada “${input.name}”.`,
				values
			};
			const editableControl = control;
			if (input.type === "number") {
				const value = editableControl.value.trim() === "" ? Number.NaN : Number(editableControl.value);
				if (!Number.isFinite(value)) return {
					error: `La entrada “${input.name}” debe ser un número válido.`,
					values
				};
				values[input.name] = value;
			} else {
				const rawSource = editableControl.value;
				if (rawSource.length > maxJsonCharacters) {
					return {
						error: `La entrada “${input.name}” supera el límite manual de ${maxJsonCharacters} caracteres.`,
						values
					};
				};
				const source = rawSource.trim();
				try {
					values[input.name] = JSON.parse(source);
				} catch {
					return {
						error: `La entrada “${input.name}” debe contener JSON válido.`,
						values
					};
				}
			}
		};
		return { values };
	};
	const execute = async (root) => {
		const functionId = root.getAttribute("data-builder-function-id")?.trim() ?? "";
		const registrationError = registrationErrors.get(functionId);
		if (registrationError) {
			setStatus(root, registrationError, true);
			return;
		};
		const metadata = registry.findFunction(functionId);
		if (!metadata) {
			setStatus(root, `No se encontró la función “${functionId}”.`, true);
			return;
		};
		const inputs = readInputs(root, metadata);
		if (inputs.error) {
			setStatus(root, inputs.error, true);
			return;
		};
		const result = await registry.executeRegisteredFunction(functionId, inputs.values);
		if (!result.ok) {
			setStatus(root, result.error, true);
			return;
		};
		const sourceId = root.getAttribute(runtimeSourceIdAttribute)?.trim();
		if (sourceId) {
			runtimeValueStore.store.publish({
				sourceId,
				outputId: root.getAttribute(runtimeOutputIdAttribute)?.trim() || functionResultOutputId,
				type: metadata.output.type,
				value: result.value
			});
		};
		const output = root.querySelector("[data-builder-function-output]");
		const displayValue = metadata.output.type === "number" ? String(result.value) : JSON.stringify(result.value);
		if (displayValue.length > maxJsonCharacters) {
			if (output) output.textContent = "Resultado disponible para otra función.";
			setStatus(root, `Función ejecutada. El resultado supera el límite gráfico de ${maxJsonCharacters} caracteres.`);
			return;
		};
		if (output) output.textContent = displayValue;
		setStatus(root, "Función ejecutada correctamente.");
	};
	const handleSubmit = (event) => {
		const target = event.target;
		if (!target || typeof target.hasAttribute !== "function") return;
		const root = target;
		if (root.tagName !== "FORM" || !root.hasAttribute("data-builder-function-id")) return;
		event.preventDefault();
		event.stopPropagation();
		void execute(root);
	};
	runtimeDocument.addEventListener("submit", handleSubmit, true);
	return () => {
		runtimeDocument.removeEventListener("submit", handleSubmit, true);
		runtimeValueStore.dispose();
	};
})(window, document, externalFunctionRegistrations, createExternalFunctionRegistry, installRuntimeValueStore, 200000, "builder:runtime-value", "__BUILDER_RUNTIME_VALUE_STORE__", "data-builder-function-source-", "data-builder-runtime-source-id", "data-builder-runtime-output-id", "result");
(function installJsLabRuntime(runtimeWindow, runtimeDocument, registrations, rawLibraries, registryFactory, runtimeValueStoreInstaller, maxCodeCharacters, runtimeValueStoreProperty, runtimeValueEventName, identifierFactory, runtimeSourceIdAttribute, runtimeOutputIdAttribute, runtimeSourceNameAttribute, runtimeOutputNameAttribute, runtimeOutputTypeAttribute, functionResultOutputId, declaredVariableNames) {
	const runtimeValueStore = runtimeValueStoreInstaller(runtimeWindow, runtimeDocument, runtimeValueStoreProperty, runtimeValueEventName);
	const functionBindings = registrations.map((registration) => ({
		implementation: registration.implementation,
		name: identifierFactory(registration.metadata.id, "externalFunction")
	}));
	const rawBindings = [];
	const rawLibraryErrors = [];
	rawLibraries.forEach((library) => {
		try {
			const loader = Function(library.source);
			loader.call(runtimeWindow);
			library.globalApis.forEach((api) => {
				const value = runtimeWindow[api.name];
				if (value === undefined) throw new Error(`no expuso “${api.name}”`);
				rawBindings.push({
					name: api.name,
					value
				});
			});
		} catch (cause) {
			rawLibraryErrors.push(`${library.id}: ${cause instanceof Error ? cause.message : "no se pudo cargar"}`);
		}
	});
	const allBindingNames = [...functionBindings.map((binding) => binding.name), ...rawBindings.map((binding) => binding.name)];
	const duplicateFunctionName = allBindingNames.find((name, index) => allBindingNames.indexOf(name) !== index);
	const setStatus = (root, message, isError = false) => {
		const status = root.querySelector("[data-builder-js-lab-status]");
		if (!status) return;
		status.textContent = message;
		status.setAttribute("role", isError ? "alert" : "status");
	};
	const initialize = (root) => {
		const code = root.getAttribute("data-builder-js-lab-code") ?? "";
		const codeEditor = root.querySelector("[data-builder-js-lab-code-editor]");
		if (codeEditor) codeEditor.value = code;
		renderVariables(root);
	};
	const runtimeSourcesFor = (root) => {
		const sources = [];
		const aliases = new Set();
		runtimeDocument.querySelectorAll(`[${runtimeSourceIdAttribute}][${runtimeOutputIdAttribute}]`).forEach((producer) => {
			if (producer === root) return;
			const sourceId = producer.getAttribute(runtimeSourceIdAttribute)?.trim();
			const outputId = producer.getAttribute(runtimeOutputIdAttribute)?.trim();
			if (!sourceId || !outputId) return;
			const sourceName = producer.getAttribute(runtimeSourceNameAttribute) || producer.getAttribute(runtimeOutputNameAttribute) || outputId;
			const baseAlias = identifierFactory(sourceName, "runtimeValue");
			let alias = baseAlias;
			let suffix = 2;
			while (aliases.has(alias)) {
				alias = `${baseAlias}${suffix}`;
				suffix += 1;
			};
			aliases.add(alias);
			const stored = runtimeValueStore.store.read(`${sourceId}::${outputId}`);
			sources.push({
				alias,
				...stored ? { stored: {
					type: stored.type,
					value: stored.value
				} } : {},
				type: producer.getAttribute(runtimeOutputTypeAttribute) || stored?.type || "json"
			});
		});
		return sources;
	};
	const runtimeValuesFor = (root) => Object.fromEntries(runtimeSourcesFor(root).flatMap((source) => source.stored ? [[source.alias, source.stored.value]] : []));
	const valueType = (value) => {
		if (typeof value === "number") return "number";
		if (Array.isArray(value)) {
			if (value.every((item) => typeof item === "number")) return "number[]";
			if (value.every((item) => Array.isArray(item))) return "number[][]";
		};
		return "json";
	};
	const valuePreview = (value) => {
		if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
		if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
		if (Array.isArray(value)) {
			if (value.length <= 6 && !value.some(Array.isArray)) return JSON.stringify(value);
			if (value.every(Array.isArray)) {
				const width = value[0]?.length ?? 0;
				return `${value.length} fila(s) × ${width} valor(es)`;
			};
			return `${value.length} valor(es)`;
		};
		if (value && typeof value === "object") return `${Object.keys(value).length} campo(s)`;
		return "No compatible";
	};
	function renderVariables(root) {
		const body = root.querySelector("[data-builder-js-lab-variable-rows]");
		if (!body) return;
		body.replaceChildren();
		const rows = runtimeSourcesFor(root).map((source) => ({
			name: `runtimeValues.${source.alias}`,
			status: source.stored ? valuePreview(source.stored.value) : "Esperando datos…",
			type: source.type
		}));
		const sourceId = root.getAttribute(runtimeSourceIdAttribute)?.trim();
		const outputId = root.getAttribute(runtimeOutputIdAttribute)?.trim() || functionResultOutputId;
		const published = sourceId ? runtimeValueStore.store.read(`${sourceId}::${outputId}`)?.value : undefined;
		if (published && typeof published === "object" && !Array.isArray(published)) {
			Object.entries(published).forEach(([name, value]) => rows.push({
				name,
				status: valuePreview(value),
				type: valueType(value)
			}));
		};
		if (!rows.length) rows.push({
			name: "—",
			status: "Ejecuta o analiza datos para ver variables.",
			type: "—"
		});
		rows.forEach((row) => {
			const tableRow = runtimeDocument.createElement("tr");
			[
				row.name,
				row.type,
				row.status
			].forEach((text, index) => {
				const cell = runtimeDocument.createElement("td");
				cell.textContent = text;
				cell.style.padding = ".48rem .4rem";
				cell.style.borderBottom = "1px solid #202a34";
				if (index === 2 && text === "Esperando datos…") cell.style.color = "#d7a95b";
				tableRow.append(cell);
			});
			body.append(tableRow);
		});
	}
	const execute = async (root) => {
		if (rawLibraryErrors.length) {
			setStatus(root, `No se pudo cargar una biblioteca global: ${rawLibraryErrors[0]}.`, true);
			return;
		};
		if (duplicateFunctionName) {
			setStatus(root, `Dos funciones producen el mismo nombre JavaScript: ${duplicateFunctionName}.`, true);
			return;
		};
		const codeEditor = root.querySelector("[data-builder-js-lab-code-editor]");
		const code = codeEditor?.value ?? root.getAttribute("data-builder-js-lab-code") ?? "";
		if (!code.trim()) {
			setStatus(root, "JS Lab necesita código JavaScript.", true);
			return;
		};
		if (code.length > maxCodeCharacters) {
			setStatus(root, `El código supera el límite de ${maxCodeCharacters} caracteres.`, true);
			return;
		};
		const variableNames = declaredVariableNames(code);
		if (!variableNames.length) {
			setStatus(root, "Declara al menos una variable con let, const o var para publicarla.", true);
			return;
		};
		try {
			const AsyncFunction = Object.getPrototypeOf(async function() {/* runtime constructor */}).constructor;
			const runtimeValues = runtimeValuesFor(root);
			const runner = new AsyncFunction(...functionBindings.map((binding) => binding.name), ...rawBindings.map((binding) => binding.name), "runtimeValues", `"use strict";\n${code}\nreturn Object.fromEntries([${variableNames.map((name) => `[${JSON.stringify(name)}, typeof ${name} === "undefined" ? undefined : ${name}]`).join(",")}].filter((entry) => entry[1] !== undefined));`);
			const value = await runner(...functionBindings.map((binding) => binding.implementation), ...rawBindings.map((binding) => binding.value), runtimeValues);
			const validator = registryFactory();
			const validation = validator.registerFunction({
				description: "Validates a JS Lab result.",
				id: "js-lab-result-validator",
				inputs: [{
					name: "value",
					type: "json"
				}],
				name: "JS Lab result validator",
				output: { type: "json" }
			}, (candidate) => candidate);
			if (!validation.ok) {
				setStatus(root, validation.error, true);
				return;
			};
			const validatedVariables = {};
			for (const [name, candidate] of Object.entries(value)) {
				if (typeof candidate === "function") {
					setStatus(root, `La variable “${name}” contiene una función. Llámala con paréntesis, por ejemplo nombreFuncion(...), para publicar su resultado.`, true);
					return;
				};
				const validated = await validator.executeRegisteredFunction("js-lab-result-validator", { value: candidate });
				if (!validated.ok) {
					const detail = validated.error.replace(/^La entrada “value”\s*/, "");
					setStatus(root, `La variable “${name}” ${detail}`, true);
					return;
				};
				validatedVariables[name] = validated.value;
			};
			const sourceId = root.getAttribute(runtimeSourceIdAttribute)?.trim();
			if (sourceId) {
				runtimeValueStore.store.publish({
					sourceId,
					outputId: root.getAttribute(runtimeOutputIdAttribute)?.trim() || functionResultOutputId,
					type: "json",
					value: validatedVariables
				});
			};
			const output = root.querySelector("[data-builder-js-lab-result]");
			const display = JSON.stringify(validatedVariables, null, 2);
			if (output) output.textContent = display.length > 2e5 ? "Resultado publicado; es demasiado grande para mostrarlo aquí." : display;
			setStatus(root, `${Object.keys(validatedVariables).length} variable(s) publicada(s).`);
		} catch (cause) {
			setStatus(root, cause instanceof Error ? cause.message : "JS Lab no pudo ejecutarse.", true);
		}
	};
	const handleClick = (event) => {
		const target = event.target;
		const button = target?.closest?.("[data-builder-js-lab-run]");
		const root = button?.closest("[data-builder-js-lab]");
		if (!button || !root) return;
		event.preventDefault();
		void execute(root);
	};
	const handleInput = (event) => {
		const target = event.target;
		const root = target?.closest?.("[data-builder-js-lab]");
		if (!target || !root) return;
		if (target.hasAttribute("data-builder-js-lab-code-editor")) {
			root.setAttribute("data-builder-js-lab-code", target.value);
		}
	};
	const handleRuntimeValue = () => {
		runtimeDocument.querySelectorAll("[data-builder-js-lab]").forEach(renderVariables);
	};
	runtimeDocument.querySelectorAll("[data-builder-js-lab]").forEach(initialize);
	runtimeDocument.addEventListener("click", handleClick, true);
	runtimeDocument.addEventListener("input", handleInput, true);
	runtimeDocument.addEventListener("change", handleInput, true);
	runtimeDocument.addEventListener(runtimeValueEventName, handleRuntimeValue);
	return () => {
		runtimeDocument.removeEventListener("click", handleClick, true);
		runtimeDocument.removeEventListener("input", handleInput, true);
		runtimeDocument.removeEventListener("change", handleInput, true);
		runtimeDocument.removeEventListener(runtimeValueEventName, handleRuntimeValue);
		runtimeValueStore.dispose();
	};
})(window, document, externalFunctionRegistrations, rawJavaScriptLibraries, createExternalFunctionRegistry, installRuntimeValueStore, 100000, "__BUILDER_RUNTIME_VALUE_STORE__", "builder:runtime-value", function javascriptIdentifier(value, fallback = "value") {
	const words = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_$]+/g, " ").trim().split(/\s+/).filter(Boolean);
	const joined = words.map((word, index) => index === 0 ? `${word.slice(0, 1).toLowerCase()}${word.slice(1)}` : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join("") || fallback;
	const prefixed = /^[A-Za-z_$]/.test(joined) ? joined : `value${joined}`;
	return /^(?:await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|function|if|import|in|instanceof|let|new|null|return|static|super|switch|this|throw|true|try|typeof|var|void|while|with|yield)$/.test(prefixed) ? `value${prefixed.slice(0, 1).toUpperCase()}${prefixed.slice(1)}` : prefixed;
}, "data-builder-runtime-source-id", "data-builder-runtime-output-id", "data-builder-runtime-source-name", "data-builder-runtime-output-name", "data-builder-runtime-output-type", "result", function jsLabDeclaredVariableNames(code) {
	const names = [];
	const declaration = /(?:^|[;\n\r])\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*(?==|;|,|\n|\r|$)/g;
	let match;
	while (match = declaration.exec(code)) {
		if (!names.includes(match[1])) names.push(match[1]);
	};
	return names;
});