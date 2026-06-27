"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  start: $("start"), pause: $("pause"), stop: $("stop"),
  timer: $("timer"), status: $("status"), err: $("err"),
  stage: $("stage"), preview: $("preview"), selBox: $("selBox"),
  selHint: $("selHint"), confirmRegion: $("confirmRegion"), fullRegion: $("fullRegion"),
  dl: $("dl"), dlLink: $("dlLink"), dlSize: $("dlSize"),
  optMic: $("optMic"), optSysAudio: $("optSysAudio"),
  optCam: $("optCam"), optCamPos: $("optCamPos"), camPosWrap: $("camPosWrap"),
  optRegion: $("optRegion"), optFormat: $("optFormat"),
  optFps: $("optFps"), optQuality: $("optQuality"),
};

let recorder = null;
let chunks = [];
let displayStream = null;   // 屏幕（含可选系统音）
let micStream = null;       // 麦克风
let camStream = null;       // 摄像头
let mixedStream = null;     // 喂给 MediaRecorder 的流
let audioCtx = null;

// canvas 合成（摄像头/区域裁剪时启用）
let useCanvas = false;
let canvas = null, ctx = null, drawWorker = null;
let screenVideo = null, camVideo = null;
let crop = null;            // {x,y,w,h} 源像素

let recMime = "video/webm";
let recExt = "webm";
let lastUrl = null;
let timerId = null;
let startedAt = 0, pausedMs = 0, pauseStart = 0;

function setError(msg) { els.err.textContent = msg || ""; }

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${String(h).padStart(2, "0")}:${m}:${ss}` : `${m}:${ss}`;
}
function tick() { els.timer.textContent = fmt(Date.now() - startedAt - pausedMs); }

// 选格式 → 选可用的容器/编码。mp4 不支持时回退 webm。
function pickMime(format) {
  const try_ = (list) => list.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (format === "mp4") {
    const t = try_([
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1,opus",
      "video/mp4",
    ]);
    if (t) return { mime: t, ext: "mp4" };
    setError("当前 Chrome 不支持直接录 mp4，已回退 webm（可后续用 ffmpeg 转）。");
  }
  const w = try_([
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ]);
  return { mime: w || "video/webm", ext: "webm" };
}

// 系统音 + 麦克风混成一条轨；只有一个来源时直接用那条。
function buildAudioTrack() {
  const sys = displayStream ? displayStream.getAudioTracks() : [];
  const mic = micStream ? micStream.getAudioTracks() : [];
  if (sys.length && mic.length) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaStreamSource(new MediaStream(sys)).connect(dest);
    audioCtx.createMediaStreamSource(new MediaStream(mic)).connect(dest);
    return dest.stream.getAudioTracks()[0];
  }
  if (sys.length) return sys[0];
  if (mic.length) return mic[0];
  return null;
}

// 后台标签页里 rAF/setInterval 会被节流到 ~1fps，导致合成画面卡顿。
// 用 Worker 定时器发 tick（Worker 不受可见性节流），主线程收到就画一帧。
function makeDrawWorker(fps) {
  const code = `let id=null;onmessage=(e)=>{if(e.data.cmd==='start'){clearInterval(id);id=setInterval(()=>postMessage(0),e.data.ms);}else{clearInterval(id);id=null;}};`;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  w.postMessage({ cmd: "start", ms: Math.max(1, Math.round(1000 / fps)) });
  return w;
}

// 在 canvas 上画一帧：裁剪后的屏幕 + 角落摄像头
function drawFrame() {
  if (!ctx) return;
  ctx.drawImage(screenVideo, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  if (camVideo && camVideo.readyState >= 2 && camVideo.videoWidth) {
    const cw = canvas.width, ch = canvas.height;
    const w = Math.round(cw * 0.24);              // 摄像头宽 ≈ 画面 24%
    const ar = camVideo.videoWidth / camVideo.videoHeight;
    const h = Math.round(w / ar);
    const m = Math.round(cw * 0.02);              // 边距
    const pos = els.optCamPos.value;
    const x = pos.includes("l") ? m : cw - w - m;
    const y = pos.includes("t") ? m : ch - h - m;
    // 圆角 + 描边
    const r = 12;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(camVideo, x, y, w, h);
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.stroke();
  }
}

async function start() {
  setError("");
  els.dl.style.display = "none";
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  chunks = [];

  const fps = Number(els.optFps.value);

  // 1) 取屏幕（必须由用户手势触发）
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps } },
      audio: els.optSysAudio.checked,
    });
  } catch (e) {
    if (e && e.name === "NotAllowedError") setError("已取消选择，未开始录制。");
    else setError("无法获取屏幕：" + (e && e.message ? e.message : e));
    cleanup();
    return;
  }

  // 2) 可选摄像头 / 麦克风
  if (els.optCam.checked) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      });
    } catch (e) { setError("摄像头获取失败（将继续无摄像头）：" + (e && e.message ? e.message : e)); }
  }
  if (els.optMic.checked) {
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { setError("麦克风获取失败（将继续无麦录制）：" + (e && e.message ? e.message : e)); }
  }

  // 隐藏的源视频元素（供 canvas 取帧）
  screenVideo = document.createElement("video");
  screenVideo.muted = true; screenVideo.playsInline = true;
  screenVideo.srcObject = new MediaStream(displayStream.getVideoTracks());
  await screenVideo.play().catch(() => {});
  if (camStream) {
    camVideo = document.createElement("video");
    camVideo.muted = true; camVideo.playsInline = true;
    camVideo.srcObject = camStream;
    await camVideo.play().catch(() => {});
  }

  // 屏幕被外部「停止共享」时自动收尾
  displayStream.getVideoTracks()[0].addEventListener("ended", () => {
    if (recorder && recorder.state !== "inactive") stop();
  });

  // 默认裁剪 = 整幅
  const vw = screenVideo.videoWidth || 1920;
  const vh = screenVideo.videoHeight || 1080;
  crop = { x: 0, y: 0, w: vw, h: vh };

  // 3) 区域录制 → 先进入框选阶段，等用户确认
  if (els.optRegion.checked) {
    enterRegionSelection();
  } else {
    beginRecording(fps);
  }
}

// ---- 区域框选 ----
let selDragging = false, selStart = null, selRectCss = null;

function enterRegionSelection() {
  els.preview.srcObject = new MediaStream(displayStream.getVideoTracks());
  els.preview.style.display = "block";
  els.preview.muted = true;
  els.preview.play().catch(() => {});
  els.stage.classList.add("selecting");
  els.selHint.style.display = "flex";
  els.status.textContent = "请框选区域";
  els.start.disabled = true;

  els.stage.addEventListener("mousedown", onSelDown);
  window.addEventListener("mousemove", onSelMove);
  window.addEventListener("mouseup", onSelUp);
}

function onSelDown(e) {
  const r = els.preview.getBoundingClientRect();
  selDragging = true;
  selStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  els.selBox.style.display = "block";
  updateSelBox(selStart.x, selStart.y, 0, 0);
}
function onSelMove(e) {
  if (!selDragging) return;
  const r = els.preview.getBoundingClientRect();
  const x2 = Math.min(Math.max(e.clientX - r.left, 0), r.width);
  const y2 = Math.min(Math.max(e.clientY - r.top, 0), r.height);
  const x = Math.min(selStart.x, x2), y = Math.min(selStart.y, y2);
  updateSelBox(x, y, Math.abs(x2 - selStart.x), Math.abs(y2 - selStart.y));
}
function onSelUp() {
  if (!selDragging) return;
  selDragging = false;
  const r = els.preview.getBoundingClientRect();
  if (selRectCss && selRectCss.w > 8 && selRectCss.h > 8) {
    // CSS 像素 → 源像素
    const sx = screenVideo.videoWidth / r.width;
    const sy = screenVideo.videoHeight / r.height;
    crop = {
      x: Math.round(selRectCss.x * sx), y: Math.round(selRectCss.y * sy),
      w: Math.round(selRectCss.w * sx), h: Math.round(selRectCss.h * sy),
    };
    els.status.textContent = `已选 ${crop.w}×${crop.h}，点「确认并开始」`;
  }
}
function updateSelBox(x, y, w, h) {
  selRectCss = { x, y, w, h };
  // selBox 相对 stage 定位；preview 在 stage 内左上对齐
  els.selBox.style.left = x + "px";
  els.selBox.style.top = y + "px";
  els.selBox.style.width = w + "px";
  els.selBox.style.height = h + "px";
}
function exitRegionSelection() {
  els.stage.classList.remove("selecting");
  els.selHint.style.display = "none";
  els.selBox.style.display = "none";
  els.stage.removeEventListener("mousedown", onSelDown);
  window.removeEventListener("mousemove", onSelMove);
  window.removeEventListener("mouseup", onSelUp);
}
els.confirmRegion.addEventListener("click", () => {
  exitRegionSelection();
  beginRecording(Number(els.optFps.value));
});
els.fullRegion.addEventListener("click", () => {
  crop = { x: 0, y: 0, w: screenVideo.videoWidth, h: screenVideo.videoHeight };
  exitRegionSelection();
  beginRecording(Number(els.optFps.value));
});

// ---- 真正开始录制 ----
function beginRecording(fps) {
  useCanvas = !!camStream || els.optRegion.checked;

  if (useCanvas) {
    canvas = document.createElement("canvas");
    canvas.width = crop.w; canvas.height = crop.h;
    ctx = canvas.getContext("2d", { alpha: false });
    drawFrame();
    drawWorker = makeDrawWorker(fps);
    drawWorker.onmessage = drawFrame;
    mixedStream = canvas.captureStream(fps);
  } else {
    mixedStream = new MediaStream();
    displayStream.getVideoTracks().forEach((t) => mixedStream.addTrack(t));
  }
  const audioTrack = buildAudioTrack();
  if (audioTrack) mixedStream.addTrack(audioTrack);

  // 预览最终画面
  els.preview.srcObject = mixedStream;
  els.preview.style.display = "block";
  els.preview.muted = true;
  els.preview.controls = false;
  els.preview.play().catch(() => {});

  const picked = pickMime(els.optFormat.value);
  recMime = picked.mime; recExt = picked.ext;
  recorder = new MediaRecorder(mixedStream, {
    mimeType: recMime,
    videoBitsPerSecond: Number(els.optQuality.value),
  });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = finalize;
  recorder.start(1000);

  startedAt = Date.now(); pausedMs = 0;
  timerId = setInterval(tick, 250);
  document.title = "● 录制中 · 极简录屏";
  document.querySelector(".bar").classList.add("rec");
  const tags = [recExt.toUpperCase()];
  if (useCanvas && els.optRegion.checked) tags.push(`${crop.w}×${crop.h}`);
  if (camStream) tags.push("摄像头");
  els.status.textContent = "录制中 · " + tags.join(" · ");
  els.start.disabled = true; els.pause.disabled = false; els.stop.disabled = false;
  els.start.innerHTML = '<span class="dot"></span>录制中';
}

function togglePause() {
  if (!recorder) return;
  if (recorder.state === "recording") {
    recorder.pause();
    pauseStart = Date.now();
    clearInterval(timerId);
    if (drawWorker) drawWorker.postMessage({ cmd: "stop" });
    els.pause.textContent = "继续"; els.status.textContent = "已暂停";
  } else if (recorder.state === "paused") {
    recorder.resume();
    pausedMs += Date.now() - pauseStart;
    timerId = setInterval(tick, 250);
    if (drawWorker) drawWorker.postMessage({ cmd: "start", ms: Math.max(1, Math.round(1000 / Number(els.optFps.value))) });
    els.pause.textContent = "暂停"; els.status.textContent = "录制中";
  }
}

function stop() {
  if (!recorder || recorder.state === "inactive") return;
  recorder.stop(); // → finalize
}

function cleanup() {
  [displayStream, micStream, camStream].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  if (drawWorker) { drawWorker.postMessage({ cmd: "stop" }); drawWorker.terminate(); drawWorker = null; }
  ctx = null; canvas = null;
  displayStream = micStream = camStream = null;
  els.start.disabled = false;
}

function finalize() {
  clearInterval(timerId);
  if (drawWorker) { drawWorker.postMessage({ cmd: "stop" }); drawWorker.terminate(); drawWorker = null; }
  [displayStream, micStream, camStream].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  document.querySelector(".bar").classList.remove("rec");
  document.title = "极简录屏 · 录制台";

  const blob = new Blob(chunks, { type: recMime.split(";")[0] });
  lastUrl = URL.createObjectURL(blob);

  els.preview.srcObject = null;
  els.preview.src = lastUrl;
  els.preview.muted = false;
  els.preview.controls = true;

  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `录屏-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.${recExt}`;
  els.dlLink.href = lastUrl; els.dlLink.download = name;
  els.dlSize.textContent = `${(blob.size / 1024 / 1024).toFixed(1)} MB · ${els.timer.textContent} · ${recExt.toUpperCase()}`;
  els.dl.style.display = "flex";

  els.status.textContent = "已完成";
  els.start.disabled = false; els.pause.disabled = true; els.stop.disabled = true;
  els.pause.textContent = "暂停"; els.start.innerHTML = "● 开始录制";
  ctx = null; canvas = null; screenVideo = camVideo = null;
  displayStream = micStream = camStream = null;
  recorder = null;
}

els.start.addEventListener("click", start);
els.pause.addEventListener("click", togglePause);
els.stop.addEventListener("click", stop);
els.optCam.addEventListener("change", () => { els.camPosWrap.hidden = !els.optCam.checked; });

window.addEventListener("beforeunload", (e) => {
  if (recorder && recorder.state !== "inactive") { e.preventDefault(); e.returnValue = ""; }
});

if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
  setError("当前浏览器不支持屏幕录制（需较新版 Chrome）。");
  els.start.disabled = true;
}
