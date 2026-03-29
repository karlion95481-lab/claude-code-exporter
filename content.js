// ============================================================
// Claude Code Session Exporter — Content Script
// DOM Inspector + Message Extraction + HTML→Markdown
// ============================================================

// --- Selector Profiles ---
// We don't know the exact DOM structure of claude.ai/code.
// These profiles are tried in order. Update after using Debug mode.
const SELECTOR_PROFILES = {
  // Discovered selectors (from Debug scan 2026-03-29)
  discovered: {
    conversationContainer: '.flex-1.overflow-y-auto',
    messageBlock: '.group\\/message',
    userMessage: '.group\\/message:not(.text-text-100)',
    assistantMessage: '.group\\/message.text-text-100',
    toolCall: null,  // Tool calls are inside assistant messages, detected by content
    toolResult: null, // Tool results are inside assistant messages, detected by content
  },

  // Strategy 1: data-testid attributes (React pattern)
  react_data_testid: {
    conversationContainer: '[data-testid*="conversation"], [data-testid*="messages"], [data-testid*="chat"]',
    messageBlock: '[data-testid*="message"], [data-testid*="turn"]',
    userMessage: '[data-testid*="human"], [data-testid*="user"]',
    assistantMessage: '[data-testid*="assistant"], [data-testid*="claude"]',
    toolCall: '[data-testid*="tool"]',
    toolResult: '[data-testid*="result"], [data-testid*="output"]',
  },

  // Strategy 2: ARIA roles
  aria_roles: {
    conversationContainer: '[role="log"], [role="main"] [role="list"], main',
    messageBlock: '[role="listitem"], [role="article"], [role="row"]',
    userMessage: '[data-role="user"], [data-sender="human"]',
    assistantMessage: '[data-role="assistant"], [data-sender="assistant"]',
    toolCall: null,
    toolResult: null,
  },

  // Strategy 3: Class name heuristics (partial match)
  class_heuristics: {
    conversationContainer: '[class*="conversation"], [class*="messages"], [class*="chat-log"], [class*="thread"]',
    messageBlock: '[class*="message"], [class*="turn"], [class*="entry"]',
    userMessage: '[class*="human"], [class*="user-message"], [class*="user_message"]',
    assistantMessage: '[class*="assistant"], [class*="claude"], [class*="ai-message"]',
    toolCall: '[class*="tool"], [class*="function-call"]',
    toolResult: '[class*="result"], [class*="output"]',
  },
};

// ============================================================
// DOM Inspector (Debug Mode)
// ============================================================

function inspectDOM() {
  const result = {
    url: window.location.href,
    title: document.title,
    bodyClasses: document.body.className,
    dataAttributes: new Set(),
    ariaRoles: new Set(),
    scrollableElements: [],
    repeatedClasses: {},
    potentialMessageContainers: [],
    sampleElements: [],
    hasShadowDOM: false,
    selectorProfileResults: {},
  };

  // Scan all elements
  const allElements = document.querySelectorAll('*');
  const classCounts = {};

  for (const el of allElements) {
    // Collect data-* attributes
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-')) {
        result.dataAttributes.add(`${attr.name}="${attr.value}"`);
      }
    }

    // Collect role attributes
    if (el.getAttribute('role')) {
      result.ariaRoles.add(el.getAttribute('role'));
    }

    // Check for Shadow DOM
    if (el.shadowRoot) {
      result.hasShadowDOM = true;
    }

    // Count class names
    for (const cls of el.classList) {
      classCounts[cls] = (classCounts[cls] || 0) + 1;
    }

    // Find scrollable elements
    const style = window.getComputedStyle(el);
    if (
      (style.overflowY === 'scroll' || style.overflowY === 'auto') &&
      el.scrollHeight > el.clientHeight &&
      el.scrollHeight > 200
    ) {
      result.scrollableElements.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: el.className ? el.className.substring(0, 100) : null,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        childCount: el.children.length,
        firstChildTag: el.firstElementChild?.tagName?.toLowerCase() || null,
      });
    }
  }

  // Find repeated classes (structural indicators)
  for (const [cls, count] of Object.entries(classCounts)) {
    if (count >= 3 && cls.length > 1) {
      result.repeatedClasses[cls] = count;
    }
  }

  // Sort repeated classes by count descending, take top 30
  const sortedClasses = Object.entries(result.repeatedClasses)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  result.repeatedClasses = Object.fromEntries(sortedClasses);

  // Find potential message containers
  // (scrollable elements with many similar children)
  for (const scrollable of result.scrollableElements) {
    const el = scrollable.id
      ? document.getElementById(scrollable.id)
      : document.querySelector(`.${scrollable.classes?.split(' ')[0]}`);

    if (el && el.children.length >= 3) {
      const childTags = {};
      for (const child of el.children) {
        const key = `${child.tagName.toLowerCase()}.${[...child.classList].join('.')}`;
        childTags[key] = (childTags[key] || 0) + 1;
      }

      const repeatedChildren = Object.entries(childTags)
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1]);

      if (repeatedChildren.length > 0) {
        result.potentialMessageContainers.push({
          ...scrollable,
          repeatedChildPatterns: repeatedChildren.slice(0, 5),
        });
      }
    }
  }

  // Get sample elements from largest scrollable container
  const largestScrollable = result.scrollableElements
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];

  if (largestScrollable) {
    const container = largestScrollable.id
      ? document.getElementById(largestScrollable.id)
      : findElementByClassAndTag(largestScrollable.tag, largestScrollable.classes);

    if (container) {
      const children = [...container.children].slice(0, 10);
      for (const child of children) {
        result.sampleElements.push({
          tag: child.tagName.toLowerCase(),
          id: child.id || null,
          classes: child.className ? child.className.substring(0, 150) : null,
          dataAttrs: getDataAttributes(child),
          role: child.getAttribute('role'),
          textPreview: child.textContent?.substring(0, 120)?.trim() || '',
          childCount: child.children.length,
          innerHTML_length: child.innerHTML.length,
        });
      }
    }
  }

  // Test each selector profile
  for (const [profileName, profile] of Object.entries(SELECTOR_PROFILES)) {
    if (!profile || profileName === 'discovered') continue;

    const profileResult = {};
    for (const [key, selector] of Object.entries(profile)) {
      if (!selector) {
        profileResult[key] = { selector: null, count: 0 };
        continue;
      }
      try {
        const matches = document.querySelectorAll(selector);
        profileResult[key] = {
          selector,
          count: matches.length,
          firstText: matches[0]?.textContent?.substring(0, 80)?.trim() || null,
        };
      } catch {
        profileResult[key] = { selector, count: 0, error: 'invalid selector' };
      }
    }
    result.selectorProfileResults[profileName] = profileResult;
  }

  // Convert Sets to arrays for serialization
  result.dataAttributes = [...result.dataAttributes].sort().slice(0, 50);
  result.ariaRoles = [...result.ariaRoles].sort();

  return result;
}

function testSelector(selector) {
  try {
    const matches = document.querySelectorAll(selector);
    const samples = [...matches].slice(0, 5).map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: el.className ? el.className.substring(0, 150) : null,
      dataAttrs: getDataAttributes(el),
      textPreview: el.textContent?.substring(0, 150)?.trim() || '',
      childCount: el.children.length,
    }));

    return {
      selector,
      count: matches.length,
      samples,
    };
  } catch (e) {
    return { selector, count: 0, error: e.message };
  }
}

function dumpHTML() {
  // Try discovered container first
  const discovered = document.querySelector('.flex-1.overflow-y-auto');
  if (discovered && discovered.innerHTML.length > 1000) {
    return discovered.outerHTML.substring(0, 500000);
  }

  // Fallback: try to find the main conversation container
  const candidates = [
    ...document.querySelectorAll('[role="log"], [role="main"], main'),
    ...document.querySelectorAll('[class*="conversation"], [class*="messages"]'),
  ];

  // Pick the one with the most content
  let best = null;
  let bestLength = 0;
  for (const el of candidates) {
    if (el.innerHTML.length > bestLength) {
      best = el;
      bestLength = el.innerHTML.length;
    }
  }

  if (!best) {
    // Fallback: largest scrollable element
    const scrollables = [...document.querySelectorAll('*')].filter((el) => {
      const style = window.getComputedStyle(el);
      return (
        (style.overflowY === 'scroll' || style.overflowY === 'auto') &&
        el.scrollHeight > el.clientHeight
      );
    });
    best = scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  }

  return best ? best.outerHTML.substring(0, 500000) : 'No conversation container found.';
}

// ============================================================
// Message Extraction
// ============================================================

function extractMessages(options = {}) {
  const { includeToolCalls = true, includeSystemMessages = false } = options;

  // Use discovered selectors first (from Debug scan)
  const discovered = SELECTOR_PROFILES.discovered;

  if (discovered.conversationContainer && discovered.messageBlock) {
    const container = document.querySelector(discovered.conversationContainer);
    if (container) {
      const blocks = container.querySelectorAll(discovered.messageBlock);
      if (blocks.length >= 2) {
        const messages = [];
        for (const block of blocks) {
          const msg = classifyMessageDiscovered(block, discovered, options);
          if (!msg) continue;
          if (msg.role === 'system' && !includeSystemMessages) continue;
          messages.push(msg);
        }
        if (messages.length > 0) return messages;
      }
    }
  }

  // Fallback: try other selector profiles
  for (const [profileName, profile] of Object.entries(SELECTOR_PROFILES)) {
    if (!profile || profileName === 'discovered') continue;

    const containerSelector = profile.conversationContainer;
    if (!containerSelector) continue;

    try {
      const container = document.querySelector(containerSelector);
      if (!container) continue;

      const blockSelector = profile.messageBlock;
      if (!blockSelector) continue;

      const blocks = container.querySelectorAll(blockSelector);
      if (blocks.length < 2) continue;

      const messages = [];
      for (const block of blocks) {
        const msg = classifyMessageGeneric(block, profile);
        if (!msg) continue;
        if (msg.role === 'system' && !includeSystemMessages) continue;
        messages.push(msg);
      }

      if (messages.length > 0) return messages;
    } catch {
      continue;
    }
  }

  // Last resort: structural analysis
  return structuralExtraction(options);
}

// Classify using discovered selectors (optimized for claude.ai/code)
function classifyMessageDiscovered(element, profile, options = {}) {
  const text = element.textContent?.trim() || '';
  if (!text) return null;

  const { includeToolCalls = true } = options;

  // Determine role by checking if element has .text-text-100 (assistant) or not (user)
  let role = 'unknown';

  try {
    if (profile.userMessage && element.matches(profile.userMessage)) {
      role = 'user';
    } else if (profile.assistantMessage && element.matches(profile.assistantMessage)) {
      // Check if this is a tool-call-only message (assistant messages containing tool invocations)
      const isToolMessage = isToolCallContent(text);
      if (isToolMessage && !includeToolCalls) return null;
      role = isToolMessage ? 'tool_call' : 'assistant';
    }
  } catch { /* ignore */ }

  return {
    role,
    content: htmlToMarkdown(element),
    rawText: text.substring(0, 200),
  };
}

// Classify using generic selector profiles
function classifyMessageGeneric(element, profile) {
  const text = element.textContent?.trim() || '';
  if (!text) return null;

  let role = 'unknown';

  if (profile.userMessage) {
    try {
      if (element.matches(profile.userMessage) || element.querySelector(profile.userMessage)) {
        role = 'user';
      }
    } catch { /* ignore */ }
  }

  if (role === 'unknown' && profile.assistantMessage) {
    try {
      if (element.matches(profile.assistantMessage) || element.querySelector(profile.assistantMessage)) {
        role = 'assistant';
      }
    } catch { /* ignore */ }
  }

  return {
    role,
    content: htmlToMarkdown(element),
    rawText: text.substring(0, 200),
  };
}

// Detect if message content is primarily a tool call
function isToolCallContent(text) {
  const toolPatterns = [
    /^(Read|Edit|Write|Bash|Glob|Grep|Agent|Skill|TodoWrite|NotebookEdit|WebFetch|WebSearch)\s/i,
    /^(Read|Edit|Write|Bash|Glob|Grep)\s+\d+\s+(file|pattern|command)/i,
    /^(Ran|Searched|Read)\s+\d+/i,
  ];

  const firstLine = text.split('\n')[0]?.trim() || '';
  return toolPatterns.some((p) => p.test(firstLine));
}

function structuralExtraction(options = {}) {
  // Find the largest scrollable container
  const scrollables = [...document.querySelectorAll('*')].filter((el) => {
    const style = window.getComputedStyle(el);
    return (
      (style.overflowY === 'scroll' || style.overflowY === 'auto') &&
      el.scrollHeight > el.clientHeight &&
      el.scrollHeight > 300
    );
  });

  const container = scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!container) return [];

  // Find repeated child patterns
  const childGroups = {};
  for (const child of container.children) {
    const key = child.tagName.toLowerCase();
    if (!childGroups[key]) childGroups[key] = [];
    childGroups[key].push(child);
  }

  // Get the most common child type
  const mainGroup = Object.entries(childGroups)
    .sort((a, b) => b[1].length - a[1].length)[0];

  if (!mainGroup || mainGroup[1].length < 2) return [];

  const messages = [];
  for (const el of mainGroup[1]) {
    const text = el.textContent?.trim();
    if (!text) continue;

    // Heuristic role detection
    let role = 'unknown';
    const lowerText = text.toLowerCase();

    // Check for tool patterns
    if (
      lowerText.includes('bash(') ||
      lowerText.includes('read(') ||
      lowerText.includes('edit(') ||
      lowerText.includes('write(') ||
      lowerText.includes('glob(') ||
      lowerText.includes('grep(')
    ) {
      role = 'tool_call';
    }

    messages.push({
      role,
      content: htmlToMarkdown(el),
      rawText: text.substring(0, 200),
    });
  }

  return messages;
}

// ============================================================
// HTML → Markdown Converter
// ============================================================

function htmlToMarkdown(element) {
  return walkNode(element).trim();
}

function walkNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const tag = node.tagName.toLowerCase();

  // Skip UI chrome
  if (
    tag === 'button' ||
    tag === 'svg' ||
    tag === 'img' ||
    node.getAttribute('aria-hidden') === 'true' ||
    node.getAttribute('role') === 'button'
  ) {
    // But keep img alt text
    if (tag === 'img' && node.alt) {
      return `![${node.alt}](${node.src || ''})`;
    }
    return '';
  }

  const children = [...node.childNodes].map(walkNode).join('');

  switch (tag) {
    case 'pre': {
      const codeEl = node.querySelector('code');
      const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
      const code = codeEl?.textContent || node.textContent || '';
      return `\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n`;
    }
    case 'code': {
      // Inline code (not inside pre)
      if (node.parentElement?.tagName?.toLowerCase() !== 'pre') {
        return `\`${node.textContent}\``;
      }
      return children;
    }
    case 'strong':
    case 'b':
      return `**${children}**`;
    case 'em':
    case 'i':
      return `*${children}*`;
    case 'a':
      return `[${children}](${node.href || ''})`;
    case 'h1':
      return `\n# ${children}\n`;
    case 'h2':
      return `\n## ${children}\n`;
    case 'h3':
      return `\n### ${children}\n`;
    case 'h4':
      return `\n#### ${children}\n`;
    case 'h5':
      return `\n##### ${children}\n`;
    case 'h6':
      return `\n###### ${children}\n`;
    case 'p':
      return `\n${children}\n`;
    case 'br':
      return '\n';
    case 'ul':
      return `\n${children}\n`;
    case 'ol':
      return `\n${children}\n`;
    case 'li': {
      const parent = node.parentElement;
      if (parent?.tagName?.toLowerCase() === 'ol') {
        const index = [...parent.children].indexOf(node) + 1;
        return `${index}. ${children.trim()}\n`;
      }
      return `- ${children.trim()}\n`;
    }
    case 'blockquote':
      return `\n> ${children.trim().replace(/\n/g, '\n> ')}\n`;
    case 'table':
      return `\n${formatTable(node)}\n`;
    case 'details': {
      const summary = node.querySelector('summary')?.textContent || 'Details';
      const body = [...node.childNodes]
        .filter((n) => n.tagName?.toLowerCase() !== 'summary')
        .map(walkNode)
        .join('');
      return `\n<details>\n<summary>${summary}</summary>\n${body}\n</details>\n`;
    }
    case 'hr':
      return '\n---\n';
    case 'div':
    case 'section':
    case 'article':
    case 'span':
    case 'main':
      return children;
    default:
      return children;
  }
}

function formatTable(tableEl) {
  const rows = [];
  for (const tr of tableEl.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('td, th')].map(
      (cell) => cell.textContent?.trim() || ''
    );
    rows.push(cells);
  }

  if (rows.length === 0) return '';

  const colWidths = rows[0].map((_, i) =>
    Math.max(...rows.map((row) => (row[i] || '').length), 3)
  );

  const lines = [];
  rows.forEach((row, rowIndex) => {
    const line = row
      .map((cell, i) => cell.padEnd(colWidths[i]))
      .join(' | ');
    lines.push(`| ${line} |`);

    if (rowIndex === 0) {
      const separator = colWidths.map((w) => '-'.repeat(w)).join(' | ');
      lines.push(`| ${separator} |`);
    }
  });

  return lines.join('\n');
}

// ============================================================
// Markdown Formatter
// ============================================================

function formatAsMarkdown(messages, options = {}) {
  const { collapseTools = true } = options;
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  let md = `# Claude Code Session — ${dateStr}\n\n`;
  md += `**Exported:** ${dateStr} ${timeStr}\n`;
  md += `**URL:** ${window.location.href}\n`;
  md += `**Messages:** ${messages.length}\n\n`;
  md += `---\n\n`;

  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        md += `**User:**\n\n${msg.content}\n\n---\n\n`;
        break;
      case 'assistant':
      case 'assistant_text':
        md += `**Assistant:**\n\n${msg.content}\n\n---\n\n`;
        break;
      case 'tool_call':
        if (collapseTools) {
          const toolName = detectToolName(msg.rawText);
          md += `<details>\n<summary>Tool: ${toolName}</summary>\n\n${msg.content}\n\n</details>\n\n`;
        } else {
          md += `**Tool Call:**\n\n${msg.content}\n\n---\n\n`;
        }
        break;
      case 'tool_result':
        if (collapseTools) {
          md += `<details>\n<summary>Tool Result</summary>\n\n${msg.content}\n\n</details>\n\n`;
        } else {
          md += `**Tool Result:**\n\n${msg.content}\n\n---\n\n`;
        }
        break;
      case 'system':
        md += `*System: ${msg.content}*\n\n---\n\n`;
        break;
      default:
        md += `${msg.content}\n\n---\n\n`;
        break;
    }
  }

  return md;
}

function detectToolName(text) {
  const toolPatterns = [
    /\b(Read|Edit|Write|Bash|Glob|Grep|Agent|Skill)\b/i,
    /\b(TodoWrite|NotebookEdit|WebFetch|WebSearch)\b/i,
  ];
  for (const pattern of toolPatterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return 'Unknown';
}

// ============================================================
// Helpers
// ============================================================

function getDataAttributes(el) {
  const attrs = {};
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-')) {
      attrs[attr.name] = attr.value.substring(0, 50);
    }
  }
  return Object.keys(attrs).length > 0 ? attrs : null;
}

function findElementByClassAndTag(tag, classStr) {
  if (!classStr) return null;
  const firstClass = classStr.split(' ')[0];
  if (!firstClass) return null;
  return document.querySelector(`${tag}.${CSS.escape(firstClass)}`);
}

// ============================================================
// Message Listener
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    switch (request.action) {
      case 'getStatus': {
        const messages = extractMessages({ includeToolCalls: true, includeSystemMessages: true });
        sendResponse({
          ready: true,
          messageCount: messages.length,
          url: window.location.href,
        });
        break;
      }

      case 'exportMarkdown': {
        const options = request.options || {};
        const messages = extractMessages(options);
        const markdown = formatAsMarkdown(messages, options);
        sendResponse({
          success: true,
          markdown,
          messageCount: messages.length,
        });
        break;
      }

      case 'inspectDOM': {
        const info = inspectDOM();
        sendResponse({ success: true, info });
        break;
      }

      case 'testSelector': {
        const result = testSelector(request.selector);
        sendResponse({ success: true, result });
        break;
      }

      case 'dumpHTML': {
        const html = dumpHTML();
        sendResponse({ success: true, html });
        break;
      }

      default:
        sendResponse({ error: 'Unknown action' });
    }
  } catch (e) {
    sendResponse({ error: e.message });
  }

  return true; // Keep message channel open for async response
});
