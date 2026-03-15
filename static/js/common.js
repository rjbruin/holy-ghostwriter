async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!response.ok) {
      const text = await response.text();
      let parsedError = null;
      try {
        parsedError = JSON.parse(text);
      } catch {
      }
      const err = new Error(parsedError?.error || text || `HTTP ${response.status}`);
      err.status = response.status;
      err.details = text;
      throw err;
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response;
  } catch (error) {
    if (error && error.status) {
      throw error;
    }
    const networkError = new Error('Netwerkfout tijdens communicatie met de server.');
    networkError.details = String(error?.stack || error?.message || error);
    throw networkError;
  }
}

function showAppError(title, friendlyMessage, details) {
  const modalEl = document.getElementById('appErrorModal');
  if (!modalEl) {
    alert(friendlyMessage || 'Er ging iets mis.');
    return;
  }
  document.getElementById('appErrorTitle').textContent = title || 'Er ging iets mis';
  document.getElementById('appErrorFriendly').textContent = friendlyMessage || 'Er ging iets mis. Probeer het opnieuw.';
  document.getElementById('appErrorDetails').textContent = details || '-';
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function handleAppError(error, title = 'Er ging iets mis') {
  const raw = String(error?.message || error || 'Onbekende fout');
  const details = String(error?.details || error?.stack || raw);
  const lowered = `${raw} ${details}`.toLowerCase();

  if (lowered.includes('api key') || lowered.includes('401')) {
    showAppError(
      title,
      'Je API key ontbreekt of is ongeldig. Open Instellingen en controleer je OpenRouter API key.',
      details,
    );
    return;
  }

  if (lowered.includes('credits') || lowered.includes('insufficient') || lowered.includes('payment required') || lowered.includes('402')) {
    showAppError(
      title,
      'Je OpenRouter credits lijken op te zijn. Voeg credits toe in OpenRouter en probeer het daarna opnieuw.',
      details,
    );
    return;
  }

  if (lowered.includes('429') || lowered.includes('rate limit')) {
    showAppError(
      title,
      'Er komen te veel verzoeken tegelijk binnen. Wacht even en probeer het opnieuw.',
      details,
    );
    return;
  }

  showAppError(title, 'Er ging iets mis tijdens het verwerken van je verzoek. Probeer het opnieuw.', details);
}

window.showAppError = showAppError;
window.handleAppError = handleAppError;

function showMeta(data) {
  const modal = new bootstrap.Modal(document.getElementById('metaModal'));
  document.getElementById('metaContent').textContent = JSON.stringify(data, null, 2);
  modal.show();
}

function formatUsd(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return '-';
  }

  return `$${numeric.toFixed(2)}`;
}

function promptDisplayName(name) {
  const labels = {
    standards_and_preferences: 'Standaarden en voorkeuren',
    chat_personality: 'Chatpersoonlijkheid',
    generate_sermon: 'Genereer preek',
    sermon_style: 'Preekstijl',
    generate_ideas: 'Genereer ideeën',
    modify_sermon: 'Pas preek aan',
    fetch_bible_text: 'Haal bijbeltekst op',
  };

  if (labels[name]) {
    return labels[name];
  }

  return (name || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

let promptEditors = {};
let currentSettings = null;
const EDITABLE_PROMPT_NAMES = [
  'standards_and_preferences',
  'chat_personality',
  'sermon_style',
];

function resetPromptEditors() {
  Object.values(promptEditors).forEach((editor) => {
    if (editor && typeof editor.destroy === 'function') {
      editor.destroy();
    }
  });
  promptEditors = {};
}

async function loadSettingsUI() {
  const settings = await api('/api/settings');
  currentSettings = settings;
  const modelsList = document.getElementById('modelsList');
  const selected = settings.selected_model_slug;
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');

  if (apiKeyInput) {
    apiKeyInput.value = settings.openrouter_api_key || '';
  }

  if (saveApiKeyBtn) {
    saveApiKeyBtn.onclick = async () => {
      const apiKey = (apiKeyInput?.value || '').trim();
      await api('/api/settings/api-key', {
        method: 'PUT',
        body: JSON.stringify({ api_key: apiKey }),
      });
      alert('API key opgeslagen.');
    };
  }

  let currentSelectedSlug = selected;

  function renderModelsList(models, selectedSlug) {
    const field = document.getElementById('modelSortField')?.value || 'cost';
    const dir = document.getElementById('modelSortDir')?.dataset.dir || 'asc';
    const sorted = [...models].sort((a, b) => {
      let aVal, bVal;
      if (field === 'name') {
        aVal = (a.name || '').toLowerCase();
        bVal = (b.name || '').toLowerCase();
        return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else {
        aVal = a.estimated_avg_sermon_generation_cost_usd ?? Infinity;
        bVal = b.estimated_avg_sermon_generation_cost_usd ?? Infinity;
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
      }
    });

    modelsList.innerHTML = '';
    sorted.forEach((model) => {
      const supports = model.supported_input_types || {};
      const fileTypeLabels = {
        text: 'tekst',
        pdf: 'PDF',
        image: 'afbeelding',
      };
      const fileTypeChips = [
        ['text', supports.text !== false],
        ['pdf', !!supports.pdf],
        ['image', !!supports.image],
      ]
        .map(([name, ok]) => `<span class="badge border ${ok ? 'border-success text-success' : 'border-danger text-danger'} me-1">${ok ? '✓' : '✗'} ${fileTypeLabels[name]}</span>`)
        .join('');

      const tile = document.createElement('div');
      tile.className = `model-select-tile mb-2${model.slug === selectedSlug ? ' selected' : ''}`;
      tile.innerHTML = `
        <div class="model-select-tile-body">
          <div><strong>${model.name}</strong></div>
          <div class="text-muted small">${model.slug}</div>
          <div class="small">Eén preek: ${formatUsd(model.estimated_avg_sermon_generation_cost_usd)}</div>
          <div class="small">Eén chatbericht: ${formatUsd(model.estimated_avg_chat_message_cost_usd)}</div>
          <div class="small mt-1">Bestandstypes: ${fileTypeChips}</div>
        </div>
        <div class="mt-2 d-flex gap-1">
          <button class="btn btn-outline-secondary btn-sm edit-model-btn" type="button" data-model-id="${model.id}">Bewerken</button>
          <button class="btn btn-outline-danger btn-sm delete-model-btn" type="button" data-model-id="${model.id}" data-model-name="${model.name}">Verwijderen</button>
        </div>
      `;
      tile.querySelector('.model-select-tile-body').addEventListener('click', async () => {
        if (currentSelectedSlug === model.slug) return;
        currentSelectedSlug = model.slug;
        renderModelsList(models, currentSelectedSlug);
        await api('/api/settings/model', { method: 'PUT', body: JSON.stringify({ slug: model.slug }) });
      });
      tile.querySelector('.edit-model-btn').addEventListener('click', () => {
        document.getElementById('editModelId').value = model.id;
        document.getElementById('editModelName').value = model.name;
        document.getElementById('editModelSlug').value = model.slug;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('editModelModal')).show();
      });
      tile.querySelector('.delete-model-btn').addEventListener('click', async (e) => {
        const name = e.currentTarget.dataset.modelName;
        if (!confirm(`Model "${name}" verwijderen?`)) return;
        await api(`/api/settings/models/${model.id}`, { method: 'DELETE' });
        await loadSettingsUI();
      });
      modelsList.appendChild(tile);
    });
  }

  renderModelsList(settings.models || [], currentSelectedSlug);

  const sortField = document.getElementById('modelSortField');
  const sortDirBtn = document.getElementById('modelSortDir');
  if (sortField) {
    sortField.onchange = () => renderModelsList(settings.models || [], currentSelectedSlug);
  }
  if (sortDirBtn) {
    sortDirBtn.onclick = () => {
      const next = sortDirBtn.dataset.dir === 'asc' ? 'desc' : 'asc';
      sortDirBtn.dataset.dir = next;
      sortDirBtn.textContent = next === 'asc' ? '↑' : '↓';
      renderModelsList(settings.models || [], currentSelectedSlug);
    };
  }

  const tabs = document.getElementById('promptTabs');
  const tabContent = document.getElementById('promptTabContent');
  if (!tabs || !tabContent) return;
  resetPromptEditors();
  tabs.innerHTML = '';
  tabContent.innerHTML = '';

  const editablePromptEntries = Object.entries(settings.prompts || {}).filter(([name]) => EDITABLE_PROMPT_NAMES.includes(name));

  editablePromptEntries.forEach(([name, content], index) => {
    const active = index === 0 ? 'active' : '';
    const show = index === 0 ? 'show active' : '';
    const tabId = `tab-${name}`;

    const li = document.createElement('li');
    li.className = 'nav-item';
    li.innerHTML = `<button class="nav-link ${active}" data-bs-toggle="tab" data-bs-target="#${tabId}" type="button" title="${name}">${promptDisplayName(name)}</button>`;
    tabs.appendChild(li);

    const pane = document.createElement('div');
    pane.className = `tab-pane fade ${show}`;
    pane.id = tabId;
    pane.innerHTML = `<div id="prompt-editor-${name}" class="prompt-editor-shell"></div>`;
    tabContent.appendChild(pane);

    const editorRoot = pane.querySelector(`#prompt-editor-${name}`);
    promptEditors[name] = new toastui.Editor({
      el: editorRoot,
      height: '320px',
      initialEditType: 'wysiwyg',
      previewStyle: 'tab',
      initialValue: content || '',
    });
  });

  if (editablePromptEntries.length === 0) {
    tabContent.innerHTML = '<p class="text-muted mb-0">Geen bewerkbare prompts gevonden.</p>';
  }

  const savePromptsBtn = document.getElementById('savePromptsBtn');
  if (savePromptsBtn) {
    savePromptsBtn.onclick = async () => {
      for (const [name, editor] of Object.entries(promptEditors)) {
        await api(`/api/settings/prompts/${name}`, {
          method: 'PUT',
          body: JSON.stringify({ content: editor.getMarkdown() }),
        });
      }
      alert('Prompts opgeslagen.');
    };
  }

  const settingsUpdateNotice = document.getElementById('settingsUpdateNotice');
  if (settingsUpdateNotice) {
    try {
      const update = await api('/api/app/update/check');
      if (update.available) {
        settingsUpdateNotice.innerHTML = `
          <div class="alert alert-warning py-2 px-3 mb-0 small">
            <strong>Update beschikbaar:</strong> ${update.latest_version}
            <div class="mt-1">Download via <a href="${update.release_url}" target="_blank" rel="noopener">GitHub releases ↗</a>.</div>
          </div>
        `;
      } else {
        settingsUpdateNotice.innerHTML = '';
      }
    } catch {
      settingsUpdateNotice.innerHTML = '';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const settingsModal = document.getElementById('settingsModal');
  if (settingsModal) {
    settingsModal.addEventListener('show.bs.modal', () => {
      loadSettingsUI().catch((err) => handleAppError(err, 'Instellingen laden mislukt'));
    });
    settingsModal.addEventListener('shown.bs.modal', () => {
      settingsModal.querySelectorAll('[data-bs-toggle="popover"]').forEach((el) => {
        const pop = bootstrap.Popover.getOrCreateInstance(el, { sanitize: false, trigger: 'manual' });
        let hideTimer = null;

        function scheduleHide() {
          hideTimer = setTimeout(() => pop.hide(), 150);
        }
        function cancelHide() {
          clearTimeout(hideTimer);
        }

        el.addEventListener('mouseenter', () => { cancelHide(); pop.show(); });
        el.addEventListener('mouseleave', scheduleHide);
        el.addEventListener('focus', () => { cancelHide(); pop.show(); });
        el.addEventListener('blur', scheduleHide);

        el.addEventListener('shown.bs.popover', () => {
          const tip = document.getElementById(el.getAttribute('aria-describedby'));
          if (!tip) return;
          tip.addEventListener('mouseenter', cancelHide);
          tip.addEventListener('mouseleave', scheduleHide);
        });
      });
    });
  }

  const saveNewModelBtn = document.getElementById('saveNewModelBtn');
  if (saveNewModelBtn) {
    saveNewModelBtn.addEventListener('click', async () => {
      const name = document.getElementById('newModelName').value.trim();
      const slug = document.getElementById('newModelSlug').value.trim();
      if (!name || !slug) return;
      try {
        await api('/api/settings/models', { method: 'POST', body: JSON.stringify({ name, slug }) });
        bootstrap.Modal.getInstance(document.getElementById('addModelModal')).hide();
        document.getElementById('newModelName').value = '';
        document.getElementById('newModelSlug').value = '';
        await loadSettingsUI();
      } catch (err) {
        handleAppError(err, 'Model toevoegen mislukt');
      }
    });
  }

  const saveEditedModelBtn = document.getElementById('saveEditedModelBtn');
  if (saveEditedModelBtn) {
    saveEditedModelBtn.addEventListener('click', async () => {
      const id = document.getElementById('editModelId').value;
      const name = document.getElementById('editModelName').value.trim();
      const slug = document.getElementById('editModelSlug').value.trim();
      if (!id || !name || !slug) return;
      try {
        await api(`/api/settings/models/${id}`, { method: 'PUT', body: JSON.stringify({ name, slug }) });
        bootstrap.Modal.getInstance(document.getElementById('editModelModal')).hide();
        await loadSettingsUI();
      } catch (err) {
        handleAppError(err, 'Model bewerken mislukt');
      }
    });
  }
});
