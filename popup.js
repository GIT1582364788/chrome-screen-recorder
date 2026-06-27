// 录制必须跑在常驻页面里——popup 一关闭就会停止 getDisplayMedia，
// 所以这里只负责把真正的「录制台」开成一个独立标签页。
document.getElementById("open").addEventListener("click", async () => {
  const url = chrome.runtime.getURL("recorder.html");
  // 已经开着就聚焦，避免开一堆
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
});
