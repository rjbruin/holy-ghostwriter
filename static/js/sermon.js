let sermonState;
let editor;

const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'log'];

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

function escapeHtml(value) {
  return (value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getFileExtension(fileName) {
  const parts = String(fileName || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function detectContextFileType(file) {
  const mime = String(file.type || '').toLowerCase();
  const extension = getFileExtension(file.name);

  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime === 'application/pdf' || extension === 'pdf') {
    return 'pdf';
  }
  if (mime.startsWith('text/') || TEXT_EXTENSIONS.includes(extension)) {
    return 'text';
  }
  return null;
}

function fileTypeLabelDutch(type) {
  const labels = {
    text: 'tekst',
    pdf: 'PDF',
    image: 'afbeelding',
  };
  return labels[type] || type;
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Bestand kon niet worden gelezen.'));
    reader.readAsDataURL(file);
  });
}

function showContextToast(message) {
  const toastEl = document.getElementById('contextToast');
  const textEl = document.getElementById('contextToastText');
  if (!toastEl || !textEl) {
    showAppError('Bestandsfout', message, message);
    return;
  }
  textEl.textContent = message;
  bootstrap.Toast.getOrCreateInstance(toastEl).show();
}

function showUnsupportedFileTypeModal(fileType, modelName) {
  const modalEl = document.getElementById('unsupportedFileTypeModal');
  const textEl = document.getElementById('unsupportedFileTypeText');
  if (!modalEl || !textEl) return;
  textEl.textContent = `Het gekozen model (${modelName}) ondersteunt geen ${fileTypeLabelDutch(fileType)}-bestanden als context. Kies in Instellingen een model dat dit wel ondersteunt.`;
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function getContextFiles() {
  if (!Array.isArray(sermonState.context_files)) {
    sermonState.context_files = [];
  }
  return sermonState.context_files;
}

function renderContextFiles() {
  const listEl = document.getElementById('contextFilesList');
  if (!listEl) return;
  const contextFiles = getContextFiles();
  listEl.innerHTML = '';

  contextFiles.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'context-file-row small';

    const left = document.createElement('div');
    left.innerHTML = `<strong>${escapeHtml(item.name || 'bestand')}</strong> <span class="text-muted">(${escapeHtml(fileTypeLabelDutch(item.type || '-'))})</span>`;

    const actions = document.createElement('div');
    actions.className = 'd-flex gap-1';
    actions.innerHTML = `
      <button type="button" class="btn btn-sm btn-outline-secondary context-view-btn" title="Bekijk">👁</button>
      <button type="button" class="btn btn-sm btn-outline-danger context-remove-btn" title="Verwijder">✕</button>
    `;

    actions.querySelector('.context-view-btn').addEventListener('click', () => {
      let dataUrl = item.data_url || '';
      if (!dataUrl && item.data_base64 && item.mime_type) {
        dataUrl = `data:${item.mime_type};base64,${item.data_base64}`;
      }
      if (!dataUrl && item.type === 'text' && item.content_text) {
        dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(item.content_text)}`;
      }
      if (!dataUrl) {
        showContextToast('Dit bestand kan niet worden weergegeven.');
        return;
      }
      window.open(dataUrl, '_blank', 'noopener');
    });

    actions.querySelector('.context-remove-btn').addEventListener('click', async () => {
      sermonState.context_files = contextFiles.filter((f) => f.id !== item.id);
      renderContextFiles();
      await saveFields();
    });

    row.appendChild(left);
    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

async function getSelectedModelSettings() {
  const settings = await api('/api/settings');
  const selected = (settings.models || []).find((model) => model.slug === settings.selected_model_slug);
  return {
    model: selected,
    supports: selected?.supported_input_types || { text: true, pdf: false, image: false },
  };
}

async function validateCurrentContextFilesAgainstModel() {
  const { model, supports } = await getSelectedModelSettings();
  const modelName = model?.name || model?.slug || 'geselecteerde model';
  const files = getContextFiles();

  const hasUnsupportedImage = files.some((file) => file.type === 'image') && !supports.image;
  if (hasUnsupportedImage) {
    showUnsupportedFileTypeModal('image', modelName);
    return false;
  }

  const hasUnsupportedPdf = files.some((file) => file.type === 'pdf') && !supports.pdf;
  if (hasUnsupportedPdf) {
    showUnsupportedFileTypeModal('pdf', modelName);
    return false;
  }

  return true;
}

function chatContainer() {
  return document.getElementById('chatMessages');
}

function addMessageBubble(role, text, isPending = false) {
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (isPending) {
    bubble.innerHTML = '<span class="pending-dots"><span>•</span><span>•</span><span>•</span></span>';
  } else {
    bubble.innerHTML = escapeHtml(text);
  }

  row.appendChild(bubble);
  chatContainer().appendChild(row);
  chatContainer().scrollTop = chatContainer().scrollHeight;
  return bubble;
}

function renderStoredMessages() {
  chatContainer().innerHTML = '';
  (sermonState.chat_messages || []).forEach((msg) => {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    addMessageBubble(role, msg.text || '');
  });
}

async function refreshChatbotTooltip() {
  const chatbotName = document.getElementById('chatbotName');
  const chatbotInfoIcon = document.getElementById('chatbotInfoIcon');
  if (!chatbotName || !chatbotInfoIcon) return;

  const modelSlug = chatbotName.dataset.modelSlug || chatbotName.getAttribute('title') || '';
  let tooltipHtml = `Slug: ${escapeHtml(modelSlug)}`;

  try {
    const settings = await api('/api/settings');
    const selectedModel = (settings.models || []).find((model) => model.slug === modelSlug)
      || (settings.models || []).find((model) => model.slug === settings.selected_model_slug);
    if (selectedModel) {
      tooltipHtml = [
        `Slug: ${escapeHtml(selectedModel.slug)}`,
        `Eén preek: ${escapeHtml(formatUsd(selectedModel.estimated_avg_sermon_generation_cost_usd))}`,
        `Eén chatbericht: ${escapeHtml(formatUsd(selectedModel.estimated_avg_chat_message_cost_usd))}`,
      ].join('<br>');
    }
  } catch {
  }

  [chatbotName, chatbotInfoIcon].forEach((el) => {
    el.setAttribute('title', tooltipHtml.replace(/<br>/g, ' | '));
    el.setAttribute('data-bs-title', tooltipHtml);
    const existing = bootstrap.Tooltip.getInstance(el);
    if (existing) {
      existing.dispose();
    }
    bootstrap.Tooltip.getOrCreateInstance(el, { html: true });
  });
}

function updateActionButtons() {
  const bibleRef = document.getElementById('bibleRefInput').value.trim();
  const notes = document.getElementById('contentNotesInput').value.trim();
  const sermonMarkdown = editor.getMarkdown().trim();

  const ideasBtn = document.getElementById('ideasBtn');
  const sermonActionBtn = document.getElementById('sermonActionBtn');

  const ideasActive = !!bibleRef && !notes && !sermonMarkdown;
  ideasBtn.disabled = !ideasActive;
  ideasBtn.title = ideasActive ? '' : 'Actief wanneer bijbelreferentie gevuld is, inhoudsbeschrijving leeg is en preek leeg is.';

  const canGenerate = !!bibleRef && !!notes && !sermonMarkdown;
  const canModify = sermonState.sermon_generated || !!sermonMarkdown;

  if (canModify) {
    sermonActionBtn.textContent = 'Pas preek aan';
    sermonActionBtn.disabled = !notes;
    sermonActionBtn.title = notes ? '' : 'Vul inhoudsbeschrijving in om aanpassing te genereren.';
  } else {
    sermonActionBtn.textContent = 'Genereer preek';
    sermonActionBtn.disabled = !canGenerate;
    sermonActionBtn.title = canGenerate ? '' : 'Actief wanneer bijbelreferentie én inhoudsbeschrijving gevuld zijn en preek nog leeg is.';
  }

  const tooltipList = [...document.querySelectorAll('[title]')].map((el) => bootstrap.Tooltip.getOrCreateInstance(el));
  return tooltipList;
}

async function saveFields() {
  const payload = {
    title: document.getElementById('titleInput').value,
    bible_reference: document.getElementById('bibleRefInput').value,
    bible_text: document.getElementById('bibleTextDisplay').textContent,
    content_notes: document.getElementById('contentNotesInput').value,
    sermon_markdown: editor.getMarkdown(),
    context_files: getContextFiles(),
    sermon_generated: sermonState.sermon_generated,
  };
  sermonState = await api(`/api/sermons/${sermonState.id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  updateActionButtons();
}

async function runAction(action, actionLabel, payload = {}) {
  const contextIsValidForModel = await validateCurrentContextFilesAgainstModel();
  if (!contextIsValidForModel) {
    return;
  }

  addMessageBubble('user', actionLabel);
  const pendingBubble = addMessageBubble('assistant', '', true);

  let jobId;
  try {
    const response = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        sermon_id: sermonState.id,
        action,
        payload: {
          action_label: actionLabel,
          ...payload,
        },
      }),
    });
    jobId = response.job_id;
  } catch (error) {
    pendingBubble.textContent = 'Fout bij starten van AI-verzoek.';
    handleAppError(error, 'AI-verzoek starten mislukt');
    return;
  }

  const source = new EventSource(`/api/jobs/${jobId}/stream`);
  let streamed = '';

  source.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'delta') {
      streamed += data.content;
      pendingBubble.textContent = streamed;
      chatContainer().scrollTop = chatContainer().scrollHeight;
      return;
    }

    if (data.type === 'result') {
      source.close();
      const result = data.result;
      pendingBubble.textContent = result.chat_message?.text || 'Gereed.';

      const fieldUpdates = result.field_updates || {};
      if (fieldUpdates.bible_text !== undefined) {
        document.getElementById('bibleTextDisplay').textContent = fieldUpdates.bible_text;
      }
      if (fieldUpdates.sermon_markdown !== undefined) {
        editor.setMarkdown(fieldUpdates.sermon_markdown || '');
        sermonState.sermon_generated = true;
      }
      if (fieldUpdates.content_notes !== undefined) {
        document.getElementById('contentNotesInput').value = fieldUpdates.content_notes;
      }
      if (fieldUpdates.title !== undefined) {
        document.getElementById('titleInput').value = fieldUpdates.title;
      }
      if (fieldUpdates.bible_reference !== undefined) {
        document.getElementById('bibleRefInput').value = fieldUpdates.bible_reference;
      }

      if (result.sermon) {
        sermonState = result.sermon;
      }

      const usage = result.usage || {};
      if (usage.cost_usd !== undefined) {
        if (result.sermon && result.sermon.total_cost_usd !== undefined) {
          document.getElementById('costTotal').textContent = Number(result.sermon.total_cost_usd).toFixed(2);
        } else {
          const totalNow = Number(document.getElementById('costTotal').textContent || 0) + Number(usage.cost_usd || 0);
          document.getElementById('costTotal').textContent = totalNow.toFixed(2);
        }
      }

      saveFields().catch(console.error);
      refreshChatbotTooltip().catch(() => {});
      updateActionButtons();
      return;
    }

    if (data.type === 'error') {
      source.close();
      pendingBubble.textContent = `Fout: ${data.message}`;
      showAppError('AI-verzoek mislukt', data.message || 'Er ging iets mis.', data.details || data.message || '-');
    }
  };

  source.onerror = () => {
    source.close();
    pendingBubble.textContent = 'Verbinding met AI-antwoord verbroken.';
    showAppError(
      'AI-verzoek mislukt',
      'De verbinding met het AI-verzoek is verbroken. Probeer het opnieuw.',
      `Job ID: ${jobId}`,
    );
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  sermonState = JSON.parse(document.getElementById('initial-sermon').textContent);
  sermonState.context_files = Array.isArray(sermonState.context_files) ? sermonState.context_files : [];

  editor = new toastui.Editor({
    el: document.getElementById('sermonEditor'),
    height: '420px',
    initialEditType: 'wysiwyg',
    previewStyle: 'vertical',
    initialValue: sermonState.sermon_markdown || '',
  });

  renderStoredMessages();
  renderContextFiles();
  updateActionButtons();
  refreshChatbotTooltip().catch(() => {});

  const contextFileInput = document.getElementById('contextFileInput');
  const addContextFileBtn = document.getElementById('addContextFileBtn');

  if (addContextFileBtn) {
    addContextFileBtn.addEventListener('click', async () => {
      const file = contextFileInput?.files?.[0];
      if (!file) {
        showContextToast('Selecteer eerst een bestand.');
        return;
      }

      const detectedType = detectContextFileType(file);
      if (!detectedType) {
        showContextToast('Bestandstype is niet geldig. Toegestaan: tekst, PDF, afbeelding.');
        return;
      }

      try {
        if (detectedType === 'image' || detectedType === 'pdf') {
          const { model, supports } = await getSelectedModelSettings();
          if (detectedType === 'image' && !supports.image) {
            showUnsupportedFileTypeModal('image', model?.name || model?.slug || 'geselecteerde model');
            return;
          }
          if (detectedType === 'pdf' && !supports.pdf) {
            showUnsupportedFileTypeModal('pdf', model?.name || model?.slug || 'geselecteerde model');
            return;
          }
        }

        const item = {
          id: (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
          name: file.name,
          type: detectedType,
          mime_type: file.type || (detectedType === 'pdf' ? 'application/pdf' : 'text/plain'),
          size: file.size,
        };

        if (detectedType === 'text') {
          item.content_text = await file.text();
        } else {
          const dataUrl = await readFileAsDataUrl(file);
          const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
          item.data_url = dataUrl;
          item.data_base64 = base64;
        }

        sermonState.context_files = [...getContextFiles(), item];
        renderContextFiles();
        await saveFields();
        contextFileInput.value = '';
      } catch (error) {
        handleAppError(error, 'Contextbestand toevoegen mislukt');
      }
    });
  }

  document.getElementById('titleInput').addEventListener('change', () => saveFields().catch((error) => handleAppError(error, 'Opslaan mislukt')));
  document.getElementById('bibleRefInput').addEventListener('change', () => saveFields().catch((error) => handleAppError(error, 'Opslaan mislukt')));
  document.getElementById('contentNotesInput').addEventListener('change', () => saveFields().catch((error) => handleAppError(error, 'Opslaan mislukt')));
  editor.on('change', () => {
    clearTimeout(window.__sermonSaveDebounce);
    window.__sermonSaveDebounce = setTimeout(() => saveFields().catch((error) => handleAppError(error, 'Opslaan mislukt')), 700);
  });

  document.getElementById('fetchBibleBtn').addEventListener('click', async () => {
    try {
      const ref = document.getElementById('bibleRefInput').value.trim();
      if (!ref) return;
      await saveFields();
      runAction('fetch_bible_text', 'Laad bijbeltekst', { bible_reference: ref });
    } catch (error) {
      handleAppError(error, 'Bijbeltekst laden mislukt');
    }
  });

  document.getElementById('ideasBtn').addEventListener('click', async () => {
    try {
      await saveFields();
      runAction('generate_ideas', 'Genereer ideeën', {});
    } catch (error) {
      handleAppError(error, 'Ideeën genereren mislukt');
    }
  });

  document.getElementById('sermonActionBtn').addEventListener('click', async () => {
    try {
      await saveFields();
      const action = (sermonState.sermon_generated || editor.getMarkdown().trim()) ? 'modify_sermon' : 'generate_sermon';
      const label = action === 'modify_sermon' ? 'Pas preek aan' : 'Genereer preek';
      runAction(action, label, {});
    } catch (error) {
      handleAppError(error, 'Preekactie mislukt');
    }
  });

  document.getElementById('chatSendBtn').addEventListener('click', async () => {
    try {
      const textInput = document.getElementById('chatInput');
      const message = textInput.value.trim();
      if (!message) return;
      textInput.value = '';
      await saveFields();
      runAction('chat', message, { user_message: message });
    } catch (error) {
      handleAppError(error, 'Chatbericht verzenden mislukt');
    }
  });

  document.getElementById('chatInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('chatSendBtn').click();
    }
  });

  document.getElementById('exportModal').addEventListener('show.bs.modal', () => {
    const markdown = editor.getMarkdown();
    document.getElementById('exportPreview').innerHTML = marked.parse(markdown);
  });

  document.getElementById('downloadDocxBtn').addEventListener('click', async () => {
    try {
      await saveFields();
      const response = await fetch(`/api/sermons/${sermonState.id}/export/docx`, { method: 'POST' });
      if (!response.ok) {
        const text = await response.text();
        const err = new Error(text || `HTTP ${response.status}`);
        err.status = response.status;
        err.details = text;
        throw err;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${document.getElementById('titleInput').value || 'preek'}.docx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      handleAppError(error, 'DOCX export mislukt');
    }
  });

  setInterval(() => {
    saveFields().catch((error) => handleAppError(error, 'Automatisch opslaan mislukt'));
  }, 10000);

  const forceOnboarding = new URLSearchParams(window.location.search).has('onboarding')
    || window.sessionStorage.getItem('holyGhostwriter.sermonOnboardingPending') === '1';
  if (forceOnboarding) {
    window.sessionStorage.removeItem('holyGhostwriter.sermonOnboardingPending');
    let tourOverlay = null;
    let tourBubble = null;
    let tourStepIndex = 0;

    const SERMON_ONBOARDING_STEPS = [
      {
        targetId: 'sermonTitleSection',
        text: 'Hier geef je je preek een duidelijke titel, zodat je hem later makkelijk terugvindt.',
        placement: 'above',
      },
      {
        targetId: 'sermonBibleRefSection',
        text: 'Vul hier de bijbelreferentie in en klik op “Laad bijbeltekst” om de tekst automatisch op te halen.',
        placement: 'above',
      },
      {
        targetId: 'sermonNotesSection',
        text: 'Hier beschrijf je de inhoud, insteek en accenten voor je preek. Hoe concreter je bent, hoe beter de AI kan helpen.',
        placement: 'above',
      },
      {
        targetId: 'sermonContextFilesSection',
        text: 'Voeg hier contextbestanden toe, zoals notities, een PDF of een afbeelding, zodat de AI extra achtergrond heeft.',
        placement: 'above',
      },
      {
        targetId: 'sermonPreekSection',
        text: 'Hier verschijnt de preektekst. Dit veld wordt automatisch gevuld zodra je een preek genereert.',
        placement: 'left',
      },
      {
        targetId: 'sermonChatSection',
        text: 'Dit is je chatinterface: hier werk je samen met de AI, stel je vragen en verfijn je je preek stap voor stap.',
        placement: 'left',
      },
      {
        targetId: 'sermonActionButtonsSection',
        text: 'Met deze knoppen laat je de AI snel ideeën of een volledige preek genereren op basis van je invoer.',
        placement: 'left',
      },
    ];

    function clearTourHighlights() {
      document.querySelectorAll('.onboarding-tour-highlight').forEach((el) => el.classList.remove('onboarding-tour-highlight'));
    }

    function endSermonOnboardingTour() {
      clearTourHighlights();
      if (tourBubble) {
        tourBubble.remove();
        tourBubble = null;
      }
      if (tourOverlay) {
        tourOverlay.remove();
        tourOverlay = null;
      }
    }

    function rectsOverlap(a, b) {
      return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    }

    function clampBubblePosition(position, bubbleRect, margin) {
      const maxLeft = window.innerWidth - bubbleRect.width - margin;
      const maxTop = window.innerHeight - bubbleRect.height - margin;
      return {
        left: Math.max(margin, Math.min(position.left, maxLeft)),
        top: Math.max(margin, Math.min(position.top, maxTop)),
      };
    }

    function positionTourBubble(step, targetRect) {
      if (!tourBubble) return;

      const margin = 12;
      const bubbleRect = tourBubble.getBoundingClientRect();
      const candidates = [];
      const centeredLeft = targetRect.left + (targetRect.width / 2) - (bubbleRect.width / 2);
      const centeredTop = targetRect.top + (targetRect.height / 2) - (bubbleRect.height / 2);

      if (step.placement === 'above') {
        candidates.push({ top: targetRect.top - bubbleRect.height - margin, left: centeredLeft });
        candidates.push({ top: targetRect.bottom + margin, left: centeredLeft });
      } else {
        candidates.push({ top: centeredTop, left: targetRect.left - bubbleRect.width - margin });
        candidates.push({ top: centeredTop, left: targetRect.right + margin });
        candidates.push({ top: targetRect.bottom + margin, left: centeredLeft });
        candidates.push({ top: targetRect.top - bubbleRect.height - margin, left: centeredLeft });
      }

      const clampedCandidates = candidates.map((candidate) => clampBubblePosition(candidate, bubbleRect, margin));
      const targetWithMargin = {
        left: targetRect.left - margin,
        right: targetRect.right + margin,
        top: targetRect.top - margin,
        bottom: targetRect.bottom + margin,
      };

      const selected = clampedCandidates.find((candidate) => {
        const bubbleBox = {
          left: candidate.left,
          right: candidate.left + bubbleRect.width,
          top: candidate.top,
          bottom: candidate.top + bubbleRect.height,
        };
        return !rectsOverlap(bubbleBox, targetWithMargin);
      }) || clampedCandidates[0];

      tourBubble.style.left = `${selected.left}px`;
      tourBubble.style.top = `${selected.top}px`;
    }

    function showSermonTourStep(index) {
      const step = SERMON_ONBOARDING_STEPS[index];
      if (!step) {
        endSermonOnboardingTour();
        return;
      }

      const target = document.getElementById(step.targetId);
      if (!target || !tourOverlay || !tourBubble) {
        endSermonOnboardingTour();
        return;
      }

      clearTourHighlights();
      target.classList.add('onboarding-tour-highlight');

      const isLastStep = index === SERMON_ONBOARDING_STEPS.length - 1;
      tourBubble.innerHTML = isLastStep
        ? `
          <p class="mb-3">${step.text}</p>
          <div class="text-end">
            <button id="sermonOnboardingDoneBtn" class="btn btn-primary btn-sm">Klaar</button>
          </div>
        `
        : `
          <p class="mb-3">${step.text}</p>
          <div class="text-end">
            <button id="sermonOnboardingNextBtn" class="btn btn-primary btn-sm">Volgende</button>
          </div>
        `;

      positionTourBubble(step, target.getBoundingClientRect());

      const nextBtn = document.getElementById('sermonOnboardingNextBtn');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          tourStepIndex += 1;
          showSermonTourStep(tourStepIndex);
        });
      }

      const doneBtn = document.getElementById('sermonOnboardingDoneBtn');
      if (doneBtn) {
        doneBtn.addEventListener('click', () => {
          endSermonOnboardingTour();
        });
      }
    }

    function startSermonOnboardingTour() {
      endSermonOnboardingTour();

      tourOverlay = document.createElement('div');
      tourOverlay.className = 'onboarding-tour-overlay';
      document.body.appendChild(tourOverlay);

      tourBubble = document.createElement('div');
      tourBubble.className = 'onboarding-tour-bubble';
      document.body.appendChild(tourBubble);

      tourStepIndex = 0;
      showSermonTourStep(tourStepIndex);
    }

    window.addEventListener('resize', () => {
      const step = SERMON_ONBOARDING_STEPS[tourStepIndex];
      if (!step || !tourBubble) return;
      const target = document.getElementById(step.targetId);
      if (!target) return;
      positionTourBubble(step, target.getBoundingClientRect());
    });

    startSermonOnboardingTour();
  }
});
