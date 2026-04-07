// 다운로드 가로채기
// - .hwp/.hwpx 다운로드 감지 → 뷰어로 열기
// - 사용자 설정(autoOpen)에 따라 동작

import { openViewer } from './viewer-launcher.js';

const HWP_EXTENSIONS = /\.(hwp|hwpx)$/i;

/**
 * 다운로드 인터셉터를 설정한다.
 */
export function setupDownloadInterceptor() {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const filename = item.filename || '';

    if (HWP_EXTENSIONS.test(filename)) {
      handleHwpDownload(item);
    }

    // 기본 파일명 유지 (다운로드는 정상 진행)
    suggest({ filename: item.filename });
  });
}

async function handleHwpDownload(item) {
  const settings = await chrome.storage.sync.get({ autoOpen: true });

  if (settings.autoOpen) {
    openViewer({
      url: item.url,
      filename: item.filename
    });
  }
}
