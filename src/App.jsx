import React, { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'abiding_prayer_ministry_v5';
const SETTINGS_KEY = 'abiding_prayer_settings_v5';
const DONATE_URL = 'https://www.fountainsoflife.org/donate/';


// FIX 1: Use local date consistently to avoid UTC timezone mismatch
// toISOString() returns UTC, which can show the wrong date for users west of UTC.
function getToday() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// FIX 3: Move tabs array outside component so it is never re-created on render.
const TABS = ['home', 'instructions', 'journal', 'meditation', 'progress', 'donate', 'settings'];

function triggerHaptic() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
}

// Shared AudioContext — must be created on a user gesture (button tap) to work on iOS.
// We create it once on Begin and reuse it for the end-of-timer bell.
let sharedAudioCtx = null;

function getAudioCtx() {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume in case it was suspended (iOS suspends on background)
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function playBell() {
  try {
    const ctx = getAudioCtx();
    const frequencies = [523.25, 659.25]; // C5 + E5

    frequencies.forEach((freq) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(freq, ctx.currentTime);

      gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 3);
    });
  } catch {
    // Audio not supported — fail silently
  }
}

// FIX 1 (continued): calcStreak uses the same local-date helper so dates always match.
function calcStreak(entries) {
  const uniqueDays = [...new Set(entries.map((e) => e.date))].sort().reverse();
  let streak = 0;
  const cursor = new Date();

  while (true) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    if (uniqueDays.includes(dateStr)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

function randomMs(minMinutes, maxMinutes) {
  const min = minMinutes * 60 * 1000;
  const max = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function practiceScore(entry) {
  const count = [entry.thanks, entry.guarded, entry.prayed, entry.grace].filter(Boolean).length;
  return Math.round((count / 4) * 100);
}

function averageScore(entries) {
  if (!entries.length) return 0;
  return Math.round(entries.reduce((sum, entry) => sum + practiceScore(entry), 0) / entries.length);
}

// ============================================================
// Reflection feedback engine — rule-based, deterministic.
// Templates are picked by a stable hash of today's date so the
// same day shows the same message but different days vary.
// All output is grounded in real counts and trends.
// ============================================================

const THEME_DEFINITIONS = [
  { key: 'anxiety',   pattern: /\b(anx\w*|worri\w*|worry|fear\w*|afraid|scared|stress\w*|overwhelm\w*|panic|nervous|dread|restless)\b/gi },
  { key: 'control',   pattern: /\b(control\w*|fix|figure (?:it|this|that) out|manage|forc\w*|grip|micromanag\w*)\b/gi },
  { key: 'gratitude', pattern: /\b(thank\w*|grateful|gratitude|praise|bless\w*|appreciat\w*|rejoic\w*)\b/gi },
  { key: 'grace',     pattern: /\b(grace|mercy|weak\w*|surrender\w*|depend\w*|trust|help me)\b/gi },
  { key: 'conflict',  pattern: /\b(frustrat\w*|angry|anger|irritat\w*|annoy\w*|complain\w*|resent\w*|bitter|hurt|offend\w*|argu\w*)\b/gi },
  { key: 'fatigue',   pattern: /\b(tired|exhaust\w*|weary|drain\w*|burn(?:ed)? out|fatigu\w*|spent|depleted)\b/gi },
  { key: 'presence',  pattern: /\b(presence|still\w*|silent\w*|silence|quiet|abide|abiding|listen\w*)\b/gi },
  { key: 'distract',  pattern: /\b(distract\w*|scatter\w*|busy|rush\w*|hurry|noise|forgot|forget)\b/gi },
  { key: 'doubt',     pattern: /\b(doubt\w*|question\w*|why does|where is god|unsure|confus\w*)\b/gi },
  { key: 'hope',      pattern: /\b(hope\w*|expect\w*|anticipat\w*|looking forward|promise\w*)\b/gi },
];

const THEME_LABELS = {
  anxiety:   'anxiety or fear',
  control:   'trying to manage outcomes',
  gratitude: 'gratitude',
  grace:     'awareness of need and grace',
  conflict:  'frustration or relational strain',
  fatigue:   'tiredness',
  presence:  "attention to God's presence",
  distract:  'distraction or hurry',
  doubt:     'questioning or doubt',
  hope:      'hope and expectation',
};

const PRACTICE_LABELS = {
  thanks:  'thanksgiving in everything',
  grace:   'asking for grace',
  prayed:  'communicating with God through the day',
  guarded: 'keeping your soul',
};

function countThemes(entries) {
  const text = entries.map((e) => e.text).join(' ');
  const counts = {};
  for (const { key, pattern } of THEME_DEFINITIONS) {
    counts[key] = (text.match(pattern) || []).length;
  }
  return counts;
}

function topThemes(counts, n = 2) {
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// FNV-1a hash of today's local date — stable per day, varies day-to-day.
function dailySeed() {
  const t = getToday();
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function pickFrom(arr, seed) {
  return arr[seed % arr.length];
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Split entries into the most recent `windowDays` and the prior window of equal size.
function partitionByWindow(entries, windowDays = 7) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const innerStart = new Date(today);  innerStart.setDate(innerStart.getDate() - windowDays + 1);
  const outerStart = new Date(today);  outerStart.setDate(outerStart.getDate() - 2 * windowDays + 1);
  const thisWindow = [], priorWindow = [];
  for (const e of entries) {
    const d = parseLocalDate(e.date);
    if (d >= innerStart) thisWindow.push(e);
    else if (d >= outerStart) priorWindow.push(e);
  }
  return { thisWindow, priorWindow };
}

// Days between today's most recent entry and the day before it (only if today has an entry).
function priorGapDays(entries) {
  const days = [...new Set(entries.map((e) => e.date))].sort().reverse();
  if (days.length < 2 || days[0] !== getToday()) return null;
  return Math.round((parseLocalDate(days[0]) - parseLocalDate(days[1])) / 86400000);
}

const ENCOURAGEMENT_HIGH = [
  'There is a beautiful rhythm forming. Stay soft, grateful, and dependent.',
  'A real cadence is here. Hold it with open hands.',
  'Consistency is shaping you. Receive it as gift, not achievement.',
  'The practice is settling in. Let it be quiet, not striving.',
];

const ENCOURAGEMENT_MID = [
  'There is real movement here. Let consistency matter more than intensity.',
  'You are showing up. That is most of the work.',
  'The shape of the practice is taking hold. Keep going gently.',
  'Steady is better than perfect. Stay with it.',
];

const ENCOURAGEMENT_LOW = [
  'Keep returning without self-judgment.',
  'Begin again, simply. That is the practice.',
  'Small returns are still returns. Tomorrow, one honest sentence is enough.',
  'There is no failing here — only beginning again.',
];

const RETURN_AFTER_BREAK = [
  'You returned after a pause. Returning is the practice.',
  'A break, then a return — that cycle is the path itself.',
  'You came back. That counts more than the gap.',
];

const FIRST_ENTRY = [
  'Begin with one honest reflection. Abiding grows through simple returning, not pressure.',
  'A single entry is a real beginning. There is no minimum here.',
  'Start with what is actually true today, however small.',
];

function reflectionSummary(entries) {
  const seed = dailySeed();
  if (!entries.length) return pickFrom(FIRST_ENTRY, seed);

  const recent = entries.slice(0, 14);
  const counts = countThemes(recent);
  const top = topThemes(counts, 2);
  const avg = averageScore(recent);

  // Theme sentence — surface up to two threads.
  let themeSentence;
  if (top.length === 0) {
    themeSentence = 'Your recent reflections show a quiet, steady tone.';
  } else if (top.length === 1) {
    themeSentence = `A repeated theme of ${THEME_LABELS[top[0]]} appears in your recent reflections.`;
  } else {
    themeSentence = `Two threads stand out recently: ${THEME_LABELS[top[0]]} and ${THEME_LABELS[top[1]]}.`;
  }

  // Trend sentence — compare top theme this week vs last.
  const { thisWindow, priorWindow } = partitionByWindow(entries, 7);
  let trendSentence = '';
  if (top[0] && thisWindow.length >= 2 && priorWindow.length >= 2) {
    const a = countThemes(thisWindow)[top[0]];
    const b = countThemes(priorWindow)[top[0]];
    if (b > 0 && a < b) trendSentence = ' It appears less often this week than last — a small easing.';
    else if (a > b * 1.5 + 1) trendSentence = ' It has grown this week — worth noticing without judgment.';
  }

  // Comeback prefix — different tone when returning after a 3+ day pause.
  const gap = priorGapDays(entries);
  const prefix = gap !== null && gap >= 3 ? `${pickFrom(RETURN_AFTER_BREAK, seed)} ` : '';

  // Encouragement pool by score.
  const pool = avg >= 75 ? ENCOURAGEMENT_HIGH : avg >= 50 ? ENCOURAGEMENT_MID : ENCOURAGEMENT_LOW;
  return `${prefix}${themeSentence}${trendSentence} ${pickFrom(pool, seed)}`;
}

const PRACTICE_PROMPTS = {
  thanks: [
    'Where can you thank God today without denying difficulty?',
    'What is one ordinary thing you can name with gratitude this morning?',
    'What good thing today might pass unnoticed if you do not pause to thank Him?',
    'Try ending the day naming three small mercies, even if the day was hard.',
  ],
  guarded: [
    'What thought pattern needs to be released instead of rehearsed?',
    'What conversation are you replaying that you can hand over today?',
    'Where is your mind drifting that does not need your attention?',
    'What worry is taking up space that could be given back to God?',
  ],
  prayed: [
    'What would it look like to speak to God in the middle of ordinary tasks today?',
    'Try a one-sentence prayer between tasks today, without leaving where you are.',
    'When you feel the next pull of stress, turn it into a sentence to God.',
    'What part of today have you not yet talked to Him about?',
  ],
  grace: [
    'What task or relationship right now needs grace rather than striving?',
    'Where are you working in your own strength when you could ask for His?',
    'Name one thing today where you will deliberately ask for grace before starting.',
    'Where is weakness inviting dependence rather than effort?',
  ],
};

const THEME_INVITATIONS = {
  anxiety: [
    'Anxiety appears often in your reflections. What single fear could you name to God today rather than carry?',
    'When fear rises today, try one breath and one sentence: "I trust You with this."',
    'What is one worry you could write down and deliberately leave on the page?',
  ],
  control: [
    'You write often about managing or fixing. What outcome could you deliberately leave with Him today?',
    'Try naming one situation today and saying: "This is not mine to hold."',
    'Where could you let something be unresolved without rushing to solve it?',
  ],
  conflict: [
    'Frustration appears repeatedly. Who could you pray for today rather than rehearse against?',
    'Where could grace replace the next reaction?',
    'What story are you carrying about someone that could be set down today?',
  ],
  fatigue: [
    'Tiredness shows up often. What rest could you receive as gift rather than earn?',
    'Where is exhaustion inviting honesty rather than more effort?',
    'What is one expectation you could let go of today?',
  ],
  distract: [
    'Hurry appears often. What is one small place today you could move slower than required?',
    'When you notice yourself rushing, that is the bell — return to Him there.',
    'What is one transition today you could walk through prayerfully instead of mentally elsewhere?',
  ],
};

function nextInvitation(entries) {
  const seed = dailySeed();

  if (!entries.length) {
    return pickFrom([
      'Ask God for grace for the next small thing in front of you.',
      'Begin with one honest sentence about today and one short prayer.',
      'Name one mercy in the past hour and let that be enough to start.',
    ], seed);
  }

  const recent = entries.slice(0, 10);
  const counts = countThemes(recent);
  const top = topThemes(counts, 1)[0];

  // Theme override when a theme is strong (3+ matches in last 10 entries).
  if (top && THEME_INVITATIONS[top] && counts[top] >= 3) {
    return pickFrom(THEME_INVITATIONS[top], seed);
  }

  // Otherwise: surface the practice that's been checked least often.
  const totals = {
    thanks:  recent.filter((e) => e.thanks).length,
    grace:   recent.filter((e) => e.grace).length,
    prayed:  recent.filter((e) => e.prayed).length,
    guarded: recent.filter((e) => e.guarded).length,
  };
  const lowest = Object.entries(totals).sort((a, b) => a[1] - b[1])[0][0];
  return `Your next gentle invitation may be ${PRACTICE_LABELS[lowest]}. ${pickFrom(PRACTICE_PROMPTS[lowest], seed)}`;
}

function weeklyNarrative(entries) {
  if (!entries.length) return 'Your weekly reflection will appear here after a few entries.';

  const { thisWindow, priorWindow } = partitionByWindow(entries, 7);
  if (!thisWindow.length) {
    return 'No entries in the last seven days. The next return is the next entry — no need to make up for the gap.';
  }

  const days = new Set(thisWindow.map((e) => e.date)).size;
  const count = thisWindow.length;
  const avg = averageScore(thisWindow);
  const priorAvg = priorWindow.length ? averageScore(priorWindow) : null;

  const parts = [];
  parts.push(`Over the last 7 days you wrote ${count} ${count === 1 ? 'entry' : 'entries'} across ${days} ${days === 1 ? 'day' : 'days'}, averaging ${avg}%.`);

  if (priorAvg !== null) {
    const delta = avg - priorAvg;
    if (delta >= 10) parts.push(`That is up from ${priorAvg}% the week before — a real lift.`);
    else if (delta <= -10) parts.push(`That is down from ${priorAvg}% the week before. Worth noticing, gently.`);
    else parts.push(`Similar to ${priorAvg}% the week before — steadiness is its own form of growth.`);
  }

  const top = topThemes(countThemes(thisWindow), 1)[0];
  if (top) parts.push(`The thread that surfaces most this week is ${THEME_LABELS[top]}.`);

  const totals = {
    thanks:  thisWindow.filter((e) => e.thanks).length,
    grace:   thisWindow.filter((e) => e.grace).length,
    prayed:  thisWindow.filter((e) => e.prayed).length,
    guarded: thisWindow.filter((e) => e.guarded).length,
  };
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const high = sorted[0], low = sorted[sorted.length - 1];
  if (high[1] > 0 && high[1] !== low[1]) {
    parts.push(`Strongest practice: ${PRACTICE_LABELS[high[0]]}. Quietest: ${PRACTICE_LABELS[low[0]]}.`);
  }

  if (avg >= 75) parts.push('Stay grateful, stay dependent.');
  else if (avg >= 50) parts.push('Consistency over intensity — keep returning.');
  else parts.push('Begin again with simple trust.');

  return parts.join(' ');
}

// Pattern Discernment — different from reflectionSummary. Looks at structural
// signals (weekday rhythm, entry length, practice pairings) rather than themes.
function patternDiscernment(entries) {
  if (entries.length < 5) {
    return 'Patterns become visible after a few more entries. Keep going gently.';
  }

  const observations = [];

  // Weekday rhythm — needs at least 3 weekdays with 2+ entries each.
  const byDay = {};
  for (const e of entries.slice(0, 30)) {
    const dow = parseLocalDate(e.date).getDay();
    (byDay[dow] = byDay[dow] || []).push(practiceScore(e));
  }
  const dayAvgs = Object.entries(byDay)
    .filter(([, arr]) => arr.length >= 2)
    .map(([d, arr]) => [Number(d), arr.reduce((a, b) => a + b, 0) / arr.length]);
  if (dayAvgs.length >= 3) {
    const dayNames = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
    dayAvgs.sort((a, b) => b[1] - a[1]);
    const best = dayAvgs[0], worst = dayAvgs[dayAvgs.length - 1];
    if (best[1] - worst[1] >= 15) {
      observations.push(`${dayNames[best[0]]} tend to show the steadiest practice; ${dayNames[worst[0]]} feel harder.`);
    }
  }

  // Entry length signal — longer entries scoring higher suggests reflection time matters.
  const longScores = entries.filter((e) => e.text.length >= 200).map(practiceScore);
  const shortScores = entries.filter((e) => e.text.length < 80).map(practiceScore);
  if (longScores.length >= 3 && shortScores.length >= 3) {
    const longAvg = longScores.reduce((a, b) => a + b, 0) / longScores.length;
    const shortAvg = shortScores.reduce((a, b) => a + b, 0) / shortScores.length;
    if (longAvg - shortAvg >= 15) {
      observations.push('Your longer entries tend to score higher — taking time to write seems to deepen the practice.');
    }
  }

  // Practice pairing.
  const both = entries.filter((e) => e.thanks && e.grace).length;
  if (entries.length >= 10 && both / entries.length >= 0.5) {
    observations.push('Thanks and grace often appear together for you — a natural pairing in your practice.');
  }

  if (!observations.length) {
    return 'Your practice is unfolding without strong patterns yet — that itself is a kind of steadiness.';
  }

  return observations.join(' ');
}

function installMessage(isStandalone) {
  if (isStandalone) return 'Installed on your device.';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIPhone = /iPhone|iPad|iPod/i.test(ua);
  if (isIPhone) return '';
  return 'Install this app from your browser menu or the install button when available.';
}

function getReminderMessage() {
  const messages = [
    'Prayer Break — pause and turn your attention to God\'s presence.',
    'Pause and worship God quietly within. He is near.',
    'Return gently to God. Let go and trust Him in this moment.',
    'Ask for grace right now — He is with you.',
    'Turn inward and enjoy God\'s presence in secret.',
    'Give thanks here, even in this moment.',
    'Release control and rest in God\'s care.',
    'Speak to God now, simply and honestly.',
    'Let your heart turn toward Him again.',
    'Be still and know He is with you.',
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function sendNotification() {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Abiding Prayer', { body: getReminderMessage() });
  }
}

function BrandBadge({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-600">
      {children}
    </span>
  );
}

function TabButton({ active, icon, label, onClick }) {
  return (
    <button
      onClick={() => {
        triggerHaptic();
        onClick();
      }}
      className={`relative z-10 flex-1 text-center py-2 rounded-2xl transition-all duration-300 ${active ? 'text-white' : 'text-stone-500'}`}
    >
      <div className="text-lg leading-none">{icon}</div>
      <div className="text-[11px] mt-1">{label}</div>
    </button>
  );
}

export default function JournalingApp() {
  const [entries, setEntries] = useState([]);
  const [text, setText] = useState('');

  // FIX 5: Single source of truth for tab state — derive activeTab from index,
  // eliminating the dual-state sync that was error-prone.
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const activeTab = TABS[activeTabIndex];

  const [thanks, setThanks] = useState(false);
  const [guarded, setGuarded] = useState(false);
  const [prayed, setPrayed] = useState(false);
  const [grace, setGrace] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [meditationMinutes, setMeditationMinutes] = useState(10);
  const [remainingSeconds, setRemainingSeconds] = useState(600);
  const [timerRunning, setTimerRunning] = useState(false);

  const idleTimer = useRef(null);
  const randomTimer = useRef(null);
  const meditationInterval = useRef(null);

  useEffect(() => {
    const savedEntries = localStorage.getItem(STORAGE_KEY);
    const savedSettings = localStorage.getItem(SETTINGS_KEY);

    if (savedEntries) {
      try { setEntries(JSON.parse(savedEntries)); } catch {}
    }
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setNotificationsEnabled(!!parsed.notificationsEnabled);
      } catch {}
    }

    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standalone || window.navigator.standalone === true);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ notificationsEnabled }));
  }, [notificationsEnabled]);

  // FIX 7: Request permission first, then schedule — avoids the race condition
  // where scheduleRandom() ran before permission was granted.
  useEffect(() => {
    if (!notificationsEnabled) return;
    if (!('Notification' in window)) return;

    let cancelled = false;

    function scheduleRandom() {
      if (cancelled) return;
      randomTimer.current = setTimeout(() => {
        sendNotification();
        scheduleRandom();
      }, randomMs(45, 120));
    }

    if (Notification.permission === 'granted') {
      scheduleRandom();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (!cancelled && permission === 'granted') scheduleRandom();
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
      clearTimeout(randomTimer.current);
    };
  }, [notificationsEnabled]);

  // FIX 4: Idle timer — bail out early when notifications are disabled,
  // so event listeners are never attached unnecessarily.
  useEffect(() => {
    if (!notificationsEnabled) return;

    function resetIdle() {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(sendNotification, 20 * 60 * 1000);
    }

    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);
    window.addEventListener('touchstart', resetIdle);
    resetIdle();

    return () => {
      clearTimeout(idleTimer.current);
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('keydown', resetIdle);
      window.removeEventListener('touchstart', resetIdle);
    };
  }, [notificationsEnabled]);

  useEffect(() => {
    setRemainingSeconds(meditationMinutes * 60);
  }, [meditationMinutes]);

  useEffect(() => {
    if (!timerRunning) {
      clearInterval(meditationInterval.current);
      return;
    }

    meditationInterval.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(meditationInterval.current);
          setTimerRunning(false);
          playBell();
          triggerHaptic();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(meditationInterval.current);
  }, [timerRunning]);

  const addEntry = () => {
    if (!text.trim()) return;

    const newEntry = {
      id: Date.now(),
      text,
      date: getToday(),
      thanks,
      guarded,
      prayed,
      grace,
    };

    setEntries((prev) => [newEntry, ...prev]);
    setText('');
    setThanks(false);
    setGuarded(false);
    setPrayed(false);
    setGrace(false);
    triggerHaptic();

    // FIX 2: Derive the progress tab index from the TABS array instead of hardcoding 4.
    setActiveTabIndex(TABS.indexOf('progress'));
  };

  const deleteEntry = (id) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    triggerHaptic();
  };

  // FIX 5 (continued): Single switchTab function using activeTabIndex only.
  const switchTab = (index) => setActiveTabIndex(index);

  const startMeditation = () => {
    setRemainingSeconds(meditationMinutes * 60);
    playBell();
    triggerHaptic();
    setTimerRunning(true);
  };

  const pauseMeditation = () => setTimerRunning(false);

  const resetMeditation = () => {
    clearInterval(meditationInterval.current);
    setTimerRunning(false);
    setRemainingSeconds(meditationMinutes * 60);
  };

  const streak = useMemo(() => calcStreak(entries), [entries]);
  const avgScore = useMemo(() => averageScore(entries), [entries]);
  const insight = useMemo(() => reflectionSummary(entries), [entries]);
  const invitation = useMemo(() => nextInvitation(entries), [entries]);
  const weekly = useMemo(() => weeklyNarrative(entries), [entries]);
  const patterns = useMemo(() => patternDiscernment(entries), [entries]);
  const installText = useMemo(() => installMessage(isStandalone), [isStandalone]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-stone-100 to-white p-4">
      <div className="max-w-md mx-auto space-y-6 pb-24">
        <div className="bg-stone-900 text-amber-50 rounded-3xl p-5 shadow-2xl border border-stone-700 space-y-4">
          <div className="space-y-2">
            <BrandBadge>Fountains of Life</BrandBadge>
            <div>
              <h1 className="text-2xl font-serif">Abiding Prayer</h1>
              <p className="text-sm text-amber-100 italic">That I May Know Him</p>
            </div>
          </div>
          <p className="text-sm text-stone-200">A contemplative ministry companion for prayer, surrender, and steady awareness of God's presence.</p>
          <div className="bg-white/10 rounded-2xl p-4 text-sm space-y-2">
            <p><strong>Goal:</strong> Learning to live continuously in God's presence and trusting God instead of controlling outcomes.</p>
            <p>{installText}</p>
          </div>
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noreferrer"
            className="block rounded-2xl border border-stone-500 text-amber-50 py-3 text-center"
          >
            Support Missions
          </a>
        </div>

        {activeTab === 'home' && (
          <div className="space-y-4">
            <div className="bg-white/85 backdrop-blur rounded-3xl border border-stone-200 p-5 shadow-sm space-y-3">
              <BrandBadge>Practice the Presence</BrandBadge>
              <p className="text-xs uppercase tracking-[0.2em] text-stone-400">TACK — How to Practice</p>
              <ul className="space-y-2 text-sm text-stone-700">
                <li>• <strong>Thanksgiving</strong> in everything.</li>
                <li>• <strong>Asking</strong> God for grace for every task.</li>
                <li>• <strong>Communicate</strong> with God all day long.</li>
                <li>• <strong>Keep</strong> your soul from negative dwelling, judgment, and obsession.</li>
              </ul>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-400 mb-2">Reflection Insight</p>
              <p className="text-stone-700">{insight}</p>
            </div>

            <div className="bg-white rounded-3xl border border-stone-200 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-400 mb-2">Next Gentle Invitation</p>
              <p className="text-stone-700">{invitation}</p>
            </div>
          </div>
        )}

        {activeTab === 'instructions' && (
          <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5 shadow-sm text-stone-700 space-y-4">
            <BrandBadge>Instructions</BrandBadge>
            <h2 className="text-xl font-serif font-semibold text-stone-800">Instructions Page</h2>

            <p><strong>Goal:</strong> Learning to live continuously in God's presence. Growing ever deeper in letting go of trying to control outcomes and trusting God instead.</p>

            <p>We focus on two types of prayer:</p>
            <ol className="list-decimal pl-5 text-sm space-y-1">
              <li>Sitting in God's presence. Say some words of love, praise, thanksgiving… and then be still and wait in His presence. When you start to lose focus, say some more words of love to God.</li>
              <li>Prayer without ceasing. This is seeking to maintain awareness of God's presence all day long.</li>
            </ol>

            <p>Here is a quick reference of the steps for Abiding Prayer. You can use these to help with your journaling for discovering where you still need to grow. Practicing daily will build the habit of living in God's presence.</p>

            <div>
              <h3 className="font-semibold mb-1">TACK</h3>
              <p className="text-sm mb-2">To fasten or attach your heart to God — 4 steps:</p>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li><strong>Thanksgiving</strong> for everything that happens. Not that He authors bad things but that He is bigger and able to help and work all for good.</li>
                <li><strong>Asking</strong> God for grace for every task.</li>
                <li><strong>Communicate</strong> with God all day long, seeking to stay in conscious contact with Him.</li>
                <li><strong>Keep</strong> your soul according to God's desires. Seek to avoid dwelling on negative things, not judging others, nor obsessing over figuring things out. Rather constantly choosing God's presence and praising Him.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Journaling Examples</h3>
              <ul className="list-disc pl-5 text-sm space-y-1">
                <li>I got frustrated in slow traffic. Not trusting God for His timing and rather complaining.</li>
                <li>I asked for grace to be around a difficult person at work and was able to maintain a loving attitude towards them.</li>
              </ul>
            </div>

            <p className="italic text-sm">The point is not worrying about how well you did but accepting whatever happens, acknowledging that apart from God you can do nothing. Then, choose to be in God's presence and trust Him to change you. Acknowledging your weakness so His strength will come.</p>

            <p className="text-sm">The process of learning to live in God's presence is not about measuring progress nor about condemning yourself. It is a process of discovering how to trust God in the midst of our weaknesses.</p>
          </div>
        )}

        {activeTab === 'journal' && (
          <div className="bg-white/92 backdrop-blur rounded-3xl shadow-2xl p-6 space-y-4 border border-stone-200">
            <div className="text-center space-y-1">
              <BrandBadge>Daily Reflection</BrandBadge>
              <h2 className="text-3xl font-serif text-stone-800">Abiding Prayer</h2>
              <p className="text-sm text-stone-500">Write your prayer, reflection, or gratitude.</p>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-32 p-4 border rounded-2xl border-stone-200 bg-stone-50"
              placeholder="What happened today, and where is God inviting trust?"
            />

            <p className="text-sm text-stone-500 mt-1">Tap any of these four steps that applied today</p>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: 'Thanksgiving', state: thanks,  set: setThanks  },
                { label: 'Asking',       state: grace,   set: setGrace   },
                { label: 'Communicate',  state: prayed,  set: setPrayed  },
                { label: 'Keep',         state: guarded, set: setGuarded },
              ].map(({ label, state, set }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { triggerHaptic(); set((v) => !v); }}
                  aria-pressed={state}
                  className={`rounded-xl px-3 py-2 border text-left transition-colors ${
                    state
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'bg-stone-50 text-stone-700 border-stone-200'
                  }`}
                >
                  {state ? '✓ ' : ''}{label}
                </button>
              ))}
            </div>

            <button onClick={addEntry} className="w-full bg-stone-800 text-white rounded-2xl py-3 shadow-md active:scale-[0.98] transition-all duration-200">
              Save Entry
            </button>

            <div className="space-y-3">
              {entries.length === 0 ? (
                <p className="text-center text-sm text-stone-400">No entries yet.</p>
              ) : (
                entries.map((entry) => (
                  <div key={entry.id} className="border border-stone-200 rounded-2xl p-4 shadow-sm bg-stone-50">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-xs text-stone-400">{entry.date}</p>
                      <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-stone-700">{practiceScore(entry)}%</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-stone-700">{entry.text}</p>
                    <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-stone-500">
                      {entry.thanks && <span className="px-2 py-1 rounded-full bg-white border border-stone-200">Thanksgiving</span>}
                      {entry.grace && <span className="px-2 py-1 rounded-full bg-white border border-stone-200">Asking</span>}
                      {entry.prayed && <span className="px-2 py-1 rounded-full bg-white border border-stone-200">Communicate</span>}
                      {entry.guarded && <span className="px-2 py-1 rounded-full bg-white border border-stone-200">Keep</span>}
                    </div>
                    <button onClick={() => deleteEntry(entry.id)} className="mt-3 text-red-500 text-sm">
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'meditation' && (
          <div className="bg-white border border-stone-200 rounded-3xl p-6 space-y-5 shadow-xl text-center">
            <BrandBadge>Meditation Prayer</BrandBadge>
            <h2 className="font-serif text-2xl text-stone-800">Meditation Prayer Timer</h2>
            <p className="text-stone-600">Set a time to become still before God. The timer begins and ends with a church bell.</p>

            <div className="rounded-3xl bg-stone-900 text-amber-50 p-8 shadow-inner">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-200 mb-3">Remaining Time</p>
              <p className="text-5xl font-serif">{formatTime(remainingSeconds)}</p>
            </div>

            <div className="space-y-2 text-left">
              <label className="block text-sm text-stone-600">Minutes</label>
              <input
                type="range"
                min="1"
                max="60"
                value={meditationMinutes}
                onChange={(e) => setMeditationMinutes(Number(e.target.value))}
                disabled={timerRunning}
                className="w-full"
              />
              <p className="text-center text-stone-700 font-medium">{meditationMinutes} minute{meditationMinutes === 1 ? '' : 's'}</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button onClick={startMeditation} disabled={timerRunning} className="rounded-2xl bg-stone-800 text-white py-3 disabled:opacity-50">
                Begin
              </button>
              <button onClick={pauseMeditation} disabled={!timerRunning} className="rounded-2xl border border-stone-200 py-3 disabled:opacity-50">
                Pause
              </button>
              <button onClick={resetMeditation} className="rounded-2xl border border-stone-200 py-3">
                Reset
              </button>
            </div>

            <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 text-left text-sm text-stone-700">
              <p className="font-medium mb-2">Prayer Suggestion</p>
              <p>Be still before God. Turn your attention inward, worship Him from the depths of your spirit, and enjoy Him there in secret.</p>
            </div>
          </div>
        )}

        {activeTab === 'progress' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-3xl bg-white border border-stone-200 p-5 shadow-sm text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-stone-400">Streak</p>
                <p className="text-3xl mt-2">🔥 {streak}</p>
              </div>
              <div className="rounded-3xl bg-white border border-stone-200 p-5 shadow-sm text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-stone-400">Average Score</p>
                <p className="text-3xl mt-2">{avgScore}%</p>
              </div>
            </div>

            <div className="rounded-3xl bg-amber-50 border border-amber-100 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-400 mb-2">Weekly Reflection</p>
              <p className="text-stone-700">{weekly}</p>
            </div>

            <div className="rounded-3xl bg-white border border-stone-200 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-stone-400 mb-2">Pattern Discernment</p>
              <p className="text-stone-700">{patterns}</p>
            </div>
          </div>
        )}

        {activeTab === 'donate' && (
          <div className="bg-white border border-stone-200 rounded-3xl p-6 space-y-4 shadow-xl text-center">
            <BrandBadge>Support the Mission</BrandBadge>
            <h2 className="font-serif text-2xl text-stone-800">Partner With Fountains of Life</h2>
            <p className="text-stone-600">Support this ministry and the ongoing work of sharing prayer, spiritual formation, and mission outreach.</p>
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noreferrer"
              className="block w-full rounded-2xl bg-stone-800 text-white py-3 shadow-md"
            >
              Donate to Our Missions Work
            </a>
            <p className="text-xs text-stone-400">You will be taken to the Fountains of Life donation page.</p>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white border border-stone-200 rounded-3xl p-6 space-y-4 shadow-xl">
            <h2 className="font-serif text-xl text-stone-800">Settings</h2>
            <div className="rounded-2xl border border-stone-200 px-4 py-3 space-y-2">
              <div className="flex justify-between items-center">
                <span>Smart Reminders</span>
                <input type="checkbox" checked={notificationsEnabled} onChange={() => setNotificationsEnabled(!notificationsEnabled)} />
              </div>
              <p className="text-xs text-stone-500">Prayer Break - pause often throughout the day to worship God from the depths of your spirit and enjoy Him there in secret.</p>
            </div>
            <div className="rounded-2xl bg-stone-50 border border-stone-200 p-4 text-sm text-stone-600">
              <p>{installText}</p>
            </div>
          </div>
        )}

        {/* FIX 5 (continued): Tab bar uses activeTabIndex throughout — no dual state. */}
        <div className="sticky bottom-3 max-w-md mx-auto bg-white/95 backdrop-blur border border-stone-200 rounded-3xl shadow-lg px-1 py-2 flex justify-around overflow-hidden">
          <div
            className="absolute top-2 bottom-2 rounded-2xl bg-stone-800 transition-all duration-300"
            style={{ left: `${activeTabIndex * (100 / TABS.length)}%`, width: `${100 / TABS.length}%` }}
          />
          <TabButton active={activeTab === 'home'}         icon="🏠" label="Home"     onClick={() => switchTab(0)} />
          <TabButton active={activeTab === 'instructions'} icon="🕊️" label="Guide"    onClick={() => switchTab(1)} />
          <TabButton active={activeTab === 'journal'}      icon="📖" label="Journal"  onClick={() => switchTab(2)} />
          <TabButton active={activeTab === 'meditation'}   icon="⏳" label="Prayer"   onClick={() => switchTab(3)} />
          <TabButton active={activeTab === 'progress'}     icon="📈" label="Progress" onClick={() => switchTab(4)} />
          <TabButton active={activeTab === 'donate'}       icon="🤍" label="Donate"   onClick={() => switchTab(5)} />
          <TabButton active={activeTab === 'settings'}     icon="⚙️" label="Settings" onClick={() => switchTab(6)} />
        </div>
      </div>
    </div>
  );
}
