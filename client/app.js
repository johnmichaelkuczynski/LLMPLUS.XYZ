(function() {
  var state = {
    projects: [],
    sessions: [],
    currentProject: null,
    currentSession: null,
    streaming: false,
    projectDocs: [],
    pendingAttachments: [],
    responseLength: 'normal',
    responseFormat: 'prose',
    stance: 'neutral',
    model: 'claude'
  };

  function getTargetWords() {
    var el = document.getElementById('target-words-input');
    if (!el) return 0;
    var n = parseInt(el.value, 10);
    if (!(n >= 10 && n <= 30000)) return 0;
    return n;
  }

  var els = {
    projectList: document.getElementById('project-list'),
    sessionList: document.getElementById('session-list'),
    messages: document.getElementById('messages'),
    welcome: document.getElementById('welcome'),
    chatInput: document.getElementById('chat-input'),
    btnSend: document.getElementById('btn-send'),
    btnNewProject: document.getElementById('btn-new-project'),
    btnNewSession: document.getElementById('btn-new-session'),
    btnUpload: document.getElementById('btn-upload'),
    fileInput: document.getElementById('file-input'),
    btnLibrary: document.getElementById('btn-library'),
    topbarProject: document.getElementById('topbar-project'),
    btnMoveSession: document.getElementById('btn-move-session'),
    btnWritePaper: document.getElementById('btn-write-paper'),
    dropOverlay: document.getElementById('drop-overlay'),
    libraryModal: document.getElementById('library-modal'),
    projectModal: document.getElementById('project-modal'),
    projectNameInput: document.getElementById('project-name-input'),
    globalDocs: document.getElementById('global-docs'),
    docPanelList: document.getElementById('doc-panel-list'),
    docPanel: document.getElementById('doc-panel'),
    docPanelToggle: document.getElementById('doc-panel-toggle'),
    ccStatus: document.getElementById('cc-status'),
    ccStatusText: document.getElementById('cc-status-text'),
    ccFill: document.getElementById('cc-fill'),
    artifactPanel: document.getElementById('artifact-panel'),
    artifactTitle: document.getElementById('artifact-title'),
    artifactBody: document.getElementById('artifact-body'),
    artifactClose: document.getElementById('artifact-close'),
    artifactDownloadTxt: document.getElementById('artifact-download-txt'),
    artifactDownloadDocx: document.getElementById('artifact-download-docx'),
    artifactDownloadPdf: document.getElementById('artifact-download-pdf'),
    artifactSave: document.getElementById('artifact-save'),
    artifactCopy: document.getElementById('artifact-copy'),
    artifactWordcount: document.getElementById('artifact-wordcount')
  };

  var currentArtifact = null;

  function stripTractatusContent(text) {
    text = text.replace(/\*?\*?Updated Tractatus Tree:?\*?\*?[\s\S]*?```[\s\S]*?```/gi, '');
    text = text.replace(/\*?\*?Updated Tractatus Tree:?\*?\*?[\s\S]*?\n\{[\s\S]*?\n\}/gi, '');
    text = text.replace(/\*?\*?Tractatus (?:Tree )?(?:Update|Memory):?\*?\*?[\s\S]*?```[\s\S]*?```/gi, '');
    text = text.replace(/```json\s*\n\s*\{[\s\S]*?"ASSERTS"[\s\S]*?\}\s*\n\s*```/gi, '');
    text = text.replace(/```\s*\n\s*\{[\s\S]*?"DOCUMENT"[\s\S]*?\}\s*\n\s*```/gi, '');
    text = text.replace(/^\s*\n+/, '');
    return text.trim();
  }

  function isDocumentArtifact(text) {
    if (!text || text.length < 300) return false;
    var cleaned = stripTractatusContent(text);
    if (cleaned.length < 300) return false;
    var lines = cleaned.split('\n');
    var headingCount = 0;
    var paragraphCount = 0;
    var numberedLines = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (/^#{1,3}\s/.test(line) || /^[IVXLC]+\.\s/.test(line) || /^[A-Z][A-Z\s,]{10,}$/.test(line)) headingCount++;
      if (line.length > 60) paragraphCount++;
      if (/^\d+\.\s/.test(line)) numberedLines++;
    }
    var words = cleaned.split(/\s+/).length;
    if (words >= 150 && headingCount >= 1 && paragraphCount >= 2) return true;
    if (words >= 200 && paragraphCount >= 3) return true;
    if (words >= 300 && numberedLines >= 3) return true;
    if (words >= 800) return true;
    return false;
  }

  function extractArtifactTitle(text) {
    var cleaned = stripTractatusContent(text);
    var lines = cleaned.split('\n');
    for (var i = 0; i < Math.min(10, lines.length); i++) {
      var line = lines[i].trim();
      if (/^#\s+(.+)/.test(line)) return line.replace(/^#\s+/, '');
      if (/^[A-Z][A-Z\s,'\-]{8,}$/.test(line) && line.length < 100) return line;
    }
    var first = cleaned.substring(0, 60).split('\n')[0].trim();
    return first.length > 5 ? first : 'Document';
  }

  function formatArtifactHtml(text) {
    var h = renderTables(text);
    h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    h = h.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    h = h.replace(/^---+$/gm, '<hr>');
    h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
    h = h.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    h = h.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    var result = '';
    var inParagraph = false;
    var htmlLines = h.split('\n');
    for (var i = 0; i < htmlLines.length; i++) {
      var line = htmlLines[i];
      var isBlock = /^<(h[1-3]|hr|pre|ul|ol|li|blockquote|table)/.test(line.trim());
      if (isBlock) {
        if (inParagraph) { result += '</p>'; inParagraph = false; }
        result += line + '\n';
      } else if (line.trim() === '') {
        if (inParagraph) { result += '</p>'; inParagraph = false; }
        result += '\n';
      } else {
        if (!inParagraph) { result += '<p>'; inParagraph = true; }
        else { result += '<br>'; }
        result += line;
      }
    }
    if (inParagraph) result += '</p>';
    return result;
  }

  function updateWordCount(text) {
    var wc = text.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
    els.artifactWordcount.textContent = wc.toLocaleString() + ' words';
  }

  function showMemoryHierarchy(memory) {
    var tiers = memory.tiers || [];
    var archives = memory.archives || [];
    var projectName = state.currentProject ? state.currentProject.name : 'Project';

    var html = '';
    if (tiers.length === 0 && archives.length === 0) {
      html = '<div style="text-align:center;padding:40px;color:#6b7280"><p style="font-size:24px;margin:0 0 12px">&#129504;</p><p>No memory stored yet. Chat with the project to build its Tractatus tree.</p></div>';
    } else {
      html += '<div style="padding:4px 0">';
      var totalNodes = 0;
      for (var t = 0; t < tiers.length; t++) totalNodes += tiers[t].nodes;

      html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center">';
      html += '<span style="font-weight:600;color:#166534">Total Memory: ' + totalNodes + ' nodes across ' + tiers.length + ' tier' + (tiers.length !== 1 ? 's' : '') + '</span>';
      if (archives.length > 0) {
        html += '<span style="font-size:12px;color:#6b7280">' + archives.length + ' archived snapshot' + (archives.length !== 1 ? 's' : '') + '</span>';
      }
      html += '</div></div>';

      for (var i = 0; i < tiers.length; i++) {
        var tier = tiers[i];
        var tierColor = tier.tier === 1 ? '#059669' : tier.tier === 2 ? '#7c3aed' : tier.tier === 3 ? '#dc2626' : '#6b7280';
        var tierIcon = tier.tier === 1 ? '&#127919;' : tier.tier === 2 ? '&#128202;' : tier.tier === 3 ? '&#128451;' : '&#128190;';
        var tierLabel = tier.tier === 1 ? 'Recent (High Resolution)' :
                        tier.tier === 2 ? 'Summary (Medium Resolution)' :
                        tier.tier === 3 ? 'Archive (Lower Resolution)' :
                        'Deep Archive (Tier ' + tier.tier + ')';

        html += '<div style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;overflow:hidden" data-testid="memory-tier-' + tier.tier + '">';
        html += '<div class="mem-tier-header" style="background:linear-gradient(135deg,' + tierColor + '10,' + tierColor + '05);padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb" data-tier="' + i + '">';
        html += '<div>' + tierIcon + ' <strong style="color:' + tierColor + '">Tier ' + tier.tier + '</strong> — ' + tierLabel + '</div>';
        html += '<div style="display:flex;align-items:center;gap:12px"><span style="background:' + tierColor + ';color:#fff;font-size:11px;padding:2px 8px;border-radius:10px">' + tier.nodes + ' nodes</span>';
        html += '<span class="mem-tier-arrow" style="font-size:14px;transition:transform 0.2s">&#9660;</span></div></div>';
        html += '<div class="mem-tier-body" style="max-height:400px;overflow-y:auto;padding:12px;font-family:\'SF Mono\',Consolas,monospace;font-size:11px;line-height:1.5;display:none">';

        var treeKeys = Object.keys(tier.tree);
        treeKeys.sort(function(a, b) {
          var pa = a.split('.').map(Number);
          var pb = b.split('.').map(Number);
          for (var k = 0; k < Math.max(pa.length, pb.length); k++) {
            var va = pa[k] || 0, vb = pb[k] || 0;
            if (va !== vb) return va - vb;
          }
          return 0;
        });

        for (var k = 0; k < treeKeys.length; k++) {
          var key = treeKeys[k];
          var depth = key.split('.').length - 1;
          var indent = depth * 16;
          var val = tier.tree[key];
          var tagMatch = typeof val === 'string' ? val.match(/^(ASSERTS|REJECTS|ASSUMES|OPEN|RESOLVED|DOCUMENT|QUESTION):/) : null;
          var tagColor = tagMatch ? ({
            'ASSERTS': '#059669', 'REJECTS': '#dc2626', 'ASSUMES': '#d97706',
            'OPEN': '#7c3aed', 'RESOLVED': '#6b7280', 'DOCUMENT': '#2563eb', 'QUESTION': '#ec4899'
          })[tagMatch[1]] || '#374151' : '#374151';
          html += '<div style="padding:2px 0;padding-left:' + indent + 'px">';
          html += '<span style="color:#9ca3af;font-size:10px;margin-right:6px">' + esc(key) + '</span>';
          if (tagMatch) {
            html += '<span style="color:' + tagColor + ';font-weight:600;font-size:10px">' + tagMatch[1] + ':</span> ';
            html += '<span style="color:#374151">' + esc(val.substring(tagMatch[0].length).trim()) + '</span>';
          } else {
            html += '<span style="color:#374151">' + esc(typeof val === 'string' ? val : JSON.stringify(val)) + '</span>';
          }
          html += '</div>';
        }

        html += '</div></div>';
      }

      if (archives.length > 0) {
        html += '<div style="border:1px solid #e5e7eb;border-radius:8px;margin-top:16px;overflow:hidden">';
        html += '<div style="padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb"><strong style="color:#6b7280">&#128451; Archived Snapshots</strong></div>';
        html += '<div style="padding:12px">';
        for (var a = 0; a < archives.length; a++) {
          var arch = archives[a];
          var archDate = new Date(arch.created_at).toLocaleDateString();
          html += '<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280">';
          html += 'Tier ' + arch.tier + ' snapshot — ' + (arch.node_count || '?') + ' nodes — ' + archDate;
          html += '</div>';
        }
        html += '</div></div>';
      }

      html += '</div>';
    }

    var title = '&#129504; Memory Hierarchy — ' + esc(projectName);

    var txtParts = [];
    txtParts.push('MEMORY HIERARCHY — ' + projectName);
    txtParts.push('=' .repeat(60));
    var totalNodesAll = 0;
    for (var tn = 0; tn < tiers.length; tn++) totalNodesAll += tiers[tn].nodes;
    txtParts.push('Total: ' + totalNodesAll + ' nodes across ' + tiers.length + ' tier(s)');
    if (archives.length > 0) txtParts.push(archives.length + ' archived snapshot(s)');
    txtParts.push('');

    for (var ti = 0; ti < tiers.length; ti++) {
      var tt = tiers[ti];
      var ttLabel = tt.tier === 1 ? 'Recent (High Resolution)' :
                    tt.tier === 2 ? 'Summary (Medium Resolution)' :
                    tt.tier === 3 ? 'Archive (Lower Resolution)' :
                    'Deep Archive (Tier ' + tt.tier + ')';
      txtParts.push('--- Tier ' + tt.tier + ' — ' + ttLabel + ' (' + tt.nodes + ' nodes) ---');
      txtParts.push('');

      var ttKeys = Object.keys(tt.tree);
      ttKeys.sort(function(a, b) {
        var pa = a.split('.').map(Number);
        var pb = b.split('.').map(Number);
        for (var sk = 0; sk < Math.max(pa.length, pb.length); sk++) {
          var va = pa[sk] || 0, vb = pb[sk] || 0;
          if (va !== vb) return va - vb;
        }
        return 0;
      });

      for (var tk = 0; tk < ttKeys.length; tk++) {
        var tKey = ttKeys[tk];
        var tDepth = tKey.split('.').length - 1;
        var tIndent = '  '.repeat(tDepth);
        var tVal = tt.tree[tKey];
        var tValStr = typeof tVal === 'string' ? tVal : JSON.stringify(tVal);
        txtParts.push(tIndent + tKey + '  ' + tValStr);
      }
      txtParts.push('');
    }

    if (archives.length > 0) {
      txtParts.push('--- Archived Snapshots ---');
      for (var ai = 0; ai < archives.length; ai++) {
        var aArch = archives[ai];
        var aDate = new Date(aArch.created_at).toLocaleDateString();
        txtParts.push('  Tier ' + aArch.tier + ' snapshot — ' + (aArch.node_count || '?') + ' nodes — ' + aDate);
      }
    }

    var txtContent = txtParts.join('\n');
    currentArtifact = { text: txtContent, title: 'Memory Hierarchy — ' + projectName };
    els.artifactTitle.innerHTML = title;
    els.artifactBody.innerHTML = html;
    els.artifactPanel.classList.remove('hidden');
    els.artifactSave.disabled = true;

    els.artifactBody.querySelectorAll('.mem-tier-header').forEach(function(header) {
      header.addEventListener('click', function() {
        var body = header.nextElementSibling;
        var arrow = header.querySelector('.mem-tier-arrow');
        if (body.style.display === 'none') {
          body.style.display = 'block';
          arrow.style.transform = 'rotate(180deg)';
        } else {
          body.style.display = 'none';
          arrow.style.transform = '';
        }
      });
    });
  }

  function showArtifact(text, title, opts) {
    opts = opts || {};
    var cleaned = opts.raw ? text : stripTractatusContent(text);
    currentArtifact = { text: cleaned, title: title || extractArtifactTitle(cleaned) };
    els.artifactTitle.textContent = currentArtifact.title;
    els.artifactBody.innerHTML = opts.raw ? '<pre style="white-space:pre-wrap;word-break:break-word;font-family:\'SF Mono\',Consolas,monospace;font-size:12px;line-height:1.6">' + esc(cleaned) + '</pre>' : formatArtifactHtml(cleaned);
    els.artifactPanel.classList.remove('hidden');
    els.artifactSave.disabled = false;
    els.artifactSave.innerHTML = '&#128218; Save';
    updateWordCount(cleaned);
  }

  function closeArtifact() {
    els.artifactPanel.classList.add('hidden');
    currentArtifact = null;
  }

  els.artifactClose.addEventListener('click', closeArtifact);

  els.artifactCopy.addEventListener('click', function() {
    if (!currentArtifact) return;
    var html = els.artifactBody ? els.artifactBody.innerHTML : fmt(currentArtifact.text);
    copyRich(html, currentArtifact.text, function(ok) {
      els.artifactCopy.textContent = ok ? '\u2705 Copied' : '\u26A0 Copy failed';
      setTimeout(function() { els.artifactCopy.innerHTML = '&#128203; Copy'; }, 2000);
    });
  });

  els.artifactDownloadTxt.addEventListener('click', function() {
    if (!currentArtifact) return;
    var blob = new Blob([currentArtifact.text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (currentArtifact.title || 'document').replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 50) + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  });

  els.artifactDownloadDocx.addEventListener('click', async function() {
    if (!currentArtifact) return;
    try {
      var resp = await fetch('/api/artifact/docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentArtifact.text, title: currentArtifact.title })
      });
      if (!resp.ok) throw new Error('Download failed');
      var blob = await resp.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (currentArtifact.title || 'document').replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 50) + '.docx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('DOCX download failed: ' + err.message, 'error');
    }
  });

  els.artifactDownloadPdf.addEventListener('click', async function() {
    if (!currentArtifact) return;
    try {
      var resp = await fetch('/api/artifact/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentArtifact.text, title: currentArtifact.title })
      });
      if (!resp.ok) throw new Error('Download failed');
      var blob = await resp.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (currentArtifact.title || 'document').replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 50) + '.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('PDF download failed: ' + err.message, 'error');
    }
  });

  els.artifactSave.addEventListener('click', async function() {
    if (!currentArtifact) return;
    try {
      await api('/api/documents/save-artifact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: currentArtifact.text, name: currentArtifact.title, projectId: state.currentProject ? state.currentProject.id : null })
      });
      els.artifactSave.innerHTML = '&#9989; Saved';
      els.artifactSave.disabled = true;
      notify(state.currentProject ? 'Saved to Project Library & General Library' : 'Saved to General Library', 'success');
      if (state.currentProject) loadProjectDocs();
    } catch (err) {
      notify('Save failed: ' + err.message, 'error');
    }
  });

  function notify(msg, type) {
    var el = document.createElement('div');
    el.className = 'notification ' + (type || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() {
      el.style.opacity = '0';
      setTimeout(function() { el.remove(); }, 300);
    }, 3000);
  }

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Inline markdown (bold/italic/code) for use inside table cells.
  function inlineMd(s) {
    var h = esc(s);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    return h;
  }

  // Convert GitHub-style markdown tables into HTML <table> blocks. Takes RAW
  // text: table cells are escaped+inline-formatted once via inlineMd, and every
  // non-table line is escaped here, so this is the FIRST transform (replaces the
  // initial esc() call). A table is consecutive pipe rows whose 2nd line is a
  // --- separator.
  function renderTables(rawText) {
    var lines = String(rawText).split('\n');
    var out = [];
    var i = 0;
    var inFence = false;
    // A separator must itself be pipe-delimited (rules out a lone "---" after
    // prose that happens to contain a pipe) and describe >=2 columns.
    function isRow(l) { return /\|/.test(l) && l.trim().length > 0; }
    function isSep(l) {
      if (!/\|/.test(l)) return false;
      if (!/^[\s|:-]+$/.test(l.trim())) return false;
      if (!/-/.test(l)) return false;
      return cells(l).length >= 2;
    }
    function cells(l) {
      var t = l.trim().replace(/^\|/, '').replace(/\|$/, '');
      return t.split('|').map(function(c) { return c.trim(); });
    }
    while (i < lines.length) {
      if (/^\s*```/.test(lines[i])) { inFence = !inFence; out.push(esc(lines[i])); i++; continue; }
      if (!inFence && isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]) && cells(lines[i]).length >= 2) {
        var header = cells(lines[i]);
        var body = [];
        var j = i + 2;
        while (j < lines.length && isRow(lines[j]) && !isSep(lines[j])) {
          body.push(cells(lines[j]));
          j++;
        }
        var tbl = '<table class="md-table"><thead><tr>';
        for (var h = 0; h < header.length; h++) tbl += '<th>' + inlineMd(header[h]) + '</th>';
        tbl += '</tr></thead><tbody>';
        for (var r = 0; r < body.length; r++) {
          tbl += '<tr>';
          for (var c = 0; c < header.length; c++) tbl += '<td>' + inlineMd(body[r][c] || '') + '</td>';
          tbl += '</tr>';
        }
        tbl += '</tbody></table>';
        out.push(tbl);
        i = j;
      } else {
        out.push(esc(lines[i]));
        i++;
      }
    }
    return out.join('\n');
  }

  function fmt(text) {
    var h = renderTables(text);
    h = h.replace(/```([\s\S]*?)```/g, '<pre style="background:#f3f4f6;padding:12px;border-radius:6px;overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:13px;margin:8px 0">$1</pre>');
    h = h.replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-family:JetBrains Mono,monospace;font-size:13px">$1</code>');
    h = h.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    h = h.replace(/^### (.+)$/gm, '<strong style="font-size:15px;display:block;margin:12px 0 4px">$1</strong>');
    h = h.replace(/^## (.+)$/gm, '<strong style="font-size:16px;display:block;margin:14px 0 4px">$1</strong>');
    h = h.replace(/^# (.+)$/gm, '<strong style="font-size:18px;display:block;margin:16px 0 6px">$1</strong>');
    h = h.replace(/^- (.+)$/gm, '\u2022 $1');
    return h;
  }

  // Copy with formatting preserved: writes both rich HTML and plain text to the
  // clipboard so pasting into Word / Google Docs / email keeps bold, headings,
  // bullets and line breaks, while plain-text editors still get clean text.
  function copyRich(html, plain, onDone) {
    var clean = document.createElement('div');
    clean.innerHTML = html || '';
    var junk = clean.querySelectorAll('.cursor-blink, .thinking-indicator, .artifact-link');
    for (var i = junk.length - 1; i >= 0; i--) junk[i].parentNode.removeChild(junk[i]);
    html = clean.innerHTML;
    var wrapped = '<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111">' + html + '</div>';
    var finish = function(ok) { if (onDone) onDone(ok); };
    var plainFallback = function() {
      try {
        var ta = document.createElement('textarea');
        ta.value = plain;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        finish(true);
      } catch (e) { finish(false); }
    };
    if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
      try {
        var item = new window.ClipboardItem({
          'text/html': new Blob([wrapped], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        });
        navigator.clipboard.write([item]).then(function() { finish(true); }).catch(plainFallback);
        return;
      } catch (e) { /* fall through */ }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(plain).then(function() { finish(true); }).catch(plainFallback);
    } else {
      plainFallback();
    }
  }

  async function api(url, opts) {
    var r = await fetch(url, opts || {});
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  function scrollBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  async function loadProjects() {
    state.projects = await api('/api/projects');
    renderProjects();
    if (!state.currentProject && state.projects.length > 0) {
      selectProject(state.projects[0]);
    }
  }

  function renderProjects() {
    els.projectList.innerHTML = '';
    for (var i = 0; i < state.projects.length; i++) {
      var p = state.projects[i];
      var d = document.createElement('div');
      d.className = 'sidebar-item' + (state.currentProject && state.currentProject.id === p.id ? ' active' : '');
      d.setAttribute('data-testid', 'project-' + p.id);
      d.innerHTML = '<span class="si-icon">&#128193;</span><span class="si-text">' + esc(p.name) + '</span>' +
        '<span class="si-actions">' +
        '<button class="si-btn si-btn-rename" data-testid="btn-rename-project-' + p.id + '" title="Rename">&#9998;</button>' +
        '<button class="si-btn si-btn-delete" data-testid="btn-delete-project-' + p.id + '" title="Delete">&#128465;</button>' +
        '</span>';
      (function(proj, el) {
        el.addEventListener('click', function(e) {
          if (e.target.closest('.si-btn')) return;
          selectProject(proj);
        });
        el.querySelector('.si-btn-rename').addEventListener('click', function(e) {
          e.stopPropagation();
          startInlineRename(el, proj.name, function(newName) { renameProject(proj, newName); });
        });
        el.querySelector('.si-btn-delete').addEventListener('click', function(e) {
          e.stopPropagation();
          deleteProject(proj);
        });
      })(p, d);
      els.projectList.appendChild(d);
    }
  }

  function deleteProject(proj) {
    if (!confirm('Delete project "' + proj.name + '"? This will delete all chats and documents in this project.')) return;
    api('/api/projects/' + proj.id, { method: 'DELETE' }).then(function() {
      state.projects = state.projects.filter(function(p) { return p.id !== proj.id; });
      if (state.currentProject && state.currentProject.id === proj.id) {
        state.currentProject = null;
        state.currentSession = null;
        state.sessions = [];
        renderSessions();
        showWelcome();
        els.topbarProject.textContent = '';
      }
      renderProjects();
      notify('Project deleted', 'success');
    }).catch(function() { notify('Failed to delete project', 'error'); });
  }

  function renameProject(proj, newName) {
    if (!newName || newName === proj.name) return;
    proj.name = newName;
    if (state.currentProject && state.currentProject.id === proj.id) {
      els.topbarProject.textContent = newName;
    }
    renderProjects();
    api('/api/projects/' + proj.id + '/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    }).catch(function() { notify('Failed to rename project', 'error'); });
  }

  function startInlineRename(el, currentName, onSave) {
    var textSpan = el.querySelector('.si-text');
    if (!textSpan) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-rename';
    input.value = currentName;
    input.setAttribute('data-testid', 'inline-rename-input');
    textSpan.replaceWith(input);
    input.focus();
    input.select();

    var saved = false;
    function save() {
      if (saved) return;
      saved = true;
      var val = input.value.trim();
      var span = document.createElement('span');
      span.className = 'si-text';
      span.textContent = val || currentName;
      input.replaceWith(span);
      if (val && val !== currentName) onSave(val);
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { input.value = currentName; save(); }
    });
  }

  async function selectProject(p) {
    state.currentProject = p;
    els.topbarProject.textContent = p.name;
    renderProjects();
    state.sessions = await api('/api/projects/' + p.id + '/sessions');
    renderSessions();
    loadProjectDocs();
    checkStaleness();
    if (state.sessions.length > 0) {
      selectSession(state.sessions[0]);
    } else {
      state.currentSession = null;
      showWelcome();
    }
  }

  function renderSessions() {
    els.sessionList.innerHTML = '';
    for (var i = 0; i < state.sessions.length; i++) {
      var s = state.sessions[i];
      var d = document.createElement('div');
      d.className = 'sidebar-item' + (state.currentSession && state.currentSession.id === s.id ? ' active' : '');
      d.setAttribute('data-testid', 'session-' + s.id);
      d.innerHTML = '<span class="si-icon">&#128172;</span><span class="si-text">' + esc(s.title || 'New Chat') + '</span>' +
        '<span class="si-actions">' +
        '<button class="si-btn si-btn-move" data-testid="btn-move-session-' + s.id + '" title="Move to project">&#128195;</button>' +
        '<button class="si-btn si-btn-rename" data-testid="btn-rename-session-' + s.id + '" title="Rename">&#9998;</button>' +
        '<button class="si-btn si-btn-delete" data-testid="btn-delete-session-' + s.id + '" title="Delete">&#128465;</button>' +
        '</span>';
      (function(sess, el) {
        el.addEventListener('click', function(e) {
          if (e.target.closest('.si-btn')) return;
          selectSession(sess);
        });
        el.querySelector('.si-btn-move').addEventListener('click', function(e) {
          e.stopPropagation();
          showMoveChatModal(sess);
        });
        el.querySelector('.si-btn-rename').addEventListener('click', function(e) {
          e.stopPropagation();
          startInlineRename(el, sess.title || 'New Chat', function(newName) { renameSession(sess, newName); });
        });
        el.querySelector('.si-btn-delete').addEventListener('click', function(e) {
          e.stopPropagation();
          deleteSession(sess);
        });
      })(s, d);
      els.sessionList.appendChild(d);
    }
  }

  function deleteSession(sess) {
    if (!confirm('Delete chat "' + (sess.title || 'New Chat') + '"?')) return;
    api('/api/sessions/' + sess.id, { method: 'DELETE' }).then(function() {
      state.sessions = state.sessions.filter(function(s) { return s.id !== sess.id; });
      if (state.currentSession && state.currentSession.id === sess.id) {
        if (state.sessions.length > 0) {
          selectSession(state.sessions[0]);
        } else {
          state.currentSession = null;
          showWelcome();
        }
      }
      renderSessions();
      notify('Chat deleted', 'success');
    }).catch(function() { notify('Failed to delete chat', 'error'); });
  }

  function renameSession(sess, newName) {
    if (!newName || newName === sess.title) return;
    sess.title = newName;
    renderSessions();
    api('/api/sessions/' + sess.id + '/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newName })
    }).catch(function() { notify('Failed to rename chat', 'error'); });
  }

  function showMoveChatModal(sess) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-bg';
    overlay.style.display = 'flex';
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '400px';
    modal.innerHTML = '<div class="modal-head"><span class="modal-title">Move Chat</span><button class="modal-x" data-testid="close-move-chat-modal">&times;</button></div>' +
      '<div style="padding:16px"><p style="margin:0 0 12px;font-size:13px;color:#6b7280">Move "<strong>' + esc(sess.title || 'New Chat') + '</strong>" to:</p>' +
      '<div id="move-chat-project-list" data-testid="move-chat-project-list" style="max-height:300px;overflow-y:auto"></div></div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var listEl = modal.querySelector('#move-chat-project-list');
    var projects = state.projects || [];
    for (var i = 0; i < projects.length; i++) {
      if (state.currentProject && projects[i].id === state.currentProject.id) continue;
      var btn = document.createElement('button');
      btn.className = 'move-project-btn';
      btn.setAttribute('data-testid', 'move-chat-to-' + projects[i].id);
      btn.textContent = projects[i].name;
      (function(proj) {
        btn.addEventListener('click', function() {
          moveChatToProject(sess, proj.id, proj.name, overlay);
        });
      })(projects[i]);
      listEl.appendChild(btn);
    }
    if (listEl.children.length === 0) {
      listEl.innerHTML = '<p style="color:#9ca3af;font-size:13px;text-align:center">No other projects to move to</p>';
    }

    modal.querySelector('[data-testid="close-move-chat-modal"]').addEventListener('click', function() {
      document.body.removeChild(overlay);
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
  }

  async function moveChatToProject(sess, targetProjectId, targetProjectName, overlay) {
    try {
      await api('/api/sessions/' + sess.id + '/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectId: targetProjectId })
      });
      state.sessions = state.sessions.filter(function(s) { return s.id !== sess.id; });
      if (state.currentSession && state.currentSession.id === sess.id) {
        if (state.sessions.length > 0) {
          selectSession(state.sessions[0]);
        } else {
          state.currentSession = null;
          showWelcome();
        }
      }
      renderSessions();
      document.body.removeChild(overlay);
      notify('Moved to "' + targetProjectName + '"', 'success');
    } catch (err) {
      notify('Move failed: ' + err.message, 'error');
    }
  }

  function selectSession(s) {
    state.currentSession = s;
    renderSessions();
    renderTranscript(s.transcript || []);
  }

  function setGreeting() {
    var g = document.getElementById('welcome-greeting');
    if (!g) return;
    var name = (window.__userName || '').trim();
    if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var day = days[new Date().getDay()];
    g.textContent = name ? ('Happy ' + day + ', ' + name) : 'How can I help you today?';
  }

  function showWelcome() {
    els.messages.innerHTML = '';
    els.messages.appendChild(els.welcome);
    els.welcome.style.display = '';
    setGreeting();
  }

  function renderTranscript(transcript) {
    els.messages.innerHTML = '';
    if (!transcript || transcript.length === 0) {
      els.messages.appendChild(els.welcome);
      els.welcome.style.display = '';
      setGreeting();
      return;
    }
    els.welcome.style.display = 'none';
    for (var i = 0; i < transcript.length; i++) {
      addMessage(transcript[i].role, transcript[i].content);
    }
    scrollBottom();
  }

  function addMessage(role, content) {
    els.welcome.style.display = 'none';
    var div = document.createElement('div');
    div.className = 'message ' + role;
    var avatar = role === 'user' ? 'U' : 'C';
    var label = role === 'user' ? 'You' : 'Claude';
    var words = content.split(/\s+/).length;
    var lines = content.split('\n').length;
    var isLarge = role === 'user' && words > 200;
    var isArtifact = role === 'assistant' && isDocumentArtifact(content);

    var bodyHtml;
    if (isLarge) {
      var preview = content.substring(0, 300);
      bodyHtml = '<div class="collapsed-card" data-testid="collapsed-message">';
      bodyHtml += '<div class="collapsed-preview">' + esc(preview) + '...</div>';
      bodyHtml += '<div class="collapsed-meta">' + words + ' words \u00b7 ' + lines + ' lines</div>';
      bodyHtml += '<button class="btn-expand" data-testid="btn-expand">Show full text</button>';
      bodyHtml += '</div>';
    } else {
      bodyHtml = '<div class="msg-text">' + fmt(content) + '</div>';
    }

    var copyBtnHtml = role === 'assistant' ? '<button class="msg-copy-btn" data-testid="btn-copy-response" title="Copy to clipboard">&#128203;</button>' : '';
    var auditRowHtml = role === 'assistant' ? '<div class="msg-actions-row"><button class="msg-audit-btn" data-testid="btn-audit" title="Fact-check this response against project memory">Audit</button></div>' : '';
    div.innerHTML = '<div class="msg-avatar">' + avatar + '</div>' +
      '<div class="msg-body"><div class="msg-role">' + label + copyBtnHtml + '</div>' + bodyHtml + auditRowHtml + '</div>';

    if (isLarge) {
      var btn = div.querySelector('.btn-expand');
      btn.addEventListener('click', function() {
        var card = div.querySelector('.collapsed-card');
        card.outerHTML = '<div class="msg-text">' + fmt(content) + '</div>';
      });
    }

    if (isArtifact) {
      var artTitle = extractArtifactTitle(content);
      var viewBtn = document.createElement('button');
      viewBtn.className = 'artifact-link';
      viewBtn.setAttribute('data-testid', 'btn-view-artifact');
      viewBtn.textContent = '\uD83D\uDCC4 View as Document';
      viewBtn.addEventListener('click', function() { showArtifact(content, artTitle); });
      var textContainer = div.querySelector('.msg-text') || div.querySelector('.msg-body');
      textContainer.appendChild(viewBtn);
    }

    if (role === 'assistant') {
      var copyBtn = div.querySelector('.msg-copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', function() {
          var textEl = div.querySelector('.msg-text');
          var rawText = textEl ? textEl.innerText : content;
          var html = textEl ? textEl.innerHTML : fmt(content);
          copyRich(html, rawText, function(ok) {
            copyBtn.textContent = ok ? '\u2705' : '\u26A0';
            setTimeout(function() { copyBtn.innerHTML = '&#128203;'; }, 1500);
          });
        });
      }
      var auditBtn = div.querySelector('.msg-audit-btn');
      if (auditBtn) {
        auditBtn.addEventListener('click', function() {
          var textEl = div.querySelector('.msg-text');
          var selected = window.getSelection().toString().trim();
          var textToAudit = selected || (textEl ? textEl.innerText : content);
          if (textToAudit) runAudit(textToAudit, auditBtn);
        });
      }
    }

    els.messages.appendChild(div);
    return div;
  }

  function addDocUploadCard(docName, wordCount, previewText, docId, opts) {
    opts = opts || {};
    els.welcome.style.display = 'none';
    var div = document.createElement('div');
    div.className = 'message user';
    var cardHtml = '<div class="doc-upload-card" data-testid="doc-upload-card-' + docId + '">';
    cardHtml += '<div class="duc-header"><span class="duc-icon">&#128196;</span><div><div class="duc-name">' + esc(docName) + '</div><div class="duc-meta">' + wordCount + ' words \u00b7 Saved to project</div></div></div>';
    if (previewText) {
      cardHtml += '<div class="duc-preview">' + esc(previewText) + '</div>';
    }
    cardHtml += '<div class="duc-status">Claude is analyzing this document...</div>';
    cardHtml += '<div class="duc-actions">';
    cardHtml += '<button class="duc-btn duc-btn-analyze" data-testid="btn-analyze-' + docId + '">&#128172; Ask Claude about it</button>';
    cardHtml += '<button class="duc-btn duc-btn-global" data-testid="btn-copy-global-' + docId + '">&#128218; Save to General Library</button>';
    cardHtml += '<button class="duc-btn duc-btn-project" data-testid="btn-move-project-' + docId + '">&#128193; Move to different project</button>';
    cardHtml += '</div>';
    cardHtml += '</div>';

    div.innerHTML = '<div class="msg-avatar">U</div><div class="msg-body"><div class="msg-role">You</div>' + cardHtml + '</div>';

    div.querySelector('[data-testid="btn-analyze-' + docId + '"]').addEventListener('click', function() {
      els.chatInput.value = 'Regarding the document "' + docName + '": ';
      els.chatInput.focus();
    });

    div.querySelector('[data-testid="btn-copy-global-' + docId + '"]').addEventListener('click', function(e) {
      var btn = e.currentTarget;
      copyToGlobal(docId).then(function() {
        btn.textContent = '\u2705 Saved to General Library';
        btn.disabled = true;
      });
    });

    div.querySelector('[data-testid="btn-move-project-' + docId + '"]').addEventListener('click', function() {
      showMoveToProjectModal(docId, docName);
    });

    els.messages.appendChild(div);
    scrollBottom();
    return div;
  }

  function showMoveToProjectModal(docId, docName) {
    var modal = document.createElement('div');
    modal.className = 'modal-bg active';
    modal.style.zIndex = '600';
    var inner = '<div class="modal" style="width:380px"><div class="modal-head"><span class="modal-title">Move "' + esc(docName) + '" to project</span><button class="modal-x" data-testid="close-move-modal">&times;</button></div><div class="modal-body"><ul class="doc-list">';
    for (var i = 0; i < state.projects.length; i++) {
      var p = state.projects[i];
      if (state.currentProject && p.id === state.currentProject.id) continue;
      inner += '<li class="doc-item" data-project-id="' + p.id + '" data-testid="move-to-' + p.id + '"><div class="doc-left"><span class="doc-icon">&#128193;</span><span class="doc-name">' + esc(p.name) + '</span></div></li>';
    }
    if (state.projects.length <= 1) {
      inner += '<li class="empty-state">No other projects. Create one first.</li>';
    }
    inner += '</ul></div></div>';
    modal.innerHTML = inner;

    modal.querySelector('[data-testid="close-move-modal"]').addEventListener('click', function() {
      modal.remove();
    });
    modal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });
    modal.addEventListener('mousedown', function(e) {
      if (e.target === modal) modal.remove();
    });

    var items = modal.querySelectorAll('[data-project-id]');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function() {
        var targetProjectId = this.getAttribute('data-project-id');
        copyDocToProject(docId, targetProjectId).then(function() {
          modal.remove();
          notify('Document copied to project', 'success');
        });
      });
    }

    document.body.appendChild(modal);
  }

  async function copyDocToProject(docId, targetProjectId) {
    try {
      await api('/api/documents/copy-to-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: docId, targetProjectId: targetProjectId })
      });
    } catch (err) {
      notify('Failed: ' + err.message, 'error');
    }
  }

  async function copyToGlobal(docId) {
    try {
      await api('/api/documents/copy-to-global', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: docId, projectId: state.currentProject.id })
      });
      notify('Copied to General Library', 'success');
    } catch (err) {
      notify('Failed: ' + err.message, 'error');
    }
  }

  function startStreaming() {
    els.welcome.style.display = 'none';
    var div = document.createElement('div');
    div.className = 'message assistant';
    var modelLabels = { claude: 'Claude', chatgpt: 'ChatGPT', deepseek: 'DeepSeek', grok: 'Grok', venice: 'Venice' };
    var modelLabel = modelLabels[state.model] || 'Claude';
    var avatarLetter = modelLabel.charAt(0);
    div.innerHTML = '<div class="msg-avatar">' + avatarLetter + '</div>' +
      '<div class="msg-body"><div class="msg-role">' + modelLabel + '<button class="msg-copy-btn" data-testid="btn-copy-response" title="Copy to clipboard">&#128203;</button></div>' +
      '<div class="msg-text"><span class="thinking-indicator"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span></div>' +
      '<div class="msg-actions-row"><button class="msg-audit-btn" data-testid="btn-audit" title="Fact-check this response against project memory">Audit</button></div></div>';
    var copyBtn = div.querySelector('.msg-copy-btn');
    copyBtn.addEventListener('click', function() {
      var textEl = div.querySelector('.msg-text');
      var rawText = textEl ? textEl.innerText : '';
      var html = textEl ? textEl.innerHTML : '';
      copyRich(html, rawText, function(ok) {
        copyBtn.textContent = ok ? '\u2705' : '\u26A0';
        setTimeout(function() { copyBtn.innerHTML = '&#128203;'; }, 1500);
      });
    });
    var auditBtn = div.querySelector('.msg-audit-btn');
    auditBtn.addEventListener('click', function() {
      var textEl = div.querySelector('.msg-text');
      var selected = window.getSelection().toString().trim();
      var textToAudit = selected || (textEl ? textEl.innerText : '');
      if (textToAudit) runAudit(textToAudit, auditBtn);
    });
    els.messages.appendChild(div);
    scrollBottom();
    return div.querySelector('.msg-text');
  }

  function streamSSE(response, textEl, onDone) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullText = '';
    var artifactOpened = false;
    var artifactCheckInterval = null;
    var lastArtifactLen = 0;
    var shownLen = 0;
    var streamDone = false;
    var finalized = false;
    var rafId = null;

    function finalizeRender() {
      if (finalized) return;
      finalized = true;
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      if (artifactCheckInterval) { clearInterval(artifactCheckInterval); artifactCheckInterval = null; }
      var ti2 = textEl.querySelector('.thinking-indicator');
      if (ti2) ti2.remove();
      var c = textEl.querySelector('.cursor-blink');
      if (c) c.remove();
      textEl.innerHTML = fmt(fullText);
      if (isDocumentArtifact(fullText)) {
        var artTitle = extractArtifactTitle(fullText);
        var viewBtn = document.createElement('button');
        viewBtn.className = 'artifact-link';
        viewBtn.setAttribute('data-testid', 'btn-view-artifact');
        viewBtn.textContent = '\uD83D\uDCC4 View as Document';
        viewBtn.addEventListener('click', function() { showArtifact(fullText, artTitle); });
        textEl.appendChild(viewBtn);
      }
      if (onDone) onDone(fullText);
    }

    // Smooth typewriter renderer: drains received text at a steady pace
    // so output flows naturally instead of appearing in network-sized blocks.
    function renderLoop() {
      rafId = null;
      if (finalized) return;
      if (shownLen < fullText.length) {
        var ti = textEl.querySelector('.thinking-indicator');
        if (ti) ti.remove();
        var remaining = fullText.length - shownLen;
        var step = Math.max(2, Math.ceil(remaining * 0.18));
        if (step > 180) step = 180;
        shownLen += step;
        if (shownLen > fullText.length) shownLen = fullText.length;
        textEl.innerHTML = fmt(fullText.slice(0, shownLen)) + '<span class="cursor-blink"></span>';
        scrollBottom();
      }
      if (shownLen < fullText.length || !streamDone) {
        rafId = requestAnimationFrame(renderLoop);
      } else {
        finalizeRender();
      }
    }

    function ensureLoop() {
      if (rafId == null && !finalized) {
        rafId = requestAnimationFrame(renderLoop);
      }
    }

    function updateLiveArtifact() {
      if (!artifactOpened) return;
      if (fullText.length === lastArtifactLen) return;
      lastArtifactLen = fullText.length;
      var cleaned = stripTractatusContent(fullText);
      currentArtifact.text = cleaned;
      els.artifactBody.innerHTML = formatArtifactHtml(cleaned) + '<span class="cursor-blink"></span>';
      els.artifactBody.scrollTop = els.artifactBody.scrollHeight;
      updateWordCount(cleaned);
    }

    function checkAndOpenArtifact() {
      if (artifactOpened) return;
      if (isDocumentArtifact(fullText)) {
        artifactOpened = true;
        var artTitle = extractArtifactTitle(fullText);
        currentArtifact = { text: stripTractatusContent(fullText), title: artTitle };
        els.artifactTitle.textContent = artTitle;
        els.artifactPanel.classList.remove('hidden');
        els.artifactSave.disabled = false;
        els.artifactSave.innerHTML = '&#128218; Save';
        updateLiveArtifact();
        if (!artifactCheckInterval) {
          artifactCheckInterval = setInterval(updateLiveArtifact, 300);
        }
      }
    }

    function pump() {
      reader.read().then(function(result) {
        if (result.done) {
          streamDone = true;
          ensureLoop();
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('data: ')) {
            var data = lines[i].slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              var parsed = JSON.parse(data);
              if (parsed.type === 'status') {
                // status events (thinking, etc.) — no action needed, indicator already shown
              } else if (parsed.type === 'text') {
                fullText += parsed.text;
                ensureLoop();
              } else if (parsed.type === 'error') {
                notify('Error: ' + parsed.error, 'error');
              } else if (parsed.type === 'tractatus_trigger') {
                startTractatusUpdate(parsed.projectId, parsed.userMessage, parsed.assistantResponse);
              }
            } catch (e) {}
          }
        }
        pump();
      }).catch(function(err) {
        if (artifactCheckInterval) { clearInterval(artifactCheckInterval); artifactCheckInterval = null; }
        var c = textEl.querySelector('.cursor-blink');
        if (c) c.remove();
        if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
        finalized = true;
        var ti2 = textEl.querySelector('.thinking-indicator');
        if (ti2) ti2.remove();
        if (err && err.name === 'AbortError') {
          if (fullText) {
            textEl.innerHTML = fmt(fullText) + '\n<em style="color:#9ca3af">[Stopped by user]</em>';
          } else {
            textEl.innerHTML = '<em style="color:#9ca3af">[Stopped]</em>';
          }
          state.streaming = false;
          state.abortController = null;
          els.btnSend.innerHTML = '&#9654;';
          els.btnSend.classList.remove('stop-mode');
          els.btnSend.disabled = false;
        }
        if (onDone) onDone(fullText);
      });
    }
    pump();
  }

  function startTractatusUpdate(projectId, userMessage, assistantResponse) {
    // Never let memory popups stack — remove any leftover one first so failed
    // updates can't pile up and cover the screen.
    var stale = document.querySelectorAll('[data-testid="tractatus-popup"]');
    for (var s = 0; s < stale.length; s++) stale[s].remove();

    var popup = document.createElement('div');
    popup.className = 'tractatus-popup';
    popup.setAttribute('data-testid', 'tractatus-popup');
    popup.innerHTML = '<div class="tp-header">' +
      '<div class="tp-title">&#128736; Updating Project Memory</div>' +
      '<div class="tp-controls">' +
      '<button class="tp-minimize" data-testid="tp-minimize" title="Minimize">&#8211;</button>' +
      '<button class="tp-close" data-testid="tp-close" title="Close">&times;</button>' +
      '</div></div>' +
      '<div class="tp-body"><div class="tp-content"><span class="cursor-blink"></span></div></div>';

    document.body.appendChild(popup);

    var tpContent = popup.querySelector('.tp-content');
    var tpTitle = popup.querySelector('.tp-title');
    var tpClose = popup.querySelector('.tp-close');
    var tpMinimize = popup.querySelector('.tp-minimize');
    var tpBody = popup.querySelector('.tp-body');
    var minimized = false;
    var rawText = '';

    function setMinimized(v) {
      minimized = v;
      tpBody.classList.toggle('hidden', minimized);
      popup.classList.toggle('minimized', minimized);
      tpMinimize.innerHTML = minimized ? '&#9633;' : '&#8211;';
      tpMinimize.title = minimized ? 'Expand' : 'Minimize';
    }
    tpMinimize.addEventListener('click', function(e) { e.stopPropagation(); setMinimized(!minimized); });
    tpClose.addEventListener('click', function(e) { e.stopPropagation(); popup.remove(); });

    var header = popup.querySelector('.tp-header');
    var dragging = false, moved = false, startX, startY, origX, origY;
    header.addEventListener('dblclick', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      setMinimized(!minimized);
    });
    header.addEventListener('mousedown', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      var rect = popup.getBoundingClientRect();
      origX = rect.left; origY = rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      popup.style.left = (origX + e.clientX - startX) + 'px';
      popup.style.top = (origY + e.clientY - startY) + 'px';
      popup.style.right = 'auto';
      popup.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function() { dragging = false; });

    fetch('/api/tractatus/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: projectId, userMessage: userMessage, assistantResponse: assistantResponse })
    }).then(function(res) {
      if (!res.ok || !res.body) {
        tpTitle.innerHTML = '&#10060; Update Failed (' + res.status + ')';
        tpClose.classList.remove('hidden');
        var cursor = tpContent.querySelector('.cursor-blink');
        if (cursor) cursor.remove();
        return;
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';

      function pump() {
        reader.read().then(function(result) {
          if (result.done) return;
          buf += decoder.decode(result.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('data: ')) {
              var d = lines[i].slice(6).trim();
              if (d === '[DONE]') continue;
              try {
                var p = JSON.parse(d);
                if (p.type === 'text') {
                  rawText += p.text;
                  var cursor = tpContent.querySelector('.cursor-blink');
                  if (cursor) cursor.remove();
                  tpContent.textContent = rawText;
                  tpContent.innerHTML += '<span class="cursor-blink"></span>';
                  tpContent.scrollTop = tpContent.scrollHeight;
                } else if (p.type === 'complete') {
                  var cursor = tpContent.querySelector('.cursor-blink');
                  if (cursor) cursor.remove();
                  tpTitle.innerHTML = '&#9989; Memory Updated (' + p.nodes + ' nodes)';
                  tpClose.classList.remove('hidden');
                  setTimeout(function() { popup.remove(); }, 8000);
                } else if (p.type === 'status') {
                  var cursor = tpContent.querySelector('.cursor-blink');
                  if (cursor) cursor.remove();
                  tpContent.textContent = p.message || '';
                  tpContent.innerHTML += '<span class="cursor-blink"></span>';
                  if (p.message && p.message.indexOf('deferred') >= 0) {
                    tpTitle.innerHTML = '&#9888;&#65039; ' + p.message;
                    tpClose.classList.remove('hidden');
                    setTimeout(function() { popup.remove(); }, 5000);
                  }
                } else if (p.type === 'error') {
                  var cursor = tpContent.querySelector('.cursor-blink');
                  if (cursor) cursor.remove();
                  var errMsg = p.message || 'Unknown error';
                  if (errMsg.indexOf('skipping') >= 0 || errMsg.indexOf('deferred') >= 0) {
                    tpTitle.innerHTML = '&#9888;&#65039; Memory update skipped';
                    setTimeout(function() { popup.remove(); }, 4000);
                  } else {
                    tpTitle.innerHTML = '&#10060; Update Failed: ' + errMsg;
                    setTimeout(function() { popup.remove(); }, 6000);
                  }
                  tpClose.classList.remove('hidden');
                }
              } catch (e) {}
            }
          }
          pump();
        }).catch(function() {
          tpTitle.innerHTML = '&#10060; Connection Lost (memory saved in background)';
          tpClose.classList.remove('hidden');
          var cursor = tpContent.querySelector('.cursor-blink');
          if (cursor) cursor.remove();
          setTimeout(function() { popup.remove(); }, 5000);
        });
      }
      pump();
    }).catch(function() {
      tpTitle.innerHTML = '&#10060; Update Failed';
      tpClose.classList.remove('hidden');
      var cursor = tpContent.querySelector('.cursor-blink');
      if (cursor) cursor.remove();
      setTimeout(function() { popup.remove(); }, 6000);
    });
  }

  async function ensureSession() {
    if (state.currentSession) return;
    if (!state.currentProject) return;
    try {
      var s = await api('/api/projects/' + state.currentProject.id + '/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat' })
      });
      s.transcript = [];
      state.sessions.unshift(s);
      state.currentSession = s;
      renderSessions();
    } catch (err) {
      notify('Failed to create chat', 'error');
    }
  }

  async function sendMessage() {
    if (state.streaming) {
      if (state.abortController) {
        state.abortController.abort();
      }
      return;
    }
    var text = els.chatInput.value.trim();
    var hasAttachments = state.pendingAttachments.length > 0 && state.pendingAttachments.some(function(a) { return !a.uploading; });
    if (!text && !hasAttachments) return;
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    await ensureSession();
    if (!state.currentSession) return;

    els.chatInput.value = '';
    autoResize();

    var readyAttachments = [];
    var remaining = [];
    for (var ai = 0; ai < state.pendingAttachments.length; ai++) {
      if (!state.pendingAttachments[ai].uploading) {
        readyAttachments.push(state.pendingAttachments[ai]);
      } else {
        remaining.push(state.pendingAttachments[ai]);
      }
    }
    state.pendingAttachments = remaining;
    renderAttachmentChips();

    var fullMessage = '';
    if (readyAttachments.length > 0) {
      var docParts = [];
      for (var di = 0; di < readyAttachments.length; di++) {
        var att = readyAttachments[di];
        docParts.push('[Attached document: "' + att.docName + '" (' + att.wordCount + ' words)]\n\n' + att.content);
      }
      fullMessage = docParts.join('\n\n---\n\n');
      if (text) fullMessage += '\n\n---\n\nUser message: ' + text;
    } else {
      fullMessage = text;
    }

    var displayText = text || (readyAttachments.length > 0 ? readyAttachments.map(function(a) { return '📄 ' + a.docName; }).join(', ') + (text ? '\n\n' + text : '') : '');
    addMessage('user', displayText);
    scrollBottom();

    var isFirstMessage = !state.currentSession.transcript || state.currentSession.transcript.length === 0;
    var needsAutoTitle = isFirstMessage && state.currentSession.title === 'New Chat';
    var sendingSession = state.currentSession;
    var optimisticTitle = '';
    if (needsAutoTitle) {
      var titleSource = text || (readyAttachments.length > 0 ? readyAttachments[0].docName : 'New Chat');
      optimisticTitle = titleSource.length > 50 ? titleSource.substring(0, 47) + '...' : titleSource;
      sendingSession.title = optimisticTitle;
      renderSessions();
    }

    if (!state.currentSession.transcript) state.currentSession.transcript = [];
    state.currentSession.transcript.push({ role: 'user', content: displayText });

    state.streaming = true;
    state.abortController = new AbortController();
    els.btnSend.innerHTML = '&#9724;';
    els.btnSend.classList.add('stop-mode');
    els.btnSend.disabled = false;

    try {
      var textEl = startStreaming();
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.currentSession.id,
          projectId: state.currentProject.id,
          message: fullMessage,
          responseLength: state.responseLength,
          responseFormat: state.responseFormat,
          stance: state.stance,
          model: state.model,
          targetWords: getTargetWords()
        }),
        signal: state.abortController.signal
      });

      streamSSE(res, textEl, function(fullText) {
        if (sendingSession && fullText) {
          sendingSession.transcript = sendingSession.transcript || [];
          sendingSession.transcript.push({ role: 'assistant', content: fullText });
        }
        state.streaming = false;
        state.abortController = null;
        els.btnSend.innerHTML = '&#9654;';
        els.btnSend.classList.remove('stop-mode');
        els.btnSend.disabled = false;

        if (needsAutoTitle && sendingSession) {
          api('/api/sessions/' + sendingSession.id + '/auto-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: text, assistantResponse: fullText })
          }).then(function(data) {
            if (data && data.title && sendingSession.title === optimisticTitle) {
              sendingSession.title = data.title;
              renderSessions();
            }
          }).catch(function() {});
        }
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        var c = textEl.querySelector('.cursor-blink');
        if (c) c.remove();
        var ti = textEl.querySelector('.thinking-indicator');
        if (ti) ti.remove();
        if (textEl.textContent.trim() === '') {
          textEl.innerHTML = '<em style="color:#9ca3af">[Stopped]</em>';
        } else {
          textEl.innerHTML = fmt(textEl.textContent) + '\n<em style="color:#9ca3af">[Stopped by user]</em>';
        }
      } else {
        notify('Message failed: ' + err.message, 'error');
      }
      state.streaming = false;
      state.abortController = null;
      els.btnSend.innerHTML = '&#9654;';
      els.btnSend.classList.remove('stop-mode');
      els.btnSend.disabled = false;
    }
  }

  function runCoherence(paperSpec) {
    var popup = document.createElement('div');
    popup.className = 'paper-popup';
    popup.setAttribute('data-testid', 'paper-popup');
    popup.innerHTML = '<div class="pp-header">' +
      '<div class="pp-title">&#128221; Generating: ' + esc(paperSpec.title || paperSpec.doctype) + '</div>' +
      '<div class="pp-controls">' +
      '<button class="pp-minimize" data-testid="pp-minimize" title="Minimize">&#8211;</button>' +
      '<button class="pp-close hidden" data-testid="pp-close" title="Close">&times;</button>' +
      '</div></div>' +
      '<div class="pp-status"><span class="pp-status-text">Starting...</span>' +
      '<div class="pp-bar"><div class="pp-fill"></div></div></div>' +
      '<div class="pp-body"><div class="pp-content"></div></div>' +
      '<div class="pp-footer hidden"><div class="pp-downloads"></div><div class="pp-word-count"></div></div>';

    document.body.appendChild(popup);

    var ppContent = popup.querySelector('.pp-content');
    var ppStatusText = popup.querySelector('.pp-status-text');
    var ppFill = popup.querySelector('.pp-fill');
    var ppFooter = popup.querySelector('.pp-footer');
    var ppDownloads = popup.querySelector('.pp-downloads');
    var ppWordCount = popup.querySelector('.pp-word-count');
    var ppClose = popup.querySelector('.pp-close');
    var ppMinimize = popup.querySelector('.pp-minimize');
    var ppBody = popup.querySelector('.pp-body');

    var minimized = false;
    ppMinimize.addEventListener('click', function() {
      minimized = !minimized;
      ppBody.classList.toggle('hidden', minimized);
      ppFooter.classList.toggle('hidden', minimized && !ppFooter.classList.contains('pp-done'));
      ppMinimize.innerHTML = minimized ? '&#9744;' : '&#8211;';
    });

    ppClose.addEventListener('click', function() {
      popup.remove();
    });

    var makeDraggable = function() {
      var header = popup.querySelector('.pp-header');
      var dragging = false, startX, startY, origX, origY;
      header.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        var rect = popup.getBoundingClientRect();
        origX = rect.left; origY = rect.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        popup.style.left = (origX + e.clientX - startX) + 'px';
        popup.style.top = (origY + e.clientY - startY) + 'px';
        popup.style.right = 'auto';
        popup.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', function() { dragging = false; });
    };
    makeDraggable();

    var fullText = '';
    var ppRenderTimer = null;

    function ppRenderContent() {
      var cursor = ppContent.querySelector('.cursor-blink');
      if (cursor) cursor.remove();
      ppContent.innerHTML = fmt(fullText) + '<span class="cursor-blink"></span>';
      ppContent.scrollTop = ppContent.scrollHeight;
      ppRenderTimer = null;
    }

    function ppScheduleRender() {
      if (!ppRenderTimer) {
        ppRenderTimer = setTimeout(ppRenderContent, 80);
      }
    }

    fetch('/api/coherence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.currentSession.id,
        projectId: state.currentProject.id,
        title: paperSpec.title,
        instructions: paperSpec.instructions,
        wordcount: paperSpec.wordcount,
        doctype: paperSpec.doctype,
        selectedDocs: paperSpec.selectedDocs || [],
        fetchResearch: paperSpec.fetchResearch || false
      })
    }).then(function(res) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function pump() {
        reader.read().then(function(result) {
          if (result.done) return;
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('data: ')) {
              var data = lines[i].slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                var parsed = JSON.parse(data);
                if (parsed.type === 'status') {
                  ppStatusText.textContent = parsed.message;
                } else if (parsed.type === 'research_status') {
                  ppStatusText.textContent = parsed.message;
                } else if (parsed.type === 'progress') {
                  var pct = Math.round((parsed.current / parsed.total) * 100);
                  ppFill.style.width = pct + '%';
                  ppStatusText.textContent = 'Writing section ' + parsed.current + ' of ' + parsed.total + '...';
                } else if (parsed.type === 'token') {
                  fullText += parsed.text;
                  ppScheduleRender();
                } else if (parsed.type === 'section_start') {
                  if (fullText) fullText += '\n\n';
                  fullText += '## ' + parsed.title + '\n\n';
                  ppRenderContent();
                } else if (parsed.type === 'chunk') {
                  fullText += (fullText ? '\n\n' : '') + parsed.text;
                  var cursor = ppContent.querySelector('.cursor-blink');
                  if (cursor) cursor.remove();
                  ppContent.innerHTML = fmt(fullText);
                  ppContent.scrollTop = ppContent.scrollHeight;
                } else if (parsed.type === 'complete') {
                  var cursor = ppContent.querySelector('.cursor-blink');
                  if (cursor) cursor.remove();
                  ppContent.innerHTML = fmt(fullText);
                  ppStatusText.textContent = 'Complete — ' + (parsed.totalWords || '?') + ' words generated';
                  ppFill.style.width = '100%';
                  ppWordCount.textContent = (parsed.totalWords || '?') + ' words';
                  ppClose.classList.remove('hidden');
                  ppFooter.classList.remove('hidden');
                  ppFooter.classList.add('pp-done');

                  var formats = [
                    { key: 'txt', icon: '&#128196;', label: 'TXT' },
                    { key: 'docx', icon: '&#128195;', label: 'DOCX' },
                    { key: 'pdf', icon: '&#128211;', label: 'PDF' }
                  ];
                  for (var f = 0; f < formats.length; f++) {
                    var btn = document.createElement('button');
                    btn.className = 'dl-btn';
                    btn.setAttribute('data-testid', 'btn-download-' + formats[f].key);
                    btn.innerHTML = formats[f].icon + ' ' + formats[f].label;
                    btn.onclick = (function(jid, fmtKey) {
                      return function() { window.open('/api/download/' + jid + '/' + fmtKey); };
                    })(parsed.jobId, formats[f].key);
                    ppDownloads.appendChild(btn);
                  }

                  var saveBtn = document.createElement('button');
                  saveBtn.className = 'dl-btn dl-btn-save';
                  saveBtn.setAttribute('data-testid', 'btn-save-to-library');
                  saveBtn.innerHTML = '&#128218; Save to Library';
                  saveBtn.onclick = (function(jid, docTitle) {
                    return async function() {
                      try {
                        await api('/api/documents/save-generated', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ jobId: jid, name: docTitle, projectId: state.currentProject ? state.currentProject.id : null })
                        });
                        saveBtn.innerHTML = '&#9989; Saved';
                        saveBtn.disabled = true;
                        notify(state.currentProject ? 'Saved to Project Library & General Library' : 'Saved to General Library', 'success');
                        if (state.currentProject) loadProjectDocs();
                      } catch (err) {
                        notify('Save failed: ' + err.message, 'error');
                      }
                    };
                  })(parsed.jobId, paperSpec.title || paperSpec.doctype);
                  ppDownloads.appendChild(saveBtn);

                  var reviseBtn = document.createElement('button');
                  reviseBtn.className = 'dl-btn dl-btn-revise';
                  reviseBtn.setAttribute('data-testid', 'btn-revise-paper');
                  reviseBtn.innerHTML = '&#9999;&#65039; Revise';
                  reviseBtn.onclick = function() {
                    var reviseArea = popup.querySelector('.pp-revise-area');
                    if (reviseArea) { reviseArea.classList.toggle('hidden'); reviseArea.querySelector('textarea').focus(); return; }
                    var area = document.createElement('div');
                    area.className = 'pp-revise-area';
                    area.innerHTML = '<textarea class="text-input pp-revise-input" data-testid="revise-instructions" placeholder="Describe what to change... (e.g. \'Make the introduction more concise\', \'Add a section on X\', \'Change the tone to be more formal\')" style="width:100%;min-height:60px;resize:vertical;font-family:inherit;margin-bottom:6px;box-sizing:border-box"></textarea>' +
                      '<div style="display:flex;gap:6px;justify-content:flex-end"><button class="btn-cancel pp-revise-cancel" data-testid="revise-cancel" style="font-size:12px">Cancel</button><button class="dl-btn" data-testid="revise-submit" style="background:#7c3aed;font-size:12px">&#9999;&#65039; Apply Revision</button></div>';
                    ppFooter.after(area);
                    area.querySelector('.pp-revise-cancel').onclick = function() { area.remove(); };
                    area.querySelector('[data-testid="revise-submit"]').onclick = function() {
                      var revInstructions = area.querySelector('textarea').value.trim();
                      if (!revInstructions) return;
                      area.remove();
                      ppFooter.classList.add('hidden');
                      ppFooter.classList.remove('pp-done');
                      ppClose.classList.add('hidden');
                      ppDownloads.innerHTML = '';
                      ppWordCount.textContent = '';
                      ppStatusText.textContent = 'Revising document...';
                      ppFill.style.width = '30%';

                      var prevText = fullText;
                      fullText = '';
                      ppContent.innerHTML = '<span class="cursor-blink"></span>';

                      fetch('/api/coherence/revise', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          sessionId: state.currentSession.id,
                          projectId: state.currentProject.id,
                          previousOutput: prevText,
                          revisionInstructions: revInstructions,
                          title: paperSpec.title,
                          doctype: paperSpec.doctype
                        })
                      }).then(function(revRes) {
                        var revReader = revRes.body.getReader();
                        var revDecoder = new TextDecoder();
                        var revBuf = '';
                        function revPump() {
                          revReader.read().then(function(rr) {
                            if (rr.done) return;
                            revBuf += revDecoder.decode(rr.value, { stream: true });
                            var revLines = revBuf.split('\n');
                            revBuf = revLines.pop();
                            for (var ri = 0; ri < revLines.length; ri++) {
                              if (revLines[ri].startsWith('data: ')) {
                                var rd = revLines[ri].slice(6).trim();
                                if (rd === '[DONE]') continue;
                                try {
                                  var rp = JSON.parse(rd);
                                  if (rp.type === 'token') {
                                    fullText += rp.text;
                                    ppScheduleRender();
                                  } else if (rp.type === 'status') {
                                    ppStatusText.textContent = rp.message;
                                  } else if (rp.type === 'complete') {
                                    var c2 = ppContent.querySelector('.cursor-blink');
                                    if (c2) c2.remove();
                                    ppContent.innerHTML = fmt(fullText);
                                    ppStatusText.textContent = 'Revision complete — ' + (rp.totalWords || '?') + ' words';
                                    ppFill.style.width = '100%';
                                    ppWordCount.textContent = (rp.totalWords || '?') + ' words';
                                    ppClose.classList.remove('hidden');
                                    ppFooter.classList.remove('hidden');
                                    ppFooter.classList.add('pp-done');

                                    var fmts2 = [
                                      { key: 'txt', icon: '&#128196;', label: 'TXT' },
                                      { key: 'docx', icon: '&#128195;', label: 'DOCX' },
                                      { key: 'pdf', icon: '&#128211;', label: 'PDF' }
                                    ];
                                    for (var f2 = 0; f2 < fmts2.length; f2++) {
                                      var btn2 = document.createElement('button');
                                      btn2.className = 'dl-btn';
                                      btn2.setAttribute('data-testid', 'btn-download-' + fmts2[f2].key);
                                      btn2.innerHTML = fmts2[f2].icon + ' ' + fmts2[f2].label;
                                      btn2.onclick = (function(jid2, fk2) { return function() { window.open('/api/download/' + jid2 + '/' + fk2); }; })(rp.jobId, fmts2[f2].key);
                                      ppDownloads.appendChild(btn2);
                                    }

                                    var saveBtn2 = document.createElement('button');
                                    saveBtn2.className = 'dl-btn dl-btn-save';
                                    saveBtn2.setAttribute('data-testid', 'btn-save-to-library');
                                    saveBtn2.innerHTML = '&#128218; Save to Library';
                                    saveBtn2.onclick = (function(jid2, dt2) { return async function() {
                                      try {
                                        await api('/api/documents/save-generated', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: jid2, name: dt2, projectId: state.currentProject ? state.currentProject.id : null }) });
                                        saveBtn2.innerHTML = '&#9989; Saved'; saveBtn2.disabled = true;
                                        notify(state.currentProject ? 'Saved to Project Library & General Library' : 'Saved to General Library', 'success');
                                        if (state.currentProject) loadProjectDocs();
                                      } catch (err) { notify('Save failed: ' + err.message, 'error'); }
                                    }; })(rp.jobId, paperSpec.title || paperSpec.doctype);
                                    ppDownloads.appendChild(saveBtn2);

                                    var reviseBtn2 = document.createElement('button');
                                    reviseBtn2.className = 'dl-btn dl-btn-revise';
                                    reviseBtn2.setAttribute('data-testid', 'btn-revise-paper');
                                    reviseBtn2.innerHTML = '&#9999;&#65039; Revise';
                                    reviseBtn2.onclick = reviseBtn.onclick;
                                    ppDownloads.appendChild(reviseBtn2);
                                    reviseBtn = reviseBtn2;

                                    notify('Revision complete!', 'success');
                                  } else if (rp.type === 'error') {
                                    ppStatusText.textContent = 'Error: ' + rp.error;
                                    ppClose.classList.remove('hidden');
                                  }
                                } catch(e2) {}
                              }
                            }
                            revPump();
                          }).catch(function() { ppStatusText.textContent = 'Connection lost'; ppClose.classList.remove('hidden'); });
                        }
                        revPump();
                      });
                    };
                    area.querySelector('textarea').focus();
                  };
                  ppDownloads.appendChild(reviseBtn);

                  notify('Paper generation complete!', 'success');
                } else if (parsed.type === 'error') {
                  ppStatusText.textContent = 'Error: ' + parsed.error;
                  ppClose.classList.remove('hidden');
                  notify('Paper error: ' + parsed.error, 'error');
                }
              } catch (e) {}
            }
          }
          pump();
        }).catch(function() {
          ppStatusText.textContent = 'Connection lost';
          ppClose.classList.remove('hidden');
        });
      }
      pump();
    }).catch(function(err) {
      ppStatusText.textContent = 'Failed: ' + err.message;
      ppClose.classList.remove('hidden');
      notify('Paper generation failed', 'error');
    });
  }

  async function loadProjectDocs() {
    if (!state.currentProject) {
      els.docPanelList.innerHTML = '<div class="doc-panel-empty">Select a project to see documents</div>';
      return;
    }
    try {
      state.projectDocs = await api('/api/projects/' + state.currentProject.id + '/documents');
      renderDocPanel();
    } catch (err) {
      els.docPanelList.innerHTML = '<div class="doc-panel-empty">Failed to load</div>';
    }
  }

  els.docPanelToggle.addEventListener('click', function() {
    els.docPanel.classList.toggle('doc-panel-collapsed');
    var collapsed = els.docPanel.classList.contains('doc-panel-collapsed');
    els.docPanelToggle.innerHTML = collapsed ? '&#9650;' : '&#9660;';
    els.docPanelToggle.title = collapsed ? 'Expand' : 'Minimize';
  });

  function renderDocPanel() {
    els.docPanelList.innerHTML = '';
    if (state.projectDocs.length === 0) {
      els.docPanelList.innerHTML = '<div class="doc-panel-empty">No documents yet.<br>Upload via the paperclip button or drag and drop.</div>';
      return;
    }
    for (var i = 0; i < state.projectDocs.length; i++) {
      var doc = state.projectDocs[i];
      var item = document.createElement('div');
      item.className = 'dp-item';
      item.setAttribute('data-testid', 'dp-doc-' + doc.id);
      item.innerHTML = '<span class="dp-icon">&#128196;</span>' +
        '<div class="dp-info"><div class="dp-name">' + esc(doc.name) + '</div><div class="dp-words">' + (doc.word_count || '?') + ' words</div></div>' +
        '<div class="dp-actions">' +
        '<button class="dp-action-btn" title="Inject into chat" data-testid="dp-inject-' + doc.id + '">&#8618;</button>' +
        '<button class="dp-action-btn" title="Move to another project" data-testid="dp-move-' + doc.id + '">&#128259;</button>' +
        '<button class="dp-action-btn" title="Copy to General Library" data-testid="dp-global-' + doc.id + '">&#128218;</button>' +
        '<button class="dp-action-btn dp-delete-btn" title="Delete" data-testid="dp-delete-' + doc.id + '">&#128465;</button>' +
        '</div>';

      (function(d) {
        item.querySelector('[data-testid="dp-inject-' + d.id + '"]').addEventListener('click', function(e) {
          e.stopPropagation();
          injectDocIntoChat(d.id);
        });
        item.querySelector('[data-testid="dp-move-' + d.id + '"]').addEventListener('click', function(e) {
          e.stopPropagation();
          showMoveDocModal(d.id, d.name);
        });
        item.querySelector('[data-testid="dp-global-' + d.id + '"]').addEventListener('click', function(e) {
          e.stopPropagation();
          copyToGlobal(d.id);
        });
        item.querySelector('[data-testid="dp-delete-' + d.id + '"]').addEventListener('click', function(e) {
          e.stopPropagation();
          deleteProjectDoc(d.id, d.name);
        });
        item.addEventListener('click', function() {
          openDocForReading(d.id, d.name);
        });
      })(doc);

      els.docPanelList.appendChild(item);
    }
  }

  async function openDocForReading(docId, docName) {
    try {
      var result = await api('/api/projects/documents/' + docId + '/content');
      if (result && result.raw_content) {
        showArtifact(result.raw_content, result.name || docName, { raw: true });
      } else {
        notify('Document is empty', 'error');
      }
    } catch (err) {
      notify('Failed to open document: ' + err.message, 'error');
    }
  }

  async function deleteProjectDoc(docId, docName) {
    try {
      await api('/api/projects/documents/' + docId, { method: 'DELETE' });
      state.projectDocs = state.projectDocs.filter(function(d) { return d.id !== docId; });
      renderDocPanel();
      notify('Deleted "' + docName + '"', 'success');
    } catch (err) {
      notify('Delete failed: ' + err.message, 'error');
    }
  }

  function showMoveDocModal(docId, docName) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-bg';
    overlay.style.display = 'flex';
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '400px';
    modal.innerHTML = '<div class="modal-head"><span class="modal-title">Move Document</span><button class="modal-x" data-testid="close-move-modal">&times;</button></div>' +
      '<div style="padding:16px"><p style="margin:0 0 12px;font-size:13px;color:#6b7280">Move "<strong>' + esc(docName) + '</strong>" to:</p>' +
      '<div id="move-project-list" data-testid="move-project-list" style="max-height:300px;overflow-y:auto"></div></div>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var listEl = modal.querySelector('#move-project-list');
    var projects = state.projects || [];
    for (var i = 0; i < projects.length; i++) {
      if (state.currentProject && projects[i].id === state.currentProject.id) continue;
      var btn = document.createElement('button');
      btn.className = 'move-project-btn';
      btn.setAttribute('data-testid', 'move-to-' + projects[i].id);
      btn.textContent = projects[i].name;
      (function(proj) {
        btn.addEventListener('click', function() {
          moveDocToProject(docId, docName, proj.id, proj.name, overlay);
        });
      })(projects[i]);
      listEl.appendChild(btn);
    }
    if (listEl.children.length === 0) {
      listEl.innerHTML = '<p style="color:#9ca3af;font-size:13px;text-align:center">No other projects to move to</p>';
    }

    modal.querySelector('[data-testid="close-move-modal"]').addEventListener('click', function() {
      document.body.removeChild(overlay);
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
  }

  async function moveDocToProject(docId, docName, targetProjectId, targetProjectName, overlay) {
    try {
      await api('/api/projects/documents/' + docId + '/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProjectId: targetProjectId })
      });
      state.projectDocs = state.projectDocs.filter(function(d) { return d.id !== docId; });
      renderDocPanel();
      if (overlay && overlay.parentNode) document.body.removeChild(overlay);
      notify('Moved "' + docName + '" to ' + targetProjectName, 'success');
    } catch (err) {
      notify('Move failed: ' + err.message, 'error');
    }
  }

  async function injectDocIntoChat(docId) {
    if (state.streaming) {
      notify('Wait for the current response to finish', 'error');
      return;
    }
    await ensureSession();
    if (!state.currentSession) return;

    try {
      var result = await api('/api/documents/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: docId, scope: 'project' })
      });
      if (!result || !result.raw_content) return;

      var wordCount = result.raw_content.split(/\s+/).length;
      var previewText = result.raw_content.substring(0, 300);
      addDocUploadCard(result.name, wordCount, previewText, docId);

      state.streaming = true;
      els.btnSend.disabled = true;

      var claudeMsg = 'The user wants to discuss the document "' + result.name + '" (' + wordCount + ' words). Here is its full content:\n\n' + result.raw_content + '\n\nPlease acknowledge you have loaded this document, briefly summarize it, and let the user know you are ready for questions or instructions about it.';

      var textEl = startStreaming();
      var chatResp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.currentSession.id,
          projectId: state.currentProject.id,
          message: claudeMsg
        })
      });

      streamSSE(chatResp, textEl, function() {
        state.streaming = false;
        els.btnSend.disabled = false;
      });
    } catch (err) {
      notify('Failed to load document', 'error');
      state.streaming = false;
      els.btnSend.disabled = false;
    }
  }

  function renderAttachmentChips() {
    var container = document.getElementById('attached-files');
    container.innerHTML = '';
    for (var i = 0; i < state.pendingAttachments.length; i++) {
      (function(idx) {
        var att = state.pendingAttachments[idx];
        var chip = document.createElement('div');
        chip.className = 'attached-chip' + (att.uploading ? ' uploading' : '');
        chip.setAttribute('data-testid', 'attached-chip-' + idx);
        chip.innerHTML = '<span class="attached-chip-icon">&#128196;</span>' +
          '<span class="attached-chip-name">' + esc(att.name) + '</span>' +
          (att.uploading ? '<span style="font-size:11px">uploading...</span>' : '<span style="font-size:11px;color:#6b7280">' + (att.wordCount || 0).toLocaleString() + ' words</span>') +
          '<button class="attached-chip-remove" data-testid="remove-attachment-' + idx + '" title="Remove">&times;</button>';
        chip.querySelector('.attached-chip-remove').addEventListener('click', function() {
          state.pendingAttachments.splice(idx, 1);
          renderAttachmentChips();
        });
        container.appendChild(chip);
      })(i);
    }
  }

  async function uploadFile(file) {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    var allowed = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];
    var ext = '.' + file.name.split('.').pop().toLowerCase();
    if (allowed.indexOf(ext) === -1) {
      notify('Unsupported file type. Use PDF, DOCX, DOC, TXT, or image files.', 'error');
      return;
    }
    var isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'].indexOf(ext) !== -1;
    if (isImage) notify('Running OCR on image...', 'info');

    var placeholderIdx = state.pendingAttachments.length;
    state.pendingAttachments.push({ name: file.name, uploading: true, wordCount: 0, content: '', docId: null });
    renderAttachmentChips();

    var fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', state.currentProject.id);

    try {
      notify('Uploading ' + file.name + '...', 'info');
      var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(await resp.text());
      var docData = await resp.json();

      var wordCount = docData.raw_content ? docData.raw_content.split(/\s+/).length : 0;

      var att = state.pendingAttachments[placeholderIdx];
      if (att && att.name === file.name) {
        att.uploading = false;
        att.wordCount = wordCount;
        att.content = docData.raw_content || '';
        att.docId = docData.id;
        att.docName = docData.name;
      }
      renderAttachmentChips();
      loadProjectDocs();
      notify(file.name + ' attached', 'info');
    } catch (err) {
      state.pendingAttachments.splice(placeholderIdx, 1);
      renderAttachmentChips();
      notify('Upload failed: ' + err.message, 'error');
    }
  }

  async function uploadAndAutoAnalyze(file) {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    var allowed = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];
    var ext = '.' + file.name.split('.').pop().toLowerCase();
    if (allowed.indexOf(ext) === -1) {
      notify('Unsupported file type. Use PDF, DOCX, DOC, TXT, or image files.', 'error');
      return;
    }
    var isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'].indexOf(ext) !== -1;
    if (isImage) notify('Running OCR on image...', 'info');

    await ensureSession();
    if (!state.currentSession) return;

    var fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', state.currentProject.id);

    try {
      notify('Uploading ' + file.name + '...', 'info');
      var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(await resp.text());
      var docData = await resp.json();

      var wordCount = docData.raw_content ? docData.raw_content.split(/\s+/).length : 0;
      var previewText = docData.raw_content ? docData.raw_content.substring(0, 300) : '';

      var cardDiv = addDocUploadCard(docData.name, wordCount, previewText, docData.id);

      loadProjectDocs();

      state.streaming = true;
      els.btnSend.disabled = true;

      var claudeMsg = 'The user just uploaded a document called "' + docData.name + '" (' + wordCount + ' words). Here is its full content:\n\n' + docData.raw_content + '\n\nPlease analyze this document. Summarize its key points, structure, and purpose. Then let the user know you are ready for any questions or instructions about it.';

      var textEl = startStreaming();
      var chatResp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.currentSession.id,
          projectId: state.currentProject.id,
          message: claudeMsg
        })
      });

      streamSSE(chatResp, textEl, function() {
        state.streaming = false;
        els.btnSend.disabled = false;
        var statusEl = cardDiv.querySelector('.duc-status');
        if (statusEl) statusEl.textContent = '\u2705 Claude has analyzed this document. Use the buttons below or ask questions in the chat.';
      });
    } catch (err) {
      notify('Upload failed: ' + err.message, 'error');
      state.streaming = false;
      els.btnSend.disabled = false;
    }
  }

  var librarySelection = {};
  var cachedGlobalDocs = [];

  function updateLibrarySelectionUI() {
    var ids = Object.keys(librarySelection).filter(function(k) { return librarySelection[k]; });
    var countEl = document.getElementById('library-selected-count');
    var footer = document.getElementById('library-footer');
    if (ids.length > 0) {
      footer.style.display = 'flex';
      countEl.textContent = ids.length + ' document' + (ids.length > 1 ? 's' : '') + ' selected';
    } else {
      footer.style.display = 'none';
    }
  }

  var libSortMode = { global: 'newest', project: 'newest' };

  function sortDocs(docs, mode) {
    var sorted = docs.slice();
    if (mode === 'newest') sorted.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    else if (mode === 'oldest') sorted.sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    else if (mode === 'az') sorted.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    else if (mode === 'za') sorted.sort(function(a, b) { return (b.name || '').localeCompare(a.name || ''); });
    else if (mode === 'largest') sorted.sort(function(a, b) { return (b.word_count || 0) - (a.word_count || 0); });
    else if (mode === 'smallest') sorted.sort(function(a, b) { return (a.word_count || 0) - (b.word_count || 0); });
    return sorted;
  }

  function filterLibraryDocs(docs, query, listEl, makeFn, libType) {
    listEl.innerHTML = '';
    var q = (query || '').toLowerCase().trim();
    var keywords = q ? q.split(/\s+/) : [];
    var filtered = docs.filter(function(d) {
      if (keywords.length === 0) return true;
      var name = (d.name || '').toLowerCase();
      return keywords.every(function(kw) { return name.indexOf(kw) !== -1; });
    });
    filtered = sortDocs(filtered, libSortMode[libType || 'global']);
    if (filtered.length === 0) {
      listEl.innerHTML = q
        ? '<li class="empty-state">No documents match "' + esc(q) + '"</li>'
        : '<li class="empty-state">No documents yet.<br>Upload files to add them.</li>';
    } else {
      for (var i = 0; i < filtered.length; i++) {
        makeFn(listEl, filtered[i]);
      }
    }
  }

  function refreshLibView(libType) {
    if (libType === 'global') {
      var q = document.getElementById('lib-search-global').value;
      filterLibraryDocs(cachedGlobalDocs, q, els.globalDocs, makeGlobalDocItem, 'global');
    } else {
      var q2 = document.getElementById('lib-search-project').value;
      filterLibraryDocs(cachedProjectDocs, q2, document.getElementById('project-lib-docs'), makeProjectDocItem, 'project');
    }
  }

  async function openGlobalLibrary() {
    els.libraryModal.classList.add('active');
    els.globalDocs.innerHTML = '<li class="empty-state">Loading...</li>';
    librarySelection = {};
    updateLibrarySelectionUI();
    var searchInput = document.getElementById('lib-search-global');
    searchInput.value = '';

    try {
      cachedGlobalDocs = await api('/api/documents/global');
      filterLibraryDocs(cachedGlobalDocs, '', els.globalDocs, makeGlobalDocItem, 'global');
    } catch (err) {
      notify('Failed to load library', 'error');
    }
  }

  var projectLibSelection = {};
  var cachedProjectDocs = [];

  function updateProjectLibSelectionUI() {
    var ids = Object.keys(projectLibSelection).filter(function(k) { return projectLibSelection[k]; });
    var countEl = document.getElementById('project-library-selected-count');
    var footer = document.getElementById('project-library-footer');
    if (ids.length > 0) {
      footer.style.display = 'flex';
      countEl.textContent = ids.length + ' document' + (ids.length > 1 ? 's' : '') + ' selected';
    } else {
      footer.style.display = 'none';
    }
  }

  async function openProjectLibrary() {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    var modal = document.getElementById('project-library-modal');
    modal.classList.add('active');
    var listEl = document.getElementById('project-lib-docs');
    listEl.innerHTML = '<li class="empty-state">Loading...</li>';
    projectLibSelection = {};
    updateProjectLibSelectionUI();
    document.getElementById('project-library-title').innerHTML = '&#128194; ' + esc(state.currentProject.name) + ' — Library';
    var searchInput = document.getElementById('lib-search-project');
    searchInput.value = '';

    try {
      cachedProjectDocs = await api('/api/projects/' + state.currentProject.id + '/documents');
      filterLibraryDocs(cachedProjectDocs, '', listEl, makeProjectDocItem, 'project');
    } catch (err) {
      notify('Failed to load project documents', 'error');
    }
  }

  function makeProjectDocItem(list, doc) {
    var li = document.createElement('li');
    li.className = 'doc-item lib-selectable';
    li.setAttribute('data-testid', 'project-doc-' + doc.id);
    li.setAttribute('data-doc-id', doc.id);
    var wc = doc.word_count ? doc.word_count.toLocaleString() + ' words' : '';
    li.innerHTML = '<label class="lib-checkbox-wrap"><input type="checkbox" class="lib-checkbox" data-testid="plib-check-' + doc.id + '"></label>' +
      '<div class="doc-left"><span class="doc-icon">&#128196;</span><span class="doc-name">' + esc(doc.name) + '</span></div>' +
      '<span class="doc-meta-right">' + esc(wc) + '</span>' +
      '<button class="lib-download-btn" data-testid="plib-download-' + doc.id + '" title="Download">&#11015;</button>' +
      '<button class="lib-delete-btn" data-testid="plib-delete-' + doc.id + '" title="Delete">&#128465;</button>';

    var checkbox = li.querySelector('.lib-checkbox');
    checkbox.addEventListener('change', function() {
      projectLibSelection[doc.id] = checkbox.checked;
      li.classList.toggle('lib-selected', checkbox.checked);
      updateProjectLibSelectionUI();
    });

    li.querySelector('.lib-download-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      window.open('/api/projects/documents/' + doc.id + '/download', '_blank');
    });

    li.querySelector('.lib-delete-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      api('/api/projects/documents/' + doc.id, { method: 'DELETE' })
        .then(function() {
          li.remove();
          delete projectLibSelection[doc.id];
          updateProjectLibSelectionUI();
          notify('Document deleted');
          loadProjectDocs();
        })
        .catch(function() { notify('Failed to delete document', 'error'); });
    });

    li.addEventListener('click', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.classList.contains('lib-download-btn') || e.target.classList.contains('lib-delete-btn')) return;
      checkbox.checked = !checkbox.checked;
      projectLibSelection[doc.id] = checkbox.checked;
      li.classList.toggle('lib-selected', checkbox.checked);
      updateProjectLibSelectionUI();
    });

    list.appendChild(li);
  }

  function makeGlobalDocItem(list, doc) {
    var li = document.createElement('li');
    li.className = 'doc-item lib-selectable';
    li.setAttribute('data-testid', 'global-doc-' + doc.id);
    li.setAttribute('data-doc-id', doc.id);
    var wc = doc.word_count ? doc.word_count.toLocaleString() + ' words' : '';
    li.innerHTML = '<label class="lib-checkbox-wrap"><input type="checkbox" class="lib-checkbox" data-testid="lib-check-' + doc.id + '"></label>' +
      '<div class="doc-left"><span class="doc-icon">&#128196;</span><span class="doc-name">' + esc(doc.name) + '</span></div>' +
      '<span class="doc-meta-right">' + esc(wc) + '</span>' +
      '<button class="lib-download-btn" data-testid="lib-download-' + doc.id + '" title="Download">&#11015;</button>' +
      '<button class="lib-delete-btn" data-testid="lib-delete-' + doc.id + '" title="Delete">&#128465;</button>';

    var checkbox = li.querySelector('.lib-checkbox');
    checkbox.addEventListener('change', function() {
      librarySelection[doc.id] = checkbox.checked;
      li.classList.toggle('lib-selected', checkbox.checked);
      updateLibrarySelectionUI();
    });

    li.querySelector('.lib-download-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      window.open('/api/documents/global/' + doc.id + '/download', '_blank');
    });

    li.querySelector('.lib-delete-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      api('/api/documents/global/' + doc.id, { method: 'DELETE' })
        .then(function() {
          li.remove();
          delete librarySelection[doc.id];
          updateLibrarySelectionUI();
          notify('Document deleted');
          if (els.globalDocs.children.length === 0) {
            els.globalDocs.innerHTML = '<li class="empty-state">No documents in the general library yet.<br>Use the upload button above to add documents.</li>';
          }
        })
        .catch(function() { notify('Failed to delete document', 'error'); });
    });

    li.addEventListener('click', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.classList.contains('lib-download-btn') || e.target.classList.contains('lib-delete-btn')) return;
      checkbox.checked = !checkbox.checked;
      librarySelection[doc.id] = checkbox.checked;
      li.classList.toggle('lib-selected', checkbox.checked);
      updateLibrarySelectionUI();
    });

    list.appendChild(li);
  }

  async function sendSelectedDocs() {
    var ids = Object.keys(librarySelection).filter(function(k) { return librarySelection[k]; });
    if (ids.length === 0) return;
    if (state.streaming) {
      notify('Wait for current response to finish', 'error');
      return;
    }
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }

    els.libraryModal.classList.remove('active');
    await ensureSession();
    if (!state.currentSession) return;

    var attached = 0;
    for (var i = 0; i < ids.length; i++) {
      try {
        var result = await api('/api/documents/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: ids[i], scope: 'global' })
        });
        if (result && result.raw_content && result.raw_content.trim().length > 0) {
          var wc = result.raw_content.split(/\s+/).length;
          state.pendingAttachments.push({
            docName: result.name,
            name: result.name,
            wordCount: wc,
            content: result.raw_content,
            docId: result.id || ids[i],
            uploading: false
          });
          attached++;
        } else if (result) {
          notify('"' + result.name + '" has no content — skipped', 'error');
        }
      } catch (err) {
        notify('Failed to load doc: ' + err.message, 'error');
      }
    }

    if (attached === 0) {
      notify('No documents with content to attach', 'error');
      return;
    }

    renderAttachmentChips();
    notify(attached + ' document' + (attached > 1 ? 's' : '') + ' attached. Type your question and press Send.', 'success');
    if (els.chatInput) {
      els.chatInput.focus();
    }
  }

  function showWritePaperModal() {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }

    var inputText = els.chatInput.value.trim();
    var defaultTitle = inputText || state.currentProject.name + ' Paper';
    var defaultInstructions = inputText || 'Write a comprehensive paper using all available project documents and conversation context.';

    var modal = document.createElement('div');
    modal.className = 'modal-bg active';
    modal.style.zIndex = '600';

    var inner = '<div class="modal" style="width:560px"><div class="modal-head"><span class="modal-title">&#128221; Write Paper</span><button class="modal-x" data-close>&times;</button></div><div class="modal-body">';
    inner += '<label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Title</label>';
    inner += '<input type="text" class="text-input" data-field="title" value="' + esc(defaultTitle) + '" data-testid="paper-title" style="margin-bottom:12px">';
    inner += '<label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Instructions</label>';
    inner += '<textarea class="text-input" data-field="instructions" data-testid="paper-instructions" style="min-height:80px;resize:vertical;margin-bottom:12px;font-family:inherit">' + esc(defaultInstructions) + '</textarea>';
    inner += '<div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Source Documents <span style="font-weight:400;color:#9ca3af">(select from library)</span></label>';
    inner += '<div data-testid="paper-doc-list" style="max-height:180px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;padding:2px 0">';
    inner += '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:12px">Loading documents...</div></div>';
    inner += '<div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button class="sidebar-btn" data-testid="paper-upload-btn" style="flex:0 0 auto" type="button">&#128194; Upload New</button>';
    inner += '<span data-testid="paper-upload-info" style="font-size:12px;color:#6b7280;flex:1"></span></div>';
    inner += '<input type="file" data-testid="paper-file-input" accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg,.gif,.bmp,.tiff,.tif,.webp" style="display:none"></div>';
    inner += '<div style="margin-bottom:12px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">';
    inner += '<input type="checkbox" data-field="fetchResearch" data-testid="paper-fetch-research" style="margin:0;width:16px;height:16px">';
    inner += '<span><strong style="color:#1d4ed8">Fetch Scholarly Sources</strong> <span style="color:#6b7280;font-weight:400">— search Semantic Scholar, OpenAlex, CrossRef, PubMed for real citations</span></span>';
    inner += '</label></div>';
    inner += '<div style="display:flex;gap:12px;margin-bottom:12px">';
    inner += '<div style="flex:1"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Words <span style="font-weight:400;color:#9ca3af">(leave blank for auto)</span></label>';
    inner += '<input type="number" class="text-input" data-field="wordcount" placeholder="Auto" min="500" max="100000" data-testid="paper-wordcount"></div>';
    inner += '<div style="flex:1"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Type</label>';
    inner += '<select class="text-input" data-field="doctype" data-testid="paper-doctype"><option value="research_paper">Research Paper</option><option value="legal_brief">Legal Brief</option><option value="rewrite">Rewrite / Polish</option><option value="dissertation">Dissertation</option><option value="whitepaper">Whitepaper</option><option value="essay">Essay</option><option value="report">Report</option><option value="letter">Letter</option><option value="book_chapter">Book Chapter</option><option value="other">Other</option></select></div>';
    inner += '</div>';
    inner += '</div><div class="modal-foot"><button class="btn-cancel" data-close>Cancel</button><button class="btn-ok" data-testid="btn-start-paper" style="background:#7c3aed">&#128221; Generate</button></div></div>';
    modal.innerHTML = inner;

    modal.querySelectorAll('[data-close]').forEach(function(b) {
      b.addEventListener('click', function() { modal.remove(); });
    });
    modal.querySelector('.modal').addEventListener('mousedown', function(e) {
      e.stopPropagation();
    });
    modal.addEventListener('mousedown', function(e) { if (e.target === modal) modal.remove(); });

    var paperDocList = modal.querySelector('[data-testid="paper-doc-list"]');
    var paperUploadBtn = modal.querySelector('[data-testid="paper-upload-btn"]');
    var paperFileInput = modal.querySelector('[data-testid="paper-file-input"]');
    var paperUploadInfo = modal.querySelector('[data-testid="paper-upload-info"]');
    var selectedDocs = [];

    function renderDocList(projectDocs, globalDocs) {
      var html = '';
      if (projectDocs.length === 0 && globalDocs.length === 0) {
        html = '<div style="text-align:center;color:#9ca3af;font-size:12px;padding:12px">No documents in library. Upload one below.</div>';
        paperDocList.innerHTML = html;
        return;
      }
      if (projectDocs.length > 0) {
        html += '<div style="padding:4px 10px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;background:#f3f4f6">Project Documents</div>';
        for (var i = 0; i < projectDocs.length; i++) {
          var d = projectDocs[i];
          var wc = d.word_count ? Number(d.word_count).toLocaleString() + ' words' : '';
          html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #f3f4f6" data-testid="paper-doc-item-' + d.id + '">';
          html += '<input type="checkbox" data-doc-id="' + d.id + '" data-doc-source="project" data-doc-name="' + esc(d.name) + '" style="margin:0">';
          html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">&#128196; ' + esc(d.name) + '</span>';
          html += '<span style="font-size:11px;color:#9ca3af;flex-shrink:0">' + wc + '</span>';
          html += '</label>';
        }
      }
      if (globalDocs.length > 0) {
        html += '<div style="padding:4px 10px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;background:#f3f4f6">General Library</div>';
        for (var g = 0; g < globalDocs.length; g++) {
          var gd = globalDocs[g];
          var gwc = gd.word_count ? Number(gd.word_count).toLocaleString() + ' words' : '';
          html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #f3f4f6" data-testid="paper-doc-item-' + gd.id + '">';
          html += '<input type="checkbox" data-doc-id="' + gd.id + '" data-doc-source="global" data-doc-name="' + esc(gd.name) + '" style="margin:0">';
          html += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">&#128218; ' + esc(gd.name) + '</span>';
          html += '<span style="font-size:11px;color:#9ca3af;flex-shrink:0">' + gwc + '</span>';
          html += '</label>';
        }
      }
      paperDocList.innerHTML = html;
    }

    (async function loadPaperDocs() {
      try {
        var pDocs = await api('/api/projects/' + state.currentProject.id + '/documents');
        var gDocs = await api('/api/documents/global');
        renderDocList(pDocs || [], gDocs || []);
      } catch (err) {
        paperDocList.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:12px;padding:12px">Failed to load documents</div>';
      }
    })();

    paperUploadBtn.addEventListener('click', function() {
      paperFileInput.click();
    });

    paperFileInput.addEventListener('change', async function() {
      var file = paperFileInput.files[0];
      if (!file) return;
      paperFileInput.value = '';
      paperUploadInfo.textContent = 'Uploading ' + file.name + '...';

      var fd = new FormData();
      fd.append('file', file);
      fd.append('projectId', state.currentProject.id);
      try {
        var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
        if (!resp.ok) throw new Error(await resp.text());
        var docData = await resp.json();
        paperUploadInfo.innerHTML = '&#9989; Uploaded <strong>' + esc(docData.name) + '</strong>';
        var pDocs = await api('/api/projects/' + state.currentProject.id + '/documents');
        var gDocs = await api('/api/documents/global');
        renderDocList(pDocs || [], gDocs || []);
        var newCheckbox = paperDocList.querySelector('[data-doc-id="' + docData.id + '"]');
        if (newCheckbox) newCheckbox.checked = true;
      } catch (err) {
        paperUploadInfo.textContent = 'Upload failed: ' + err.message;
      }
    });

    modal.querySelector('[data-testid="btn-start-paper"]').addEventListener('click', async function() {
      var title = modal.querySelector('[data-field="title"]').value.trim();
      var instructions = modal.querySelector('[data-field="instructions"]').value.trim();
      var wcVal = modal.querySelector('[data-field="wordcount"]').value.trim();
      var wordcount = wcVal ? parseInt(wcVal) : 0;
      var doctype = modal.querySelector('[data-field="doctype"]').value;
      var fetchResearch = modal.querySelector('[data-field="fetchResearch"]').checked;

      if (!title && !instructions) {
        notify('Enter at least a title or instructions', 'error');
        return;
      }

      var checkboxes = paperDocList.querySelectorAll('input[type="checkbox"]:checked');
      selectedDocs = [];
      var docNames = [];
      for (var ci = 0; ci < checkboxes.length; ci++) {
        if (checkboxes[ci].getAttribute('data-doc-id')) {
          selectedDocs.push({
            id: checkboxes[ci].getAttribute('data-doc-id'),
            source: checkboxes[ci].getAttribute('data-doc-source'),
            name: checkboxes[ci].getAttribute('data-doc-name')
          });
          docNames.push(checkboxes[ci].getAttribute('data-doc-name'));
        }
      }

      modal.remove();
      els.chatInput.value = '';
      await ensureSession();
      if (!state.currentSession) return;

      var desc = wordcount
        ? 'Generate a ' + wordcount + '-word ' + doctype.replace(/_/g, ' ') + ': "' + (title || 'Untitled') + '"'
        : 'Generate a ' + doctype.replace(/_/g, ' ') + ' (auto length): "' + (title || 'Untitled') + '"';
      if (docNames.length > 0) desc += '\nSource documents: ' + docNames.join(', ');
      if (fetchResearch) desc += '\n[Scholarly research enabled]';
      addMessage('user', desc);
      scrollBottom();

      runCoherence({
        title: title,
        instructions: instructions,
        wordcount: wordcount,
        doctype: doctype,
        selectedDocs: selectedDocs,
        fetchResearch: fetchResearch
      });
    });

    document.body.appendChild(modal);
    modal.querySelector('[data-field="title"]').focus();
  }

  function showMoveSessionModal() {
    if (!state.currentSession) {
      notify('No active session to move', 'error');
      return;
    }
    var modal = document.createElement('div');
    modal.className = 'modal-bg active';
    modal.style.zIndex = '600';
    var inner = '<div class="modal" style="width:420px"><div class="modal-head"><span class="modal-title">Move session to project</span><button class="modal-x" data-close>&times;</button></div><div class="modal-body">';
    inner += '<p style="font-size:13px;color:#6b7280;margin-bottom:12px">Move this conversation (and all its history) to an existing project, or create a new one.</p>';
    inner += '<div style="margin-bottom:12px"><div style="display:flex;gap:8px"><input type="text" class="text-input" placeholder="New project name..." data-testid="move-new-project-input" style="flex:1"><button class="btn-ok" data-testid="move-create-project" style="white-space:nowrap">+ Create &amp; Move</button></div></div>';
    inner += '<div class="doc-label">Existing Projects</div><ul class="doc-list">';
    for (var i = 0; i < state.projects.length; i++) {
      var p = state.projects[i];
      var isCurrent = state.currentProject && p.id === state.currentProject.id;
      inner += '<li class="doc-item' + (isCurrent ? '' : '') + '" data-project-id="' + p.id + '" data-testid="move-session-to-' + p.id + '">';
      inner += '<div class="doc-left"><span class="doc-icon">&#128193;</span><span class="doc-name">' + esc(p.name) + (isCurrent ? ' (current)' : '') + '</span></div></li>';
    }
    inner += '</ul></div></div>';
    modal.innerHTML = inner;

    modal.querySelector('[data-close]').addEventListener('click', function() { modal.remove(); });
    modal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });
    modal.addEventListener('mousedown', function(e) { if (e.target === modal) modal.remove(); });

    var newInput = modal.querySelector('[data-testid="move-new-project-input"]');
    modal.querySelector('[data-testid="move-create-project"]').addEventListener('click', async function() {
      var name = newInput.value.trim();
      if (!name) { notify('Enter a project name', 'error'); return; }
      try {
        var newProj = await api('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name })
        });
        await moveSessionToProject(newProj.id);
        modal.remove();
        await loadProjects();
        selectProject(newProj);
      } catch (err) {
        notify('Failed: ' + err.message, 'error');
      }
    });

    newInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') modal.querySelector('[data-testid="move-create-project"]').click();
    });

    var items = modal.querySelectorAll('[data-project-id]');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', async function() {
        var targetId = this.getAttribute('data-project-id');
        if (state.currentProject && targetId === state.currentProject.id) {
          notify('Session is already in this project', 'info');
          return;
        }
        try {
          await moveSessionToProject(targetId);
          modal.remove();
          var targetProj = state.projects.find(function(p) { return p.id === targetId; });
          if (targetProj) {
            await loadProjects();
            selectProject(targetProj);
          }
        } catch (err) {
          notify('Failed: ' + err.message, 'error');
        }
      });
    }

    document.body.appendChild(modal);
    newInput.focus();
  }

  async function moveSessionToProject(targetProjectId) {
    await api('/api/sessions/' + state.currentSession.id + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetProjectId: targetProjectId })
    });
    notify('Session moved successfully', 'success');
  }

  function autoResize() {
    els.chatInput.style.height = 'auto';
    els.chatInput.style.height = Math.min(els.chatInput.scrollHeight, 300) + 'px';
  }

  els.chatInput.addEventListener('input', autoResize);

  (function setupMicRecording() {
    var micBtn = document.getElementById('btn-mic');
    if (!micBtn) return;
    var mediaRecorder = null;
    var chunks = [];
    var stream = null;
    var startTime = 0;
    var timerInterval = null;
    var timerEl = null;
    var micState = 'idle';
    var MAX_SEC = 120;

    function forceStopStream() {
      try { if (stream) stream.getTracks().forEach(function(t) { try { t.stop(); } catch (e) {} }); } catch (e) {}
      stream = null;
    }
    window.addEventListener('beforeunload', forceStopStream);
    document.addEventListener('visibilitychange', function() {
      if (document.hidden && micState === 'recording') stopRecording();
    });

    function showTimer() {
      timerEl = document.createElement('div');
      timerEl.className = 'mic-timer';
      timerEl.textContent = '0:00';
      document.body.appendChild(timerEl);
      var rect = micBtn.getBoundingClientRect();
      timerEl.style.left = (rect.left + rect.width / 2) + 'px';
      timerEl.style.top = rect.top + 'px';
      timerInterval = setInterval(function() {
        if (!timerEl) return;
        var s = Math.floor((Date.now() - startTime) / 1000);
        var mm = Math.floor(s / 60);
        var ss = s % 60;
        timerEl.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
        if (s >= MAX_SEC) stopRecording();
      }, 250);
    }
    function hideTimer() {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      if (timerEl && timerEl.parentNode) timerEl.parentNode.removeChild(timerEl);
      timerEl = null;
    }

    async function startRecording() {
      if (micState !== 'idle') return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        notify('Voice input not supported in this browser', 'error');
        return;
      }
      micState = 'starting';
      forceStopStream();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        micState = 'idle';
        notify('Microphone access denied', 'error');
        return;
      }
      if (micState !== 'starting') { forceStopStream(); return; }
      var mimeOpts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', ''];
      var chosen = '';
      for (var i = 0; i < mimeOpts.length; i++) {
        if (!mimeOpts[i] || (window.MediaRecorder && MediaRecorder.isTypeSupported(mimeOpts[i]))) { chosen = mimeOpts[i]; break; }
      }
      try {
        mediaRecorder = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
      } catch (err) {
        micState = 'idle';
        notify('Could not start recorder: ' + err.message, 'error');
        forceStopStream();
        return;
      }
      chunks = [];
      mediaRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.onstop = function() { handleStop(); };
      mediaRecorder.start();
      micState = 'recording';
      startTime = Date.now();
      micBtn.classList.add('recording');
      micBtn.title = 'Click again to stop & transcribe';
      showTimer();
    }

    function stopRecording() {
      if (micState !== 'recording' || !mediaRecorder) return;
      micState = 'stopping';
      micBtn.disabled = true;
      micBtn.classList.remove('recording');
      hideTimer();
      try { mediaRecorder.stop(); } catch (e) { forceStopStream(); micState = 'idle'; micBtn.disabled = false; }
    }

    async function handleStop() {
      micState = 'transcribing';
      forceStopStream();
      var elapsed = (Date.now() - startTime) / 1000;
      if (elapsed < 0.5 || chunks.length === 0) {
        chunks = [];
        notify('Recording too short', 'error');
        micBtn.classList.remove('transcribing');
        micBtn.disabled = false;
        micState = 'idle';
        return;
      }
      var blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
      chunks = [];
      micBtn.classList.add('transcribing');
      micBtn.disabled = true;
      micBtn.title = 'Transcribing...';
      try {
        var fd = new FormData();
        var ext = (blob.type.indexOf('mp4') >= 0) ? 'm4a' : (blob.type.indexOf('ogg') >= 0 ? 'ogg' : 'webm');
        fd.append('audio', blob, 'voice.' + ext);
        var resp = await fetch('/api/transcribe', { method: 'POST', body: fd });
        var json = await resp.json();
        if (!resp.ok) {
          notify('Transcription failed: ' + (json.error || resp.status), 'error');
        } else {
          var text = (json.text || '').trim();
          if (!text) {
            notify('No speech detected', 'error');
          } else {
            var current = els.chatInput.value;
            els.chatInput.value = current ? (current.replace(/\s+$/, '') + ' ' + text) : text;
            els.chatInput.focus();
            try { autoResize(); } catch (e) {}
            notify('Transcribed ' + text.length + ' chars', 'success');
          }
        }
      } catch (err) {
        notify('Transcription error: ' + err.message, 'error');
      } finally {
        micBtn.classList.remove('transcribing');
        micBtn.disabled = false;
        micBtn.title = 'Hold or click to record voice (AssemblyAI)';
        micState = 'idle';
      }
    }

    micBtn.addEventListener('click', function() {
      if (micState === 'idle') startRecording();
      else if (micState === 'recording') stopRecording();
    });
  })();

  els.chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && state.streaming && state.abortController) {
      state.abortController.abort();
    }
  });
  els.chatInput.addEventListener('paste', function(e) {
    var items = (e.clipboardData || {}).items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        if (!blob) continue;
        var ext = blob.type.split('/')[1] || 'png';
        if (ext === 'jpeg') ext = 'jpg';
        var fname = 'pasted-image-' + Date.now() + '.' + ext;
        var file = new File([blob], fname, { type: blob.type });
        uploadFile(file);
        break;
      }
    }
  });
  els.btnSend.addEventListener('click', sendMessage);

  document.querySelectorAll('.rl-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.rl-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.responseLength = btn.getAttribute('data-length');
    });
  });

  var twInput = document.getElementById('target-words-input');
  if (twInput) {
    twInput.addEventListener('input', function() {
      twInput.classList.toggle('has-value', !!getTargetWords());
    });
  }

  document.querySelectorAll('.rf-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.rf-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.responseFormat = btn.getAttribute('data-format');
    });
  });

  document.querySelectorAll('.rs-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.rs-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.stance = btn.getAttribute('data-stance');
    });
  });

  document.querySelectorAll('.rm-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.rm-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.model = btn.getAttribute('data-model');
      var modelNames = { claude: 'Claude', chatgpt: 'ChatGPT', deepseek: 'DeepSeek', grok: 'Grok', venice: 'Venice' };
      els.chatInput.placeholder = 'Message ' + (modelNames[state.model] || 'Claude') + '...';
    });
  });

  els.btnNewProject.addEventListener('click', function() {
    els.projectModal.classList.add('active');
    els.projectNameInput.value = '';
    els.projectNameInput.focus();
  });

  document.getElementById('confirm-project').addEventListener('click', async function() {
    var name = els.projectNameInput.value.trim();
    if (!name) return;
    try {
      var p = await api('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
      });
      els.projectModal.classList.remove('active');
      await loadProjects();
      selectProject(p);
    } catch (err) {
      notify('Failed to create project', 'error');
    }
  });

  els.projectNameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('confirm-project').click();
  });

  document.getElementById('cancel-project').addEventListener('click', function() {
    els.projectModal.classList.remove('active');
  });
  document.getElementById('close-project-modal').addEventListener('click', function() {
    els.projectModal.classList.remove('active');
  });

  els.btnNewSession.addEventListener('click', async function() {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    try {
      var s = await api('/api/projects/' + state.currentProject.id + '/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat' })
      });
      s.transcript = [];
      state.sessions.unshift(s);
      state.currentSession = s;
      renderSessions();
      showWelcome();
    } catch (err) {
      notify('Failed to create chat', 'error');
    }
  });

  els.btnUpload.addEventListener('click', function() {
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', function() {
    for (var i = 0; i < els.fileInput.files.length; i++) {
      uploadFile(els.fileInput.files[i]);
    }
    els.fileInput.value = '';
  });

  document.getElementById('btn-auto-analyze').addEventListener('click', function() {
    document.getElementById('file-input-analyze').click();
  });
  document.getElementById('file-input-analyze').addEventListener('change', function() {
    var input = document.getElementById('file-input-analyze');
    if (input.files.length > 0) {
      uploadAndAutoAnalyze(input.files[0]);
      input.value = '';
    }
  });

  document.getElementById('btn-download-session').addEventListener('click', function() {
    if (!state.currentSession) {
      notify('No chat session selected', 'error');
      return;
    }
    window.open('/api/sessions/' + state.currentSession.id + '/download', '_blank');
  });
  els.btnMoveSession.addEventListener('click', showMoveSessionModal);
  els.btnWritePaper.addEventListener('click', showWritePaperModal);
  els.btnLibrary.addEventListener('click', openGlobalLibrary);
  document.getElementById('btn-library-sidebar').addEventListener('click', openGlobalLibrary);

  document.getElementById('btn-view-tractatus').addEventListener('click', async function() {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    try {
      var tree = await api('/api/projects/' + state.currentProject.id + '/tractatus');
      var treeText = JSON.stringify(tree, null, 2);
      var title = 'Tractatus Tree — ' + state.currentProject.name;
      showArtifact(treeText, title, { raw: true });
    } catch (err) {
      notify('Failed to load Tractatus tree', 'error');
    }
  });
  document.getElementById('btn-memory-hierarchy').addEventListener('click', async function() {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    try {
      var memory = await api('/api/projects/' + state.currentProject.id + '/memory-hierarchy');
      showMemoryHierarchy(memory);
    } catch (err) {
      notify('Failed to load memory hierarchy', 'error');
    }
  });

  document.getElementById('close-library').addEventListener('click', function() {
    els.libraryModal.classList.remove('active');
  });

  document.getElementById('lib-search-global').addEventListener('input', function() {
    refreshLibView('global');
  });

  document.getElementById('lib-search-project').addEventListener('input', function() {
    refreshLibView('project');
  });

  document.querySelectorAll('.modal-resize-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var modal = btn.closest('.lib-modal-resizable');
      modal.classList.toggle('lib-expanded');
    });
  });

  document.querySelectorAll('.lib-sort-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var libType = btn.getAttribute('data-lib');
      var sortMode = btn.getAttribute('data-sort');
      libSortMode[libType] = sortMode;
      var container = btn.closest('.lib-sort-bar');
      container.querySelectorAll('.lib-sort-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      refreshLibView(libType);
    });
  });

  document.getElementById('btn-project-library').addEventListener('click', openProjectLibrary);

  document.getElementById('close-project-library').addEventListener('click', function() {
    document.getElementById('project-library-modal').classList.remove('active');
  });

  var projLibFileInput = document.getElementById('file-input-project-lib');
  document.getElementById('btn-upload-project-lib').addEventListener('click', function() {
    projLibFileInput.click();
  });
  projLibFileInput.addEventListener('change', async function() {
    if (!state.currentProject) return;
    var files = projLibFileInput.files;
    var uploaded = 0;
    for (var i = 0; i < files.length; i++) {
      var fd = new FormData();
      fd.append('file', files[i]);
      fd.append('projectId', state.currentProject.id);
      try {
        var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
        if (resp.ok) uploaded++;
      } catch (err) {}
    }
    projLibFileInput.value = '';
    if (uploaded > 0) {
      notify('Added ' + uploaded + ' document' + (uploaded > 1 ? 's' : '') + ' to project library', 'success');
      openProjectLibrary();
      loadProjectDocs();
    }
  });

  document.getElementById('btn-send-project-selected').addEventListener('click', async function() {
    var ids = Object.keys(projectLibSelection).filter(function(k) { return projectLibSelection[k]; });
    if (ids.length === 0) return;
    if (state.streaming) { notify('Wait for current response to finish', 'error'); return; }
    if (!state.currentProject) { notify('Select a project first', 'error'); return; }

    document.getElementById('project-library-modal').classList.remove('active');
    await ensureSession();
    if (!state.currentSession) return;

    var attached = 0;
    for (var i = 0; i < ids.length; i++) {
      try {
        var result = await api('/api/documents/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: ids[i], scope: 'project' })
        });
        if (result && result.raw_content && result.raw_content.trim().length > 0) {
          var wc = result.raw_content.split(/\s+/).length;
          state.pendingAttachments.push({
            docName: result.name,
            name: result.name,
            wordCount: wc,
            content: result.raw_content,
            docId: result.id || ids[i],
            uploading: false
          });
          attached++;
        }
      } catch (err) { notify('Failed to load doc: ' + err.message, 'error'); }
    }
    if (attached === 0) { notify('No documents with content to attach', 'error'); return; }

    renderAttachmentChips();
    notify(attached + ' document' + (attached > 1 ? 's' : '') + ' attached. Type your question and press Send.', 'success');
    if (els.chatInput) { els.chatInput.focus(); }
  });

  document.getElementById('btn-copy-to-global').addEventListener('click', async function() {
    var ids = Object.keys(projectLibSelection).filter(function(k) { return projectLibSelection[k]; });
    if (ids.length === 0) return;
    var copied = 0;
    for (var i = 0; i < ids.length; i++) {
      try {
        await api('/api/projects/documents/' + ids[i] + '/copy-to-global', { method: 'POST' });
        copied++;
      } catch (err) {}
    }
    if (copied > 0) notify('Copied ' + copied + ' document' + (copied > 1 ? 's' : '') + ' to General Library', 'success');
  });

  var projLibModal = document.getElementById('project-library-modal');
  var projLibInner = projLibModal.querySelector('.modal');
  projLibInner.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  projLibModal.addEventListener('mousedown', function(e) {
    if (e.target === projLibModal) projLibModal.classList.remove('active');
  });

  projLibInner.addEventListener('dragover', function(e) {
    e.preventDefault(); e.stopPropagation();
    projLibInner.style.outline = '2px dashed #2563eb';
    projLibInner.style.outlineOffset = '-4px';
  });
  projLibInner.addEventListener('dragleave', function() {
    projLibInner.style.outline = ''; projLibInner.style.outlineOffset = '';
  });
  projLibInner.addEventListener('drop', async function(e) {
    e.preventDefault(); e.stopPropagation();
    projLibInner.style.outline = ''; projLibInner.style.outlineOffset = '';
    if (!state.currentProject) return;
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var uploaded = 0;
    for (var fi = 0; fi < files.length; fi++) {
      var fd = new FormData();
      fd.append('file', files[fi]);
      fd.append('projectId', state.currentProject.id);
      try {
        var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
        if (resp.ok) uploaded++;
      } catch (err) {}
    }
    if (uploaded > 0) {
      notify('Added ' + uploaded + ' document' + (uploaded > 1 ? 's' : '') + ' to project library', 'success');
      openProjectLibrary();
      loadProjectDocs();
    }
  });

  // --- Tractator ---
  var reportGenModal = document.getElementById('report-generator-modal');
  var reportGenScope = document.getElementById('report-scope');
  var reportGenInstructions = document.getElementById('report-instructions');
  var reportGenStatus = document.getElementById('report-gen-status');
  var reportGenStatusText = document.getElementById('report-gen-status-text');
  var reportGenFill = document.getElementById('report-gen-fill');
  var reportGenGoBtn = document.getElementById('report-gen-go');

  document.getElementById('btn-report-generator').addEventListener('click', async function() {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    reportGenModal.classList.add('active');
    reportGenStatus.style.display = 'none';
    reportGenGoBtn.disabled = false;
    reportGenInstructions.value = '';
    reportGenFill.style.width = '0%';

    reportGenScope.innerHTML = '<option value="project">Entire Project</option>';
    try {
      var scopes = await api('/api/report/scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: state.currentProject.id })
      });
      for (var i = 1; i < scopes.length; i++) {
        var opt = document.createElement('option');
        opt.value = scopes[i].value;
        opt.textContent = scopes[i].label;
        reportGenScope.appendChild(opt);
      }
    } catch (err) {
      console.error('Failed to load scopes:', err);
    }
  });

  document.getElementById('close-report-gen').addEventListener('click', function() {
    reportGenModal.classList.remove('active');
  });
  document.getElementById('report-gen-cancel').addEventListener('click', function() {
    reportGenModal.classList.remove('active');
  });
  reportGenModal.addEventListener('mousedown', function(e) {
    if (e.target === reportGenModal) reportGenModal.classList.remove('active');
  });
  reportGenModal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });

  reportGenGoBtn.addEventListener('click', async function() {
    if (!state.currentProject) return;
    reportGenGoBtn.disabled = true;
    reportGenStatus.style.display = 'block';
    reportGenStatusText.textContent = 'Starting...';
    reportGenFill.style.width = '10%';

    var scope = reportGenScope.value;
    var instructions = reportGenInstructions.value.trim();
    var fullReport = '';

    try {
      var resp = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: state.currentProject.id,
          scope: scope,
          instructions: instructions
        })
      });

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var chunk = reader.read ? await reader.read() : { done: true };
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line.startsWith('data: ')) continue;
          var data = line.substring(6);
          if (data === '[DONE]') continue;
          try {
            var parsed = JSON.parse(data);
            if (parsed.type === 'status') {
              reportGenStatusText.textContent = parsed.message;
            } else if (parsed.type === 'progress') {
              reportGenFill.style.width = Math.round((parsed.current / parsed.total) * 100) + '%';
            } else if (parsed.type === 'token') {
              fullReport += parsed.text;
            } else if (parsed.type === 'complete') {
              if (parsed.cleanedText) fullReport = parsed.cleanedText;
              reportGenStatusText.textContent = 'Complete! (' + (parsed.totalWords || fullReport.split(/\s+/).length) + ' words)';
              reportGenFill.style.width = '100%';
            } else if (parsed.type === 'error') {
              reportGenStatusText.textContent = 'Error: ' + parsed.error;
            }
          } catch (e) {}
        }
      }

      if (fullReport.trim()) {
        var scopeLabel = reportGenScope.options[reportGenScope.selectedIndex].text;
        var title = 'Report — ' + scopeLabel + ' — ' + (state.currentProject ? state.currentProject.name : 'Project');
        reportGenModal.classList.remove('active');
        showArtifact(fullReport, title, { raw: false });
      }
    } catch (err) {
      reportGenStatusText.textContent = 'Error: ' + err.message;
    }
    reportGenGoBtn.disabled = false;
  });

  var sumModal = document.getElementById('summarize-modal');
  var sumModalTitle = document.getElementById('summarize-modal-title');
  var sumGoBtn = document.getElementById('sum-go');
  var sumStatus = document.getElementById('sum-status');
  var sumStatusText = document.getElementById('sum-status-text');
  var sumHint = document.getElementById('sum-length-hint');
  var sumCustomRow = document.getElementById('sum-custom-row');
  var sumCustomWords = document.getElementById('sum-custom-words');
  var sumScope = 'project';
  var sumChatId = null;
  var sumSelectedLen = 'auto';

  var sumLenBtns = document.querySelectorAll('.sum-len-btn');
  for (var sb = 0; sb < sumLenBtns.length; sb++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        for (var x = 0; x < sumLenBtns.length; x++) sumLenBtns[x].classList.remove('active');
        btn.classList.add('active');
        sumSelectedLen = btn.getAttribute('data-len');
        if (sumSelectedLen === 'auto') {
          sumCustomRow.style.display = 'none';
          sumHint.textContent = 'Auto-calculated based on content size';
        } else if (sumSelectedLen === 'brief') {
          sumCustomRow.style.display = 'none';
          sumHint.textContent = '~150-300 words — key points only';
        } else if (sumSelectedLen === 'moderate') {
          sumCustomRow.style.display = 'none';
          sumHint.textContent = '~500-800 words — balanced coverage';
        } else if (sumSelectedLen === 'detailed') {
          sumCustomRow.style.display = 'block';
          sumHint.textContent = '~1000-2000 words, or specify your own target below';
        }
      });
    })(sumLenBtns[sb]);
  }

  function openSummarizeModal(scope, chatIdVal) {
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    sumScope = scope;
    sumChatId = chatIdVal || null;
    sumModalTitle.innerHTML = scope === 'project' ? '&#128221; Summarize Project' : '&#128196; Summarize Chat';
    sumStatus.style.display = 'none';
    sumGoBtn.disabled = false;
    sumCustomWords.value = '';
    for (var x = 0; x < sumLenBtns.length; x++) {
      sumLenBtns[x].classList.remove('active');
      if (sumLenBtns[x].getAttribute('data-len') === 'auto') sumLenBtns[x].classList.add('active');
    }
    sumSelectedLen = 'auto';
    sumCustomRow.style.display = 'none';
    sumHint.textContent = 'Auto-calculated based on content size';
    sumModal.classList.add('active');
  }

  document.getElementById('btn-summarize-project').addEventListener('click', function() {
    openSummarizeModal('project');
  });

  document.getElementById('btn-summarize-chat').addEventListener('click', function() {
    if (!state.currentSession) {
      notify('Open a chat first', 'error');
      return;
    }
    openSummarizeModal('chat', state.currentSession.id);
  });

  document.getElementById('close-summarize').addEventListener('click', function() {
    sumModal.classList.remove('active');
  });
  document.getElementById('sum-cancel').addEventListener('click', function() {
    sumModal.classList.remove('active');
  });
  sumModal.addEventListener('mousedown', function(e) {
    if (e.target === sumModal) sumModal.classList.remove('active');
  });
  sumModal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });

  sumGoBtn.addEventListener('click', async function() {
    if (!state.currentProject) return;
    sumGoBtn.disabled = true;
    sumStatus.style.display = 'block';
    sumStatusText.textContent = 'Gathering data...';

    var targetWords = 0;
    if (sumSelectedLen === 'brief') targetWords = 200;
    else if (sumSelectedLen === 'moderate') targetWords = 600;
    else if (sumSelectedLen === 'detailed') {
      var custom = parseInt(sumCustomWords.value);
      targetWords = custom > 0 ? custom : 1500;
    }

    var fullSummary = '';

    try {
      var resp = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: state.currentProject.id,
          scope: sumScope,
          chatId: sumChatId,
          targetWords: targetWords
        })
      });

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line.startsWith('data: ')) continue;
          var data = line.substring(6);
          if (data === '[DONE]') continue;
          try {
            var parsed = JSON.parse(data);
            if (parsed.type === 'status') {
              sumStatusText.textContent = parsed.message;
            } else if (parsed.type === 'meta') {
              sumStatusText.textContent = 'Generating ~' + parsed.targetWords + ' word summary from ' + parsed.sourceWords + ' words of content...';
            } else if (parsed.type === 'token') {
              fullSummary += parsed.text;
            } else if (parsed.type === 'complete') {
              if (parsed.cleanedText) fullSummary = parsed.cleanedText;
              sumStatusText.textContent = 'Complete! (' + (parsed.totalWords || fullSummary.split(/\s+/).length) + ' words)';
            } else if (parsed.type === 'error') {
              sumStatusText.textContent = 'Error: ' + parsed.error;
            }
          } catch (e) {}
        }
      }

      if (fullSummary.trim()) {
        var scopeLabel = sumScope === 'project' ? 'Project' : 'Chat';
        var title = scopeLabel + ' Summary — ' + (state.currentProject ? state.currentProject.name : 'Project');
        sumModal.classList.remove('active');
        showArtifact(fullSummary, title, { raw: false });
      }
    } catch (err) {
      sumStatusText.textContent = 'Error: ' + err.message;
    }
    sumGoBtn.disabled = false;
  });

  var tractatorModal = document.getElementById('tractator-modal');
  var tractatorDepth = 0;
  var tractatorSource = null;

  document.getElementById('btn-tractator').addEventListener('click', function() {
    tractatorModal.classList.add('active');
    tractatorSource = null;
    document.getElementById('tractator-source-info').style.display = 'none';
    document.getElementById('tractator-library-pick').style.display = 'none';
    document.getElementById('tractator-status').style.display = 'none';
    document.getElementById('tractator-generate').disabled = true;
    document.getElementById('tractator-fill').style.width = '0%';
  });
  document.getElementById('close-tractator').addEventListener('click', function() {
    tractatorModal.classList.remove('active');
  });
  document.getElementById('tractator-cancel').addEventListener('click', function() {
    tractatorModal.classList.remove('active');
  });
  tractatorModal.addEventListener('mousedown', function(e) {
    if (e.target === tractatorModal) tractatorModal.classList.remove('active');
  });
  tractatorModal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });

  var depthBtns = document.querySelectorAll('.tractator-depth-btn');
  for (var di = 0; di < depthBtns.length; di++) {
    depthBtns[di].addEventListener('click', function() {
      for (var j = 0; j < depthBtns.length; j++) depthBtns[j].classList.remove('active');
      this.classList.add('active');
      tractatorDepth = parseInt(this.getAttribute('data-depth'));
    });
  }

  document.getElementById('tractator-upload-btn').addEventListener('click', function() {
    document.getElementById('tractator-file-input').click();
  });

  document.getElementById('tractator-file-input').addEventListener('change', async function() {
    var file = this.files[0];
    if (!file) return;
    this.value = '';
    var allowed = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];
    var ext = '.' + file.name.split('.').pop().toLowerCase();
    if (allowed.indexOf(ext) === -1) {
      notify('Unsupported file type', 'error');
      return;
    }

    var srcInfo = document.getElementById('tractator-source-info');
    srcInfo.textContent = 'Uploading ' + file.name + '...';
    srcInfo.style.display = 'block';
    document.getElementById('tractator-library-pick').style.display = 'none';

    var fd = new FormData();
    fd.append('file', file);
    try {
      var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(await resp.text());
      var docData = await resp.json();
      var wc = docData.raw_content ? docData.raw_content.split(/\s+/).length : 0;
      tractatorSource = { name: docData.name, content: docData.raw_content || '' };
      srcInfo.innerHTML = '&#128196; <strong>' + esc(docData.name) + '</strong> (' + wc.toLocaleString() + ' words)';
      document.getElementById('tractator-generate').disabled = false;
    } catch (err) {
      srcInfo.textContent = 'Upload failed: ' + err.message;
      notify('Upload failed', 'error');
    }
  });

  document.getElementById('tractator-library-btn').addEventListener('click', async function() {
    var libPick = document.getElementById('tractator-library-pick');
    var libList = document.getElementById('tractator-lib-list');
    libPick.style.display = 'block';
    libList.innerHTML = '<li style="color:#6b7280;font-size:12px">Loading...</li>';

    try {
      var docs = await api('/api/documents/global');
      libList.innerHTML = '';
      if (docs.length === 0) {
        libList.innerHTML = '<li style="color:#6b7280;font-size:12px">No documents in library</li>';
        return;
      }
      for (var k = 0; k < docs.length; k++) {
        (function(doc) {
          var li = document.createElement('li');
          li.className = 'tractator-lib-item';
          li.setAttribute('data-testid', 'tractator-pick-' + doc.id);
          var wc = doc.word_count ? doc.word_count.toLocaleString() + ' words' : '';
          li.innerHTML = '<span>&#128196;</span><span style="flex:1">' + esc(doc.name) + '</span><span style="font-size:11px;color:#6b7280">' + wc + '</span>';
          li.addEventListener('click', async function() {
            var items = libList.querySelectorAll('.tractator-lib-item');
            for (var m = 0; m < items.length; m++) items[m].classList.remove('selected');
            li.classList.add('selected');

            var srcInfo = document.getElementById('tractator-source-info');
            srcInfo.textContent = 'Loading document content...';
            srcInfo.style.display = 'block';

            try {
              var fullDoc = await api('/api/documents/global/' + doc.id + '/content');
              tractatorSource = { name: doc.name, content: fullDoc.raw_content || '' };
              var fwc = tractatorSource.content.split(/\s+/).length;
              srcInfo.innerHTML = '&#128196; <strong>' + esc(doc.name) + '</strong> (' + fwc.toLocaleString() + ' words)';
              document.getElementById('tractator-generate').disabled = false;
            } catch (err) {
              srcInfo.textContent = 'Failed to load document';
              notify('Failed to load document', 'error');
            }
          });
          libList.appendChild(li);
        })(docs[k]);
      }
    } catch (err) {
      libList.innerHTML = '<li style="color:#dc2626;font-size:12px">Failed to load library</li>';
    }
  });

  document.getElementById('tractator-generate').addEventListener('click', async function() {
    if (!tractatorSource) return;
    var genBtn = document.getElementById('tractator-generate');
    genBtn.disabled = true;
    genBtn.textContent = 'Generating...';
    var statusDiv = document.getElementById('tractator-status');
    var statusText = document.getElementById('tractator-status-text');
    var fillBar = document.getElementById('tractator-fill');
    statusDiv.style.display = 'block';
    statusText.textContent = 'Starting...';
    fillBar.style.width = '10%';

    try {
      var resp = await fetch('/api/tractator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: tractatorSource.content,
          docName: tractatorSource.name,
          depth: tractatorDepth
        })
      });

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var resultTree = null;

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line.startsWith('data: ')) continue;
          var payload = line.substring(6);
          if (payload === '[DONE]') continue;
          try {
            var parsed = JSON.parse(payload);
            if (parsed.type === 'status') {
              statusText.textContent = parsed.message;
            } else if (parsed.type === 'progress') {
              fillBar.style.width = Math.round((parsed.current / parsed.total) * 90) + '%';
            } else if (parsed.type === 'complete') {
              resultTree = parsed;
              fillBar.style.width = '100%';
              statusText.textContent = 'Complete! ' + parsed.nodeCount + ' nodes generated.';
            } else if (parsed.type === 'error') {
              throw new Error(parsed.error);
            }
          } catch (pe) {
            if (pe.message && !pe.message.includes('JSON')) throw pe;
          }
        }
      }

      if (resultTree && resultTree.tree) {
        tractatorModal.classList.remove('active');
        var treeText = JSON.stringify(resultTree.tree, null, 2);
        var depthNames = ['Broad', '1-Decimal', '2-Decimal', '3-Decimal'];
        var artTitle = 'Tractatus (' + depthNames[tractatorDepth] + ') — ' + tractatorSource.name;
        showArtifact(treeText, artTitle, { raw: true });
        notify('Tractatus tree generated: ' + resultTree.nodeCount + ' nodes');
      } else {
        throw new Error('No tree generated');
      }
    } catch (err) {
      statusText.textContent = 'Error: ' + err.message;
      notify('Tractator failed: ' + err.message, 'error');
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate Tractatus Tree';
    }
  });

  var globalFileInput = document.getElementById('file-input-global');
  document.getElementById('btn-upload-global').addEventListener('click', function() {
    globalFileInput.click();
  });
  document.getElementById('btn-send-selected').addEventListener('click', function() {
    sendSelectedDocs().catch(function(err) {
      console.error('sendSelectedDocs error:', err);
      notify('Failed to send documents: ' + err.message, 'error');
      state.streaming = false;
      els.btnSend.disabled = false;
    });
  });
  globalFileInput.addEventListener('change', async function() {
    if (globalFileInput.files.length === 0) return;
    var files = Array.from(globalFileInput.files);
    globalFileInput.value = '';
    var allowed = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];
    var uploaded = 0;
    for (var fi = 0; fi < files.length; fi++) {
      var file = files[fi];
      var ext = '.' + file.name.split('.').pop().toLowerCase();
      if (allowed.indexOf(ext) === -1) {
        notify(file.name + ': unsupported type', 'error');
        continue;
      }
      try {
        var isImg = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'].indexOf(ext) !== -1;
        notify((isImg ? 'Running OCR on ' : 'Uploading ') + file.name + '...', 'info');
        var fd = new FormData();
        fd.append('file', file);
        var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
        if (!resp.ok) throw new Error(await resp.text());
        uploaded++;
      } catch (err) {
        notify('Failed: ' + file.name, 'error');
      }
    }
    if (uploaded > 0) {
      notify('Added ' + uploaded + ' document' + (uploaded > 1 ? 's' : '') + ' to library', 'success');
      openGlobalLibrary();
    }
  });

  var dragTimer = null;
  var libraryBtn = document.getElementById('btn-library-sidebar');
  var droppedOnLibrary = false;

  libraryBtn.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    libraryBtn.classList.add('library-drop-hover');
  });
  libraryBtn.addEventListener('dragleave', function(e) {
    libraryBtn.classList.remove('library-drop-hover');
  });
  libraryBtn.addEventListener('drop', async function(e) {
    e.preventDefault();
    e.stopPropagation();
    droppedOnLibrary = true;
    libraryBtn.classList.remove('library-drop-hover');
    els.dropOverlay.classList.remove('active');
    clearTimeout(dragTimer);

    var files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    var allowed = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'];
    var uploaded = 0;
    for (var fi = 0; fi < files.length; fi++) {
      var file = files[fi];
      var ext = '.' + file.name.split('.').pop().toLowerCase();
      if (allowed.indexOf(ext) === -1) {
        notify(file.name + ': unsupported type', 'error');
        continue;
      }
      try {
        var isImg = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'].indexOf(ext) !== -1;
        notify((isImg ? 'Running OCR on ' : 'Uploading ') + file.name + ' to library...', 'info');
        var fd = new FormData();
        fd.append('file', file);
        var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
        if (!resp.ok) throw new Error(await resp.text());
        uploaded++;
      } catch (err) {
        notify('Failed: ' + file.name, 'error');
      }
    }
    if (uploaded > 0) {
      notify('Added ' + uploaded + ' document' + (uploaded > 1 ? 's' : '') + ' to General Library', 'success');
      openGlobalLibrary();
    }
    setTimeout(function() { droppedOnLibrary = false; }, 100);
  });

  document.addEventListener('dragover', function(e) {
    e.preventDefault();
    els.dropOverlay.classList.add('active');
    clearTimeout(dragTimer);
    dragTimer = setTimeout(function() {
      els.dropOverlay.classList.remove('active');
    }, 200);
  });
  document.addEventListener('drop', function(e) {
    e.preventDefault();
    clearTimeout(dragTimer);
    els.dropOverlay.classList.remove('active');
    if (droppedOnLibrary) return;
    if (e.dataTransfer.files.length > 0) {
      for (var fi = 0; fi < e.dataTransfer.files.length; fi++) {
        uploadFile(e.dataTransfer.files[fi]);
      }
    }
  });
  document.addEventListener('dragleave', function(e) {
    if (e.relatedTarget === null) {
      clearTimeout(dragTimer);
      els.dropOverlay.classList.remove('active');
    }
  });

  var libModal = els.libraryModal.querySelector('.modal');
  libModal.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    libModal.style.outline = '2px dashed #7c3aed';
    libModal.style.outlineOffset = '-4px';
  });
  libModal.addEventListener('dragleave', function(e) {
    libModal.style.outline = '';
    libModal.style.outlineOffset = '';
  });
  libModal.addEventListener('drop', async function(e) {
    e.preventDefault();
    e.stopPropagation();
    libModal.style.outline = '';
    libModal.style.outlineOffset = '';
    clearTimeout(dragTimer);
    els.dropOverlay.classList.remove('active');
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var uploaded = 0;
    for (var fi = 0; fi < files.length; fi++) {
      var fd = new FormData();
      fd.append('file', files[fi]);
      try {
        var resp = await fetch('/api/documents/upload', { method: 'POST', body: fd });
        if (resp.ok) uploaded++;
      } catch (err) {}
    }
    if (uploaded > 0) {
      notify('Added ' + uploaded + ' document' + (uploaded > 1 ? 's' : '') + ' to General Library', 'success');
      openGlobalLibrary();
    }
  });

  els.libraryModal.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
  });
  els.libraryModal.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(dragTimer);
    els.dropOverlay.classList.remove('active');
  });

  libModal.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  els.libraryModal.addEventListener('mousedown', function(e) {
    if (e.target === els.libraryModal) els.libraryModal.classList.remove('active');
  });
  els.projectModal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });
  els.projectModal.addEventListener('mousedown', function(e) {
    if (e.target === els.projectModal) els.projectModal.classList.remove('active');
  });

  var appEl = document.getElementById('app');

  var auditPanel = document.getElementById('audit-panel');
  var auditBody = document.getElementById('audit-result-body');
  var stalenessContainer = document.getElementById('staleness-container');

  document.getElementById('audit-panel-close').addEventListener('click', function() {
    auditPanel.classList.remove('active');
  });

  async function runAudit(text, triggerBtn) {
    if (!state.currentProject) return;
    auditPanel.classList.add('active');
    auditBody.innerHTML = '<div class="audit-result-status">Auditing claims against project memory...</div>';
    if (triggerBtn) {
      if (!triggerBtn.getAttribute('data-original-label')) {
        triggerBtn.setAttribute('data-original-label', triggerBtn.textContent);
      }
      triggerBtn.classList.add('auditing');
      triggerBtn.textContent = 'Auditing...';
    }

    try {
      var response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: state.currentProject.id,
          text: text.substring(0, 8000)
        })
      });

      if (!response.ok || !response.body) {
        auditBody.innerHTML = '<div class="audit-result-status" style="color:#dc2626;">Audit request failed. Please try again.</div>';
        if (triggerBtn) { triggerBtn.classList.remove('auditing'); triggerBtn.textContent = triggerBtn.getAttribute('data-original-label') || 'Audit'; }
        return;
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var fullText = '';
      auditBody.innerHTML = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith('data: ')) continue;
          var data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            var parsed = JSON.parse(data);
            if (parsed.type === 'token') {
              fullText += parsed.text;
              auditBody.innerHTML = fmt(fullText);
            } else if (parsed.type === 'status') {
              if (!fullText) {
                auditBody.innerHTML = '<div class="audit-result-status">' + esc(parsed.message) + '</div>';
              }
            } else if (parsed.type === 'complete') {
              var saved = parsed.lessonsSaved || 0;
              var noteHtml;
              if (saved > 0) {
                noteHtml = '<div class="audit-lesson-note audit-lesson-saved" data-testid="audit-lesson-note">&#10003; Saved ' + saved + ' contradicted finding' + (saved !== 1 ? 's' : '') + ' as a caution. Future answers in this project will be told not to repeat these mistakes. Existing answers are unchanged.</div>';
              } else {
                noteHtml = '<div class="audit-lesson-note audit-lesson-clean" data-testid="audit-lesson-note">&#10003; No contradicted findings to add to the project\'s caution list.</div>';
              }
              auditBody.innerHTML = fmt(fullText) + noteHtml;
            } else if (parsed.type === 'error') {
              auditBody.innerHTML = '<div class="audit-result-status" style="color:#dc2626;">' + esc(parsed.error) + '</div>';
            }
          } catch (e) {}
        }
      }
    } catch (err) {
      auditBody.innerHTML = '<div class="audit-result-status" style="color:#dc2626;">Audit failed: ' + esc(err.message) + '</div>';
    }

    if (triggerBtn) {
      triggerBtn.classList.remove('auditing');
      triggerBtn.textContent = triggerBtn.getAttribute('data-original-label') || 'Audit';
    }
  }

  async function checkStaleness() {
    if (!state.currentProject) {
      stalenessContainer.innerHTML = '';
      return;
    }
    try {
      var r = await fetch('/api/projects/' + state.currentProject.id + '/staleness');
      if (!r.ok) return;
      var data = await r.json();
      if (!data.isStale) {
        stalenessContainer.innerHTML = '';
        return;
      }
      var icon = data.severity === 'critical' ? '\u26A0\uFE0F' : data.severity === 'warning' ? '\u26A0\uFE0F' : '\u2139\uFE0F';
      var msg = 'Project memory';
      if (data.daysSinceUpdate !== null && data.daysSinceUpdate > 0) msg += ' last updated ' + data.daysSinceUpdate + ' day' + (data.daysSinceUpdate !== 1 ? 's' : '') + ' ago';
      if (data.compressionCount > 0) msg += ', compressed ' + data.compressionCount + ' time' + (data.compressionCount !== 1 ? 's' : '');
      msg += '. Specific dates, numbers, and names may have degraded. Use Audit to verify critical claims.';
      stalenessContainer.innerHTML = '<div class="staleness-banner severity-' + data.severity + '" data-testid="staleness-banner">' +
        '<span class="staleness-icon">' + icon + '</span>' +
        '<span class="staleness-text">' + msg + '</span>' +
        '<button class="btn-run-audit-banner" data-testid="btn-run-audit-banner">Run Audit</button>' +
        '<button class="btn-dismiss-staleness" data-testid="btn-dismiss-staleness">&times;</button>' +
        '</div>';
      var runAuditBannerBtn = stalenessContainer.querySelector('.btn-run-audit-banner');
      if (runAuditBannerBtn) {
        runAuditBannerBtn.addEventListener('click', function() {
          var allMsgs = els.messages.querySelectorAll('.message.assistant');
          if (allMsgs.length === 0) { notify('No assistant messages to audit', 'info'); return; }
          var textToAudit = '';
          for (var i = allMsgs.length - 1; i >= 0; i--) {
            var m = allMsgs[i];
            var t = '';
            var te = m.querySelector('.msg-text');
            if (te) t = te.innerText || '';
            if (!t) {
              var tb = m.querySelector('.msg-body');
              if (tb) t = tb.innerText || '';
            }
            if (!t) {
              var clone = m.cloneNode(true);
              var actions = clone.querySelector('.msg-actions-row');
              if (actions) actions.remove();
              t = clone.innerText || clone.textContent || '';
            }
            t = (t || '').trim();
            if (t.length >= 20) { textToAudit = t; break; }
          }
          if (textToAudit) runAudit(textToAudit, runAuditBannerBtn);
          else notify('No assistant text found to audit yet', 'info');
        });
      }
      var dismissBtn = stalenessContainer.querySelector('.btn-dismiss-staleness');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function() {
          stalenessContainer.innerHTML = '';
        });
      }
    } catch (e) {}
  }

  var reminderDot = document.getElementById('reminder-dot');
  var remindersModal = document.getElementById('reminders-modal');
  var remindersList = document.getElementById('reminders-list');
  var reminderInput = document.getElementById('reminder-input');

  async function updateReminderDot() {
    try {
      var r = await fetch('/api/reminders/count');
      if (r.ok) {
        var data = await r.json();
        reminderDot.classList.toggle('hidden', data.count === 0);
      }
    } catch (e) {}
  }

  async function loadReminders() {
    try {
      var r = await fetch('/api/reminders');
      if (!r.ok) return;
      var reminders = await r.json();
      renderReminders(reminders);
    } catch (e) {}
  }

  function renderReminders(reminders) {
    if (reminders.length === 0) {
      remindersList.innerHTML = '<div class="reminders-empty">No reminders yet. Add one above.</div>';
      return;
    }
    remindersList.innerHTML = '';
    for (var i = 0; i < reminders.length; i++) {
      (function(rem) {
        var div = document.createElement('div');
        div.className = 'reminder-item' + (rem.completed ? ' completed' : '');
        div.setAttribute('data-testid', 'reminder-item-' + rem.id);

        var check = document.createElement('div');
        check.className = 'reminder-check';
        check.innerHTML = rem.completed ? '&#10003;' : '';
        check.addEventListener('click', async function() {
          try {
            await fetch('/api/reminders/' + rem.id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ completed: !rem.completed })
            });
            loadReminders();
            updateReminderDot();
          } catch (e) {}
        });

        var textWrap = document.createElement('div');
        textWrap.style.flex = '1';
        var textEl = document.createElement('div');
        textEl.className = 'reminder-text';
        textEl.textContent = rem.text;
        var metaEl = document.createElement('div');
        metaEl.className = 'reminder-meta';
        var d = new Date(rem.created_at);
        var dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        metaEl.textContent = dateStr;
        if (rem.completed && rem.completed_at) {
          var cd = new Date(rem.completed_at);
          metaEl.textContent += ' — done ' + cd.toLocaleDateString();
        }
        textWrap.appendChild(textEl);
        textWrap.appendChild(metaEl);

        var del = document.createElement('button');
        del.className = 'reminder-delete';
        del.innerHTML = '&times;';
        del.title = 'Delete';
        del.addEventListener('click', async function() {
          try {
            await fetch('/api/reminders/' + rem.id, { method: 'DELETE' });
            loadReminders();
            updateReminderDot();
          } catch (e) {}
        });

        div.appendChild(check);
        div.appendChild(textWrap);
        div.appendChild(del);
        remindersList.appendChild(div);
      })(reminders[i]);
    }
  }

  var pinnedModal = document.getElementById('pinned-context-modal');
  var pinnedInput = document.getElementById('pinned-context-input');
  var pinnedCharcount = document.getElementById('pinned-context-charcount');
  function updatePinnedCount() { if (pinnedCharcount && pinnedInput) pinnedCharcount.textContent = (pinnedInput.value || '').length; }
  if (pinnedInput) pinnedInput.addEventListener('input', updatePinnedCount);
  function closePinned() { if (pinnedModal) pinnedModal.classList.remove('show'); }
  if (document.getElementById('close-pinned-context')) document.getElementById('close-pinned-context').addEventListener('click', closePinned);
  if (document.getElementById('btn-pinned-cancel')) document.getElementById('btn-pinned-cancel').addEventListener('click', closePinned);
  if (document.getElementById('btn-pinned-save')) document.getElementById('btn-pinned-save').addEventListener('click', async function() {
    if (!state.currentProject) { notify('No project selected', 'error'); return; }
    try {
      var res = await fetch('/api/projects/' + state.currentProject.id + '/pinned-context', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinnedContext: pinnedInput.value || '' })
      });
      if (!res.ok) throw new Error('Save failed (' + res.status + ')');
      notify('Pinned context saved', 'success');
      closePinned();
    } catch (e) { notify('Failed to save: ' + e.message, 'error'); }
  });
  document.getElementById('btn-pinned-context').addEventListener('click', async function() {
    if (!state.currentProject) { notify('Select a project first', 'error'); return; }
    try {
      var res = await fetch('/api/projects/' + state.currentProject.id + '/pinned-context');
      var data = await res.json();
      pinnedInput.value = data.pinnedContext || '';
      updatePinnedCount();
      pinnedModal.classList.add('show');
      setTimeout(function() { pinnedInput.focus(); }, 50);
    } catch (e) { notify('Failed to load: ' + e.message, 'error'); }
  });

  document.getElementById('btn-reminders').addEventListener('click', function() {
    remindersModal.classList.add('active');
    loadReminders();
    reminderInput.focus();
  });

  // === Diagnostic ===
  var diagModal = document.getElementById('diagnostic-modal');
  document.getElementById('btn-diagnostic').addEventListener('click', function() {
    diagModal.classList.remove('hidden');
    diagModal.classList.add('active');
  });
  document.getElementById('close-diagnostic').addEventListener('click', function() {
    diagModal.classList.remove('active');
    diagModal.classList.add('hidden');
  });
  diagModal.addEventListener('mousedown', function(e) {
    if (e.target === diagModal) {
      diagModal.classList.remove('active');
      diagModal.classList.add('hidden');
    }
  });

  document.getElementById('btn-run-diagnostic').addEventListener('click', async function() {
    var runBtn = document.getElementById('btn-run-diagnostic');
    var body = document.getElementById('diagnostic-body');
    var summary = document.getElementById('diagnostic-summary');
    runBtn.disabled = true;
    runBtn.textContent = 'Running...';
    summary.textContent = '';
    body.innerHTML = '';

    var categoryLabels = { env: 'Environment', db: 'Database', llm: 'External LLM APIs', func: 'Functional CRUD', cleanup: 'Cleanup' };
    var categoryEls = {};
    var rows = {};
    var passCount = 0, failCount = 0, totalCount = 0;

    function ensureCategory(cat) {
      if (categoryEls[cat]) return categoryEls[cat];
      var h = document.createElement('div');
      h.className = 'diag-category';
      h.textContent = categoryLabels[cat] || cat;
      body.appendChild(h);
      var container = document.createElement('div');
      body.appendChild(container);
      categoryEls[cat] = container;
      return container;
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function updateSummary() {
      summary.textContent = passCount + ' passed, ' + failCount + ' failed of ' + totalCount;
      summary.style.color = failCount > 0 ? '#991b1b' : '#065f46';
    }

    try {
      var resp = await fetch('/api/diagnostic/run', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith('data:')) continue;
          var payload;
          try { payload = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
          if (payload.type === 'start') {
            var container = ensureCategory(payload.category);
            var row = document.createElement('div');
            row.className = 'diag-row';
            row.innerHTML = '<span class="diag-status running">RUN</span><span class="diag-name">' + escapeHtml(payload.name) + '</span><span class="diag-msg"></span><span class="diag-ms"></span>';
            container.appendChild(row);
            rows[payload.category + '|' + payload.name] = row;
            totalCount++;
            updateSummary();
            body.scrollTop = body.scrollHeight;
          } else if (payload.type === 'result') {
            var key = payload.category + '|' + payload.name;
            var row2 = rows[key];
            if (!row2) continue;
            var status = payload.status;
            row2.querySelector('.diag-status').className = 'diag-status ' + status;
            row2.querySelector('.diag-status').textContent = status.toUpperCase();
            row2.querySelector('.diag-msg').textContent = payload.message || '';
            row2.querySelector('.diag-ms').textContent = (payload.ms || 0) + 'ms';
            if (status === 'pass') passCount++; else failCount++;
            updateSummary();
          } else if (payload.type === 'fatal') {
            var fatal = document.createElement('div');
            fatal.className = 'diag-row';
            fatal.style.color = '#991b1b';
            fatal.textContent = 'FATAL: ' + payload.error;
            body.appendChild(fatal);
          }
        }
      }
    } catch (err) {
      var errEl = document.createElement('div');
      errEl.className = 'diag-row';
      errEl.style.color = '#991b1b';
      errEl.textContent = 'Diagnostic request failed: ' + err.message;
      body.appendChild(errEl);
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Full System Check';
    }
  });

  document.getElementById('close-reminders').addEventListener('click', function() {
    remindersModal.classList.remove('active');
  });
  document.getElementById('reminders-close').addEventListener('click', function() {
    remindersModal.classList.remove('active');
  });
  remindersModal.addEventListener('mousedown', function(e) {
    if (e.target === remindersModal) remindersModal.classList.remove('active');
  });
  remindersModal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });

  document.getElementById('btn-add-reminder').addEventListener('click', async function() {
    var text = reminderInput.value.trim();
    if (!text) return;
    try {
      await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, projectId: state.currentProject ? state.currentProject.id : null })
      });
      reminderInput.value = '';
      loadReminders();
      updateReminderDot();
    } catch (e) {}
  });

  reminderInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-add-reminder').click();
    }
  });

  document.getElementById('btn-clear-completed').addEventListener('click', async function() {
    try {
      var r = await fetch('/api/reminders');
      if (!r.ok) return;
      var reminders = await r.json();
      var completed = reminders.filter(function(rem) { return rem.completed; });
      for (var i = 0; i < completed.length; i++) {
        await fetch('/api/reminders/' + completed[i].id, { method: 'DELETE' });
      }
      loadReminders();
      updateReminderDot();
    } catch (e) {}
  });

  // Mandatory login: without Google sign-in only the login gate is visible.
  document.getElementById('btn-administrative').addEventListener('click', function() {
    window.location.href = '/administrative';
  });

  var ADMIN_EMAIL = 'johnmichaelkuczynski@gmail.com';

  async function fetchAuthState() {
    try {
      var r = await fetch('/api/auth/user');
      if (r.ok) return await r.json();
    } catch (e) {}
    return { authenticated: false, user: null };
  }

  document.getElementById('btn-gate-signin').addEventListener('click', function() {
    var inIframe = false;
    try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }
    if (inIframe) {
      // Google blocks OAuth inside iframes (Replit preview) — open a tab and poll for completion.
      var w = window.open('/auth/google', '_blank');
      document.getElementById('gate-waiting').classList.remove('hidden');
      var poll = setInterval(async function() {
        var auth = await fetchAuthState();
        if (auth.authenticated) {
          clearInterval(poll);
          try { if (w && !w.closed) w.close(); } catch (e) {}
          window.location.reload();
        }
      }, 2000);
      setTimeout(function() { clearInterval(poll); }, 180000);
    } else {
      window.location.href = '/auth/google';
    }
  });

  document.getElementById('btn-signout').addEventListener('click', async function() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    window.location.reload();
  });

  // Login is REQUIRED: without Google sign-in, only the login gate is shown.
  // In the Replit DEV PREVIEW only, the server exposes /api/auth/dev-login
  // (absent in production) so the owner can debug without the OAuth dance.
  var isDevHost = /\.replit\.dev$|^localhost$|^127\.0\.0\.1$/.test(window.location.hostname);
  async function checkAuth() {
    var auth = await fetchAuthState();
    var gate = document.getElementById('login-gate');
    if ((!auth.authenticated || !auth.user) && isDevHost) {
      try {
        var dl = await fetch('/api/auth/dev-login');
        if (dl.ok) auth = await fetchAuthState();
      } catch (e) {}
      if ((!auth.authenticated || !auth.user) && !sessionStorage.getItem('devLoginTried')) {
        sessionStorage.setItem('devLoginTried', '1');
        window.location.href = '/api/auth/dev-login';
        return;
      }
    }
    if (!auth.authenticated || !auth.user) {
      appEl.classList.add('hidden');
      gate.classList.remove('hidden');
      return;
    }
    gate.classList.add('hidden');
    appEl.classList.remove('hidden');

    var chip = document.getElementById('user-chip');
    chip.classList.remove('hidden');
    document.getElementById('user-chip-name').textContent =
      auth.user.displayName || auth.user.username || auth.user.email || 'Signed in';
    window.__userName = auth.user.displayName || auth.user.username || '';

    // Administrative button only appears for the owner
    var adminBtn = document.getElementById('btn-administrative');
    if ((auth.user.email || '').toLowerCase() === ADMIN_EMAIL) {
      adminBtn.classList.remove('hidden');
    } else {
      adminBtn.classList.add('hidden');
    }

    setGreeting();
    loadProjects();
    updateReminderDot();
  }

  document.getElementById('btn-profile-me').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Generating...';

    try {
      var resp = await fetch('/api/profile/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!resp.ok || !resp.body) {
        notify('Profile generation failed (' + resp.status + ')', 'error');
        btn.disabled = false;
        btn.innerHTML = '&#128100; Profile Me';
        return;
      }

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var fullText = '';
      var statusEl = null;

      function createStatusToast(msg) {
        if (statusEl) { var c = statusEl.querySelector('.tp-content'); if (c) c.textContent = msg; return; }
        statusEl = document.createElement('div');
        statusEl.className = 'tractatus-popup';
        statusEl.style.cssText = 'bottom:80px;right:20px;min-width:280px;max-width:400px;';
        statusEl.innerHTML = '<div class="tp-header"><div class="tp-title">&#128100; Generating Profile</div></div>' +
          '<div class="tp-body"><div class="tp-content" style="font-size:12px;padding:6px 10px;">' + msg + '</div></div>';
        document.body.appendChild(statusEl);
      }

      function pump() {
        reader.read().then(function(result) {
          if (result.done) {
            if (statusEl) statusEl.remove();
            btn.disabled = false;
            btn.innerHTML = '&#128100; Profile Me';
            if (fullText.trim()) {
              showArtifact(fullText, 'User Profile', { raw: false });
            }
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line.startsWith('data: ')) continue;
            var data = line.substring(6);
            if (data === '[DONE]') continue;
            try {
              var parsed = JSON.parse(data);
              if (parsed.type === 'status') {
                createStatusToast(parsed.message);
              } else if (parsed.type === 'token') {
                fullText += parsed.text;
                if (statusEl) {
                  var content = statusEl.querySelector('.tp-content');
                  if (content) content.textContent = 'Writing profile... (' + fullText.split(/\s+/).length + ' words)';
                }
              } else if (parsed.type === 'complete') {
                if (statusEl) {
                  var content = statusEl.querySelector('.tp-content');
                  if (content) content.textContent = 'Profile complete! (' + (parsed.wordCount || fullText.split(/\s+/).length) + ' words)';
                }
              } else if (parsed.type === 'error') {
                notify('Profile error: ' + (parsed.error || 'Unknown'), 'error');
                if (statusEl) statusEl.remove();
                statusEl = null;
                btn.disabled = false;
                btn.innerHTML = '&#128100; Profile Me';
              }
            } catch (e) {}
          }
          pump();
        }).catch(function() {
          if (statusEl) statusEl.remove();
          btn.disabled = false;
          btn.innerHTML = '&#128100; Profile Me';
          notify('Profile generation failed', 'error');
        });
      }
      pump();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '&#128100; Profile Me';
      notify('Profile error: ' + err.message, 'error');
    }
  });

  // === Compare Stances ===
  var STANCE_LABELS = {
    agreeable: 'Agreeable',
    neutral: 'Neutral',
    mildly_critical: 'Mildly Critical',
    strongly_critical: 'Strongly Critical'
  };
  var MODEL_LABELS = { claude: 'Claude', chatgpt: 'ChatGPT', deepseek: 'DeepSeek', grok: 'Grok', venice: 'Venice' };
  var compareAbort = null;

  function openComparePicker() {
    if (!state.currentSession || !state.currentProject) {
      notify('Open a chat first', 'error');
      return;
    }
    var msgInput = document.getElementById('chat-input');
    if (!msgInput || !msgInput.value.trim()) {
      notify('Type a message in the chat input first', 'error');
      return;
    }
    var noteEl = document.getElementById('compare-picker-note');
    if (noteEl) noteEl.textContent = '';
    var aSel = document.getElementById('compare-stance-a');
    var bSel = document.getElementById('compare-stance-b');
    if (aSel) aSel.value = state.stance || 'neutral';
    if (bSel) bSel.value = (state.stance === 'mildly_critical') ? 'neutral' : 'mildly_critical';
    document.getElementById('compare-picker-modal').classList.remove('hidden');
  }

  function closeComparePicker() {
    document.getElementById('compare-picker-modal').classList.add('hidden');
  }

  function closeCompareOverlay() {
    if (compareAbort) {
      try { compareAbort.abort(); } catch (e) {}
      compareAbort = null;
    }
    document.getElementById('compare-overlay').classList.add('hidden');
  }

  async function runCompare(stanceA, stanceB) {
    var msgInput = document.getElementById('chat-input');
    var message = msgInput ? msgInput.value.trim() : '';
    if (!message) { notify('Empty message', 'error'); return; }

    var aBody = document.getElementById('compare-col-a-body');
    var bBody = document.getElementById('compare-col-b-body');
    var aHdr = document.getElementById('compare-col-a-header');
    var bHdr = document.getElementById('compare-col-b-header');
    var statusEl = document.getElementById('compare-status');
    var titleEl = document.getElementById('compare-overlay-title');
    var modelLabel = MODEL_LABELS[state.model] || 'Claude';
    aHdr.textContent = STANCE_LABELS[stanceA] + '  ·  ' + modelLabel;
    bHdr.textContent = STANCE_LABELS[stanceB] + '  ·  ' + modelLabel;
    titleEl.textContent = STANCE_LABELS[stanceA] + ' vs ' + STANCE_LABELS[stanceB];
    aBody.innerHTML = '<span class="compare-cursor"></span>';
    bBody.innerHTML = '<span class="compare-cursor"></span>';
    statusEl.textContent = 'Streaming both stances in parallel...';
    document.getElementById('compare-overlay').classList.remove('hidden');

    var textA = '', textB = '';
    var doneA = false, doneB = false;

    function appendLane(lane, t) {
      var body = lane === 'A' ? aBody : bBody;
      if (lane === 'A') textA += t; else textB += t;
      var cursor = body.querySelector('.compare-cursor');
      var node = document.createTextNode(t);
      if (cursor) body.insertBefore(node, cursor); else body.appendChild(node);
      body.scrollTop = body.scrollHeight;
    }

    function endLane(lane) {
      if (lane === 'A') doneA = true; else doneB = true;
      var body = lane === 'A' ? aBody : bBody;
      var cursor = body.querySelector('.compare-cursor');
      if (cursor) cursor.remove();
      if (doneA && doneB) statusEl.textContent = 'Done. ' + textA.split(/\s+/).length + ' words (A) · ' + textB.split(/\s+/).length + ' words (B).';
      else statusEl.textContent = 'Lane ' + lane + ' done. Waiting for the other...';
    }

    compareAbort = new AbortController();
    try {
      var res = await fetch('/api/chat/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.currentSession.id,
          projectId: state.currentProject.id,
          message: message,
          stanceA: stanceA,
          stanceB: stanceB,
          responseLength: state.responseLength,
          responseFormat: state.responseFormat,
          model: state.model,
          targetWords: getTargetWords()
        }),
        signal: compareAbort.signal
      });
      if (!res.ok || !res.body) {
        statusEl.textContent = 'Error: HTTP ' + res.status;
        return;
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith('data: ')) continue;
          var data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            var ev = JSON.parse(data);
            if (ev.type === 'text' && (ev.lane === 'A' || ev.lane === 'B')) {
              appendLane(ev.lane, ev.text || '');
            } else if (ev.type === 'lane_end' && (ev.lane === 'A' || ev.lane === 'B')) {
              endLane(ev.lane);
            } else if (ev.type === 'error') {
              statusEl.textContent = 'Error: ' + ev.error;
            }
          } catch (e) {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') statusEl.textContent = 'Error: ' + err.message;
    } finally {
      compareAbort = null;
      var ca = aBody.querySelector('.compare-cursor'); if (ca) ca.remove();
      var cb = bBody.querySelector('.compare-cursor'); if (cb) cb.remove();
    }
  }

  var btnCompare = document.getElementById('btn-compare-stances');
  if (btnCompare) btnCompare.addEventListener('click', openComparePicker);
  var btnCmpCancel = document.getElementById('btn-compare-cancel');
  if (btnCmpCancel) btnCmpCancel.addEventListener('click', closeComparePicker);
  var btnCmpClosePick = document.getElementById('close-compare-picker');
  if (btnCmpClosePick) btnCmpClosePick.addEventListener('click', closeComparePicker);
  var btnCmpCloseOv = document.getElementById('close-compare-overlay');
  if (btnCmpCloseOv) btnCmpCloseOv.addEventListener('click', closeCompareOverlay);
  var btnCmpGo = document.getElementById('btn-compare-go');
  if (btnCmpGo) btnCmpGo.addEventListener('click', function() {
    var a = document.getElementById('compare-stance-a').value;
    var b = document.getElementById('compare-stance-b').value;
    var note = document.getElementById('compare-picker-note');
    if (a === b) { if (note) note.textContent = 'Pick two different stances.'; return; }
    if (note) note.textContent = '';
    closeComparePicker();
    runCompare(a, b);
  });
  var btnCpyA = document.getElementById('btn-compare-copy-a');
  if (btnCpyA) btnCpyA.addEventListener('click', function() {
    var t = document.getElementById('compare-col-a-body').innerText;
    navigator.clipboard.writeText(t).then(function() { notify('Copied A', 'success'); });
  });
  var btnCpyB = document.getElementById('btn-compare-copy-b');
  if (btnCpyB) btnCpyB.addEventListener('click', function() {
    var t = document.getElementById('compare-col-b-body').innerText;
    navigator.clipboard.writeText(t).then(function() { notify('Copied B', 'success'); });
  });

  checkAuth();
})();
