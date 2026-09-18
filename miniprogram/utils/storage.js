// utils/storage.js
// 本地存储封装, 数据完全留在用户手机

const KEYS = {
  PROGRESS: 'apca.progress.v1',
  HISTORY: 'apca.history.v1',
  ONBOARDING: 'apca.onboarding.v1'
};

function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v == null || v === '' ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (e) {
    return false;
  }
}

// ---- progress (当前未完成测评) ----
function saveCurrentProgress(progress) {
  return set(KEYS.PROGRESS, { ...progress, ts: Date.now() });
}

function loadCurrentProgress() {
  return get(KEYS.PROGRESS, null);
}

function clearCurrentProgress() {
  return remove(KEYS.PROGRESS);
}

// ---- history (历史测评结果, 最新在前, 最多 20 条) ----
function loadHistory() {
  return get(KEYS.HISTORY, []);
}

function appendHistory(item) {
  const list = loadHistory();
  list.unshift({ ...item, ts: item.ts || Date.now() });
  if (list.length > 20) list.length = 20;
  return set(KEYS.HISTORY, list);
}

function clearHistory() {
  return remove(KEYS.HISTORY);
}

function getHistoryItem(id) {
  return loadHistory().find(x => x.ts === id);
}

// ---- onboarding (是否看过隐私说明) ----
function hasOnboarded() {
  return !!get(KEYS.ONBOARDING, false);
}

function setOnboarded() {
  return set(KEYS.ONBOARDING, true);
}

module.exports = {
  saveCurrentProgress,
  loadCurrentProgress,
  clearCurrentProgress,
  loadHistory,
  appendHistory,
  clearHistory,
  getHistoryItem,
  hasOnboarded,
  setOnboarded,
  KEYS
};