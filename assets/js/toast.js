/**
 * UBR Esports - Universal Toast Notification System
 * Seamlessly replaces window.alert with color-coded, animated toasts.
 */
(function() {
  let container = null;

  function getOrCreateContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.getElementById('ubrToastContainer');
      if (!container) {
        container = document.createElement('div');
        container.id = 'ubrToastContainer';
        document.body.appendChild(container);
      }
    }
    return container;
  }

  // Automatic message classifier
  function detectType(message) {
    if (!message || typeof message !== 'string') return 'info';
    const text = message.toLowerCase();

    // 1. Success check (must not contain negative terms)
    const isSuccess = /(success|successfully|successful|created|saved|updated|added successfully|credited|approved|copied|confirmed|welcome|booked|uploaded successfully)/i.test(text);
    const isExplicitFail = /(fail|failed|not successful|unsuccessful|error|denied|wrong|invalid)/i.test(text);

    if (isSuccess && !isExplicitFail) {
      return 'success';
    }

    // 2. Error check
    const isError = /(error|failed|fail|cannot|can't|unable|invalid|wrong|incorrect|denied|cancelled|cancel|insufficient|not have enough|not available|missing|something went wrong|fill required|please enter|please select|please upload|not allowed|fill all|valid amount|not found|does not exist)/i.test(text);
    if (isError) {
      return 'error';
    }

    // 3. Warning check
    const isWarning = /(warning|warn|already|limit|caution|attention|pending|required|expire|note:)/i.test(text);
    if (isWarning) {
      return 'warning';
    }

    // 4. Default to info
    return 'info';
  }

  const ICONS = {
    success: '<i class="fa-solid fa-circle-check"></i>',
    error: '<i class="fa-solid fa-circle-xmark"></i>',
    warning: '<i class="fa-solid fa-triangle-exclamation"></i>',
    info: '<i class="fa-solid fa-circle-info"></i>'
  };

  const TITLES = {
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Notice'
  };

  function showToast(message, type = 'auto', options = {}) {
    if (message === undefined || message === null) return;
    if (typeof message === 'object') {
      message = message.msg || message.message || JSON.stringify(message);
    }
    message = String(message);

    if (!type || type === 'auto') {
      type = detectType(message);
    }

    const duration = (typeof options.duration === 'number') ? options.duration : 3500;
    const title = options.title || TITLES[type] || 'Notice';

    // Store in sessionStorage in case page reloads or navigates immediately
    try {
      sessionStorage.setItem('ubr_pending_toast', JSON.stringify({
        message,
        type,
        time: Date.now()
      }));
    } catch (e) {}

    const toastBox = document.createElement('div');
    toastBox.className = 'ubr-toast ubr-toast-' + type;
    toastBox.innerHTML = 
      '<div class="ubr-toast-icon">' + (ICONS[type] || ICONS.info) + '</div>' +
      '<div class="ubr-toast-body">' +
        '<span class="ubr-toast-title">' + title + '</span>' +
        '<span class="ubr-toast-message">' + message + '</span>' +
      '</div>' +
      '<button type="button" class="ubr-toast-close" aria-label="Close notification">&times;</button>' +
      '<div class="ubr-toast-progress">' +
        '<div class="ubr-toast-progress-bar"></div>' +
      '</div>';

    const toastContainer = getOrCreateContainer();
    toastContainer.appendChild(toastBox);

    const closeBtn = toastBox.querySelector('.ubr-toast-close');
    const progressBar = toastBox.querySelector('.ubr-toast-progress-bar');

    let isDismissed = false;
    let timer = null;
    let startTime = Date.now();
    let remaining = duration;

    function dismiss() {
      if (isDismissed) return;
      isDismissed = true;
      clearTimeout(timer);
      toastBox.classList.add('ubr-toast-hiding');
      try {
        const stored = sessionStorage.getItem('ubr_pending_toast');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.message === message) {
            sessionStorage.removeItem('ubr_pending_toast');
          }
        }
      } catch (e) {}
      setTimeout(() => {
        if (toastBox.parentNode) {
          toastBox.parentNode.removeChild(toastBox);
        }
      }, 300);
    }

    closeBtn.addEventListener('click', dismiss);

    // Initial progress bar trigger
    if (progressBar) {
      progressBar.style.transition = 'transform ' + duration + 'ms linear';
      (window.requestAnimationFrame || window.setTimeout)(() => {
        progressBar.style.transform = 'scaleX(0)';
      }, 16);
    }

    function startTimer() {
      startTime = Date.now();
      timer = setTimeout(dismiss, remaining);
      if (progressBar) {
        progressBar.style.transition = 'transform ' + remaining + 'ms linear';
        progressBar.style.transform = 'scaleX(0)';
      }
    }

    function pauseTimer() {
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;
      remaining = Math.max(0, remaining - elapsed);
      if (progressBar) {
        const computedStyle = window.getComputedStyle(progressBar);
        progressBar.style.transition = 'none';
        progressBar.style.transform = computedStyle.transform;
      }
    }

    toastBox.addEventListener('mouseenter', pauseTimer);
    toastBox.addEventListener('mouseleave', () => {
      if (remaining > 0) startTimer();
    });

    startTimer();
    return toastBox;
  }

  // Check pending toast on page load
  function checkPendingToast() {
    try {
      const stored = sessionStorage.getItem('ubr_pending_toast');
      if (stored) {
        sessionStorage.removeItem('ubr_pending_toast');
        const parsed = JSON.parse(stored);
        if (Date.now() - (parsed.time || 0) < 4000) {
          setTimeout(() => {
            showToast(parsed.message, parsed.type);
          }, 300);
        }
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkPendingToast);
  } else {
    checkPendingToast();
  }

  // Global APIs
  window.showToast = showToast;
  window.toast = {
    show: showToast,
    success: function(msg, opt) { return showToast(msg, 'success', opt); },
    error: function(msg, opt) { return showToast(msg, 'error', opt); },
    warning: function(msg, opt) { return showToast(msg, 'warning', opt); },
    info: function(msg, opt) { return showToast(msg, 'info', opt); }
  };

  // Universal alert interception
  window.alert = function(msg, type) {
    showToast(msg, type || 'auto');
  };
})();
