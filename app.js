const API_URL = 'https://render72.pages.dev/api/test/events';
const CACHE_KEY = 'afterhours-events-v1';
const CACHE_TTL = 5 * 60 * 1000;
const TIME_ZONE = 'Asia/Kolkata';
const root = document.documentElement;
const themeToggle = document.querySelector('#themeToggle');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const themeIcon = themeToggle.querySelector('.toggle-icon');
const themeText = themeToggle.querySelector('.toggle-text');
const storedTheme = localStorage.getItem('afterhours-theme');

function setTheme(theme) {
  root.dataset.theme = theme;
  const dark = theme === 'dark';
  themeIcon.textContent = dark ? '☀' : '☾';
  themeText.textContent = dark ? 'LIGHT MODE' : 'DARK MODE';
  themeToggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
  themeMeta.content = dark ? '#0e1118' : '#f3efe5';
  localStorage.setItem('afterhours-theme', theme);
}

setTheme(storedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeToggle.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

const eventGrid = document.querySelector('#eventGrid');
const searchInput = document.querySelector('#eventSearch');
const dateButtons = [...document.querySelectorAll('.date-chip')];
const apiState = document.querySelector('#apiState');
const apiStateTitle = document.querySelector('#apiStateTitle');
const apiStateMessage = document.querySelector('#apiStateMessage');
const noResults = document.querySelector('#noResults');
const noResultsMessage = document.querySelector('#noResultsMessage');
const eventCount = document.querySelector('#eventCount');
const lineupStatus = document.querySelector('#lineupStatus');
const stationDial = document.querySelector('#stationDial');
const tunedLabel = document.querySelector('#tunedLabel');
const dialFrequency = document.querySelector('#dialFrequency');
const presetButtons = [...document.querySelectorAll('#dialPresets button')];
const featuredLink = document.querySelector('#featuredLink');
const eventDialog = document.querySelector('#eventDialog');
const detailContent = document.querySelector('#detailContent');
const detailsCache = new Map();
let events = [];
let activeStation = 0;
let activeDate = 'upcoming';
let activeFeatured = null;
let eventFetchController;
let detailFetchController;

const stations = [
  { label: 'ALL SIGNALS', frequency: '99.7', matches: () => true },
  { label: 'IDEAS & BUILDS', frequency: '101.3', matches: (event) => event.is_technical === true },
  { label: 'CULTURE & ARTS', frequency: '103.5', matches: (event) => event.is_technical === false },
  { label: 'MUSIC', frequency: '106.1', matches: (event) => /music|band|concert|gig|sound/i.test(`${event.category} ${(event.tags || []).join(' ')}`) },
];

function getTodayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function plusDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function displayDate(dateString, options = { weekday: 'short', day: '2-digit', month: 'short' }) {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return 'DATE TBA';
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: TIME_ZONE }).format(new Date(`${dateString}T12:00:00+05:30`));
}

function displayTime(timeString) {
  if (!timeString || !/^\d{2}:\d{2}$/.test(timeString)) return 'TIME TBA';
  const [hours, minutes] = timeString.split(':').map(Number);
  const date = new Date(Date.UTC(2020, 0, 1, hours, minutes));
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date);
}

function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function isUpcoming(event) {
  const end = event.schedule_summary?.end_date || event.schedule_summary?.start_date;
  return event.event_status !== 'COMPLETED' && Boolean(end) && end >= getTodayIST();
}

function dayRange() {
  const today = getTodayIST();
  const monday = mondayOf(today);
  return { today, monday, sunday: plusDays(monday, 6) };
}

function matchesDate(event) {
  const day = event.schedule_summary?.start_date;
  if (!day) return activeDate === 'all';
  const { today, monday, sunday } = dayRange();
  if (activeDate === 'all') return true;
  if (activeDate === 'tonight') return day === today && isUpcoming(event);
  if (activeDate === 'week') return day >= today && day <= sunday && isUpcoming(event);
  if (activeDate === 'later') return day > sunday && isUpcoming(event);
  return isUpcoming(event);
}

function matchesSearch(event, query) {
  if (!query) return true;
  const haystack = [event.name, event.blurb, event.category, event.event_mode, ...(event.tags || [])].join(' ').toLowerCase();
  return haystack.includes(query);
}

function filteredEvents() {
  const query = searchInput.value.trim().toLowerCase();
  return events.filter((event) => stations[activeStation].matches(event) && matchesDate(event) && matchesSearch(event, query));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setFeatured() {
  const featured = events.find((event) => event.is_featured && isUpcoming(event)) || events.find(isUpcoming) || events[0];
  activeFeatured = featured || null;
  const art = document.querySelector('#featuredArt');
  const kicker = document.querySelector('#featuredKicker');
  const title = document.querySelector('#featuredTitle');
  const blurb = document.querySelector('#featuredBlurb');
  const meta = document.querySelector('#featuredMeta');
  const label = document.querySelector('#featuredLabel');
  art.replaceChildren();
  if (!featured) {
    label.innerHTML = '<span class="live-dot"></span> ON AIR · BETWEEN SHOWS';
    art.append(element('span', '', '☾'));
    kicker.textContent = 'THE STATION IS BETWEEN SHOWS';
    title.textContent = 'No featured event yet';
    blurb.textContent = 'Check the lineup again soon.';
    meta.replaceChildren(element('span', '', 'AFTERHOURS FM'), element('span', '', 'NEW SIGNALS SOON'));
    featuredLink.disabled = true;
    return;
  }
  label.innerHTML = `<span class="live-dot"></span> ON AIR · ${featured.is_featured ? "EDITOR'S PICK" : 'NEXT UP'}`;
  const imageUrl = safeImageUrl(featured.cover_image_url);
  if (imageUrl) {
    const image = element('img', 'featured-image');
    image.src = imageUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.onerror = () => image.remove();
    art.append(image);
  }
  art.append(element('span', 'featured-symbol', '✳'));
  const date = featured.schedule_summary?.start_date;
  kicker.textContent = `${featured.is_featured ? "EDITOR'S PICK" : 'NEXT UP'} · ${displayDate(date, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} · ${displayTime(featured.schedule_summary?.start_time)}`;
  title.textContent = featured.name;
  blurb.textContent = featured.blurb || featured.category || 'A new campus signal is coming through.';
  meta.replaceChildren(
    element('span', '', `${featured.category || 'CAMPUS'} · ${featured.event_mode === 'ONLINE' ? 'ONLINE' : 'ON CAMPUS'}`),
    element('span', '', featured.registration_status === 'OPEN' ? 'REGISTRATION OPEN' : featured.registration_status === 'SOLD_OUT' ? 'SOLD OUT' : 'CHECK EVENT DETAILS'),
  );
  featuredLink.disabled = false;
  featuredLink.onclick = () => openEvent(featured.id);
}

function createCard(event, index) {
  const card = element('article', `event-card api-event-card ${event.is_featured ? 'is-featured' : ''}`);
  const identity = element('div', 'card-top');
  identity.append(element('span', 'event-category', `${(event.category || 'CAMPUS').toUpperCase()} / ${event.event_type === 'WORKSHOP' ? 'WORKSHOP' : event.is_technical ? 'IDEAS' : 'CULTURE'}`));
  identity.append(element('span', 'event-number', `FM—${String(index + 1).padStart(2, '0')}`));
  card.append(identity);

  const art = element('div', 'card-art api-card-art');
  const imageUrl = safeImageUrl(event.cover_image_url);
  if (imageUrl) {
    const image = element('img', 'event-cover');
    image.src = imageUrl;
    image.alt = event.cover_image_alt || '';
    image.loading = index < 3 ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.fetchPriority = index === 0 ? 'high' : 'auto';
    image.onerror = () => image.remove();
    art.append(image);
  }
  art.append(element('span', 'art-index', String(index + 1).padStart(2, '0')));
  art.append(element('span', 'art-waveform', '∿ ∿ ∿ ∿ ∿'));
  if (event.is_featured) art.append(element('span', 'featured-badge', '✳ ON AIR'));
  card.append(art);

  const date = event.schedule_summary?.start_date;
  const dateRow = element('div', 'card-date');
  dateRow.append(element('span', '', displayDate(date, { weekday: 'short' }).toUpperCase()));
  const numericDate = date ? new Date(`${date}T12:00:00+05:30`) : null;
  dateRow.append(element('b', '', numericDate ? new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: '2-digit' }).format(numericDate) : '—'));
  dateRow.append(element('span', '', numericDate ? new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, month: 'short' }).format(numericDate).toUpperCase() : 'TBA'));
  dateRow.append(element('i', '', ''));
  dateRow.append(element('span', '', displayTime(event.schedule_summary?.start_time).toUpperCase()));
  card.append(dateRow);

  const title = element('h3', '', event.name);
  card.append(title);
  card.append(element('p', 'event-blurb', event.blurb || 'A new frequency worth finding.'));
  const footer = element('div', 'card-footer');
  footer.append(element('span', '', `${event.event_mode === 'ONLINE' ? '↗ ONLINE' : '⌖ ON CAMPUS'} · ${event.registration_status === 'OPEN' ? 'REGISTRATION OPEN' : event.registration_status === 'SOLD_OUT' ? 'SOLD OUT' : 'DETAILS'}`));
  const link = element('button', 'card-open', '↗');
  link.type = 'button';
  link.setAttribute('aria-label', `View details for ${event.name}`);
  link.addEventListener('click', () => openEvent(event.id));
  footer.append(link);
  card.append(footer);
  return card;
}

function renderEvents() {
  const results = filteredEvents();
  eventGrid.replaceChildren(...results.map(createCard));
  eventGrid.hidden = results.length === 0;
  noResults.hidden = results.length > 0 || apiState.hidden === false;
  noResultsMessage.textContent = activeDate === 'tonight'
    ? 'No events are scheduled tonight. Try the full week or keep the frequency open.'
    : activeDate === 'week'
      ? 'No events this week yet. There may be more on a later frequency.'
      : 'Try another date, search term, or station preset.';
  eventCount.textContent = results.length ? `${String(results.length).padStart(2, '0')} ${results.length === 1 ? 'EVENT' : 'EVENTS'} ON THIS FREQUENCY` : 'NO EVENTS ON THIS FREQUENCY';
  eventGrid.setAttribute('aria-busy', 'false');
}

function setStation(value) {
  activeStation = Math.max(0, Math.min(stations.length - 1, Number(value) || 0));
  const station = stations[activeStation];
  stationDial.value = String(activeStation);
  document.querySelector('#tuningDial').style.setProperty('--dial-position', `${activeStation / (stations.length - 1) * 100}%`);
  stationDial.setAttribute('aria-valuetext', station.label.toLowerCase());
  tunedLabel.textContent = station.label;
  dialFrequency.textContent = station.frequency;
  presetButtons.forEach((button, index) => {
    const selected = index === activeStation;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  renderEvents();
}

stationDial.addEventListener('input', () => setStation(stationDial.value));
presetButtons.forEach((button) => button.addEventListener('click', () => setStation(button.dataset.station)));
dateButtons.forEach((button) => button.addEventListener('click', () => {
  activeDate = button.dataset.date;
  dateButtons.forEach((item) => {
    const selected = item === button;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  renderEvents();
}));
searchInput.addEventListener('input', renderEvents);
document.querySelector('#resetFilters').addEventListener('click', () => {
  searchInput.value = '';
  activeDate = 'upcoming';
  dateButtons.forEach((button) => {
    const selected = button.dataset.date === 'upcoming';
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  setStation(0);
});

function cachedEvents() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    return cached && Array.isArray(cached.events) && Date.now() - cached.savedAt < CACHE_TTL ? cached.events : null;
  } catch {
    return null;
  }
}

async function loadEvents() {
  eventFetchController?.abort();
  const controller = new AbortController();
  eventFetchController = controller;
  const timeout = window.setTimeout(() => controller.abort('timeout'), 12000);
  apiState.hidden = true;
  noResults.hidden = true;
  eventGrid.hidden = false;
  eventGrid.setAttribute('aria-busy', 'true');
  lineupStatus.hidden = false;
  lineupStatus.innerHTML = '<span class="status-wave" aria-hidden="true">〰</span> Tuning into the campus signal…';
  try {
    const response = await fetch(API_URL, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(response.status >= 500 ? 'The station is having trouble answering. Give it another try.' : 'The station returned an unexpected signal.');
    const payload = await response.json();
    if (!Array.isArray(payload.events)) throw new Error('The lineup arrived in an unfamiliar format. Try again in a moment.');
    events = payload.events;
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ events, savedAt: Date.now() })); } catch { /* Storage can be unavailable in private browsing. */ }
    lineupStatus.hidden = true;
    renderEvents();
    setFeatured();
  } catch (error) {
    if (eventFetchController !== controller) return;
    const saved = cachedEvents();
    eventGrid.setAttribute('aria-busy', 'false');
    lineupStatus.hidden = true;
    if (saved) {
      events = saved;
      apiStateTitle.textContent = 'The live signal dropped.';
      apiStateMessage.textContent = 'Showing the latest saved lineup. Reconnect to refresh it.';
      apiState.classList.add('is-inline');
      apiState.hidden = false;
      renderEvents();
      setFeatured();
      return;
    }
    eventGrid.replaceChildren();
    eventGrid.hidden = true;
    noResults.hidden = true;
    apiState.classList.remove('is-inline');
    apiStateTitle.textContent = 'The signal’s quiet.';
    apiStateMessage.textContent = error.name === 'AbortError' ? 'The station took too long to answer. Try again when the signal is clearer.' : error.message || 'We couldn’t reach the station right now. Check your connection and try again.';
    apiState.hidden = false;
    eventCount.textContent = 'WAITING FOR THE ROTATION';
    setFeatured();
  } finally {
    window.clearTimeout(timeout);
  }
}

document.querySelector('#retryButton').addEventListener('click', loadEvents);

function section(title, content) {
  const wrapper = element('section', 'detail-section');
  wrapper.append(element('h3', 'detail-section-title', title));
  wrapper.append(content);
  return wrapper;
}

function listSection(title, items, mapItem = (item) => item) {
  if (!Array.isArray(items) || !items.length) return null;
  const list = element('ul', 'detail-list');
  items.forEach((item) => list.append(element('li', '', mapItem(item))));
  return section(title, list);
}

function renderDetail(event) {
  detailContent.replaceChildren();
  const imageUrl = safeImageUrl(event.banner_image_url || event.cover_image_url);
  if (imageUrl) {
    const hero = element('div', 'detail-hero');
    const image = element('img', '', '');
    image.src = imageUrl;
    image.alt = event.banner_image_alt || event.cover_image_alt || '';
    image.loading = 'eager';
    image.decoding = 'async';
    image.onerror = () => hero.remove();
    hero.append(image);
    hero.append(element('span', 'detail-hero-mark', 'AFTERHOURS FM · EVENT FILE'));
    detailContent.append(hero);
  }
  const intro = element('div', 'detail-intro');
  intro.append(element('p', 'eyebrow', `${event.category || 'CAMPUS EVENT'} · ${event.event_mode === 'ONLINE' ? 'ONLINE' : 'ON CAMPUS'}`));
  intro.append(element('h2', '', event.name));
  intro.append(element('p', 'detail-blurb', event.blurb || 'A frequency worth finding.'));
  detailContent.append(intro);
  document.title = `${event.name} · Afterhours FM`;
  document.querySelector('meta[name="description"]').content = event.blurb || 'Tune into this campus event on Afterhours FM.';

  const metadata = element('div', 'detail-meta');
  const date = event.schedule_summary?.start_date;
  const endDate = event.schedule_summary?.end_date;
  const schedule = date ? `${displayDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${endDate && endDate !== date ? ` – ${displayDate(endDate, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}` : 'Date to be announced';
  metadata.append(element('div', '', `◷  ${schedule} · ${displayTime(event.schedule_summary?.start_time)}`));
  const venue = event.schedules?.find((item) => item.venue)?.venue || (event.event_mode === 'ONLINE' ? 'Online event' : 'Venue to be announced');
  metadata.append(element('div', '', `⌖  ${venue}`));
  metadata.append(element('div', '', `◎  ${event.registration_status === 'OPEN' ? 'Registration open' : event.registration_status === 'SOLD_OUT' ? 'Sold out' : 'Registration closed'} · ${event.price === 0 ? 'Free' : `₹${event.price}${event.is_per_head ? ' per person' : ' per team'}`}`));
  detailContent.append(metadata);

  if (event.description) {
    const description = element('div', 'detail-description');
    event.description.split(/\n\s*\n/).filter(Boolean).forEach((paragraph) => description.append(element('p', '', paragraph)));
    detailContent.append(section('THE LISTENING NOTES', description));
  }
  const schedules = event.schedules;
  if (Array.isArray(schedules) && schedules.length) {
    const scheduleList = element('div', 'detail-schedule');
    schedules.forEach((session) => {
      const row = element('div', 'schedule-row');
      row.append(element('span', '', displayDate(session.event_date, { weekday: 'short', day: 'numeric', month: 'short' })));
      row.append(element('b', '', `${displayTime(session.start_time)} – ${displayTime(session.end_time)}`));
      row.append(element('span', '', session.venue || 'Venue TBA'));
      scheduleList.append(row);
    });
    detailContent.append(section('SCHEDULE', scheduleList));
  }
  for (const [title, items] of [['GOOD TO KNOW', event.highlights], ['WHAT TO EXPECT', event.what_to_expect], ['WHO CAN JOIN', event.eligibility], ['BEFORE YOU ARRIVE', event.prerequisites], ['THE HOUSE RULES', event.rules]]) {
    const block = listSection(title, items);
    if (block) detailContent.append(block);
  }
  if (Array.isArray(event.prizes) && event.prizes.length) {
    const prizes = element('div', 'detail-prizes');
    event.prizes.forEach((prize) => {
      const row = element('div', 'prize-row');
      row.append(element('b', '', prize.title || `Place ${prize.rank}`));
      row.append(element('span', '', prize.amount ? `₹${Number(prize.amount).toLocaleString('en-IN')}` : 'Prize details'));
      if (prize.description) row.append(element('p', '', prize.description));
      prizes.append(row);
    });
    detailContent.append(section('PRIZES', prizes));
  }
  if (Array.isArray(event.faqs) && event.faqs.length) {
    const faqs = element('div', 'detail-faqs');
    event.faqs.forEach((faq) => {
      const item = element('details', 'detail-faq');
      item.append(element('summary', '', faq.question));
      item.append(element('p', '', faq.answer));
      faqs.append(item);
    });
    detailContent.append(section('ON THE FREQUENCY', faqs));
  }
  const organizers = (event.organizers || []).map((item) => item.name).filter(Boolean);
  if (organizers.length) detailContent.append(element('p', 'detail-organizers', `BROADCAST BY ${organizers.join(' · ')}`));
}

async function openEvent(id, { updateUrl = true } = {}) {
  if (!id) return;
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('event', id);
    history.pushState({ eventId: id }, '', url);
  }
  detailContent.replaceChildren(element('div', 'detail-loading', '〰  Tuning in to event details…'));
  if (!eventDialog.open) eventDialog.showModal();
  document.querySelector('#dialogClose').focus();
  if (detailsCache.has(id)) {
    renderDetail(detailsCache.get(id));
    return;
  }
  detailFetchController?.abort();
  detailFetchController = new AbortController();
  const timeout = window.setTimeout(() => detailFetchController.abort(), 12000);
  try {
    const response = await fetch(`${API_URL}/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, signal: detailFetchController.signal });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error('No event was found on that frequency. It may have been removed or the link may be mistuned.');
    if (!response.ok) throw new Error(response.status >= 500 ? 'The station couldn’t fetch this event right now. Try again in a moment.' : 'The event details could not be read. Try again shortly.');
    if (!body.event || typeof body.event !== 'object') throw new Error('The event details arrived in an unfamiliar format.');
    detailsCache.set(id, body.event);
    renderDetail(body.event);
  } catch (error) {
    if (error.name === 'AbortError') return;
    detailContent.replaceChildren();
    const state = element('div', 'detail-error');
    state.append(element('span', '', '〰'));
    state.append(element('h2', '', 'Couldn’t tune in.'));
    state.append(element('p', '', error.message || 'The station lost this event signal. Try again.'));
    const retry = element('button', 'retry-button', 'TRY AGAIN ↻');
    retry.type = 'button';
    retry.addEventListener('click', () => openEvent(id, { updateUrl: false }));
    state.append(retry);
    detailContent.append(state);
  } finally {
    window.clearTimeout(timeout);
  }
}

function closeEventDialog({ updateUrl = true } = {}) {
  detailFetchController?.abort();
  if (eventDialog.open) eventDialog.close();
  if (updateUrl && new URLSearchParams(window.location.search).has('event')) {
    const url = new URL(window.location.href);
    url.searchParams.delete('event');
    history.pushState({}, '', url);
  }
  document.title = 'Afterhours FM — Campus, on your frequency';
  document.querySelector('meta[name="description"]').content = "Afterhours FM — your frequency for campus events, late-night ideas, and good company.";
}

eventDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeEventDialog();
});

document.querySelector('#dialogClose').addEventListener('click', () => closeEventDialog());
eventDialog.addEventListener('click', (event) => {
  if (event.target === eventDialog) closeEventDialog();
});
eventDialog.addEventListener('close', () => {
  if (!new URLSearchParams(window.location.search).has('event')) document.querySelector('#lineup').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
window.addEventListener('popstate', () => {
  const id = new URLSearchParams(window.location.search).get('event');
  if (id) openEvent(id, { updateUrl: false });
  else if (eventDialog.open) closeEventDialog({ updateUrl: false });
});

const menuButton = document.querySelector('#menuButton');
const nav = document.querySelector('.main-nav');
menuButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});
nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
}));

document.querySelector('#retryButton').addEventListener('click', loadEvents);
loadEvents().then(() => {
  const eventId = new URLSearchParams(window.location.search).get('event');
  if (eventId) openEvent(eventId, { updateUrl: false });
});
