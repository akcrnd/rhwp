// rhwp Chrome Extension - Content Script
// 웹페이지에서 HWP/HWPX 링크를 자동 감지하고 rhwp 아이콘을 삽입

(() => {
  'use strict';

  const HWP_EXTENSIONS = /\.(hwp|hwpx)(\?.*)?$/i;
  const BADGE_CLASS = 'rhwp-badge';
  const PROCESSED_ATTR = 'data-rhwp-processed';

  // 확장 존재 알림
  document.documentElement.setAttribute('data-hwp-extension', 'rhwp');
  document.documentElement.setAttribute('data-hwp-extension-version', '0.1.0');
  window.dispatchEvent(new CustomEvent('hwp-extension-ready', {
    detail: { name: 'rhwp', version: '0.1.0', capabilities: ['preview', 'edit', 'print'] }
  }));

  // 개발자 도구 주입 (페이지 컨텍스트에 rhwpDev 노출)
  const devScript = document.createElement('script');
  devScript.src = chrome.runtime.getURL('dev-tools-inject.js');
  (document.head || document.documentElement).appendChild(devScript);
  devScript.onload = () => devScript.remove();

  function isHwpLink(anchor) {
    if (!anchor.href) return false;
    // data-hwp="true" 마커 (1순위)
    if (anchor.getAttribute('data-hwp') === 'true') return true;
    // 확장자 기반 감지 (폴백)
    return HWP_EXTENSIONS.test(anchor.href);
  }

  function createBadge(anchor) {
    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.title = 'rhwp로 열기';

    // data-hwp-* 메타데이터 수집
    const title = anchor.getAttribute('data-hwp-title');
    const pages = anchor.getAttribute('data-hwp-pages');
    const size = anchor.getAttribute('data-hwp-size');

    let tooltip;
    if (title && pages && size) {
      tooltip = chrome.i18n.getMessage('badgeTooltipWithInfo', [title, pages, formatSize(Number(size))]);
    } else if (title) {
      tooltip = title;
    } else {
      tooltip = chrome.i18n.getMessage('badgeTooltip');
    }
    badge.title = tooltip;

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'open-hwp', url: anchor.href });
    });

    return badge;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function processLinks(root = document) {
    const anchors = root.querySelectorAll('a[href]');
    for (const anchor of anchors) {
      if (anchor.hasAttribute(PROCESSED_ATTR)) continue;
      if (!isHwpLink(anchor)) continue;

      anchor.setAttribute(PROCESSED_ATTR, 'true');
      const badge = createBadge(anchor);
      anchor.style.position = anchor.style.position || 'relative';
      anchor.insertAdjacentElement('afterend', badge);
    }
  }

  // 초기 스캔
  processLinks();

  // 동적 콘텐츠 대응 (게시판 AJAX 로딩 등)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          processLinks(node);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
