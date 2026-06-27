// 全局快捷键 → 找到录制台标签页并转发停止/暂停指令，
// 让你在任意标签页都能停掉正在进行的录制（开始仍需在录制台点按钮，受浏览器手势限制）。
chrome.commands.onCommand.addListener(async (command) => {
  const url = chrome.runtime.getURL("recorder.html");
  const cmd = command === "pause-recording" ? "pause" : "stop";
  try {
    const tabs = await chrome.tabs.query({ url });
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { cmd }).catch(() => {});
  } catch (_) {}
});
