(function installPythonLabRuntime(runtimeWindow, runtimeDocument, workerSource, maxCodeCharacters, timeoutMs, runtimeValueStoreProperty, runtimeValueEventName, runtimeSourceIdAttribute, runtimeOutputIdAttribute) {
	const config = runtimeWindow.__BUILDER_PYTHON_LAB__;
	if (!config) return () => undefined;
	const store = runtimeWindow[runtimeValueStoreProperty];
	const workers = new Map();
	const setStatus = (root, message, error = false) => {
		const status = root.querySelector("[data-builder-python-lab-status]");
		if (status) {
			status.textContent = message;
			status.setAttribute("role", error ? "alert" : "status");
		}
	};
	const preview = (value) => Array.isArray(value) ? `${value.length} valor(es)` : value && typeof value === "object" ? `${Object.keys(value).length} campo(s)` : String(value);
	const renderVariables = (root) => {
		const body = root.querySelector("[data-builder-python-lab-variable-rows]");
		if (!body || !store) return;
		const rows = [];
		runtimeDocument.querySelectorAll(`[${runtimeSourceIdAttribute}][${runtimeOutputIdAttribute}]`).forEach((producer) => {
			if (producer === root) return;
			const sourceId = producer.getAttribute(runtimeSourceIdAttribute);
			const outputId = producer.getAttribute(runtimeOutputIdAttribute);
			if (!sourceId || !outputId) return;
			const stored = store.read(`${sourceId}::${outputId}`);
			rows.push([
				`runtime_values[${JSON.stringify(outputId)}]`,
				stored?.type ?? "json",
				stored ? preview(stored.value) : "Esperando datos…"
			]);
		});
		const sourceId = root.getAttribute(runtimeSourceIdAttribute);
		const outputId = root.getAttribute(runtimeOutputIdAttribute) || "variables";
		const published = sourceId ? store.read(`${sourceId}::${outputId}`)?.value : undefined;
		if (published && typeof published === "object" && !Array.isArray(published)) {
			Object.entries(published).forEach(([name, value]) => rows.push([
				name,
				Array.isArray(value) ? "array" : typeof value,
				preview(value)
			]));
		};
		body.replaceChildren();
		(rows.length ? rows : [[
			"—",
			"—",
			"Ejecuta o analiza datos para ver variables."
		]]).forEach((row) => {
			const tr = runtimeDocument.createElement("tr");
			row.forEach((text) => {
				const td = runtimeDocument.createElement("td");
				td.textContent = text;
				td.style.padding = ".48rem .4rem";
				tr.append(td);
			});
			body.append(tr);
		});
	};
	const runtimeValuesFor = (root) => {
		if (!store) return {};
		const values = {};
		runtimeDocument.querySelectorAll(`[${runtimeSourceIdAttribute}][${runtimeOutputIdAttribute}]`).forEach((producer) => {
			if (producer === root) return;
			const sourceId = producer.getAttribute(runtimeSourceIdAttribute);
			const outputId = producer.getAttribute(runtimeOutputIdAttribute);
			if (!sourceId || !outputId) return;
			const stored = store.read(`${sourceId}::${outputId}`);
			if (stored) values[outputId] = stored.value;
		});
		return values;
	};
	const setRunButton = (root, label, disabled) => {
		const button = root.querySelector("[data-builder-python-lab-run]");
		if (!button) return;
		button.textContent = label;
		button.disabled = disabled;
	};
	const disposeWorker = (root) => {
		const active = workers.get(root);
		active?.worker.terminate();
		if (active?.timer !== undefined) runtimeWindow.clearTimeout(active.timer);
		if (active) URL.revokeObjectURL(active.url);
		workers.delete(root);
	};
	const prepare = (root, announce = true) => {
		if (workers.has(root)) return;
		const blob = new Blob([workerSource], { type: "text/javascript" });
		const workerUrl = URL.createObjectURL(blob);
		const worker = new Worker(workerUrl, { type: "module" });
		const state = {
			announce,
			ready: false,
			running: false,
			url: workerUrl,
			worker
		};
		workers.set(root, state);
		setRunButton(root, "Preparando Python…", true);
		root.querySelector("[data-builder-python-lab-cancel]")?.removeAttribute("hidden");
		if (announce) setStatus(root, "Iniciando Python y NumPy…");
		worker.onmessage = (event) => {
			const active = workers.get(root);
			if (!active || active.worker !== worker) return;
			if (event.data.kind === "status") {
				if (event.data.message === "Ejecutando Python…") {
					if (active.timer !== undefined) runtimeWindow.clearTimeout(active.timer);
					active.timer = runtimeWindow.setTimeout(() => stop(root, "El código Python excedió el límite de ejecución de 30 segundos."), timeoutMs);
				};
				if (active.announce || active.running) setStatus(root, event.data.message ?? "");
				return;
			};
			if (event.data.kind === "ready") {
				active.ready = true;
				setRunButton(root, "Ejecutar Python Lab →", false);
				root.querySelector("[data-builder-python-lab-cancel]")?.setAttribute("hidden", "");
				if (active.announce) setStatus(root, "Python y NumPy listos.");
				return;
			};
			if (active.timer !== undefined) runtimeWindow.clearTimeout(active.timer);
			const wasRunning = active.running;
			disposeWorker(root);
			setRunButton(root, "Ejecutar Python Lab →", false);
			root.querySelector("[data-builder-python-lab-cancel]")?.setAttribute("hidden", "");
			if (event.data.kind === "error") {
				setStatus(root, event.data.message ?? "Python no pudo ejecutarse.", true);
			} else if (wasRunning) {
				const sourceId = root.getAttribute(runtimeSourceIdAttribute);
				if (sourceId && store) store.publish({
					sourceId,
					outputId: root.getAttribute(runtimeOutputIdAttribute) || "variables",
					type: "json",
					value: event.data.value
				});
				renderVariables(root);
				setStatus(root, "Variables Python publicadas.");
			};
			if (wasRunning) prepare(root, false);
		};
		worker.postMessage({
			action: "prepare",
			assetsBase: config.assetsBase
		});
	};
	const stop = (root, message = "Ejecución cancelada.") => {
		disposeWorker(root);
		root.querySelector("[data-builder-python-lab-cancel]")?.setAttribute("hidden", "");
		setRunButton(root, "Preparar Python", false);
		setStatus(root, message);
	};
	const execute = (root) => {
		const editor = root.querySelector("[data-builder-python-lab-code-editor]");
		const code = editor?.value ?? root.getAttribute("data-builder-python-lab-code") ?? "";
		if (!code.trim()) return setStatus(root, "Python Lab necesita código.", true);
		if (code.length > maxCodeCharacters) return setStatus(root, `El código supera ${maxCodeCharacters} caracteres.`, true);
		let pageLibraries = [];
		try {
			const parsed = JSON.parse(root.getAttribute("data-builder-python-lab-libraries") || "[]");
			if (Array.isArray(parsed)) pageLibraries = parsed;
		} catch {
			return setStatus(root, "Las dependencias de Python Lab están dañadas.", true);
		};
		const active = workers.get(root);
		if (!active) {
			prepare(root);
			return;
		};
		if (!active.ready) return setStatus(root, "Python y NumPy todavía se están preparando…");
		if (active.running) return;
		active.running = true;
		active.announce = true;
		setRunButton(root, "Ejecutando Python…", true);
		root.querySelector("[data-builder-python-lab-cancel]")?.removeAttribute("hidden");
		const libraries = [...config.libraries, ...pageLibraries].filter((library, index, all) => all.findIndex((candidate) => candidate.id === library.id) === index);
		active.worker.postMessage({
			action: "execute",
			assetsBase: config.assetsBase,
			code,
			libraries,
			runtimeValues: runtimeValuesFor(root)
		});
	};
	const click = (event) => {
		const target = event.target;
		const root = target?.closest("[data-builder-python-lab]");
		if (!root) return;
		if (target?.closest("[data-builder-python-lab-run]")) {
			event.preventDefault();
			execute(root);
		};
		if (target?.closest("[data-builder-python-lab-cancel]")) {
			event.preventDefault();
			stop(root);
		}
	};
	const input = (event) => {
		const target = event.target;
		const root = target?.closest("[data-builder-python-lab]");
		if (root && target?.hasAttribute("data-builder-python-lab-code-editor")) root.setAttribute("data-builder-python-lab-code", target.value);
	};
	runtimeDocument.querySelectorAll("[data-builder-python-lab]").forEach((root) => {
		const editor = root.querySelector("[data-builder-python-lab-code-editor]");
		if (editor) editor.value = root.getAttribute("data-builder-python-lab-code") ?? "";
		renderVariables(root);
		prepare(root);
	});
	runtimeDocument.addEventListener("click", click, true);
	runtimeDocument.addEventListener("input", input, true);
	runtimeDocument.addEventListener(runtimeValueEventName, () => runtimeDocument.querySelectorAll("[data-builder-python-lab]").forEach(renderVariables));
	return () => {
		runtimeDocument.removeEventListener("click", click, true);
		runtimeDocument.removeEventListener("input", input, true);
		workers.forEach(({ timer, url, worker }) => {
			if (timer !== undefined) runtimeWindow.clearTimeout(timer);
			worker.terminate();
			URL.revokeObjectURL(url);
		});
	};
})(window,document,"\nlet pyodide;\nconst postStatus = (message) => self.postMessage({ kind: \"status\", message });\nconst adapter = \"\\nimport json\\nfrom types import SimpleNamespace\\n\\ndef _builder_landmark_list(groups):\\n    points = groups[0] if isinstance(groups, list) and groups and isinstance(groups[0], list) else groups\\n    if not points:\\n        return None\\n    return SimpleNamespace(landmark=[SimpleNamespace(\\n        x=point.get(\\\"x\\\"), y=point.get(\\\"y\\\"), z=point.get(\\\"z\\\", 0)\\n    ) for point in points])\\n\\ndef _builder_video_results(frames):\\n    return [SimpleNamespace(\\n        pose_landmarks=_builder_landmark_list(frame.get(\\\"poseLandmarks\\\")),\\n        left_hand_landmarks=_builder_landmark_list(frame.get(\\\"leftHandLandmarks\\\")),\\n        right_hand_landmarks=_builder_landmark_list(frame.get(\\\"rightHandLandmarks\\\"))\\n    ) for frame in frames]\\n\\n_builder_raw_runtime_values = json.loads(__builder_runtime_values_json)\\nruntime_values = {}\\nvideo_results = []\\nfor _builder_name, _builder_value in _builder_raw_runtime_values.items():\\n    if isinstance(_builder_value, list) and (_builder_value == [] or isinstance(_builder_value[0], dict)):\\n        if _builder_value == [] or \\\"poseLandmarks\\\" in _builder_value[0]:\\n            _builder_converted = _builder_video_results(_builder_value)\\n            runtime_values[_builder_name] = _builder_converted\\n            if not video_results:\\n                video_results = _builder_converted\\n            continue\\n    runtime_values[_builder_name] = _builder_value\\n\";\nconst collect = \"\\nimport inspect as _builder_inspect\\nimport json as _builder_json\\nimport math as _builder_math\\n\\ndef _builder_jsonable(value):\\n    if hasattr(value, \\\"tolist\\\"):\\n        value = value.tolist()\\n    if value is None or isinstance(value, (str, bool)):\\n        return value\\n    if isinstance(value, (int, float)):\\n        if not _builder_math.isfinite(value):\\n            raise ValueError(\\\"Las variables contienen un número no finito.\\\")\\n        return value\\n    if isinstance(value, (list, tuple)):\\n        return [_builder_jsonable(item) for item in value]\\n    if isinstance(value, dict):\\n        return {str(key): _builder_jsonable(item) for key, item in value.items()}\\n    raise TypeError(f\\\"La variable contiene un valor no publicable: {type(value).__name__}.\\\")\\n\\n_builder_published = {}\\nfor _builder_name, _builder_value in list(globals().items()):\\n    if _builder_name.startswith(\\\"_\\\") or _builder_name in {\\\"runtime_values\\\", \\\"video_results\\\"}:\\n        continue\\n    if _builder_inspect.ismodule(_builder_value) or _builder_inspect.isfunction(_builder_value) or _builder_inspect.isclass(_builder_value):\\n        continue\\n    try:\\n        _builder_published[_builder_name] = _builder_jsonable(_builder_value)\\n    except TypeError:\\n        # Loop variables such as MediaPipe SimpleNamespace objects are useful\\n        # while executing but are not truthful JSON outputs. Publish the\\n        # student's JSON-compatible values instead of failing the whole lab.\\n        continue\\n_builder_result_json = _builder_json.dumps(_builder_published, allow_nan=False)\\n\";\nself.onmessage = async (event) => {\n  const { action, assetsBase, code, libraries = [], runtimeValues = {} } = event.data;\n  try {\n    if (!pyodide) {\n      postStatus(\"Cargando Python…\");\n      const module = await import(new URL(\"pyodide.mjs\", assetsBase).href);\n      pyodide = await module.loadPyodide({ indexURL: assetsBase });\n      postStatus(\"Cargando NumPy…\");\n      await pyodide.loadPackage(\"numpy\");\n    }\n    if (action === \"prepare\") {\n      self.postMessage({ kind: \"ready\" });\n      return;\n    }\n    libraries.forEach((library) => {\n      pyodide.FS.writeFile(\"/home/pyodide/\" + library.moduleName + \".py\", library.source);\n    });\n    pyodide.globals.set(\"__builder_runtime_values_json\", JSON.stringify(runtimeValues));\n    postStatus(\"Preparando datos…\");\n    pyodide.runPython(adapter);\n    postStatus(\"Ejecutando Python…\");\n    for (const library of libraries) {\n      await pyodide.runPythonAsync(library.source);\n    }\n    await pyodide.runPythonAsync(code);\n    postStatus(\"Publicando variables…\");\n    pyodide.runPython(collect);\n    const result = JSON.parse(pyodide.globals.get(\"_builder_result_json\"));\n    self.postMessage({ kind: \"result\", value: result });\n  } catch (error) {\n    self.postMessage({ kind: \"error\", message: error instanceof Error ? error.message : String(error) });\n  }\n};",100000,30000,"__BUILDER_RUNTIME_VALUE_STORE__","builder:runtime-value","data-builder-runtime-source-id","data-builder-runtime-output-id");