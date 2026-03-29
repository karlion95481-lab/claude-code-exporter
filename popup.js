// ============================================================
// Claude Code Session Exporter — Popup Script
// ============================================================

const $ = (sel) => document.querySelector(sel);

// --- State ---
let debugVisible = false;

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  updateFilenamePreview();
  checkStatus();

  // Event listeners
  $('#btn-export').addEventListener('click', handleExport);
  $('#btn-toggle-debug').addEventListener('click', toggleDebug);
  $('#btn-scan').addEventListener('click', handleScan);
  $('#btn-dump').addEventListener('click', handleDump);
  $('#btn-test-selector').addEventListener('click', handleTestSelector);

  $('#input-selector').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleTestSelector();
  });
});

// --- Status ---
async function checkStatus() {
  const dot = $('#status-dot');
  const text = $('#status-text');
  const btn = $('#btn-export');

  try {
    const tab = await getCurrentTab();
    if (!tab?.url?.includes('claude.ai/code')) {
      dot.className = 'dot dot-yellow';
      text.textContent = 'Not on a Claude Code page';
      btn.disabled = true;
      return;
    }

    const response = await sendToContentScript(tab.id, { action: 'getStatus' });

    if (response?.ready) {
      const count = response.messageCount || 0;
      dot.className = 'dot dot-green';
      text.textContent = count > 0
        ? `Ready — ${count} message${count !== 1 ? 's' : ''} found`
        : 'Connected — no messages detected yet';
      btn.disabled = count === 0;
    } else {
      dot.className = 'dot dot-red';
      text.textContent = response?.error || 'Content script not responding';
      btn.disabled = true;
    }
  } catch (e) {
    dot.className = 'dot dot-red';
    text.textContent = 'Cannot connect to page';
    btn.disabled = true;
  }
}

// --- Export ---
async function handleExport() {
  const btn = $('#btn-export');
  btn.disabled = true;
  btn.textContent = 'Exporting...';

  try {
    const tab = await getCurrentTab();
    const options = {
      includeToolCalls: $('#opt-tool-calls').checked,
      collapseTools: $('#opt-collapse').checked,
      includeSystemMessages: $('#opt-system').checked,
    };

    const response = await sendToContentScript(tab.id, {
      action: 'exportMarkdown',
      options,
    });

    if (response?.success && response.markdown) {
      const filename = generateFilename();
      downloadMarkdown(response.markdown, filename);
      btn.textContent = `Exported ${response.messageCount} messages!`;
      setTimeout(() => {
        btn.textContent = 'Export Markdown';
        btn.disabled = false;
      }, 2000);
    } else {
      btn.textContent = 'Export failed';
      if (response?.error) {
        setDebugOutput(`Export error: ${response.error}`);
      }
      setTimeout(() => {
        btn.textContent = 'Export Markdown';
        btn.disabled = false;
      }, 2000);
    }
  } catch (e) {
    btn.textContent = 'Export failed';
    setTimeout(() => {
      btn.textContent = 'Export Markdown';
      btn.disabled = false;
    }, 2000);
  }
}

// --- Debug ---
function toggleDebug() {
  debugVisible = !debugVisible;
  $('#debug-panel').classList.toggle('hidden', !debugVisible);
  $('#btn-toggle-debug').textContent = debugVisible ? 'Hide Debug' : 'Debug Mode';
}

async function handleScan() {
  setDebugOutput('Scanning...');

  try {
    const tab = await getCurrentTab();
    const response = await sendToContentScript(tab.id, { action: 'inspectDOM' });

    if (response?.success) {
      setDebugOutput(formatInspectResult(response.info));
    } else {
      setDebugOutput(`Error: ${response?.error || 'No response'}`);
    }
  } catch (e) {
    setDebugOutput(`Error: ${e.message}`);
  }
}

async function handleDump() {
  setDebugOutput('Dumping HTML...');

  try {
    const tab = await getCurrentTab();
    const response = await sendToContentScript(tab.id, { action: 'dumpHTML' });

    if (response?.success) {
      // Copy to clipboard
      await navigator.clipboard.writeText(response.html);
      setDebugOutput(`HTML copied to clipboard! (${response.html.length} chars)\n\nFirst 2000 chars:\n\n${response.html.substring(0, 2000)}`);
    } else {
      setDebugOutput(`Error: ${response?.error || 'No response'}`);
    }
  } catch (e) {
    setDebugOutput(`Error: ${e.message}`);
  }
}

async function handleTestSelector() {
  const selector = $('#input-selector').value.trim();
  if (!selector) return;

  try {
    const tab = await getCurrentTab();
    const response = await sendToContentScript(tab.id, {
      action: 'testSelector',
      selector,
    });

    if (response?.success) {
      const r = response.result;
      let output = `Selector: ${r.selector}\nMatches: ${r.count}\n`;

      if (r.error) {
        output += `Error: ${r.error}\n`;
      }

      if (r.samples?.length > 0) {
        output += `\nSamples:\n`;
        r.samples.forEach((s, i) => {
          output += `\n[${i + 1}] <${s.tag}>`;
          if (s.id) output += `#${s.id}`;
          if (s.classes) output += ` class="${s.classes}"`;
          if (s.dataAttrs) output += `\n    data: ${JSON.stringify(s.dataAttrs)}`;
          output += `\n    children: ${s.childCount}`;
          output += `\n    text: "${s.textPreview}"`;
          output += '\n';
        });
      }

      setDebugOutput(output);
    } else {
      setDebugOutput(`Error: ${response?.error || 'No response'}`);
    }
  } catch (e) {
    setDebugOutput(`Error: ${e.message}`);
  }
}

// --- Helpers ---

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToContentScript(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

function generateFilename() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  return `I_J_Code_Session_${date}.md`;
}

function updateFilenamePreview() {
  $('#filename-preview').textContent = generateFilename();
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setDebugOutput(text) {
  $('#debug-output').textContent = text;
}

function formatInspectResult(info) {
  let out = '';

  out += `=== PAGE INFO ===\n`;
  out += `URL: ${info.url}\n`;
  out += `Title: ${info.title}\n`;
  out += `Shadow DOM: ${info.hasShadowDOM ? 'YES' : 'No'}\n\n`;

  out += `=== DATA ATTRIBUTES ===\n`;
  if (info.dataAttributes.length > 0) {
    info.dataAttributes.forEach((a) => { out += `  ${a}\n`; });
  } else {
    out += '  (none found)\n';
  }

  out += `\n=== ARIA ROLES ===\n`;
  if (info.ariaRoles.length > 0) {
    info.ariaRoles.forEach((r) => { out += `  ${r}\n`; });
  } else {
    out += '  (none found)\n';
  }

  out += `\n=== SCROLLABLE ELEMENTS ===\n`;
  if (info.scrollableElements.length > 0) {
    info.scrollableElements.forEach((s, i) => {
      out += `\n  [${i + 1}] <${s.tag}>`;
      if (s.id) out += `#${s.id}`;
      out += `\n      classes: ${s.classes || '(none)'}`;
      out += `\n      scroll: ${s.scrollHeight}px / client: ${s.clientHeight}px`;
      out += `\n      children: ${s.childCount}`;
      out += '\n';
    });
  } else {
    out += '  (none found)\n';
  }

  out += `\n=== REPEATED CLASSES (top 30) ===\n`;
  const classes = Object.entries(info.repeatedClasses);
  if (classes.length > 0) {
    classes.forEach(([cls, count]) => {
      out += `  .${cls} × ${count}\n`;
    });
  } else {
    out += '  (none found)\n';
  }

  out += `\n=== POTENTIAL MESSAGE CONTAINERS ===\n`;
  if (info.potentialMessageContainers.length > 0) {
    info.potentialMessageContainers.forEach((c, i) => {
      out += `\n  [${i + 1}] <${c.tag}> (scroll: ${c.scrollHeight}px, children: ${c.childCount})`;
      if (c.repeatedChildPatterns) {
        out += `\n      repeated patterns:`;
        c.repeatedChildPatterns.forEach(([pattern, count]) => {
          out += `\n        ${pattern} × ${count}`;
        });
      }
      out += '\n';
    });
  } else {
    out += '  (none found)\n';
  }

  out += `\n=== SAMPLE ELEMENTS (from largest scrollable) ===\n`;
  if (info.sampleElements.length > 0) {
    info.sampleElements.forEach((s, i) => {
      out += `\n  [${i + 1}] <${s.tag}>`;
      if (s.id) out += `#${s.id}`;
      if (s.role) out += ` role="${s.role}"`;
      out += `\n      classes: ${s.classes || '(none)'}`;
      if (s.dataAttrs) out += `\n      data: ${JSON.stringify(s.dataAttrs)}`;
      out += `\n      children: ${s.childCount} | innerHTML: ${s.innerHTML_length} chars`;
      out += `\n      text: "${s.textPreview}"`;
      out += '\n';
    });
  } else {
    out += '  (none found)\n';
  }

  out += `\n=== SELECTOR PROFILE RESULTS ===\n`;
  for (const [profileName, results] of Object.entries(info.selectorProfileResults)) {
    out += `\n  --- ${profileName} ---\n`;
    for (const [key, r] of Object.entries(results)) {
      if (!r.selector) {
        out += `    ${key}: (no selector)\n`;
        continue;
      }
      out += `    ${key}: ${r.count} match${r.count !== 1 ? 'es' : ''}`;
      if (r.firstText) out += ` | "${r.firstText}"`;
      if (r.error) out += ` | ERROR: ${r.error}`;
      out += '\n';
    }
  }

  return out;
}
