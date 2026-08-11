(function installPythonReferenceSequencePreparation(runtimeWindow, runtimeDocument) {
	const templateField = runtimeDocument.querySelector("[data-motion-template-field]");
	const form = templateField?.closest("form");
	const formStatus = form?.querySelector("[data-builder-mutation-status]");
	if (!templateField || !form) return;

	const adapterSource = `
import json
from types import SimpleNamespace

def _builder_landmark_list(groups):
    points = groups[0] if isinstance(groups, list) and groups and isinstance(groups[0], list) else groups
    if not points:
        return None
    return SimpleNamespace(landmark=[SimpleNamespace(
        x=point.get("x"), y=point.get("y"), z=point.get("z", 0)
    ) for point in points])

def _builder_video_results(frames):
    return [SimpleNamespace(
        pose_landmarks=_builder_landmark_list(frame.get("poseLandmarks")),
        left_hand_landmarks=_builder_landmark_list(frame.get("leftHandLandmarks")),
        right_hand_landmarks=_builder_landmark_list(frame.get("rightHandLandmarks"))
    ) for frame in frames]

video_results = _builder_video_results(json.loads(__builder_landmark_frames_json))
`;
	const librarySource = `
import numpy as np

def landmark_to_array(mp_landmark_list):
    """Convert a MediaPipe landmark list to a NumPy array of shape (n, 3)."""
    keypoints = []
    for landmark in mp_landmark_list.landmark:
        keypoints.append([landmark.x, landmark.y, landmark.z])
    return np.nan_to_num(keypoints)

def extract_landmarks(results):
    pose = landmark_to_array(results.pose_landmarks).reshape(99).tolist()
    left_hand = np.zeros(63).tolist()
    if results.left_hand_landmarks:
        left_hand = landmark_to_array(results.left_hand_landmarks).reshape(63).tolist()
    right_hand = np.zeros(63).tolist()
    if results.right_hand_landmarks:
        right_hand = landmark_to_array(results.right_hand_landmarks).reshape(63).tolist()
    return pose, left_hand, right_hand
`;
	const usageSource = `
pose_sequence = []
left_hand_sequence = []
right_hand_sequence = []
for results in video_results:
    pose, left_hand, right_hand = extract_landmarks(results)
    pose_sequence.append(pose)
    left_hand_sequence.append(left_hand)
    right_hand_sequence.append(right_hand)

import json as _builder_json
_builder_result_json = _builder_json.dumps({
    "pose": pose_sequence,
    "leftHand": left_hand_sequence,
    "rightHand": right_hand_sequence
}, allow_nan=False)
`;
	const workerSource = `
self.onmessage = async (event) => {
  try {
    self.postMessage({ kind: "status", message: "Cargando Python y NumPy…" });
    const module = await import(new URL("pyodide.mjs", event.data.assetsBase).href);
    const pyodide = await module.loadPyodide({ indexURL: event.data.assetsBase });
    await pyodide.loadPackage("numpy");
    pyodide.globals.set("__builder_landmark_frames_json", JSON.stringify(event.data.frames));
    self.postMessage({ kind: "status", message: "Preparando secuencias con Python…" });
    pyodide.runPython(${JSON.stringify(adapterSource)});
    await pyodide.runPythonAsync(${JSON.stringify(librarySource)});
    await pyodide.runPythonAsync(${JSON.stringify(usageSource)});
    self.postMessage({ kind: "result", value: JSON.parse(pyodide.globals.get("_builder_result_json")) });
  } catch (error) {
    self.postMessage({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  }
};`;

	let generation = 0;
	let worker;
	let workerUrl;
	const setStatus = (message, error = false) => {
		if (!formStatus) return;
		formStatus.textContent = message;
		formStatus.setAttribute("role", error ? "alert" : "status");
	};
	const validSequences = (sequences, frameCount) => {
		const valid = (frames, width) => Array.isArray(frames)
			&& frames.length === frameCount
			&& frames.every((frame) => Array.isArray(frame) && frame.length === width && frame.every(Number.isFinite));
		return valid(sequences?.pose, 99)
			&& valid(sequences?.leftHand, 63)
			&& valid(sequences?.rightHand, 63);
	};
	const dispose = () => {
		worker?.terminate();
		if (workerUrl) URL.revokeObjectURL(workerUrl);
		worker = undefined;
		workerUrl = undefined;
	};
	const prepare = () => {
		let template;
		try {
			template = templateField.value.trim() ? JSON.parse(templateField.value) : undefined;
		} catch {
			template = undefined;
		}
		if (!template) {
			templateField.dataset.motionPythonReady = "false";
			dispose();
			generation += 1;
			return;
		}
		if (validSequences(template.pythonSequences, template.landmarkFrames?.length)) {
			template.version = 4;
			delete template.frames;
			template.landmarkFrames = (template.landmarkFrames || []).map((frame) => ({
				t: frame.t,
				width: frame.width,
				height: frame.height,
				poseLandmarks: frame.poseLandmarks || [],
				leftHandLandmarks: frame.leftHandLandmarks || [],
				rightHandLandmarks: frame.rightHandLandmarks || []
			}));
			templateField.value = JSON.stringify(template);
			templateField.dataset.motionPythonReady = "true";
			return;
		}
		if (!Array.isArray(template.landmarkFrames) || !template.landmarkFrames.length) return;
		const currentGeneration = ++generation;
		templateField.dataset.motionPythonReady = "false";
		dispose();
		workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
		worker = new Worker(workerUrl, { type: "module" });
		setStatus("Landmarks listos. Preparando secuencias con Python…");
		worker.onmessage = (event) => {
			if (currentGeneration !== generation) return;
			if (event.data.kind === "status") {
				setStatus(event.data.message || "Preparando secuencias con Python…");
				return;
			}
			if (event.data.kind === "error") {
				dispose();
				setStatus(event.data.message || "Python no pudo preparar las secuencias.", true);
				return;
			}
			if (!validSequences(event.data.value, template.landmarkFrames.length)) {
				dispose();
				setStatus("Python devolvió secuencias incompletas.", true);
				return;
			}
			const latest = JSON.parse(templateField.value);
			latest.version = 4;
			delete latest.frames;
			latest.landmarkFrames = latest.landmarkFrames.map((frame) => ({
				t: frame.t,
				width: frame.width,
				height: frame.height,
				poseLandmarks: frame.poseLandmarks || [],
				leftHandLandmarks: frame.leftHandLandmarks || [],
				rightHandLandmarks: frame.rightHandLandmarks || []
			}));
			latest.pythonSequences = event.data.value;
			latest.sequenceProcessor = {
				engine: "pyodide",
				language: "python",
				library: "landmark_utils",
				version: 1
			};
			templateField.value = JSON.stringify(latest);
			templateField.dataset.motionPythonReady = "true";
			dispose();
			setStatus("Video y secuencias Python listos para guardar.");
			templateField.dispatchEvent(new Event("change", { bubbles: true }));
		};
		worker.onerror = () => {
			if (currentGeneration !== generation) return;
			dispose();
			setStatus("Python no pudo preparar las secuencias.", true);
		};
		worker.postMessage({
			assetsBase: new URL("../pyodide/", runtimeDocument.baseURI).href,
			frames: template.landmarkFrames
		});
	};
	templateField.addEventListener("input", prepare);
	form.addEventListener("submit", (event) => {
		if (templateField.value.trim() && templateField.dataset.motionPythonReady !== "true") {
			event.preventDefault();
			event.stopImmediatePropagation();
			setStatus("Espera a que Python termine de preparar las secuencias.", true);
		}
	}, true);
	prepare();
	runtimeWindow.addEventListener("pagehide", dispose, { once: true });
})(window, document);
