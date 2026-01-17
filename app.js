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
    2030: { month: 4, days: [21, 22] }
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
function getStoredData() { const j = localStorage.getItem('grafikas_data'); return j ? JSON.parse(j) : null; }
function setStoredData(data) { localStorage.setItem('grafikas_data', JSON.stringify(data)); }
function getPMarks() { const j = localStorage.getItem('grafikas_pmarks'); return j ? JSON.parse(j) : {}; }
function savePMarks() { localStorage.setItem('grafikas_pmarks', JSON.stringify(pMarks)); }

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
function convertCloudUrl(url) {
    // Google Drive - konvertuoti į tiesioginę atsisiuntimo nuorodą
    if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
        // Jei jau yra uc?export=download formatas - grąžinti kaip yra
        if (url.includes('uc?export=download')) {
            return url;
        }
        // Ištraukti failo ID iš įvairių Google Drive URL formatų
        let fileId = null;
        const patterns = [
            /\/d\/([a-zA-Z0-9_-]+)/,           // /d/FILE_ID/
            /id=([a-zA-Z0-9_-]+)/,              // id=FILE_ID
            /\/file\/d\/([a-zA-Z0-9_-]+)/       // /file/d/FILE_ID/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) { fileId = match[1]; break; }
        }
        if (fileId) {
            return `https://drive.google.com/uc?export=download&id=${fileId}`;
        }
    }

    // OneDrive - palikti senąjį metodą
    if (url.includes('1drv.ms') || url.includes('onedrive.live.com')) {
        const base64 = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return `https://api.onedrive.com/v1.0/shares/u!${base64}/root/content`;
    }

    return url;
}

async function refreshData() {
    const url = getStoredUrl();
    showLoading();

    try {
        let downloadUrl;

        // Jei URL tuščias arba "local" - bandyti įkelti iš lokalaus failo
        if (!url || url === 'local' || url === 'lokalus') {
            downloadUrl = 'grafikas_data.json';
        } else if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com') ||
            url.includes('1drv.ms') || url.includes('onedrive.live.com')) {
            // Google Drive arba OneDrive - reikia CORS proxy
            const convertedUrl = convertCloudUrl(url);
            downloadUrl = 'https://corsproxy.io/?' + encodeURIComponent(convertedUrl);
        } else {
            // Kitas URL (pvz. GitHub raw, tiesioginis JSON)
            downloadUrl = url;
        }

        console.log('Fetching:', downloadUrl);
        const response = await fetch(downloadUrl);

        if (!response.ok) {
            if (downloadUrl === 'grafikas_data.json') {
                throw new Error('Failas grafikas_data.json nerastas. Paleiskite Python parserį.');
            }
            throw new Error('Nepavyko atsisiųsti: ' + response.status);
        }

        const text = await response.text();
        if (text.trim().startsWith('<')) {
            throw new Error('Gautas HTML vietoj JSON. Patikrinkite nuorodą.');
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
    select.value = selectedTeacherIndex;
    renderCalendar();
    renderAllTeachers();
    showCalendar();
}

function renderCalendar() {
    if (!scheduleData) return;
    selectedTeacherIndex = parseInt(document.getElementById('teacherSelect').value) || 0;
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
        const pMarkKey = `${selectedTeacherIndex}_${day}`;
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

        html += `<div class="${className}" onclick="handleDayClick(${day}, ${canEdit || hasPMark})">
            <span class="number">${day}</span>
            ${status && !isWeekend && !holiday ? `<span class="status">${status}</span>` : ''}
        </div>`;
    }
    html += '</div>';
    document.getElementById('calendarGrid').innerHTML = html;
}

function handleDayClick(day, canEdit) {
    if (!canEdit) return;
    const teacher = scheduleData.teachers[selectedTeacherIndex];
    const originalStatus = teacher.schedule[day.toString()] || '';
    if (originalStatus !== '' && originalStatus !== 'P') return;
    const pMarkKey = `${selectedTeacherIndex}_${day}`;
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
    pMarks = getPMarks();
    const cached = getStoredData();
    if (cached) { scheduleData = cached; renderApp(); }
    else showNoData();
    window.addEventListener('resize', () => { if (scheduleData) { renderCalendar(); renderAllTeachers(); } });
}
document.addEventListener('DOMContentLoaded', init);
