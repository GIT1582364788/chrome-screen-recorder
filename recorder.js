"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  start: $("start"), pause: $("pause"), stop: $("stop"),
  timer: $("timer"), status: $("status"), err: $("err"),
  preview: $("preview"), dl: $("dl"), dlLink: $("dlLink"), dlSize: $("dlSize"),
  optMic: $("optMic"), optSysAudio: $("optSysAudio"),
  optFps: $("optFps"), optQuality: $("optQuality"),
};

let recorder = null;
let chunks = [];
let displayStream = null;   // 屏幕（含可选系统音）
let micStream = null;       // 麦克风
let mixedStream = null;     // 真正喂给 MediaRecorder 的流
let audioCtx = null;
let lastUrl = null;
let timerId = null;
let startedAt = 0;
let pausedMs = 0;
let pauseStart = 0;

function setError(msg) { els.err.textContent = msg || ""; }

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${String(h).padStart(2, "0")}:${m}:${ss}` : `${m}:${ss}`;
}

function tick() {
  els.timer.textContent = fmt(Date.now() - startedAt - pausedMs);
}

// 在支持的容器/编码里挑一个可用的（Chrome 优先 vp9，回退 vp8/默认）
function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

// 把屏幕音 + 麦克风音混成一条轨；只有一个来源时直接用那一条。
function buildAudioTrack() {
  const sysTracks = displayStream ? displayStream.getAudioTracks() : [];
  const micTracks = micStream ? micStream.getAudioTracks() : [];

  if (sysTracks.length && micTracks.length) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaStreamSource(new MediaStream(sysTracks)).connect(dest);
    audioCtx.createMediaStreamSource(new MediaStream(micTracks)).connect(dest);
    return dest.stream.getAudioTracks()[0];
  }
  if (sysTracks.length) return sysTracks[0];
  if (micTracks.length) return micTracks[0];
  return null;
}

async function start() {
  setError("");
  els.dl.style.display = "none";
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  chunks = [];

  const fps = Number(els.optFps.value);

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps } },
      audio: els.optSysAudio.checked, // 系统/标签页声音（需用户在选择器勾选分享音频）
    });
  } catch (e) {
    if (e && e.name === "NotAllowedError") setError("已取消选择，未开始录制。");
    else setError("无法获取屏幕：" + (e && e.message ? e.message : e));
    return;
  }

  if (els.optMic.checked) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError("麦克风获取失败（将继续无麦录制）：" + (e && e.message ? e.message : e));
    }
  }

  // 组装最终流
  mixedStream = new MediaStream();
  displayStream.getVideoTracks().forEach((t) => mixedStream.addTrack(t));
  const audioTrack = buildAudioTrack();
  if (audioTrack) mixedStream.addTrack(audioTrack);

  // 实时预览
  els.preview.srcObject = mixedStream;
  els.preview.style.display = "block";
  els.preview.muted = true; // 避免回声啸叫
  els.preview.play().catch(() => {});

  const mimeType = pickMimeType();
  recorder = new MediaRecorder(mixedStream, {
    mimeType,
    videoBitsPerSecond: Number(els.optQuality.value),
  });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = finalize;
  recorder.start(1000); // 每秒切片，长录也不丢

  // 用户在 Chrome 自带的「停止共享」条上点停止时，视频轨会 ended → 自动收尾
  displayStream.getVideoTracks()[0].addEventListener("ended", () => {
    if (recorder && recorder.state !== "inactive") stop();
  });

  startedAt = Date.now();
  pausedMs = 0;
  timerId = setInterval(tick, 250);
  document.title = "● 录制中 · 极简录屏";
  els.status.textContent = `录制中（${mimeType.replace("video/webm;codecs=", "")}）`;
  document.querySelector(".bar").classList.add("rec");
  els.start.disabled = true;
  els.pause.disabled = false;
  els.stop.disabled = false;
  els.start.innerHTML = '<span class="dot"></span>录制中';
}

function togglePause() {
  if (!recorder) return;
  if (recorder.state === "recording") {
    recorder.pause();
    pauseStart = Date.now();
    clearInterval(timerId);
    els.pause.textContent = "继续";
    els.status.textContent = "已暂停";
  } else if (recorder.state === "paused") {
    recorder.resume();
    pausedMs += Date.now() - pauseStart;
    timerId = setInterval(tick, 250);
    els.pause.textContent = "暂停";
    els.status.textContent = "录制中";
  }
}

function stopAllTracks() {
  [displayStream, micStream].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
}

function stop() {
  if (!recorder || recorder.state === "inactive") return;
  recorder.stop(); // → onstop → finalize
}

function finalize() {
  clearInterval(timerId);
  stopAllTracks();
  document.querySelector(".bar").classList.remove("rec");
  document.title = "极简录屏 · 录制台";

  const blob = new Blob(chunks, { type: "video/webm" });
  lastUrl = URL.createObjectURL(blob);

  // 切到回放（可拖动、带声音）
  els.preview.srcObject = null;
  els.preview.src = lastUrl;
  els.preview.muted = false;
  els.preview.controls = true;

  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `录屏-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.webm`;
  els.dlLink.href = lastUrl;
  els.dlLink.download = name;
  els.dlSize.textContent = `${(blob.size / 1024 / 1024).toFixed(1)} MB · ${els.timer.textContent}`;
  els.dl.style.display = "flex";

  els.status.textContent = "已完成";
  els.start.disabled = false;
  els.pause.disabled = true;
  els.stop.disabled = true;
  els.pause.textContent = "暂停";
  els.start.innerHTML = "● 开始录制";

  recorder = null;
}

els.start.addEventListener("click", start);
els.pause.addEventListener("click", togglePause);
els.stop.addEventListener("click", stop);

// 录制中误关页面时提醒
window.addEventListener("beforeunload", (e) => {
  if (recorder && recorder.state !== "inactive") { e.preventDefault(); e.returnValue = ""; }
});

if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
  setError("当前浏览器不支持屏幕录制（需较新版 Chrome）。");
  els.start.disabled = true;
}
