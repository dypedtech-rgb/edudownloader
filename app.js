/* ═══════════════════════════════════════════════
   EduDownloader — Application Logic
   Cobalt API integration + client-side TXT gen
   ═══════════════════════════════════════════════ */

// ── State ────────────────────────────────────
let currentTab = 'youtube';
let lastVideoInfo = null;   // { title, author, date, url, downloadUrl, filename, thumbnail }
let cobaltApiUrl = '';

// ── Platform config ──────────────────────────
const PLATFORMS = {
  youtube: {
    hint: '🎓 Pega el enlace de un video de YouTube para descargarlo en alta definición',
    placeholder: 'https://www.youtube.com/watch?v=...',
    color: '#ff0000',
  },
  instagram: {
    hint: '📸 Pega el enlace de un reel o video de Instagram',
    placeholder: 'https://www.instagram.com/reel/...',
    color: '#e1306c',
  },
  tiktok: {
    hint: '🎵 Pega el enlace de un video de TikTok',
    placeholder: 'https://www.tiktok.com/@usuario/video/...',
    color: '#00f2ea',
  },
  web: {
    hint: '🌐 Pega el enlace de un blog o página web con videos incrustados',
    placeholder: 'https://ejemplo.com/articulo-con-videos',
    color: '#3b82f6',
  },
};

// ── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Load saved API URL
  cobaltApiUrl = localStorage.getItem('cobaltApiUrl') || '';
  const apiInput = document.getElementById('apiUrl');
  if (apiInput && cobaltApiUrl) {
    apiInput.value = cobaltApiUrl;
  }

  // Open API config if no URL is saved
  if (!cobaltApiUrl) {
    document.getElementById('apiConfig').open = true;
  }

  // Enable/disable download button based on input
  const urlInput = document.getElementById('videoUrl');
  urlInput.addEventListener('input', () => {
    document.getElementById('downloadBtn').disabled = !urlInput.value.trim();
  });

  // Enter key to submit
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && urlInput.value.trim()) {
      handleDownload();
    }
  });
});

// ── Tab Switching ────────────────────────────
function switchTab(tab) {
  currentTab = tab;

  // Update tab styles
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');

  // Update hint
  const platform = PLATFORMS[tab];
  document.getElementById('hintIcon').textContent = platform.hint.split(' ')[0];
  document.getElementById('hintText').textContent = platform.hint.substring(platform.hint.indexOf(' ') + 1);

  // Update placeholder
  document.getElementById('videoUrl').placeholder = platform.placeholder;

  // Reset state
  resetUI();
}

// ── Save API URL ─────────────────────────────
function saveApiUrl() {
  const input = document.getElementById('apiUrl');
  let url = input.value.trim();

  if (!url) {
    showApiStatus('Ingresa una URL válida', 'error');
    return;
  }

  // Normalize URL
  if (!url.startsWith('http')) url = 'https://' + url;
  if (url.endsWith('/')) url = url.slice(0, -1);

  cobaltApiUrl = url;
  localStorage.setItem('cobaltApiUrl', cobaltApiUrl);
  input.value = cobaltApiUrl;

  // Test connection
  testApiConnection();
}

async function testApiConnection() {
  showApiStatus('Probando conexión...', '');
  try {
    const res = await fetch(cobaltApiUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      showApiStatus('✓ Conexión exitosa', 'success');
    } else {
      showApiStatus('✓ Servidor encontrado (puede requerir autenticación)', 'success');
    }
  } catch (err) {
    showApiStatus('⚠ No se pudo conectar. Verifica la URL.', 'error');
  }
}

function showApiStatus(text, type) {
  const el = document.getElementById('apiStatus');
  el.textContent = text;
  el.className = 'api-status ' + type;
}

// ── Paste from Clipboard ─────────────────────
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    const input = document.getElementById('videoUrl');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  } catch {
    // Clipboard API not available or denied
  }
}

// ── Main Download Handler ────────────────────
async function handleDownload() {
  const url = document.getElementById('videoUrl').value.trim();
  if (!url) return;

  if (!cobaltApiUrl) {
    document.getElementById('apiConfig').open = true;
    showApiStatus('⚠ Primero configura tu servidor Cobalt API', 'error');
    return;
  }

  resetUI();
  showStatus('Conectando con el servidor...', true);
  disableButton(true);

  try {
    // Call Cobalt API
    showStatus('Procesando video... Esto puede tardar un momento', true);

    const response = await fetch(cobaltApiUrl + '/', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        videoQuality: 'max',
        filenameStyle: 'pretty',
        downloadMode: 'auto',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.code || `Error del servidor (${response.status})`);
    }

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.error?.code || 'Error al procesar el video');
    }

    if (data.status === 'picker') {
      // Multiple items found — show picker
      handlePickerResponse(data, url);
      return;
    }

    if (data.status === 'tunnel' || data.status === 'redirect') {
      // Single video ready
      await handleSingleVideo(data, url);
      return;
    }

    if (data.status === 'local-processing') {
      // Cobalt returned local-processing — still a URL
      await handleSingleVideo(data, url);
      return;
    }

    throw new Error('Respuesta inesperada del servidor');

  } catch (err) {
    showError(err.message);
    disableButton(false);
  }
}

// ── Handle Single Video ──────────────────────
async function handleSingleVideo(data, originalUrl) {
  const downloadUrl = data.url;
  const filename = data.filename || 'video.mp4';

  // Try to get metadata from oEmbed or page
  const metadata = await fetchMetadata(originalUrl);

  lastVideoInfo = {
    title: metadata.title || filename.replace(/\.[^/.]+$/, ''),
    author: metadata.author || 'Desconocido',
    date: metadata.date || new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }),
    url: originalUrl,
    downloadUrl: downloadUrl,
    filename: filename,
    thumbnail: metadata.thumbnail || '',
  };

  // Show video card
  showVideoCard(lastVideoInfo);

  // Show download actions
  showStatus('✓ Video listo para descargar en Alta Definición', false);
  document.getElementById('downloadActions').style.display = 'flex';
  disableButton(false);
}

// ── Handle Picker (multiple videos) ──────────
function handlePickerResponse(data, originalUrl) {
  const items = data.picker || [];

  if (items.length === 0) {
    showError('No se encontraron videos en esta página');
    disableButton(false);
    return;
  }

  showStatus(`✓ Se detectaron ${items.length} videos en la página`, false);

  const picker = document.getElementById('videoPicker');
  const list = document.getElementById('pickerList');
  document.getElementById('pickerCount').textContent = `Se detectaron ${items.length} videos`;

  list.innerHTML = '';

  items.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'picker-item';
    div.innerHTML = `
      <div class="picker-checkbox"></div>
      <div class="picker-item-info">
        <div class="picker-item-title">${item.text || `Video ${index + 1}`}</div>
        <div class="picker-item-meta">${item.type || 'video'}</div>
      </div>
      <button class="btn btn-sm" onclick="downloadPickerItem('${encodeURIComponent(item.url)}', '${encodeURIComponent(item.text || `Video ${index + 1}`)}', event)">
        Descargar
      </button>
    `;
    list.appendChild(div);
  });

  picker.style.display = 'block';
  disableButton(false);
}

async function downloadPickerItem(encodedUrl, encodedTitle, event) {
  const url = decodeURIComponent(encodedUrl);
  const title = decodeURIComponent(encodedTitle);

  // Highlight selected
  event.target.closest('.picker-item').classList.add('selected');
  event.target.textContent = 'Descargando...';
  event.target.disabled = true;

  // Generate TXT for this item
  const txtContent = `Título: ${title}\nAutor: Desconocido\nFecha: ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}\nUrl: ${url}\n`;
  downloadTextFile(`${sanitizeFilename(title)}.txt`, txtContent);

  // Trigger video download
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFilename(title) + '.mp4';
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    event.target.textContent = '✓ Listo';
  }, 1000);
}

// ── Fetch Metadata ───────────────────────────
async function fetchMetadata(url) {
  const result = { title: '', author: '', date: '', thumbnail: '' };

  try {
    // Try oEmbed (works for YouTube, Vimeo, etc.)
    const oembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });

    if (res.ok) {
      const data = await res.json();
      result.title = data.title || '';
      result.author = data.author_name || '';
      result.thumbnail = data.thumbnail_url || '';

      // Try to extract date from YouTube API (public, no key needed)
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const videoId = extractYouTubeId(url);
        if (videoId) {
          result.thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }
      }
    }
  } catch {
    // Metadata fetch failed, continue with defaults
  }

  return result;
}

function extractYouTubeId(url) {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// ── UI Helpers ───────────────────────────────
function showVideoCard(info) {
  const card = document.getElementById('videoCard');

  const thumb = document.getElementById('videoThumb');
  if (info.thumbnail) {
    thumb.src = info.thumbnail;
    thumb.style.display = 'block';
  } else {
    thumb.style.display = 'none';
  }

  document.getElementById('videoTitle').textContent = info.title;

  const authorEl = document.getElementById('videoAuthor');
  authorEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${info.author}`;

  const dateEl = document.getElementById('videoDate');
  dateEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${info.date}`;

  const badge = document.getElementById('qualityBadge');
  badge.textContent = 'HD Máxima Calidad';
  badge.className = 'quality-badge';

  card.style.display = 'flex';
}

function showStatus(text, showSpinner) {
  const area = document.getElementById('statusArea');
  area.style.display = 'block';

  document.getElementById('statusText').textContent = text;

  const spinner = document.getElementById('spinner');
  spinner.className = showSpinner ? 'spinner' : 'spinner hidden';
}

function showError(message) {
  // Remove any existing error
  const existing = document.querySelector('.error-msg');
  if (existing) existing.remove();

  const statusArea = document.getElementById('statusArea');
  statusArea.style.display = 'none';

  const div = document.createElement('div');
  div.className = 'error-msg';
  div.textContent = '✕ ' + message;

  document.querySelector('.main-panel').appendChild(div);

  setTimeout(() => div.remove(), 8000);
}

function disableButton(disabled) {
  const btn = document.getElementById('downloadBtn');
  btn.disabled = disabled;
  if (disabled) {
    btn.querySelector('span').textContent = 'Procesando...';
  } else {
    btn.querySelector('span').textContent = 'Obtener Video en Alta Definición';
  }
}

function resetUI() {
  document.getElementById('statusArea').style.display = 'none';
  document.getElementById('videoCard').style.display = 'none';
  document.getElementById('videoPicker').style.display = 'none';
  document.getElementById('downloadActions').style.display = 'none';

  const existing = document.querySelector('.error-msg');
  if (existing) existing.remove();

  lastVideoInfo = null;
}

// ── Download Triggers ────────────────────────
function triggerVideoDownload() {
  if (!lastVideoInfo || !lastVideoInfo.downloadUrl) return;

  const link = document.createElement('a');
  link.href = lastVideoInfo.downloadUrl;
  link.download = sanitizeFilename(lastVideoInfo.title) + '.mp4';
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function triggerTxtDownload() {
  if (!lastVideoInfo) return;

  const txtContent = `Título: ${lastVideoInfo.title}
Autor: ${lastVideoInfo.author}
Fecha: ${lastVideoInfo.date}
Url: ${lastVideoInfo.url}
`;

  const filename = sanitizeFilename(lastVideoInfo.title) + '.txt';
  downloadTextFile(filename, txtContent);
}

// ── Utilities ────────────────────────────────
function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200) || 'video';
}
