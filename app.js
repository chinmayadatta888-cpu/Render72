const API_URL = 'https://render72.pages.dev/api/test/events';
const CACHE_KEY = 'afterbell-events-v1';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const TIME_ZONE = 'Asia/Kolkata';
const themeMeta = document.querySelector('meta[name="theme-color"]');
if (themeMeta) themeMeta.content = '#000000';

const eventGrid = document.querySelector('#eventGrid');
const spiralScroll = document.querySelector('#spiralScroll');
const spiralIndex = document.querySelector('#spiralIndex');
const spiralPath = document.querySelector('#spiralPath');
const searchInput = document.querySelector('#eventSearch');
const dateButtons = [...document.querySelectorAll('.date-chip')];
const apiState = document.querySelector('#apiState');
const apiStateTitle = document.querySelector('#apiStateTitle');
const apiStateMessage = document.querySelector('#apiStateMessage');
const noResults = document.querySelector('#noResults');
const noResultsMessage = document.querySelector('#noResultsMessage');
const eventCount = document.querySelector('#eventCount');
const lineupStatus = document.querySelector('#lineupStatus');
const featuredLink = document.querySelector('#featuredLink');
const eventDialog = document.querySelector('#eventDialog');
const detailContent = document.querySelector('#detailContent');
const detailsCache = new Map();
let events = [];
let activeDate = 'upcoming';
let activeFeatured = null;
let visibleEventCount = Number.MAX_SAFE_INTEGER;
let eventFetchController;
let detailFetchController;

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

function resizedRemoteImage(value, width = 520, height = 360) {
  const safe = safeImageUrl(value);
  if (!safe) return '';
  try {
    const url = new URL(safe);
    if (url.hostname === 'images.pexels.com') {
      url.searchParams.set('w', String(width));
      url.searchParams.set('h', String(height));
      url.searchParams.set('fit', 'crop');
      url.searchParams.set('fm', 'webp');
    }
    return url.href;
  } catch {
    return safe;
  }
}

function localCoverImage(eventId) {
  return `/assets/events/${encodeURIComponent(eventId)}.webp`;
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
  return events.filter((event) => matchesDate(event) && matchesSearch(event, query))
    .sort((a, b) => `${a.schedule_summary?.start_date || '9999-99-99'}T${a.schedule_summary?.start_time || '99:99'}`.localeCompare(`${b.schedule_summary?.start_date || '9999-99-99'}T${b.schedule_summary?.start_time || '99:99'}`));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setFeatured() {
  const featured = events.filter(isUpcoming).sort((a, b) => `${a.schedule_summary?.start_date || '9999-99-99'}T${a.schedule_summary?.start_time || '99:99'}`.localeCompare(`${b.schedule_summary?.start_date || '9999-99-99'}T${b.schedule_summary?.start_time || '99:99'}`))[0] || events[0];
  activeFeatured = featured || null;
  const kicker = document.querySelector('#featuredKicker');
  const title = document.querySelector('#featuredTitle');
  const blurb = document.querySelector('#featuredBlurb');
  const meta = document.querySelector('#featuredMeta');
  const heroImage = document.querySelector('#heroFeaturedImage');
  if (!featured) {
    kicker.textContent = 'SERVICE GAP';
    title.textContent = 'Nothing coming up yet';
    blurb.textContent = 'Check the lineup again soon.';
    meta.replaceChildren(element('span', '', 'CAMPUS EVENTS'), element('span', '', 'CHECK BACK SOON'));
    featuredLink.disabled = true;
    return;
  }
  if (heroImage) {
    heroImage.onerror = () => {
      const remoteFallback = resizedRemoteImage(featured.cover_image_url, 900, 1000);
      if (remoteFallback && heroImage.src !== remoteFallback) heroImage.src = remoteFallback;
    };
    heroImage.src = localCoverImage(featured.id);
    heroImage.alt = `Scene from ${featured.name}`;
  }
  const date = featured.schedule_summary?.start_date;
  kicker.textContent = `UP NEXT · ${displayDate(date, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} · ${displayTime(featured.schedule_summary?.start_time)}`;
  title.textContent = featured.name;
  blurb.textContent = featured.blurb || featured.category || 'A new campus event is coming up.';
  meta.replaceChildren(
    element('span', '', `${featured.category || 'CAMPUS'} · ${featured.event_mode === 'ONLINE' ? 'ONLINE' : 'ON CAMPUS'}`),
    element('span', '', featured.registration_status === 'OPEN' ? 'REGISTRATION OPEN' : featured.registration_status === 'SOLD_OUT' ? 'SOLD OUT' : 'CHECK EVENT DETAILS'),
  );
  featuredLink.disabled = false;
  featuredLink.onclick = () => openEvent(featured.id);
}

function createEventCard(event, index) {
  const card = element('button', `event-card ${event.is_featured ? 'is-featured' : ''}`);
  card.type = 'button';
  const date = event.schedule_summary?.start_date;
  const poster = element('img', 'event-poster');
  poster.src = localCoverImage(event.id);
  poster.alt = '';
  poster.loading = 'lazy';
  poster.decoding = 'async';
  poster.onerror = () => {
    const remoteFallback = resizedRemoteImage(event.cover_image_url, 440, 520);
    if (remoteFallback && poster.src !== remoteFallback) poster.src = remoteFallback;
    else poster.remove();
  };
  card.append(poster);
  const dateCell = element('span', 'event-date');
  dateCell.append(element('span', 'event-weekday', displayDate(date, { weekday: 'short' }).toUpperCase()));
  const numericDate = date ? new Date(`${date}T12:00:00+05:30`) : null;
  dateCell.append(element('strong', 'event-day', numericDate ? new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: '2-digit' }).format(numericDate) : '—'));
  dateCell.append(element('span', 'event-month', numericDate ? new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, month: 'short' }).format(numericDate).toUpperCase() : 'DATE TBA'));
  dateCell.append(element('span', 'event-time', displayTime(event.schedule_summary?.start_time).toUpperCase()));
  card.append(dateCell);
  const content = element('span', 'event-card-content');
  const top = element('span', 'event-card-meta');
  top.append(element('span', 'event-category', (event.category || 'CAMPUS').toUpperCase()));
  top.append(element('span', 'event-number', `INDEX ${String(index + 1).padStart(2, '0')}`));
  content.append(top);
  content.append(element('strong', 'event-name', event.name));
  content.append(element('span', 'event-summary', event.blurb || 'Open this event for the full details.'));
  const foot = element('span', 'event-card-foot');
  foot.append(element('span', '', `${event.event_mode === 'ONLINE' ? 'ONLINE' : 'ON CAMPUS'} · ${event.event_type === 'WORKSHOP' ? 'WORKSHOP' : 'EVENT'}`));
  const status = event.registration_status === 'OPEN' ? 'REGISTRATION OPEN' : event.registration_status === 'SOLD_OUT' ? 'SOLD OUT' : event.event_status === 'COMPLETED' ? 'COMPLETED' : 'VIEW DETAILS';
  foot.append(element('span', `event-status ${event.registration_status === 'OPEN' ? 'is-open' : ''}`, status));
  content.append(foot);
  card.append(content);
  card.setAttribute('aria-label', `Open event ${index + 1}: ${event.name}, ${displayDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} at ${displayTime(event.schedule_summary?.start_time)}`);
  card.addEventListener('click', () => openEvent(event.id));
  return card;
}

let spiralFrame = 0;
function updateSpiralLayout() {
  if (!spiralScroll || !eventGrid) return;
  const cards = [...eventGrid.children];
  const pin = spiralScroll.firstElementChild;
  const viewportHeight = pin?.clientHeight || window.innerHeight;
  const step = Math.min(300, Math.max(210, viewportHeight * 0.42));
  const scrollRange = Math.max(0, (cards.length - 1) * step);
  const stageHeight = `${cards.length ? viewportHeight + scrollRange : 0}px`;
  if (spiralScroll.style.height !== stageHeight) spiralScroll.style.height = stageHeight;
  spiralScroll.hidden = cards.length === 0;
  if (!cards.length) {
    if (spiralIndex) spiralIndex.textContent = '00 / 00';
    if (spiralPath) spiralPath.setAttribute('d', '');
    return;
  }

  const sectionTop = spiralScroll.getBoundingClientRect().top + window.scrollY;
  const progress = scrollRange
    ? Math.max(0, Math.min(1, (window.scrollY - sectionTop) / scrollRange))
    : 0;
  const active = progress * (cards.length - 1);
  const radius = Math.min(250, window.innerWidth * 0.34);
  cards.forEach((card, index) => {
    const offset = index - active;
    const angle = offset * 0.86;
    const distance = Math.abs(offset);
    card.style.setProperty('--spiral-x', `${Math.sin(angle) * radius}px`);
    card.style.setProperty('--spiral-y', `${offset * step}px`);
    card.style.setProperty('--spiral-z', `${Math.cos(angle) * 145}px`);
    card.style.setProperty('--spiral-yaw', `${Math.sin(angle) * 24}deg`);
    card.style.setProperty('--spiral-roll', `${Math.sin(angle * 0.52) * 3.5}deg`);
    card.style.setProperty('--spiral-scale', String(Math.max(0.58, 1 - distance * 0.14)));
    card.style.setProperty('--spiral-opacity', String(Math.max(0, 1 - distance * 0.34)));
    card.style.zIndex = String(100 - Math.round(distance * 10));
    card.style.pointerEvents = distance < 2.4 ? 'auto' : 'none';
    card.tabIndex = distance < 2.6 ? 0 : -1;
  });

  if (spiralIndex) {
    spiralIndex.textContent = `${String(Math.min(cards.length, Math.floor(active) + 1)).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
  }
  if (spiralPath) {
    const xRadius = (radius / window.innerWidth) * 1000;
    const yStep = (step / viewportHeight) * 900;
    const points = [];
    for (let offset = -2.65; offset <= 2.66; offset += 0.08) {
      const angle = offset * 0.86;
      const x = 500 + Math.sin(angle) * xRadius;
      const y = 450 + offset * yStep;
      points.push(`${points.length ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    spiralPath.setAttribute('d', points.join(' '));
  }
}

function requestSpiralUpdate() {
  if (spiralFrame) return;
  spiralFrame = window.requestAnimationFrame(() => {
    spiralFrame = 0;
    updateSpiralLayout();
  });
}

window.addEventListener('scroll', requestSpiralUpdate, { passive: true });
window.addEventListener('resize', requestSpiralUpdate);

function renderEvents(resetCount = true) {
  if (resetCount) visibleEventCount = Number.MAX_SAFE_INTEGER;
  const results = filteredEvents();
  const visibleEvents = results.slice(0, visibleEventCount);
  eventGrid.replaceChildren(...visibleEvents.map(createEventCard));
  eventGrid.hidden = results.length === 0;
  updateSpiralLayout();
  const loadMore = document.querySelector('#loadMore');
  loadMore.hidden = results.length <= visibleEvents.length;
  loadMore.textContent = `SHOW ${Math.min(9, results.length - visibleEvents.length)} MORE EVENTS ↓`;
  noResults.hidden = results.length > 0 || apiState.hidden === false;
  noResultsMessage.textContent = activeDate === 'tonight'
    ? 'No events are scheduled tonight. Try the full week or keep the full line open.'
    : activeDate === 'week'
      ? 'No events this week yet. Try a later date.'
      : 'Try another date or search term.';
  eventCount.textContent = results.length ? `${String(results.length).padStart(2, '0')} ${results.length === 1 ? 'EVENT' : 'EVENTS'} IN THE PROGRAMME` : 'NO EVENTS MATCH THIS SEARCH';
  eventGrid.setAttribute('aria-busy', 'false');
}

document.querySelector('#loadMore').addEventListener('click', () => {
  visibleEventCount += 9;
  renderEvents(false);
});

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
  renderEvents();
});

function cachedEvents() {
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[storageName];
      const cached = JSON.parse(storage.getItem(CACHE_KEY));
      if (cached && Array.isArray(cached.events) && cached.events.length && Date.now() - cached.savedAt < CACHE_TTL) return cached;
    } catch {
      // Storage can be unavailable or contain malformed data; try the next cache.
    }
  }
  return null;
}

async function loadEvents() {
  eventFetchController?.abort();
  const controller = new AbortController();
  eventFetchController = controller;
  const timeout = window.setTimeout(() => controller.abort('timeout'), 12000);
  apiState.hidden = true;
  apiState.classList.remove('is-inline');
  noResults.hidden = true;
  const initialCache = cachedEvents();
  if (initialCache) {
    events = initialCache.events;
    renderEvents();
    setFeatured();
  } else {
    eventGrid.hidden = false;
    eventGrid.setAttribute('aria-busy', 'true');
  }
  lineupStatus.hidden = false;
  lineupStatus.textContent = initialCache ? 'UPDATING THE INDEX · SHOWING YOUR SAVED EVENTS' : 'GETTING THE LATEST CAMPUS PROGRAMME…';
  try {
    const response = await fetch(API_URL, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(response.status >= 500 ? 'The event service is having trouble. Try again in a moment.' : 'The event service returned an unexpected response.');
    const payload = await response.json();
    if (!Array.isArray(payload.events)) throw new Error('The event list arrived in an unfamiliar format. Try again in a moment.');
    events = payload.events;
    const snapshot = JSON.stringify({ events, savedAt: Date.now() });
    for (const storageName of ['localStorage', 'sessionStorage']) {
      try { window[storageName].setItem(CACHE_KEY, snapshot); } catch { /* Storage can be unavailable in private browsing. */ }
    }
    lineupStatus.hidden = true;
    renderEvents();
    setFeatured();
  } catch (error) {
    if (eventFetchController !== controller) return;
    const saved = cachedEvents();
    eventGrid.setAttribute('aria-busy', 'false');
    lineupStatus.hidden = true;
    if (saved) {
      events = saved.events;
      apiStateTitle.textContent = 'Saved programme is available.';
      const savedDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(saved.savedAt));
      apiStateMessage.textContent = `The event service couldn’t refresh. Showing ${saved.events.length} saved events from ${savedDate}.`;
      apiState.classList.add('is-inline');
      apiState.hidden = false;
      renderEvents();
      setFeatured();
      return;
    }
    eventGrid.replaceChildren();
    eventGrid.hidden = true;
    updateSpiralLayout();
    noResults.hidden = true;
    apiState.classList.remove('is-inline');
    apiStateTitle.textContent = 'The event index is offline.';
    apiStateMessage.textContent = error.name === 'AbortError' ? 'The event service took too long to answer. Check your connection, then retry.' : error.message || 'We couldn’t load the event index. Check your connection, then retry.';
    apiState.hidden = false;
    eventCount.textContent = 'EVENT INDEX UNAVAILABLE';
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
    image.src = resizedRemoteImage(imageUrl, 1200, 700);
    image.alt = event.banner_image_alt || event.cover_image_alt || '';
    image.loading = 'eager';
    image.decoding = 'async';
    image.onerror = () => hero.remove();
    hero.append(image);
    hero.append(element('span', 'detail-hero-mark', '72 · EVENT DETAILS'));
    detailContent.append(hero);
  }
  const intro = element('div', 'detail-intro');
  intro.append(element('p', 'eyebrow', `${event.category || 'CAMPUS EVENT'} · ${event.event_mode === 'ONLINE' ? 'ONLINE' : 'ON CAMPUS'}`));
  const detailTitle = element('h2', '', event.name);
  detailTitle.id = 'detailTitle';
  intro.append(detailTitle);
  intro.append(element('p', 'detail-blurb', event.blurb || 'An event worth showing up for.'));
  detailContent.append(intro);
  document.title = `${event.name} · 72`;
  document.querySelector('meta[name="description"]').content = event.blurb || 'Event details from 72, the campus event index.';

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
    detailContent.append(section('EVENT OVERVIEW', description));
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
    detailContent.append(section('QUICK QUESTIONS', faqs));
  }
  const organizers = (event.organizers || []).map((item) => item.name).filter(Boolean);
  if (organizers.length) detailContent.append(element('p', 'detail-organizers', `ORGANIZED BY ${organizers.join(' · ')}`));
}

async function openEvent(id, { updateUrl = true } = {}) {
  if (!id) return;
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('event', id);
    history.pushState({ eventId: id }, '', url);
  }
  detailContent.replaceChildren(element('div', 'detail-loading', '✳  LOADING EVENT DETAILS…'));
  if (!eventDialog.open) eventDialog.showModal();
  document.querySelector('#dialogClose').focus();
  if (detailsCache.has(id)) {
    renderDetail(detailsCache.get(id));
    return;
  }
  detailFetchController?.abort();
  const controller = new AbortController();
  detailFetchController = controller;
  let response = null;
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    response = await fetch(`${API_URL}/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) throw new Error('No event was found. It may have been removed or the link may be outdated.');
    if (!response.ok) throw new Error(response.status >= 500 ? 'The event service couldn’t fetch the details right now. Try again in a moment.' : 'The event details could not be read. Try again shortly.');
    if (!body.event || typeof body.event !== 'object') throw new Error('The event details arrived in an unfamiliar format.');
    detailsCache.set(id, body.event);
    renderDetail(body.event);
  } catch (error) {
    if (detailFetchController !== controller) return;
    const cachedEvent = events.find((event) => String(event.id) === String(id));
    const canUseCachedEvent = error.name === 'AbortError' || !response || response.status >= 500;
    if (cachedEvent && canUseCachedEvent) {
      renderDetail(cachedEvent);
      detailContent.prepend(element('p', 'detail-stale', 'The event service is unavailable. Showing saved event details; some fields may be missing.'));
      return;
    }
    detailContent.replaceChildren();
    const state = element('div', 'detail-error');
    state.append(element('span', '', '〰'));
    state.append(element('h2', '', 'The details are out of reach.'));
    state.append(element('p', '', error.message || 'We couldn’t load this event. Try again.'));
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
    history.replaceState({}, '', url);
  }
  document.title = '72 — Campus, in session';
  document.querySelector('meta[name="description"]').content = 'A sharper way to find the events, ideas and people shaping campus life.';
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
if (menuButton && nav) {
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
}

loadEvents().then(() => {
  const eventId = new URLSearchParams(window.location.search).get('event');
  if (eventId) openEvent(eventId, { updateUrl: false });
});
