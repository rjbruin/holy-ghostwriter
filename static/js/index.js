document.addEventListener('DOMContentLoaded', () => {
  let activeExport = null;

  const ONBOARDING_PROMPT_TOKENS = 865.0;
  const ONBOARDING_COMPLETION_TOKENS = 3382.6666666666665;
  const ONBOARDING_MODELS = [
    {
      slug: 'nvidia/nemotron-3-super-120b-a12b:free',
      name: 'NVIDIA Nemotron 3 Super (free)',
      promptPrice: 0,
      completionPrice: 0,
      costLabel: 'gratis',
      costLabelClass: 'border-success text-success',
    },
    {
      slug: 'anthropic/claude-sonnet-4.6',
      name: 'Claude Sonnet 4.6',
      promptPrice: 0.000003,
      completionPrice: 0.000015,
      costLabel: 'goedkoop',
      costLabelClass: 'border-warning text-warning',
    },
    {
      slug: 'openai/gpt-5.4-pro',
      name: 'OpenAI GPT 5.4 Pro',
      promptPrice: 0.00003,
      completionPrice: 0.00018,
      costLabel: 'duur',
      costLabelClass: 'border-danger text-danger',
    },
  ];

  const onboardingModalEl = document.getElementById('apiKeyOnboardingModal');
  const onboardingApiKeyInput = document.getElementById('onboardingApiKeyInput');
  const saveOnboardingApiKeyBtn = document.getElementById('saveOnboardingApiKeyBtn');
  const completeOnboardingBtn = document.getElementById('completeOnboardingBtn');
  const onboardingShowTourBtn = document.getElementById('onboardingShowTourBtn');
  const onboardingSkipTourBtn = document.getElementById('onboardingSkipTourBtn');
  const onboardingTitle = document.getElementById('onboardingTitle');
  const onboardingStep1 = document.getElementById('onboardingStep1');
  const onboardingStep2 = document.getElementById('onboardingStep2');
  const onboardingStep3 = document.getElementById('onboardingStep3');
  const onboardingModelTiles = document.getElementById('onboardingModelTiles');
  const onboardingModal = onboardingModalEl ? bootstrap.Modal.getOrCreateInstance(onboardingModalEl) : null;
  const forceOnboarding = new URLSearchParams(window.location.search).has('onboarding');
  let selectedOnboardingModelSlug = ONBOARDING_MODELS[0].slug;
  let onboardingModelSupportBySlug = {};

  const updateAvailableIcon = document.getElementById('updateAvailableIcon');
  const updateModalEl = document.getElementById('updateModal');
  const updateModal = updateModalEl ? bootstrap.Modal.getOrCreateInstance(updateModalEl) : null;
  const updateModalVersion = document.getElementById('updateModalVersion');
  const updateModalChangelog = document.getElementById('updateModalChangelog');
  const openUpdateReleaseBtn = document.getElementById('openUpdateReleaseBtn');
  const ignoreUpdateBtn = document.getElementById('ignoreUpdateBtn');
  let latestUpdateVersion = '';

  let tourOverlay = null;
  let tourBubble = null;
  let tourStepIndex = 0;

  const ONBOARDING_TOUR_STEPS = [
    {
      targetId: 'sermonListCard',
      text: 'Hier staan al je preken. Deze lijst is nu nog leeg.',
      placement: 'above',
    },
    {
      targetId: 'indexSettingsBtn',
      text: 'Hier pas je instellingen aan, zoals welk AI-model je gebruikt, hoe de chatbot met je moet praten, en wat je voorkeuren zijn voor het gegeneren van preken, zoals je preekstijl en de lengte van de preek.',
      placement: 'right',
    },
    {
      targetId: 'newSermonBtn',
      text: 'Klik hier om een nieuwe preek te maken.',
      placement: 'right',
      allowClickTarget: true,
    },
  ];

  function clearTourHighlights() {
    document.querySelectorAll('.onboarding-tour-highlight').forEach((el) => el.classList.remove('onboarding-tour-highlight'));
    document.querySelectorAll('.onboarding-tour-allowed').forEach((el) => el.classList.remove('onboarding-tour-allowed'));
  }

  function endOnboardingTour() {
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

  function positionTourBubble(step, targetRect) {
    if (!tourBubble) return;

    const margin = 12;
    const bubbleRect = tourBubble.getBoundingClientRect();
    let top;
    let left;

    if (step.placement === 'above') {
      top = targetRect.top - bubbleRect.height - margin;
      left = targetRect.left + (targetRect.width / 2) - (bubbleRect.width / 2);
    } else {
      const rightCandidate = targetRect.right + margin;
      const leftCandidate = targetRect.left - bubbleRect.width - margin;
      const centeredTop = targetRect.top + (targetRect.height / 2) - (bubbleRect.height / 2);

      const canPlaceRight = rightCandidate + bubbleRect.width + margin <= window.innerWidth;
      const canPlaceLeft = leftCandidate >= margin;

      if (canPlaceRight) {
        left = rightCandidate;
        top = centeredTop;
      } else if (canPlaceLeft) {
        left = leftCandidate;
        top = centeredTop;
      } else {
        left = targetRect.left + (targetRect.width / 2) - (bubbleRect.width / 2);
        top = targetRect.bottom + margin;
      }
    }

    const maxLeft = window.innerWidth - bubbleRect.width - margin;
    const maxTop = window.innerHeight - bubbleRect.height - margin;
    left = Math.max(margin, Math.min(left, maxLeft));
    top = Math.max(margin, Math.min(top, maxTop));

    tourBubble.style.left = `${left}px`;
    tourBubble.style.top = `${top}px`;
  }

  function showTourStep(index) {
    const step = ONBOARDING_TOUR_STEPS[index];
    if (!step) {
      endOnboardingTour();
      return;
    }

    const target = document.getElementById(step.targetId);
    if (!target || !tourOverlay || !tourBubble) {
      endOnboardingTour();
      return;
    }

    clearTourHighlights();
    target.classList.add('onboarding-tour-highlight');
    if (step.allowClickTarget) {
      target.classList.add('onboarding-tour-allowed');
    }

    const isLastStep = index === ONBOARDING_TOUR_STEPS.length - 1;
    tourBubble.innerHTML = isLastStep
      ? `<p class="mb-0">${step.text}</p>`
      : `
        <p class="mb-3">${step.text}</p>
        <div class="text-end">
          <button id="onboardingTourNextBtn" class="btn btn-primary btn-sm">Volgende</button>
        </div>
      `;

    positionTourBubble(step, target.getBoundingClientRect());

    if (!isLastStep) {
      const nextBtn = document.getElementById('onboardingTourNextBtn');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          tourStepIndex += 1;
          showTourStep(tourStepIndex);
        });
      }
    }
  }

  function startOnboardingTour() {
    endOnboardingTour();

    tourOverlay = document.createElement('div');
    tourOverlay.className = 'onboarding-tour-overlay';
    document.body.appendChild(tourOverlay);

    tourBubble = document.createElement('div');
    tourBubble.className = 'onboarding-tour-bubble';
    document.body.appendChild(tourBubble);

    tourStepIndex = 0;
    showTourStep(tourStepIndex);
  }

  function estimateOnboardingSermonCost(model) {
    return (ONBOARDING_PROMPT_TOKENS * model.promptPrice) + (ONBOARDING_COMPLETION_TOKENS * model.completionPrice);
  }

  function renderOnboardingInputTypeChips(modelSlug) {
    const supports = onboardingModelSupportBySlug[modelSlug] || { text: true, pdf: false, image: false };
    const typeLabels = {
      text: 'tekst',
      pdf: 'PDF',
      image: 'afbeelding',
    };

    return [
      ['text', supports.text !== false],
      ['pdf', !!supports.pdf],
      ['image', !!supports.image],
    ]
      .map(([name, enabled]) => `<span class="badge border ${enabled ? 'border-success text-success' : 'border-danger text-danger'} me-1">${enabled ? '✓' : '✗'} ${typeLabels[name]}</span>`)
      .join('');
  }

  function renderOnboardingModelTiles() {
    if (!onboardingModelTiles) return;
    onboardingModelTiles.innerHTML = '';

    ONBOARDING_MODELS.forEach((model) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `onboarding-model-tile ${model.slug === selectedOnboardingModelSlug ? 'selected' : ''}`;
      tile.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-1">
          <strong>${model.name}</strong>
          <span class="badge border ${model.costLabelClass}">${model.costLabel}</span>
        </div>
        <div class="small text-muted">Eén preek: ${formatUsd(estimateOnboardingSermonCost(model))}</div>
        <div class="small mt-1">Bestandstypes: ${renderOnboardingInputTypeChips(model.slug)}</div>
      `;
      tile.addEventListener('click', () => {
        selectedOnboardingModelSlug = model.slug;
        renderOnboardingModelTiles();
      });
      onboardingModelTiles.appendChild(tile);
    });
  }

  function setOnboardingStep(step) {
    if (step === 1) {
      onboardingTitle.textContent = 'Stap 1: OpenRouter API key instellen';
      onboardingStep1.classList.remove('d-none');
      onboardingStep2.classList.add('d-none');
      onboardingStep3.classList.add('d-none');
      saveOnboardingApiKeyBtn.classList.remove('d-none');
      completeOnboardingBtn.classList.add('d-none');
      onboardingShowTourBtn.classList.add('d-none');
      onboardingSkipTourBtn.classList.add('d-none');
    } else if (step === 2) {
      onboardingTitle.textContent = 'Stap 2: Kies een AI model';
      onboardingStep1.classList.add('d-none');
      onboardingStep2.classList.remove('d-none');
      onboardingStep3.classList.add('d-none');
      saveOnboardingApiKeyBtn.classList.add('d-none');
      completeOnboardingBtn.classList.remove('d-none');
      onboardingShowTourBtn.classList.add('d-none');
      onboardingSkipTourBtn.classList.add('d-none');
      renderOnboardingModelTiles();
    } else {
      onboardingTitle.textContent = 'Stap 3: Klaar om te starten';
      onboardingStep1.classList.add('d-none');
      onboardingStep2.classList.add('d-none');
      onboardingStep3.classList.remove('d-none');
      saveOnboardingApiKeyBtn.classList.add('d-none');
      completeOnboardingBtn.classList.add('d-none');
      onboardingShowTourBtn.classList.remove('d-none');
      onboardingSkipTourBtn.classList.remove('d-none');
    }
  }

  async function ensureApiKeyOnboarding() {
    const settings = await api('/api/settings');
    onboardingModelSupportBySlug = (settings.models || []).reduce((acc, model) => {
      acc[model.slug] = model.supported_input_types || { text: true, pdf: false, image: false };
      return acc;
    }, {});

    if (onboardingApiKeyInput) {
      onboardingApiKeyInput.value = settings.openrouter_api_key || '';
    }

    selectedOnboardingModelSlug = ONBOARDING_MODELS.some((model) => model.slug === settings.selected_model_slug)
      ? settings.selected_model_slug
      : ONBOARDING_MODELS[0].slug;

    if (forceOnboarding) {
      setOnboardingStep(1);
      onboardingModal?.show();
      return;
    }

    if (!forceOnboarding && settings.openrouter_api_key) {
      return;
    }

    setOnboardingStep(1);
    onboardingModal?.show();
  }

  if (saveOnboardingApiKeyBtn) {
    saveOnboardingApiKeyBtn.addEventListener('click', async () => {
      const apiKey = (onboardingApiKeyInput?.value || '').trim();
      if (!apiKey) {
        showAppError('API key vereist', 'Vul eerst een API key in voordat je doorgaat.', 'Geen API key ingevoerd in onboarding.');
        return;
      }
      try {
        await api('/api/settings/api-key', {
          method: 'PUT',
          body: JSON.stringify({ api_key: apiKey }),
        });
        setOnboardingStep(2);
      } catch (err) {
        handleAppError(err, 'API key opslaan mislukt');
      }
    });
  }

  if (completeOnboardingBtn) {
    completeOnboardingBtn.addEventListener('click', async () => {
      try {
        await api('/api/settings/model', {
          method: 'PUT',
          body: JSON.stringify({ slug: selectedOnboardingModelSlug }),
        });
        setOnboardingStep(3);
      } catch (err) {
        handleAppError(err, 'Model kiezen mislukt');
      }
    });
  }

  if (onboardingShowTourBtn) {
    onboardingShowTourBtn.addEventListener('click', () => {
      onboardingModal?.hide();
      startOnboardingTour();
    });
  }

  if (onboardingSkipTourBtn) {
    onboardingSkipTourBtn.addEventListener('click', () => {
      onboardingModal?.hide();
    });
  }

  window.addEventListener('resize', () => {
    const step = ONBOARDING_TOUR_STEPS[tourStepIndex];
    if (!step || !tourBubble) return;
    const target = document.getElementById(step.targetId);
    if (!target) return;
    positionTourBubble(step, target.getBoundingClientRect());
  });

  async function checkForUpdates() {
    try {
      const updateInfo = await api('/api/app/update/check');
      if (!updateInfo.available) {
        updateAvailableIcon?.classList.add('d-none');
        return;
      }

      latestUpdateVersion = updateInfo.latest_version || '';
      updateAvailableIcon?.classList.remove('d-none');

      if (openUpdateReleaseBtn) {
        openUpdateReleaseBtn.href = updateInfo.release_url || 'https://github.com/rjbruin/holy-ghostwriter/releases';
      }
      if (updateModalVersion) {
        updateModalVersion.textContent = latestUpdateVersion || '-';
      }
      if (updateModalChangelog) {
        updateModalChangelog.textContent = updateInfo.changelog || 'Geen changelog beschikbaar.';
      }

      if (updateInfo.should_notify) {
        updateModal?.show();
      }
    } catch {
      updateAvailableIcon?.classList.add('d-none');
    }
  }

  if (ignoreUpdateBtn) {
    ignoreUpdateBtn.addEventListener('click', async () => {
      try {
        await api('/api/app/update/ignore', {
          method: 'PUT',
          body: JSON.stringify({ version: latestUpdateVersion }),
        });
      } catch {
      }
      updateModal?.hide();
    });
  }

  ensureApiKeyOnboarding().catch((err) => handleAppError(err, 'Onboarding laden mislukt'));
  checkForUpdates();

  const newBtn = document.getElementById('newSermonBtn');
  if (newBtn) {
    newBtn.addEventListener('click', async () => {
      try {
        const sermon = await api('/api/sermons', { method: 'POST', body: JSON.stringify({}) });
        const onboardingSuffix = forceOnboarding ? '?onboarding' : '';
        if (forceOnboarding) {
          window.sessionStorage.setItem('holyGhostwriter.sermonOnboardingPending', '1');
        }
        window.location.href = `/sermon/${sermon.id}${onboardingSuffix}`;
      } catch (err) {
        handleAppError(err, 'Nieuwe preek maken mislukt');
      }
    });
  }

  document.querySelectorAll('.delete-sermon-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sermonId = btn.dataset.sermonId;
      if (!confirm('Weet je zeker dat je dit project wilt verwijderen?')) return;
      try {
        await api(`/api/sermons/${sermonId}`, { method: 'DELETE' });
        window.location.reload();
      } catch (err) {
        handleAppError(err, 'Project verwijderen mislukt');
      }
    });
  });

  document.querySelectorAll('.export-sermon-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sermonId = btn.dataset.sermonId;
      try {
        const sermon = await api(`/api/sermons/${sermonId}`);
        activeExport = {
          id: sermon.id,
          title: sermon.title || 'preek',
        };
        document.getElementById('exportPreview').innerHTML = marked.parse(sermon.sermon_markdown || '');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('exportModal')).show();
      } catch (err) {
        handleAppError(err, 'Export laden mislukt');
      }
    });
  });

  const downloadDocxBtn = document.getElementById('downloadDocxBtn');
  if (downloadDocxBtn) {
    downloadDocxBtn.addEventListener('click', async () => {
      if (!activeExport) return;
      try {
        const response = await fetch(`/api/sermons/${activeExport.id}/export/docx`, { method: 'POST' });
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
        a.download = `${activeExport.title}.docx`;
        a.click();
        window.URL.revokeObjectURL(url);
      } catch (err) {
        handleAppError(err, 'DOCX export mislukt');
      }
    });
  }
});
