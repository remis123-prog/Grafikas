/**
 * Grafikas PWA - Darbo grafiko programėlė
 */

// ========== State ==========
let scheduleData = null;
let selectedTeacherIndex = 0;
let pMarks = {}; // { "teacherIndex_day": true }

// ========== Lithuanian Holidays ==========
const FIXED_HOLIDAYS = {
    1: [1],           // Sausio 1 - Naujieji metai
    2: [16],          // Vasario 16
    3: [11],          // Kovo 11
    5: [1],           // Gegužės 1
    6: [24],          // Birželio 24 - Joninės
    7: [6],           // Liepos 6
    8: [15],          // Rugpjūčio 15 - Žolinė
    11: [1, 2],       // Lapkričio 1-2
    12: [24, 25, 26]  // Gruodžio 24-26
};

const EASTER_DATES = {
    2024: { month: 3, days: [31] },
    2025: { month: 4, days: [20, 21] },
    2026: { month: 4, days: [5, 6] },
    2027: { month: 3, days: [28, 29] },
    2028: { month: 4, days: [16, 17] },
    2029: { month: 4, days: [1, 2] },
    2030: { month: 4, days: [21, 22] },
    2031: { month: 4, days: [13, 14] },
    2032: { month: 3, days: [28, 29] },
    2033: { month: 4, days: [17, 18] },
    2034: { month: 4, days: [9, 10] },
    2035: { month: 3, days: [25, 26] }
};

function isHoliday(year, month, day) {
    if (FIXED_HOLIDAYS[month] && FIXED_HOLIDAYS[month].includes(day)) return true;
    const easter = EASTER_DATES[year];
    if (easter && easter.month === month && easter.days.includes(day)) return true;
    return false;
}

// ========== Storage ==========
function getStoredUrl() { return localStorage.getItem('grafikas_url') || ''; }
function setStoredUrl(url) { localStorage.setItem('grafikas_url', url); }
function getStoredData() { try { return JSON.parse(localStorage.getItem('grafikas_data')); } catch { return null; } }
function setStoredData(data) { localStorage.setItem('grafikas_data', JSON.stringify(data)); }
function loadPMarks() { try { pMarks = JSON.parse(localStorage.getItem('grafikas_pmarks')) || {}; } catch { pMarks = {}; } }
function savePMarks() { localStorage.setItem('grafikas_pmarks', JSON.stringify(pMarks)); }
function getStoredTeacher() { return parseInt(localStorage.getItem('grafikas_teacher')) || 0; }
function setStoredTeacher(index) { localStorage.setItem('grafikas_teacher', index.toString()); }

// ========== UI Functions ==========
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('noData').classList.add('hidden');
    document.getElementById('calendarView').classList.add('hidden');
    document.getElementById('allTeachersView').classList.add('hidden');
}
function hideLoading() { document.getElementById('loading').classList.add('hidden'); }
function showNoData() {
    document.getElementById('noData').classList.remove('hidden');
    document.getElementById('calendarView').classList.add('hidden');
    document.getElementById('allTeachersView').classList.add('hidden');
}
function showCalendar() {
    document.getElementById('noData').classList.add('hidden');
    document.getElementById('calendarView').classList.remove('hidden');
    document.getElementById('allTeachersView').classList.remove('hidden');
}
function showSettings() {
    document.getElementById('settingsModal').classList.remove('hidden');
    document.getElementById('urlInput').value = getStoredUrl();
}
function hideSettings() { document.getElementById('settingsModal').classList.add('hidden'); }
function saveSettings() {
    setStoredUrl(document.getElementById('urlInput').value.trim());
    hideSettings();
    showToast('Nustatymai išsaugoti!', 'success');
}
function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ========== Data Loading ==========

// Ištraukti Google Drive failo ID iš URL
function extractGoogleDriveFileId(url) {
    const patterns = [
        /\/d\/([a-zA-Z0-9_-]+)/,
        /id=([a-zA-Z0-9_-]+)/,
        /\/file\/d\/([a-zA-Z0-9_-]+)/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// Visi galimi Google Drive atsisiuntimo URL formatai
function getGoogleDriveUrls(fileId) {
    return [
        `https://drive.google.com/uc?export=download&id=${fileId}`,
        `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
        `https://docs.google.com/uc?export=download&id=${fileId}`,
    ];
}

// CORS proxy sąrašas - jei vienas neveikia, bandomas kitas
const CORS_PROXIES = [
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://cors.eu.org/${url}`,
];

function convertOneDriveUrl(url) {
    const base64 = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `https://api.onedrive.com/v1.0/shares/u!${base64}/root/content`;
}

async function tryFetch(downloadUrl, label) {
    const cacheBuster = '_cb=' + Date.now();
    const separator = downloadUrl.includes('?') ? '&' : '?';
    const finalUrl = downloadUrl + separator + cacheBuster;
    console.log(`[${label}] Fetching:`, finalUrl);
    const response = await fetch(finalUrl);
    if (!response.ok) {
        throw new Error(`${label}: HTTP ${response.status}`);
    }
    const text = await response.text();
    // Patikrinti ar gavome JSON, ne HTML
    if (text.trim().startsWith('<')) {
        throw new Error(`${label}: Gautas HTML vietoj JSON`);
    }
    return text;
}

async function refreshData() {
    const url = getStoredUrl();
    showLoading();

    try {
        let text;

        // Jei URL tuščias arba "local" - bandyti įkelti iš lokalaus failo
        if (!url || url === 'local' || url === 'lokalus') {
            text = await tryFetch('grafikas_data.json', 'Local');
        } else if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            // Google Drive - bandyti kelis URL formatus per kelis proxy
            const fileId = extractGoogleDriveFileId(url);
            if (!fileId) throw new Error('Nepavyko ištraukti Google Drive failo ID iš URL');

            const driveUrls = getGoogleDriveUrls(fileId);
            let lastError;
            let found = false;

            // Bandyti kiekvieną proxy su kiekvienu Drive URL formatu
            for (let p = 0; p < CORS_PROXIES.length && !found; p++) {
                for (let u = 0; u < driveUrls.length && !found; u++) {
                    try {
                        const proxyUrl = CORS_PROXIES[p](driveUrls[u]);
                        text = await tryFetch(proxyUrl, `Proxy${p + 1}/URL${u + 1}`);
                        console.log(`✓ Pavyko su Proxy #${p + 1}, URL formatas #${u + 1}`);
                        found = true;
                    } catch (err) {
                        lastError = err;
                        console.warn(`✗ Proxy #${p + 1}/URL #${u + 1}:`, err.message);
                    }
                }
            }
            if (!found) {
                throw new Error('Nepavyko pasiekti Google Drive failo. Bandykite vėliau arba naudokite "local" režimą.\nPaskutinė klaida: ' + lastError.message);
            }
        } else if (url.includes('1drv.ms') || url.includes('onedrive.live.com')) {
            // OneDrive
            const convertedUrl = convertOneDriveUrl(url);
            let lastError;
            let found = false;
            for (let p = 0; p < CORS_PROXIES.length && !found; p++) {
                try {
                    const proxyUrl = CORS_PROXIES[p](convertedUrl);
                    text = await tryFetch(proxyUrl, `Proxy${p + 1}`);
                    console.log(`✓ OneDrive: Proxy #${p + 1} veikia!`);
                    found = true;
                } catch (err) {
                    lastError = err;
                    console.warn(`✗ OneDrive Proxy #${p + 1}:`, err.message);
                }
            }
            if (!found) {
                throw new Error('Nepavyko pasiekti OneDrive failo. Paskutinė klaida: ' + lastError.message);
            }
        } else {
            // Kitas URL (pvz. GitHub raw, tiesioginis JSON)
            text = await tryFetch(url, 'Direct');
        }

        const data = JSON.parse(text);
        if (!data.teachers || !data.year || !data.month) throw new Error('Neteisingas JSON formatas');
        scheduleData = data;
        setStoredData(data);
        hideLoading();
        renderApp();
        showToast('Duomenys atnaujinti!', 'success');
    } catch (error) {
        console.error('Klaida:', error);
        hideLoading();
        const cached = getStoredData();
        if (cached) { scheduleData = cached; renderApp(); showToast('Klaida atnaujinant. Rodomi seni duomenys.', 'error'); }
        else { showNoData(); showToast('Klaida: ' + error.message, 'error'); }
    }
}

// ========== Rendering ==========
function renderApp() {
    if (!scheduleData) { showNoData(); return; }
    document.getElementById('title').textContent = `${scheduleData.year} ${scheduleData.monthName}`;
    const select = document.getElementById('teacherSelect');
    select.innerHTML = '';
    scheduleData.teachers.forEach((t, i) => {
        const opt = document.createElement('option');
        opt.value = i; opt.textContent = t.name;
        select.appendChild(opt);
    });
    // Atkurti išsaugotą auklėtoją
    const savedTeacher = getStoredTeacher();
    if (savedTeacher < scheduleData.teachers.length) {
        selectedTeacherIndex = savedTeacher;
    }
    select.value = selectedTeacherIndex;
    renderCalendar();
    renderAllTeachers();
    showCalendar();
}

function renderCalendar() {
    if (!scheduleData) return;
    selectedTeacherIndex = parseInt(document.getElementById('teacherSelect').value) || 0;
    setStoredTeacher(selectedTeacherIndex); // Išsaugoti pasirinkimą
    const teacher = scheduleData.teachers[selectedTeacherIndex];
    if (!teacher) return;
    const year = scheduleData.year, month = scheduleData.month;
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    const adjustedFirstDay = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

    let html = '<div class="weekdays">';
    ['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'].forEach((d, i) => {
        html += `<div class="weekday ${i >= 5 ? 'weekend' : ''}">${d}</div>`;
    });
    html += '</div><div class="days">';
    for (let i = 0; i < adjustedFirstDay; i++) html += '<div class="day empty-cell"></div>';

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const holiday = isHoliday(year, month, day);
        let status = teacher.schedule[day.toString()] || '';
        const pMarkKey = `${year}_${month}_${selectedTeacherIndex}_${day}`;
        const hasPMark = pMarks[pMarkKey];
        if (hasPMark && status === '') status = 'P';

        let className = 'day', canEdit = false;
        if (isWeekend || holiday) className += ' weekend';
        else if (status === 'P') className += ' pavadavimas';
        else if (status === 'M') className += ' mamadienis';
        else if (status === 'DN') className += ' no-contact';
        else if (status.startsWith('D') && status !== '') className += ' working';
        else { className += ' off'; canEdit = true; }
        if (canEdit) className += ' editable';
        if (hasPMark) { canEdit = true; className = className.replace(' off', ''); }

        // Long press events for P mark toggle (500ms)
        const dataAttrs = `data-day="${day}" data-canedit="${canEdit || hasPMark}"`;
        html += `<div class="${className}" ${dataAttrs}>
            <span class="number">${day}</span>
            ${status && !isWeekend && !holiday ? `<span class="status">${status}</span>` : ''}
        </div>`;
    }
    html += '</div>';
    document.getElementById('calendarGrid').innerHTML = html;

    // Pridėti long press event listeners
    setupLongPressHandlers();
}

// Long press handler kintamieji
let longPressTimer = null;
let longPressTriggered = false;

function setupLongPressHandlers() {
    const days = document.querySelectorAll('.day.editable, .day.pavadavimas');

    days.forEach(dayEl => {
        const day = parseInt(dayEl.dataset.day);
        const canEdit = dayEl.dataset.canedit === 'true';

        // Touch events (mobile)
        dayEl.addEventListener('touchstart', (e) => {
            longPressTriggered = false;
            longPressTimer = setTimeout(() => {
                longPressTriggered = true;
                handleDayLongPress(day, canEdit);
                // Vibracija jei palaikoma
                if (navigator.vibrate) navigator.vibrate(50);
            }, 500);
        }, { passive: true });

        dayEl.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });

        dayEl.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
        });

        // Mouse events (desktop) - right click arba long click
        dayEl.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                longPressTriggered = false;
                longPressTimer = setTimeout(() => {
                    longPressTriggered = true;
                    handleDayLongPress(day, canEdit);
                }, 500);
            }
        });

        dayEl.addEventListener('mouseup', () => {
            clearTimeout(longPressTimer);
        });

        dayEl.addEventListener('mouseleave', () => {
            clearTimeout(longPressTimer);
        });
    });
}

function handleDayLongPress(day, canEdit) {
    if (!canEdit) return;
    const teacher = scheduleData.teachers[selectedTeacherIndex];
    const originalStatus = teacher.schedule[day.toString()] || '';
    if (originalStatus !== '' && originalStatus !== 'P') return;
    const pMarkKey = `${scheduleData.year}_${scheduleData.month}_${selectedTeacherIndex}_${day}`;
    if (pMarks[pMarkKey]) delete pMarks[pMarkKey];
    else pMarks[pMarkKey] = true;
    savePMarks();
    renderCalendar();
}

function renderAllTeachers() {
    if (!scheduleData) return;
    const year = scheduleData.year, month = scheduleData.month;
    const daysInMonth = new Date(year, month, 0).getDate();
    const workingDays = [];
    const weekDayNames = ['Sk', 'Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št'];

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const holiday = isHoliday(year, month, day);
        if (!isWeekend && !holiday) {
            workingDays.push({ day, dayOfWeek, dayName: weekDayNames[dayOfWeek], isFriday: dayOfWeek === 5 });
        }
    }

    let html = '<table class="schedule-table"><thead><tr><th class="corner-cell">Auklėtoja</th>';
    workingDays.forEach(d => {
        const sep = d.isFriday ? ' week-sep' : '';
        html += `<th class="day-header${sep}"><div>${d.day}</div><div class="dn">${d.dayName}</div></th>`;
    });
    html += '</tr></thead><tbody>';

    scheduleData.teachers.forEach((teacher, ti) => {
        const rc = ti % 2 === 0 ? 'even' : 'odd';
        html += `<tr class="${rc}"><td class="teacher-cell">${teacher.name}</td>`;
        workingDays.forEach(d => {
            let status = teacher.schedule[d.day.toString()] || '';
            if (pMarks[`${ti}_${d.day}`] && status === '') status = 'P';
            let cls = 'data-cell';
            if (status === 'P') cls += ' pav';
            else if (status === 'M') cls += ' mam';
            else if (status === 'DN') cls += ' dnc';
            else if (status.startsWith('D') && status !== '') cls += ' wrk';
            if (d.isFriday) cls += ' week-sep';
            html += `<td class="${cls}">${status}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('allTeachersGrid').innerHTML = html;
}

// ========== Initialization ==========
function init() {
    loadPMarks();
    const cached = getStoredData();
    if (cached) { scheduleData = cached; renderApp(); }
    else showNoData();
    window.addEventListener('resize', () => { if (scheduleData) { renderCalendar(); renderAllTeachers(); } });
}
document.addEventListener('DOMContentLoaded', init);
