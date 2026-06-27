"use strict";
// 轻量中英 i18n：静态文案用 [data-i18n] 自动替换，动态文案用 t(key, ...args)。
// 语言存 localStorage，默认跟随浏览器。
(function () {
  const DICT = {
    zh: {
      app_title: "🎬 极简录屏 · 录制台",
      subtitle: "屏幕 / 窗口 / 标签页录制，可叠摄像头、框选区域、画笔标注、仅录摄像头，导出 webm / mp4。",
      opt_camonly: "仅录摄像头", opt_camonly_d: "不录屏幕，全画幅录摄像头（口播/讲解）。",
      opt_mic: "录麦克风", opt_mic_d: "叠加你的人声讲解。",
      opt_sysaudio: "录系统/标签页声音", opt_sysaudio_d: "选择器里记得勾「分享音频」。",
      opt_cam: "摄像头画中画", opt_cam_d: "露脸讲解，叠在角落。",
      lbl_campos: "摄像头位置", campos_br: "右下角", campos_bl: "左下角", campos_tr: "右上角", campos_tl: "左上角",
      lbl_camsize: "摄像头大小", size_s: "小", size_m: "中", size_l: "大",
      lbl_camshape: "摄像头形状", shape_round: "圆角矩形", shape_rect: "矩形", shape_circle: "圆形",
      opt_region: "区域录制", opt_region_d: "先框选再录，只录一块。",
      opt_draw: "画笔标注", opt_draw_d: "录制时在预览上画，烧进录像。",
      opt_hotinsert: "录制中可加摄像头/画笔", opt_hotinsert_d: "纯屏幕录制默认直通最省资源；勾上才允许中途叠加。",
      lbl_countdown: "开始倒计时", cd_off: "不倒计时", cd_3: "3 秒", cd_5: "5 秒",
      lbl_format: "导出格式", fmt_webm: "webm（兼容性最好）", fmt_mp4: "mp4（需较新 Chrome）",
      lbl_fps: "帧率", fps_30: "30 fps（默认）", fps_60: "60 fps（更顺）", fps_15: "15 fps（省空间）",
      lbl_quality: "画质码率", q_sd: "标清 ~2.5 Mbps", q_hd: "高清 ~5 Mbps", q_uhd: "超清 ~8 Mbps",
      btn_start: "● 开始录制", recording: "录制中", btn_pause: "暂停", btn_resume: "继续", btn_stop: "停止",
      pen_on: "✎ 画笔开", pen_off: "✎ 画笔关", undo: "↶ 撤销", clear: "🗑 清除",
      selhint_tip: "回到本页，在预览里拖拽框选；可拖角调整、框内拖动，不选则录整个画面。",
      confirm_region: "✔ 确认并开始", full_region: "录整个画面", cancel: "✖ 取消",
      dl_link: "⬇ 下载录像", discard: "✖ 丢弃", dl_hint: "已生成预览，可在上方播放器回放。",
      keys_hint: "快捷键：空格 开始/停止 · P 暂停/继续 · Ctrl/⌘+Shift+S 在任意标签页停止",
      lang_switch: "EN",
      err_no_displaymedia: "当前浏览器不支持屏幕录制（需较新版 Chrome）。",
      err_cancel_pick: "已取消选择，未开始录制。",
      err_get_screen: "无法获取屏幕：{0}",
      err_get_cam: "摄像头获取失败：{0}",
      err_get_cam_continue: "摄像头获取失败（继续无摄像头）：{0}",
      err_get_mic_continue: "麦克风获取失败（继续无麦）：{0}",
      err_mp4_fallback: "当前 Chrome 不支持直接录 mp4，已回退 webm（可后续用 ffmpeg 转）。",
      err_big_warn: "录制已很大（录像暂存在内存中），建议尽快停止保存，超长录制可分多段。",
      err_no_hotinsert: "当前为直通录制，无法中途加摄像头（开始前勾「录制中可加摄像头/画笔」）。",
      st_select_region: "请在预览里按住拖拽框选",
      st_selected: "已选 {0}，点「确认并开始」",
      st_canceled: "已取消", st_discarded: "已丢弃", st_done: "已完成", st_paused: "已暂停", st_rec: "录制中",
      tag_camonly: "仅摄像头", tag_cam: "摄像头", tag_draw: "画笔",
      filename_prefix: "录屏",
      popup_title: "🎬 极简录屏", popup_desc: "录制屏幕 / 窗口 / 标签页，含声音。",
      popup_open: "打开录制台", popup_hint: "录制在独立标签页进行，关闭弹窗不会中断。",
    },
    en: {
      app_title: "🎬 Simple Screen Recorder",
      subtitle: "Record screen / window / tab, with camera overlay, region crop, pen annotation or camera-only — export webm / mp4.",
      opt_camonly: "Camera only", opt_camonly_d: "No screen, record the full camera frame (talking head).",
      opt_mic: "Microphone", opt_mic_d: "Add your voice-over.",
      opt_sysaudio: "System / tab audio", opt_sysaudio_d: "Tick “Share audio” in the picker.",
      opt_cam: "Camera overlay", opt_cam_d: "Show your face in a corner.",
      lbl_campos: "Camera position", campos_br: "Bottom-right", campos_bl: "Bottom-left", campos_tr: "Top-right", campos_tl: "Top-left",
      lbl_camsize: "Camera size", size_s: "Small", size_m: "Medium", size_l: "Large",
      lbl_camshape: "Camera shape", shape_round: "Rounded", shape_rect: "Rectangle", shape_circle: "Circle",
      opt_region: "Region capture", opt_region_d: "Select a box first, record just that area.",
      opt_draw: "Pen annotation", opt_draw_d: "Draw on the preview, burned into the video.",
      opt_hotinsert: "Allow adding camera/pen mid-recording", opt_hotinsert_d: "Plain screen capture stays direct (cheapest); tick to allow overlays mid-way.",
      lbl_countdown: "Start countdown", cd_off: "Off", cd_3: "3 s", cd_5: "5 s",
      lbl_format: "Export format", fmt_webm: "webm (most compatible)", fmt_mp4: "mp4 (recent Chrome)",
      lbl_fps: "Frame rate", fps_30: "30 fps (default)", fps_60: "60 fps (smoother)", fps_15: "15 fps (smaller)",
      lbl_quality: "Quality / bitrate", q_sd: "SD ~2.5 Mbps", q_hd: "HD ~5 Mbps", q_uhd: "UHD ~8 Mbps",
      btn_start: "● Start", recording: "Recording", btn_pause: "Pause", btn_resume: "Resume", btn_stop: "Stop",
      pen_on: "✎ Pen on", pen_off: "✎ Pen off", undo: "↶ Undo", clear: "🗑 Clear",
      selhint_tip: "Back here, drag on the preview to select; drag corners to resize, drag inside to move. No selection records the whole frame.",
      confirm_region: "✔ Confirm & start", full_region: "Whole frame", cancel: "✖ Cancel",
      dl_link: "⬇ Download", discard: "✖ Discard", dl_hint: "Preview ready — replay it in the player above.",
      keys_hint: "Shortcuts: Space start/stop · P pause/resume · Ctrl/⌘+Shift+S stop from any tab",
      lang_switch: "中",
      err_no_displaymedia: "This browser can’t record the screen (needs a recent Chrome).",
      err_cancel_pick: "Selection cancelled, not recording.",
      err_get_screen: "Can’t capture screen: {0}",
      err_get_cam: "Camera failed: {0}",
      err_get_cam_continue: "Camera failed (continuing without it): {0}",
      err_get_mic_continue: "Mic failed (continuing without it): {0}",
      err_mp4_fallback: "This Chrome can’t record mp4 directly — fell back to webm (convert later with ffmpeg).",
      err_big_warn: "Recording is large (held in memory) — stop and save soon; split very long recordings.",
      err_no_hotinsert: "Direct-capture mode can’t add a camera mid-way (tick “Allow adding camera/pen mid-recording” before starting).",
      st_select_region: "Drag on the preview to select a region",
      st_selected: "Selected {0} — click “Confirm & start”",
      st_canceled: "Cancelled", st_discarded: "Discarded", st_done: "Done", st_paused: "Paused", st_rec: "Recording",
      tag_camonly: "camera-only", tag_cam: "camera", tag_draw: "pen",
      filename_prefix: "screen-rec",
      popup_title: "🎬 Screen Recorder", popup_desc: "Record screen / window / tab, with audio.",
      popup_open: "Open recorder", popup_hint: "Recording runs in its own tab — closing this popup won’t stop it.",
    },
  };

  let lang = localStorage.getItem("sr_lang") || ((navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en");

  function t(key, ...args) {
    const s = (DICT[lang] && DICT[lang][key]) ?? (DICT.en[key] ?? key);
    return args.length ? s.replace(/\{(\d+)\}/g, (_, i) => (args[i] ?? "")) : s;
  }
  function applyI18n() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  }
  function setLang(l) { lang = l; localStorage.setItem("sr_lang", l); applyI18n(); }
  function getLang() { return lang; }

  window.t = t; window.applyI18n = applyI18n; window.setLang = setLang; window.getLang = getLang;
})();
