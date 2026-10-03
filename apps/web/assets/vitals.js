/*! PETAVU vitals — سنجش میدانی Core Web Vitals: بی‌کتابخانه، بی‌شناسه، بی‌کوکی. */
(function () {
  'use strict';

  var ENDPOINT = '/api/v1/public/vitals';
  var meta = document.querySelector('meta[name="pv-rum"]');

  // ناسازگاری یا نبودِ بودجه ⇒ سکوت. صفحه بدون این اسکریپت هم کامل کار می‌کند.
  if (!meta || typeof PerformanceObserver !== 'function' || typeof navigator.sendBeacon !== 'function') return;
  // «ردیابی نکن» محترم است؛ این سنجش شناسه ندارد، ولی انتخاب کاربر مقدم است.
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  // نرخ نمونه‌گیری از بودجهٔ همین مسیر می‌آید (داده، نه ثابت کد).
  var rate = parseFloat(meta.getAttribute('content'));
  if (!(rate > 0) || Math.random() >= rate) return;

  var values = {};
  var interactions = {};
  var sent = false;

  function observe(type, handler, extra) {
    try {
      var observer = new PerformanceObserver(function (list) {
        handler(list.getEntries());
      });
      var options = { type: type, buffered: true };
      for (var key in extra) options[key] = extra[key];
      observer.observe(options);
      return true;
    } catch (error) {
      return false; // نوع پشتیبانی نمی‌شود
    }
  }

  observe('largest-contentful-paint', function (entries) {
    values.lcp = entries[entries.length - 1].startTime;
  });

  observe('paint', function (entries) {
    for (var i = 0; i < entries.length; i += 1) {
      if (entries[i].name === 'first-contentful-paint') values.fcp = entries[i].startTime;
    }
  });

  // CLS: بدترین «پنجرهٔ نشست» (فاصلهٔ کمتر از ۱ثانیه، حداکثر ۵ثانیه) — تعریف رسمی.
  var windowValue = 0;
  var windowFirst = 0;
  var windowLast = 0;
  var worst = 0;
  if (
    observe('layout-shift', function (entries) {
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i];
        if (entry.hadRecentInput) continue;
        if (windowValue && entry.startTime - windowLast < 1000 && entry.startTime - windowFirst < 5000) {
          windowValue += entry.value;
        } else {
          windowValue = entry.value;
          windowFirst = entry.startTime;
        }
        windowLast = entry.startTime;
        if (windowValue > worst) worst = windowValue;
        values.cls = worst;
      }
    })
  ) {
    values.cls = 0;
  }

  // INP: کندترین تعامل (برای کمتر از ۵۰ تعامل)، وگرنه صدک ۹۸.
  observe(
    'event',
    function (entries) {
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i];
        if (!entry.interactionId) continue;
        if (!interactions[entry.interactionId] || entry.duration > interactions[entry.interactionId]) {
          interactions[entry.interactionId] = entry.duration;
        }
      }
    },
    { durationThreshold: 40 },
  );

  function inp() {
    var durations = [];
    for (var id in interactions) durations.push(interactions[id]);
    if (durations.length === 0) return undefined;
    durations.sort(function (a, b) {
      return b - a;
    });
    return durations[Math.min(durations.length - 1, Math.floor(durations.length / 50))];
  }

  function flush() {
    if (sent) return;

    var navigation = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (navigation && navigation.responseStart > 0) values.ttfb = navigation.responseStart;
    var interaction = inp();
    if (interaction !== undefined) values.inp = interaction;

    var width = window.innerWidth || 0;
    var common = {
      // فقط مسیر: بدون پرس‌وجو و لنگر (می‌توانند توکن داشته باشند).
      path: location.pathname,
      navigation_type: navigation && navigation.type ? navigation.type : 'unknown',
      connection: (navigator.connection && navigator.connection.effectiveType) || 'unknown',
      device_class: width === 0 ? 'unknown' : width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop',
    };

    var samples = [];
    var names = ['lcp', 'inp', 'cls', 'ttfb', 'fcp'];
    for (var i = 0; i < names.length; i += 1) {
      var value = values[names[i]];
      if (typeof value !== 'number' || !isFinite(value) || value < 0) continue;
      var sample = { metric: names[i], value: names[i] === 'cls' ? Math.round(value * 1000) / 1000 : Math.round(value) };
      for (var key in common) sample[key] = common[key];
      samples.push(sample);
    }
    if (samples.length === 0) return;

    sent = true;
    navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify({ samples: samples })], { type: 'application/json' }));
  }

  // استاندارد: هنگام پنهان‌شدن صفحه (تب، قفل، بستن) — قابل‌اتکاترین لحظه برای ارسال.
  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('pagehide', flush);
})();
