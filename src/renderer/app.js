const importButton = document.querySelector('#importButton');
const statusText = document.querySelector('#statusText');
const fileName = document.querySelector('#fileName');
const privacyMode = document.querySelector('#privacyMode');
const totalSamples = document.querySelector('#totalSamples');
const lowPlatelets = document.querySelector('#lowPlatelets');
const peripheralSuspicion = document.querySelector('#peripheralSuspicion');
const correlation = document.querySelector('#correlation');
const sampleTable = document.querySelector('#sampleTable');
const tableCount = document.querySelector('#tableCount');
const chartSubtitle = document.querySelector('#chartSubtitle');
const scatterPlot = document.querySelector('#scatterPlot');
const errorBanner = document.querySelector('#errorBanner');
const errorMessage = document.querySelector('#errorMessage');

const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function setStatus(message) {
  statusText.textContent = message;
}

function clearError() {
  errorBanner.hidden = true;
  errorMessage.textContent = '';
}

function showError(message) {
  errorMessage.textContent = message;
  errorBanner.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '--';
  }

  return numberFormatter.format(value);
}

function formatDecimal(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '--';
  }

  return decimalFormatter.format(value);
}

function classificationKind(label) {
  const normalized = normalizeText(label);
  if (normalized.includes('destruicao')) {
    return 'danger';
  }

  if (normalized.includes('producao')) {
    return 'warning';
  }

  return 'neutral';
}

function markerColor(label) {
  const kind = classificationKind(label);
  if (kind === 'danger') {
    return '#c73535';
  }

  if (kind === 'warning') {
    return '#a76205';
  }

  return '#2563eb';
}

function markerSize(vpm) {
  const value = Number(vpm);
  if (!Number.isFinite(value)) {
    return 9;
  }

  return Math.max(8, Math.min(24, value * 1.35));
}

function friendlyError(rawMessage) {
  const message = String(rawMessage || '').replace(/\s+/g, ' ').trim();
  const normalized = normalizeText(message);

  if (normalized.includes('numpy') && normalized.includes('_internal')) {
    return 'Backend analitico incompleto. Instale novamente usando o instalador mais recente.';
  }

  if (normalized.includes('coluna obrigatoria')) {
    return message.match(/Coluna obrigatoria[^.]+[.]/)?.[0] || message;
  }

  if (normalized.includes('python 3 nao foi encontrado')) {
    return 'Python nao foi encontrado para rodar em modo desenvolvimento.';
  }

  if (message.includes('Traceback')) {
    return 'Nao foi possivel processar o arquivo. Verifique se o CSV esta completo e tente novamente.';
  }

  return message || 'Nao foi possivel processar o arquivo.';
}

function updateSummary(payload) {
  const summary = payload.summary;
  const corr = payload.metadata.correlacao_vpm_ipf;

  fileName.textContent = payload.metadata.arquivo;
  privacyMode.textContent = summary.ids_pseudonimizados ? 'Pseudonimizados' : 'Originais';
  totalSamples.textContent = formatNumber(summary.total_amostras);
  lowPlatelets.textContent = formatNumber(summary.trombocitopenia);
  peripheralSuspicion.textContent = formatNumber(summary.suspeita_destruicao_periferica);
  correlation.textContent = corr.r === null ? '--' : `r=${formatDecimal(corr.r)}`;
  chartSubtitle.textContent = `${formatNumber(summary.total_amostras)} amostras analisadas`;
}

function renderTable(records) {
  const visibleRecords = records.slice(0, 250);
  tableCount.textContent = `${numberFormatter.format(records.length)} linhas`;

  if (visibleRecords.length === 0) {
    sampleTable.innerHTML = '<tr><td colspan="4" class="empty-cell">Nenhuma linha valida encontrada.</td></tr>';
    return;
  }

  sampleTable.innerHTML = visibleRecords.map((record) => {
    const kind = classificationKind(record.classificacao);
    const classification = escapeHtml(record.classificacao);
    return `
      <tr>
        <td>${escapeHtml(record.id_amostra)}</td>
        <td>${formatNumber(record.plaquetas_global)}</td>
        <td>${formatDecimal(record.ipf)}%</td>
        <td><span class="class-pill class-${kind}" title="${classification}">${classification}</span></td>
      </tr>
    `;
  }).join('');
}

function buildTrace(records, classificationLabel) {
  const filtered = records.filter((record) => record.classificacao === classificationLabel);
  return {
    type: 'scatter',
    mode: 'markers',
    name: classificationLabel,
    x: filtered.map((record) => record.plaquetas_global),
    y: filtered.map((record) => record.ipf),
    text: filtered.map((record) => [
      `Amostra: ${escapeHtml(record.id_amostra)}`,
      `Linha: ${record.linha_origem}`,
      `Plaquetas: ${formatNumber(record.plaquetas_global)}/uL`,
      `IPF: ${formatDecimal(record.ipf)}%`,
      `VPM: ${formatDecimal(record.vpm)} fL`,
      escapeHtml(record.classificacao)
    ].join('<br>')),
    hovertemplate: '%{text}<extra></extra>',
    marker: {
      size: filtered.map((record) => markerSize(record.vpm)),
      color: markerColor(classificationLabel),
      opacity: 0.82,
      line: {
        width: 1,
        color: '#ffffff'
      }
    }
  };
}

function renderPlot(payload) {
  if (!window.Plotly) {
    showError('Plotly nao foi carregado.');
    return;
  }

  const records = payload.records.filter((record) => record.plaquetas_global !== null && record.ipf !== null);
  const labels = [...new Set(records.map((record) => record.classificacao))];
  const plateletThreshold = payload.metadata.regras.platelet_threshold_per_ul;
  const ipfThreshold = payload.metadata.regras.ipf_threshold_percent;
  const maxPlatelets = Math.max(plateletThreshold * 1.35, ...records.map((record) => record.plaquetas_global || 0));
  const maxIpf = Math.max(ipfThreshold * 1.8, ...records.map((record) => record.ipf || 0));
  const data = labels.map((label) => buildTrace(records, label));

  const layout = {
    autosize: true,
    margin: { l: 74, r: 28, t: 22, b: 70 },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    hovermode: 'closest',
    legend: {
      orientation: 'h',
      x: 0,
      y: -0.24,
      font: { size: 11, color: '#405064' }
    },
    xaxis: {
      title: 'Plaquetas (/uL)',
      range: [0, maxPlatelets * 1.08],
      zeroline: false,
      gridcolor: '#e9eef5',
      linecolor: '#d8e2ec',
      tickfont: { color: '#405064' },
      titlefont: { color: '#405064' }
    },
    yaxis: {
      title: 'IPF (%)',
      range: [0, maxIpf * 1.12],
      zeroline: false,
      gridcolor: '#e9eef5',
      linecolor: '#d8e2ec',
      tickfont: { color: '#405064' },
      titlefont: { color: '#405064' }
    },
    shapes: [
      {
        type: 'rect',
        xref: 'x',
        yref: 'y',
        x0: 0,
        x1: plateletThreshold,
        y0: ipfThreshold,
        y1: maxIpf * 1.12,
        fillcolor: 'rgba(199, 53, 53, 0.08)',
        line: { width: 0 },
        layer: 'below'
      },
      {
        type: 'line',
        x0: plateletThreshold,
        x1: plateletThreshold,
        y0: 0,
        y1: maxIpf * 1.12,
        line: { color: '#8a97a8', width: 1, dash: 'dash' }
      },
      {
        type: 'line',
        x0: 0,
        x1: maxPlatelets * 1.08,
        y0: ipfThreshold,
        y1: ipfThreshold,
        line: { color: '#8a97a8', width: 1, dash: 'dash' }
      }
    ]
  };

  const config = {
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d']
  };

  Plotly.react(scatterPlot, data, layout, config);
}

async function importCsv() {
  importButton.disabled = true;
  clearError();
  setStatus('Processando arquivo');

  try {
    const response = await window.ipfAnalyzer.selectAndAnalyze();
    if (response.canceled) {
      setStatus('Importacao cancelada');
      return;
    }

    if (response.error) {
      throw new Error(response.error);
    }

    updateSummary(response.result);
    renderPlot(response.result);
    renderTable(response.result.records);
    setStatus('Analise concluida');
  } catch (error) {
    console.error(error);
    const message = friendlyError(error.message);
    setStatus('Erro na analise');
    showError(message);
    sampleTable.innerHTML = `<tr><td colspan="4" class="empty-cell">${escapeHtml(message)}</td></tr>`;
  } finally {
    importButton.disabled = false;
  }
}

function initializeEmptyPlot() {
  const emptyPayload = {
    metadata: {
      regras: {
        platelet_threshold_per_ul: 150000,
        ipf_threshold_percent: 10
      }
    },
    records: []
  };

  renderPlot(emptyPayload);
}

importButton.addEventListener('click', importCsv);
initializeEmptyPlot();
