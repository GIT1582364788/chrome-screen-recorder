"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  start: $("start"), pause: $("pause"), stop: $("stop"),
  timer: $("timer"), status: $("status"), err: $("err"),
  stage: $("stage"), preview: $("preview"), selBox: $("selBox"), selOverlay: $("selOverlay"), drawSurface: $("drawSurface"),
  selHint: $("selHint"), confirmRegion: $("confirmRegion"), fullRegion: $("fullRegion"), cancelRegion: $("cancelRegion"),
  dl: $("dl"), dlLink: $("dlLink"), dlSize: $("dlSize"), discardRec: $("discardRec"),
  optCamOnly: $("optCamOnly"), optMic: $("optMic"), optSysAudio: $("optSysAudio"),
  optCam: $("optCam"), optCamPos: $("optCamPos"), optCamSize: $("optCamSize"), optCamShape: $("optCamShape"),
  optRegion: $("optRegion"), optDraw: $("optDraw"), optFormat: $("optFormat"),
  optHotInsert: $("optHotInsert"), optCountdown: $("optCountdown"),
  optFps: $("optFps"), optQuality: $("optQuality"),
  countdown: $("countdown"), countNum: $("countNum"),
  sysAudioWrap: $("sysAudioWrap"), camWrap: $("camWrap"), regionWrap: $("regionWrap"),
  camPosWrap: $("camPosWrap"), camSizeWrap: $("camSizeWrap"), camShapeWrap: $("camShapeWrap"),
  drawTools: $("drawTools"), penToggle: $("penToggle"), penSize: $("penSize"),
  undoStroke: $("undoStroke"), clearStrokes: $("clearStrokes"), langToggle: $("langToggle"),
};

// 语言切换
function applyLang() { applyI18n(); els.langToggle.textContent = t("lang_switch"); }
els.langToggle.addEventListener("click", () => { setLang(getLang() === "zh" ? "en" : "zh"); applyLang(); });
applyLang();

let recorder = null, chunks = [];
let displayStream = null, micStream = null, camStream = null, mixedStream = null, audioCtx = null;

let useCanvas = false, isCamOnly = false;
let canvas = null, ctx = null, drawWorker = null;
let screenVideo = null, camVideo = null;
let crop = null;                       // 源像素 {x,y,w,h}

// 画笔
let strokes = [], curStroke = null, penOn = true, penColor = "#ff3b30", penWidth = 4;
let dsCtx = null;                      // drawSurface 2D 上下文

let recMime = "video/webm", recExt = "webm";
let lastUrl = null, timerId = null, startedAt = 0, pausedMs = 0, pauseStart = 0;
let recordedBytes = 0, warnedBig = false, recStatusBase = "";

const setError = (m) => { els.err.textContent = m || ""; };
// 编码器（尤其 H.264/mp4）要求宽高为偶数，且至少 2
const even = (n) => Math.max(2, Math.floor(n) & ~1);
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${String(h).padStart(2, "0")}:${m}:${ss}` : `${m}:${ss}`;
}
function tick() {
  els.timer.textContent = fmt(Date.now() - startedAt - pausedMs);
  if (recStatusBase) {
    const mb = recordedBytes / 1024 / 1024;
    els.status.textContent = recStatusBase + ` · ${mb < 1024 ? mb.toFixed(0) + "MB" : (mb / 1024).toFixed(1) + "GB"}`;
    // 录像全在内存里，超大/超长时一次性提醒，避免页面崩溃
    if (!warnedBig && (recordedBytes > 3 * 1024 ** 3 || Date.now() - startedAt - pausedMs > 60 * 60 * 1000)) {
      warnedBig = true;
      setError(t("err_big_warn"));
    }
  }
}

// 选项可见性联动
function refreshOpts() {
  const camOnly = els.optCamOnly.checked;
  els.sysAudioWrap.hidden = camOnly;
  els.camWrap.hidden = camOnly;
  els.regionWrap.hidden = camOnly;
  const showCamSub = !camOnly && els.optCam.checked;
  els.camPosWrap.hidden = !showCamSub;
  els.camSizeWrap.hidden = !showCamSub;
  els.camShapeWrap.hidden = !showCamSub;
}
els.optCamOnly.addEventListener("change", refreshOpts);

// 摄像头中途热插拔：录制中勾上当场申请并开始画，取消则停止释放（关指示灯）
let camBusy = false;
async function onCamToggle() {
  refreshOpts();
  if (!recorder || isCamOnly || camBusy) return;
  if (els.optCam.checked && !useCanvas) { // 直通录制无 canvas，无法中途叠加
    setError(t("err_no_hotinsert"));
    els.optCam.checked = false; refreshOpts(); return;
  }
  if (els.optCam.checked) {
    if (camStream) return;
    camBusy = true;
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      camVideo = mkVideo(camStream);
      await camVideo.play().catch(() => {});
    } catch (e) {
      setError(t("err_get_cam", e && e.message ? e.message : e));
      els.optCam.checked = false; refreshOpts();
    } finally { camBusy = false; }
  } else if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null; camVideo = null;
  }
}
els.optCam.addEventListener("change", onCamToggle);

function pickMime(format) {
  const find = (l) => l.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (format === "mp4") {
    const t = find(["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,opus", "video/mp4"]);
    if (t) return { mime: t, ext: "mp4" };
    setError(window.t("err_mp4_fallback"));
  }
  const w = find(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]);
  return { mime: w || "video/webm", ext: "webm" };
}

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

// 后台标签页 rAF/setInterval 被节流到 ~1fps，用 Worker 定时器驱动绘制
function makeDrawWorker(fps) {
  const code = `let id=null;onmessage=(e)=>{if(e.data.cmd==='start'){clearInterval(id);id=setInterval(()=>postMessage(0),e.data.ms);}else{clearInterval(id);id=null;}};`;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  w.postMessage({ cmd: "start", ms: Math.max(1, Math.round(1000 / fps)) });
  return w;
}

// cover 方式把视频铺满目标矩形（居中裁剪）
function drawCover(c, img, dx, dy, dw, dh) {
  const iw = img.videoWidth, ih = img.videoHeight;
  if (!iw || !ih) return;
  const ir = iw / ih, dr = dw / dh;
  let sw, sh, sx, sy;
  if (ir > dr) { sh = ih; sw = sh * dr; sx = (iw - sw) / 2; sy = 0; }
  else { sw = iw; sh = sw / dr; sx = 0; sy = (ih - sh) / 2; }
  c.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function roundedPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 摄像头画中画（自定义大小/形状）
function drawCamPiP() {
  if (!camVideo || camVideo.readyState < 2 || !camVideo.videoWidth) return;
  const cw = canvas.width, ch = canvas.height;
  const f = Number(els.optCamSize.value);
  const shape = els.optCamShape.value;
  const m = Math.round(cw * 0.02);
  let w, h;
  if (shape === "circle") { w = h = Math.round(cw * f); }
  else { w = Math.round(cw * f); h = Math.round(w / (camVideo.videoWidth / camVideo.videoHeight)); }
  const pos = els.optCamPos.value;
  const x = pos.includes("l") ? m : cw - w - m;
  const y = pos.includes("t") ? m : ch - h - m;

  ctx.save();
  if (shape === "circle") { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); ctx.closePath(); }
  else if (shape === "round") roundedPath(ctx, x, y, w, h, 12);
  else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  ctx.clip();
  drawCover(ctx, camVideo, x, y, w, h);
  ctx.restore();

  ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,.85)";
  if (shape === "circle") { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); ctx.stroke(); }
  else if (shape === "round") { roundedPath(ctx, x, y, w, h, 12); ctx.stroke(); }
  else ctx.strokeRect(x, y, w, h);
}

// 把画笔描线画到上下文（sx/sy：源坐标 → 目标像素的缩放）
function paintStrokes(c, sx, sy) {
  c.lineCap = "round"; c.lineJoin = "round";
  for (const st of strokes.concat(curStroke ? [curStroke] : [])) {
    if (st.points.length < 1) continue;
    c.strokeStyle = st.color; c.lineWidth = st.size * sx;
    c.beginPath();
    st.points.forEach((p, i) => i ? c.lineTo(p.x * sx, p.y * sy) : c.moveTo(p.x * sx, p.y * sy));
    if (st.points.length === 1) { const p = st.points[0]; c.lineTo(p.x * sx + 0.1, p.y * sy); }
    c.stroke();
  }
}

// 录像 canvas 一帧
function drawFrame() {
  if (!ctx) return;
  if (isCamOnly) drawCover(ctx, camVideo, 0, 0, canvas.width, canvas.height);
  else {
    ctx.drawImage(screenVideo, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    if (camStream && els.optCam.checked) drawCamPiP(); // 跟随复选框实时开关
  }
  if (els.optDraw.checked && strokes.length) paintStrokes(ctx, 1, 1); // strokes 存源坐标
}

// drawSurface 即时反馈（与录像同步，但用显示尺寸缩放）
function repaintSurface() {
  if (!dsCtx) return;
  dsCtx.clearRect(0, 0, els.drawSurface.width, els.drawSurface.height);
  if (!canvas) return;
  const sx = els.drawSurface.width / canvas.width, sy = els.drawSurface.height / canvas.height;
  paintStrokes(dsCtx, sx, sy);
}

async function start() {
  setError("");
  els.dl.style.display = "none";
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  chunks = []; strokes = []; curStroke = null;
  recordedBytes = 0; warnedBig = false; recStatusBase = "";
  const fps = Number(els.optFps.value);
  isCamOnly = els.optCamOnly.checked;

  // 仅录摄像头
  if (isCamOnly) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: fps } }, audio: false,
      });
    } catch (e) { setError(t("err_get_cam", e && e.message ? e.message : e)); cleanup(); return; }
    if (els.optMic.checked) {
      try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { setError(t("err_get_mic_continue", e && e.message ? e.message : e)); }
    }
    camVideo = mkVideo(camStream);
    await camVideo.play().catch(() => {});
    crop = null;
    beginWithCountdown(fps);
    return;
  }

  // 取屏幕
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps } }, audio: els.optSysAudio.checked,
    });
  } catch (e) {
    if (e && e.name === "NotAllowedError") setError(t("err_cancel_pick"));
    else setError(t("err_get_screen", e && e.message ? e.message : e));
    cleanup(); return;
  }
  if (els.optCam.checked) {
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); }
    catch (e) { setError(t("err_get_cam_continue", e && e.message ? e.message : e)); }
  }
  if (els.optMic.checked) {
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { setError(t("err_get_mic_continue", e && e.message ? e.message : e)); }
  }

  screenVideo = mkVideo(new MediaStream(displayStream.getVideoTracks()));
  await screenVideo.play().catch(() => {});
  if (camStream) { camVideo = mkVideo(camStream); await camVideo.play().catch(() => {}); }

  displayStream.getVideoTracks()[0].addEventListener("ended", () => {
    if (recorder && recorder.state !== "inactive") stop();
  });

  crop = { x: 0, y: 0, w: screenVideo.videoWidth || 1920, h: screenVideo.videoHeight || 1080 };
  if (els.optRegion.checked) enterRegionSelection();
  else beginWithCountdown(fps);
}

function mkVideo(stream) {
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.srcObject = stream;
  return v;
}

// ---- 区域框选 ----
// 用透明 overlay + Pointer Capture 接管框选：<video> 不再当事件目标，
// 按下后即便指针移出预览也能持续收到 move/up，框一定拉得开。
let selDragging = false, selStart = null, selRectCss = null, regionSelecting = false;

// 选源（尤其选了别的标签页/整屏）后焦点会跑到被共享处，把录制台拉回前台才能画框
async function focusSelf() {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab) { await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true }); }
  } catch (_) { try { window.focus(); } catch (_) {} }
}
// 标签页切回来时预览可能被暂停，恢复播放
function onSelVisible() { if (regionSelecting && document.visibilityState === "visible") els.preview.play().catch(() => {}); }

function enterRegionSelection() {
  regionSelecting = true;
  els.preview.srcObject = new MediaStream(displayStream.getVideoTracks());
  els.preview.style.display = "block"; els.preview.muted = true; els.preview.play().catch(() => {});
  els.stage.classList.add("selecting");
  els.selOverlay.classList.add("on");
  els.selHint.style.display = "flex";
  els.status.textContent = t("st_select_region");
  els.start.disabled = true;
  els.selOverlay.addEventListener("pointerdown", onSelDown);
  els.selOverlay.addEventListener("pointermove", onSelMove);
  els.selOverlay.addEventListener("pointerup", onSelUp);
  document.addEventListener("visibilitychange", onSelVisible);
  focusSelf();
}
function onSelDown(e) {
  e.preventDefault();
  els.selOverlay.setPointerCapture(e.pointerId); // 锁定指针，move/up 必达
  const r = els.selOverlay.getBoundingClientRect();
  selDragging = true; selStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  selRectCss = { x: selStart.x, y: selStart.y, w: 0, h: 0 };
  els.selBox.style.display = "block"; updateSelBox(selStart.x, selStart.y, 0, 0);
}
function onSelMove(e) {
  if (!selDragging) return;
  const r = els.selOverlay.getBoundingClientRect();
  const x2 = Math.min(Math.max(e.clientX - r.left, 0), r.width), y2 = Math.min(Math.max(e.clientY - r.top, 0), r.height);
  updateSelBox(Math.min(selStart.x, x2), Math.min(selStart.y, y2), Math.abs(x2 - selStart.x), Math.abs(y2 - selStart.y));
}
function onSelUp(e) {
  if (!selDragging) return;
  selDragging = false;
  try { els.selOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
  const r = els.selOverlay.getBoundingClientRect();
  if (selRectCss && selRectCss.w > 8 && selRectCss.h > 8) {
    const sx = screenVideo.videoWidth / r.width, sy = screenVideo.videoHeight / r.height;
    crop = { x: Math.round(selRectCss.x * sx), y: Math.round(selRectCss.y * sy), w: Math.round(selRectCss.w * sx), h: Math.round(selRectCss.h * sy) };
    els.status.textContent = t("st_selected", `${crop.w}×${crop.h}`);
  }
}
function updateSelBox(x, y, w, h) {
  selRectCss = { x, y, w, h };
  els.selBox.style.left = x + "px"; els.selBox.style.top = y + "px";
  els.selBox.style.width = w + "px"; els.selBox.style.height = h + "px";
}
function exitRegionSelection() {
  regionSelecting = false; selDragging = false;
  els.stage.classList.remove("selecting");
  els.selOverlay.classList.remove("on");
  els.selHint.style.display = "none"; els.selBox.style.display = "none";
  els.selOverlay.removeEventListener("pointerdown", onSelDown);
  els.selOverlay.removeEventListener("pointermove", onSelMove);
  els.selOverlay.removeEventListener("pointerup", onSelUp);
  document.removeEventListener("visibilitychange", onSelVisible);
}
// 取消框选：停止已获取的捕获，回到空闲
function cancelSelection() {
  exitRegionSelection();
  els.preview.style.display = "none"; els.preview.srcObject = null;
  cleanup();
  els.status.textContent = t("st_canceled");
}
els.confirmRegion.addEventListener("click", () => { exitRegionSelection(); beginWithCountdown(Number(els.optFps.value)); });
els.fullRegion.addEventListener("click", () => {
  crop = { x: 0, y: 0, w: screenVideo.videoWidth, h: screenVideo.videoHeight };
  exitRegionSelection(); beginWithCountdown(Number(els.optFps.value));
});
els.cancelRegion.addEventListener("click", cancelSelection);
// 框选阶段取消勾选「区域录制」= 中止
els.optRegion.addEventListener("change", () => { if (regionSelecting && !els.optRegion.checked) cancelSelection(); });

// ---- 画笔层 ----
function sizeDrawSurface() {
  const r = els.preview.getBoundingClientRect();
  els.drawSurface.width = Math.round(r.width);
  els.drawSurface.height = Math.round(r.height);
  repaintSurface();
}
function enableDrawing() {
  dsCtx = els.drawSurface.getContext("2d");
  els.drawSurface.classList.add("on");
  els.drawTools.classList.add("on");
  sizeDrawSurface();
  window.addEventListener("resize", sizeDrawSurface);
  els.drawSurface.addEventListener("pointerdown", onPenDown);
  els.drawSurface.addEventListener("pointermove", onPenMove);
  window.addEventListener("pointerup", onPenUp);
}
function disableDrawing() {
  els.drawSurface.classList.remove("on");
  els.drawTools.classList.remove("on");
  window.removeEventListener("resize", sizeDrawSurface);
  els.drawSurface.removeEventListener("pointerdown", onPenDown);
  els.drawSurface.removeEventListener("pointermove", onPenMove);
  window.removeEventListener("pointerup", onPenUp);
  dsCtx = null;
}
function surfaceToSource(e) {
  const r = els.drawSurface.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * canvas.width, y: (e.clientY - r.top) / r.height * canvas.height };
}
function onPenDown(e) {
  if (!penOn || !canvas) return;
  curStroke = { color: penColor, size: penWidth, points: [surfaceToSource(e)] };
  repaintSurface();
}
function onPenMove(e) {
  if (!curStroke) return;
  curStroke.points.push(surfaceToSource(e));
  repaintSurface();
}
function onPenUp() {
  if (!curStroke) return;
  if (curStroke.points.length) strokes.push(curStroke);
  curStroke = null;
  repaintSurface();
}
els.penToggle.addEventListener("click", () => {
  penOn = !penOn;
  els.penToggle.textContent = penOn ? t("pen_on") : t("pen_off");
  els.penToggle.classList.toggle("off", !penOn);
  els.drawSurface.style.cursor = penOn ? "crosshair" : "default";
  els.drawSurface.style.pointerEvents = penOn ? "auto" : "none";
});
els.penSize.addEventListener("input", () => { penWidth = Number(els.penSize.value); });
els.undoStroke.addEventListener("click", () => { strokes.pop(); repaintSurface(); });
els.clearStrokes.addEventListener("click", () => { strokes = []; repaintSurface(); });
document.querySelectorAll(".swatch").forEach((s) => s.addEventListener("click", () => {
  penColor = s.dataset.color;
  document.querySelectorAll(".swatch").forEach((x) => x.classList.remove("active"));
  s.classList.add("active");
}));

// 开始前倒计时（源已获取，仅延迟启动 MediaRecorder，不影响用户手势）
function runCountdown(sec) {
  return new Promise((resolve) => {
    els.countdown.classList.add("on");
    let n = sec; els.countNum.textContent = n;
    const id = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(id); els.countdown.classList.remove("on"); resolve(); }
      else { els.countNum.textContent = n; els.countNum.style.animation = "none"; void els.countNum.offsetWidth; els.countNum.style.animation = ""; }
    }, 1000);
  });
}
async function beginWithCountdown(fps) {
  const sec = Number(els.optCountdown.value) || 0;
  if (sec > 0) await runCountdown(sec);
  beginRecording(fps);
}

// ---- 开始录制 ----
function beginRecording(fps) {
  // 有叠加需求（摄像头/区域/画笔/中途叠加）才走 canvas；纯屏幕直通最省资源
  const wantOverlay = els.optCam.checked || els.optRegion.checked || els.optDraw.checked || els.optHotInsert.checked;
  useCanvas = isCamOnly ? els.optDraw.checked : wantOverlay;

  // crop 兜底：metadata 未就绪/框选异常导致 0 尺寸会让 MediaRecorder 直接失败
  if (!isCamOnly) {
    const vw = screenVideo.videoWidth || 1920, vh = screenVideo.videoHeight || 1080;
    if (!crop || crop.w < 2 || crop.h < 2) crop = { x: 0, y: 0, w: vw, h: vh };
    crop.x = Math.max(0, Math.min(crop.x, vw - 2));
    crop.y = Math.max(0, Math.min(crop.y, vh - 2));
    crop.w = Math.min(crop.w, vw - crop.x);
    crop.h = Math.min(crop.h, vh - crop.y);
  }

  if (useCanvas) {
    canvas = document.createElement("canvas");
    if (isCamOnly) { canvas.width = even(camVideo.videoWidth || 1280); canvas.height = even(camVideo.videoHeight || 720); }
    else { canvas.width = even(crop.w); canvas.height = even(crop.h); }
    ctx = canvas.getContext("2d", { alpha: false });
    drawFrame();
    drawWorker = makeDrawWorker(fps);
    drawWorker.onmessage = drawFrame;
    mixedStream = canvas.captureStream(fps);
  } else {
    mixedStream = new MediaStream();
    (isCamOnly ? camStream : displayStream).getVideoTracks().forEach((t) => mixedStream.addTrack(t));
  }
  const audioTrack = buildAudioTrack();
  if (audioTrack) mixedStream.addTrack(audioTrack);

  els.preview.srcObject = mixedStream;
  els.preview.style.display = "block"; els.preview.muted = true; els.preview.controls = false;
  els.preview.play().catch(() => {});

  if (els.optDraw.checked) {
    penOn = true; els.penToggle.textContent = t("pen_on"); els.penToggle.classList.remove("off");
    els.drawSurface.style.pointerEvents = "auto"; els.drawSurface.style.cursor = "crosshair";
    setTimeout(enableDrawing, 60); // 等预览拿到布局尺寸
  }

  const picked = pickMime(els.optFormat.value);
  recMime = picked.mime; recExt = picked.ext;
  recorder = new MediaRecorder(mixedStream, { mimeType: recMime, videoBitsPerSecond: Number(els.optQuality.value) });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) { chunks.push(e.data); recordedBytes += e.data.size; } };
  recorder.onstop = finalize;
  recorder.start(1000);

  startedAt = Date.now(); pausedMs = 0;
  timerId = setInterval(tick, 250);
  document.title = "● 录制中 · 极简录屏";
  document.querySelector(".bar").classList.add("rec");
  const tags = [recExt.toUpperCase()];
  if (isCamOnly) tags.push(t("tag_camonly"));
  else { if (els.optRegion.checked) tags.push(`${crop.w}×${crop.h}`); if (camStream) tags.push(t("tag_cam")); }
  if (els.optDraw.checked) tags.push(t("tag_draw"));
  recStatusBase = t("st_rec") + " · " + tags.join(" · ");
  els.status.textContent = recStatusBase;
  els.start.disabled = true; els.pause.disabled = false; els.stop.disabled = false;
  els.start.innerHTML = '<span class="dot"></span>' + t("recording");
}

function togglePause() {
  if (!recorder) return;
  if (recorder.state === "recording") {
    recorder.pause(); pauseStart = Date.now(); clearInterval(timerId);
    if (drawWorker) drawWorker.postMessage({ cmd: "stop" });
    els.pause.textContent = t("btn_resume"); els.status.textContent = t("st_paused");
  } else if (recorder.state === "paused") {
    recorder.resume(); pausedMs += Date.now() - pauseStart; timerId = setInterval(tick, 250);
    if (drawWorker) drawWorker.postMessage({ cmd: "start", ms: Math.max(1, Math.round(1000 / Number(els.optFps.value))) });
    els.pause.textContent = t("btn_pause"); els.status.textContent = t("st_rec");
  }
}

const stop = () => { if (recorder && recorder.state !== "inactive") recorder.stop(); };

function stopStreams() {
  [displayStream, micStream, camStream, mixedStream].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  if (drawWorker) { drawWorker.postMessage({ cmd: "stop" }); drawWorker.terminate(); drawWorker = null; }
}
function cleanup() {
  stopStreams();
  ctx = null; canvas = null; screenVideo = camVideo = null;
  displayStream = micStream = camStream = mixedStream = null;
  els.start.disabled = false;
}

function finalize() {
  clearInterval(timerId);
  recStatusBase = "";
  stopStreams();
  disableDrawing();
  document.querySelector(".bar").classList.remove("rec");
  document.title = "极简录屏 · 录制台";

  const blob = new Blob(chunks, { type: recMime.split(";")[0] });
  lastUrl = URL.createObjectURL(blob);
  els.preview.srcObject = null; els.preview.src = lastUrl; els.preview.muted = false; els.preview.controls = true;

  const ts = new Date(), pad = (n) => String(n).padStart(2, "0");
  const name = `${t("filename_prefix")}-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.${recExt}`;
  els.dlLink.href = lastUrl; els.dlLink.download = name;
  els.dlSize.textContent = `${(blob.size / 1024 / 1024).toFixed(1)} MB · ${els.timer.textContent} · ${recExt.toUpperCase()}`;
  els.dl.style.display = "flex";

  els.status.textContent = t("st_done");
  els.start.disabled = false; els.pause.disabled = true; els.stop.disabled = true;
  els.pause.textContent = t("btn_pause"); els.start.innerHTML = t("btn_start");
  ctx = null; canvas = null; screenVideo = camVideo = null;
  displayStream = micStream = camStream = mixedStream = null; recorder = null;
}

els.start.addEventListener("click", start);
els.pause.addEventListener("click", togglePause);
els.stop.addEventListener("click", stop);

// 丢弃录像：撤销 blob、清掉预览与下载区，不下载直接弃录
els.discardRec.addEventListener("click", () => {
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  chunks = [];
  els.preview.pause(); els.preview.removeAttribute("src"); els.preview.load();
  els.preview.controls = false; els.preview.style.display = "none";
  els.dl.style.display = "none";
  els.status.textContent = t("st_discarded");
});

// 页内快捷键（仅当录制台标签页聚焦时有效）
document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.code === "Space") {
    e.preventDefault();
    if (recorder && recorder.state !== "inactive") stop();
    else if (!regionSelecting && !els.start.disabled) start();
  } else if (e.key === "p" || e.key === "P") {
    if (recorder && recorder.state !== "inactive") togglePause();
  }
});

// 全局快捷键（background 转发）：在任意标签页也能停止/暂停录制
if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!recorder || recorder.state === "inactive") return;
    if (msg && msg.cmd === "stop") stop();
    else if (msg && msg.cmd === "pause") togglePause();
  });
}

window.addEventListener("beforeunload", (e) => {
  if (recorder && recorder.state !== "inactive") { e.preventDefault(); e.returnValue = ""; }
});

// ---- 选项记忆（chrome.storage.local）----
const PERSIST = ["optCamOnly", "optMic", "optSysAudio", "optCam", "optRegion", "optDraw",
  "optHotInsert", "optCamPos", "optCamSize", "optCamShape", "optCountdown", "optFormat", "optFps", "optQuality"];
function saveSettings() {
  const data = {};
  PERSIST.forEach((id) => { const el = els[id]; data[id] = el.type === "checkbox" ? el.checked : el.value; });
  try { chrome.storage.local.set({ settings: data }); } catch (_) {}
}
function loadSettings() {
  return new Promise((res) => {
    try {
      chrome.storage.local.get("settings", (r) => {
        const s = r && r.settings;
        if (s) PERSIST.forEach((id) => {
          if (id in s) { const el = els[id]; if (el.type === "checkbox") el.checked = !!s[id]; else el.value = s[id]; }
        });
        res();
      });
    } catch (_) { res(); }
  });
}
PERSIST.forEach((id) => els[id].addEventListener("change", saveSettings));

loadSettings().then(refreshOpts);
if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
  setError(t("err_no_displaymedia"));
  els.start.disabled = true;
}
