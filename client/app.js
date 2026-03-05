(function() {
  var state = {
    projects: [],
    sessions: [],
    currentProject: null,
    currentSession: null,
    streaming: false,
    projectDocs: []
  };

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
    artifactSave: document.getElementById('artifact-save')
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
    if (!text || text.length < 400) return false;
    var cleaned = stripTractatusContent(text);
    if (cleaned.length < 400) return false;
    var lines = cleaned.split('\n');
    var headingCount = 0;
    var paragraphCount = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (/^#{1,3}\s/.test(line) || /^[IVXLC]+\.\s/.test(line) || /^[A-Z][A-Z\s,]{10,}$/.test(line)) headingCount++;
      if (line.length > 80) paragraphCount++;
    }
    var words = cleaned.split(/\s+/).length;
    if (words >= 300 && headingCount >= 2 && paragraphCount >= 3) return true;
    if (words >= 500 && paragraphCount >= 5) return true;
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
    var h = esc(text);
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
      var isBlock = /^<(h[1-3]|hr|pre|ul|ol|li|blockquote)/.test(line.trim());
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

  function showArtifact(text, title, opts) {
    opts = opts || {};
    var cleaned = opts.raw ? text : stripTractatusContent(text);
    currentArtifact = { text: cleaned, title: title || extractArtifactTitle(cleaned) };
    els.artifactTitle.textContent = currentArtifact.title;
    els.artifactBody.innerHTML = opts.raw ? '<pre style="white-space:pre-wrap;word-break:break-word;font-family:\'SF Mono\',Consolas,monospace;font-size:12px;line-height:1.6">' + esc(cleaned) + '</pre>' : formatArtifactHtml(cleaned);
    els.artifactPanel.classList.remove('hidden');
    els.artifactSave.disabled = false;
    els.artifactSave.innerHTML = '&#128218; Save';
  }

  function closeArtifact() {
    els.artifactPanel.classList.add('hidden');
    currentArtifact = null;
  }

  els.artifactClose.addEventListener('click', closeArtifact);

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
        body: JSON.stringify({ text: currentArtifact.text, name: currentArtifact.title })
      });
      els.artifactSave.innerHTML = '&#9989; Saved';
      els.artifactSave.disabled = true;
      notify('Saved to General Library', 'success');
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

  function fmt(text) {
    var h = esc(text);
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
        '<button class="si-btn si-btn-rename" data-testid="btn-rename-session-' + s.id + '" title="Rename">&#9998;</button>' +
        '<button class="si-btn si-btn-delete" data-testid="btn-delete-session-' + s.id + '" title="Delete">&#128465;</button>' +
        '</span>';
      (function(sess, el) {
        el.addEventListener('click', function(e) {
          if (e.target.closest('.si-btn')) return;
          selectSession(sess);
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

  function selectSession(s) {
    state.currentSession = s;
    renderSessions();
    renderTranscript(s.transcript || []);
  }

  function showWelcome() {
    els.messages.innerHTML = '';
    els.messages.appendChild(els.welcome);
    els.welcome.style.display = '';
  }

  function renderTranscript(transcript) {
    els.messages.innerHTML = '';
    if (!transcript || transcript.length === 0) {
      els.messages.appendChild(els.welcome);
      els.welcome.style.display = '';
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

    div.innerHTML = '<div class="msg-avatar">' + avatar + '</div>' +
      '<div class="msg-body"><div class="msg-role">' + label + '</div>' + bodyHtml + '</div>';

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
    div.innerHTML = '<div class="msg-avatar">C</div>' +
      '<div class="msg-body"><div class="msg-role">Claude</div>' +
      '<div class="msg-text"><span class="cursor-blink"></span></div></div>';
    els.messages.appendChild(div);
    scrollBottom();
    return div.querySelector('.msg-text');
  }

  function streamSSE(response, textEl, onDone) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var fullText = '';

    function pump() {
      reader.read().then(function(result) {
        if (result.done) {
          var c = textEl.querySelector('.cursor-blink');
          if (c) c.remove();
          textEl.innerHTML = fmt(fullText);
          if (isDocumentArtifact(fullText)) {
            var artTitle = extractArtifactTitle(fullText);
            showArtifact(fullText, artTitle);
            var viewBtn = document.createElement('button');
            viewBtn.className = 'artifact-link';
            viewBtn.setAttribute('data-testid', 'btn-view-artifact');
            viewBtn.textContent = '\uD83D\uDCC4 View as Document';
            viewBtn.addEventListener('click', function() { showArtifact(fullText, artTitle); });
            textEl.appendChild(viewBtn);
          }
          if (onDone) onDone(fullText);
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
              if (parsed.type === 'text') {
                fullText += parsed.text;
                var c = textEl.querySelector('.cursor-blink');
                if (c) c.remove();
                textEl.innerHTML = fmt(fullText) + '<span class="cursor-blink"></span>';
                scrollBottom();
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
        var c = textEl.querySelector('.cursor-blink');
        if (c) c.remove();
        if (onDone) onDone(fullText);
      });
    }
    pump();
  }

  function startTractatusUpdate(projectId, userMessage, assistantResponse) {
    var popup = document.createElement('div');
    popup.className = 'tractatus-popup';
    popup.setAttribute('data-testid', 'tractatus-popup');
    popup.innerHTML = '<div class="tp-header">' +
      '<div class="tp-title">&#128736; Updating Project Memory</div>' +
      '<div class="tp-controls">' +
      '<button class="tp-minimize" data-testid="tp-minimize" title="Minimize">&#8211;</button>' +
      '<button class="tp-close hidden" data-testid="tp-close" title="Close">&times;</button>' +
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

    tpMinimize.addEventListener('click', function() {
      minimized = !minimized;
      tpBody.classList.toggle('hidden', minimized);
      tpMinimize.innerHTML = minimized ? '&#9744;' : '&#8211;';
    });
    tpClose.addEventListener('click', function() { popup.remove(); });

    var header = popup.querySelector('.tp-header');
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
                } else if (p.type === 'error') {
                  var cursor = tpContent.querySelector('.cursor-blink');
                  if (cursor) cursor.remove();
                  tpTitle.innerHTML = '&#10060; Update Failed: ' + (p.message || 'Unknown error');
                  tpClose.classList.remove('hidden');
                }
              } catch (e) {}
            }
          }
          pump();
        }).catch(function() {
          tpTitle.innerHTML = '&#10060; Connection Lost';
          tpClose.classList.remove('hidden');
        });
      }
      pump();
    }).catch(function() {
      tpTitle.innerHTML = '&#10060; Update Failed';
      tpClose.classList.remove('hidden');
      var cursor = tpContent.querySelector('.cursor-blink');
      if (cursor) cursor.remove();
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
    if (state.streaming) return;
    var text = els.chatInput.value.trim();
    if (!text) return;
    if (!state.currentProject) {
      notify('Select a project first', 'error');
      return;
    }
    await ensureSession();
    if (!state.currentSession) return;

    els.chatInput.value = '';
    autoResize();
    addMessage('user', text);
    scrollBottom();

    var isFirstMessage = !state.currentSession.transcript || state.currentSession.transcript.length === 0;
    var needsAutoTitle = isFirstMessage && state.currentSession.title === 'New Chat';
    var sendingSession = state.currentSession;
    var optimisticTitle = '';
    if (needsAutoTitle) {
      optimisticTitle = text.length > 50 ? text.substring(0, 47) + '...' : text;
      sendingSession.title = optimisticTitle;
      renderSessions();
    }

    if (!state.currentSession.transcript) state.currentSession.transcript = [];
    state.currentSession.transcript.push({ role: 'user', content: text });

    state.streaming = true;
    els.btnSend.disabled = true;

    try {
      var textEl = startStreaming();
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.currentSession.id,
          projectId: state.currentProject.id,
          message: text
        })
      });

      streamSSE(res, textEl, function(fullText) {
        if (sendingSession && fullText) {
          sendingSession.transcript = sendingSession.transcript || [];
          sendingSession.transcript.push({ role: 'assistant', content: fullText });
        }
        state.streaming = false;
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
      notify('Message failed: ' + err.message, 'error');
      state.streaming = false;
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
        doctype: paperSpec.doctype
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
                          body: JSON.stringify({ jobId: jid, name: docTitle })
                        });
                        saveBtn.innerHTML = '&#9989; Saved';
                        saveBtn.disabled = true;
                        notify('Saved to General Library', 'success');
                      } catch (err) {
                        notify('Save failed: ' + err.message, 'error');
                      }
                    };
                  })(parsed.jobId, paperSpec.title || paperSpec.doctype);
                  ppDownloads.appendChild(saveBtn);

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
        '<div class="dp-actions"><button class="dp-action-btn" title="Inject into chat" data-testid="dp-inject-' + doc.id + '">&#8618;</button>' +
        '<button class="dp-action-btn" title="Copy to General Library" data-testid="dp-global-' + doc.id + '">&#128218;</button></div>';

      (function(d) {
        item.querySelector('[data-testid="dp-inject-' + d.id + '"]').addEventListener('click', function(e) {
          e.stopPropagation();
          injectDocIntoChat(d.id);
        });
        item.querySelector('[data-testid="dp-global-' + d.id + '"]').addEventListener('click', function(e) {
          e.stopPropagation();
          copyToGlobal(d.id);
        });
        item.addEventListener('click', function() {
          injectDocIntoChat(d.id);
        });
      })(doc);

      els.docPanelList.appendChild(item);
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

  function updateLibrarySelectionUI() {
    var ids = Object.keys(librarySelection).filter(function(k) { return librarySelection[k]; });
    var countEl = document.getElementById('library-selected-count');
    var sendBtn = document.getElementById('btn-send-selected');
    if (ids.length > 0) {
      countEl.style.display = '';
      countEl.textContent = ids.length + ' document' + (ids.length > 1 ? 's' : '') + ' selected';
      sendBtn.disabled = false;
      sendBtn.style.opacity = '1';
    } else {
      countEl.style.display = 'none';
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.5';
    }
  }

  async function openGlobalLibrary() {
    els.libraryModal.classList.add('active');
    els.globalDocs.innerHTML = '<li class="empty-state">Loading...</li>';
    librarySelection = {};
    updateLibrarySelectionUI();

    try {
      var gDocs = await api('/api/documents/global');
      els.globalDocs.innerHTML = '';
      if (gDocs.length === 0) {
        els.globalDocs.innerHTML = '<li class="empty-state">No documents in the general library yet.<br>Use the upload button above to add documents.</li>';
      } else {
        for (var j = 0; j < gDocs.length; j++) {
          makeGlobalDocItem(els.globalDocs, gDocs[j]);
        }
      }
    } catch (err) {
      notify('Failed to load library', 'error');
    }
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
      if (!confirm('Delete "' + doc.name + '" from the library?')) return;
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

    var allContent = '';
    var docNames = [];

    for (var i = 0; i < ids.length; i++) {
      try {
        var result = await api('/api/documents/insert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docId: ids[i], scope: 'global' })
        });
        if (result && result.raw_content && result.raw_content.trim().length > 0) {
          var wc = result.raw_content.split(/\s+/).length;
          docNames.push('"' + result.name + '" (' + wc + ' words)');
          allContent += '\n\n=== DOCUMENT: ' + result.name + ' (' + wc + ' words) ===\n\n' + result.raw_content;
        } else if (result) {
          notify('"' + result.name + '" has no content — skipped', 'error');
        }
      } catch (err) {
        notify('Failed to load doc: ' + err.message, 'error');
      }
    }

    if (docNames.length === 0) {
      notify('No documents with content to send', 'error');
      return;
    }

    addMessage('user', 'Loading ' + docNames.length + ' document' + (docNames.length > 1 ? 's' : '') + ' from library:\n' + docNames.join('\n'));
    scrollBottom();

    state.streaming = true;
    els.btnSend.disabled = true;

    var claudeMsg = 'The user has loaded ' + docNames.length + ' documents from the general library:\n' + docNames.join('\n') + '\n\nHere are the full contents:' + allContent + '\n\nPlease acknowledge all documents loaded, provide a brief summary of each, and let the user know you are ready for questions or instructions about them.';

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
    inner += '<div style="display:flex;gap:12px;margin-bottom:12px">';
    inner += '<div style="flex:1"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Words</label>';
    inner += '<input type="number" class="text-input" data-field="wordcount" value="10000" min="1000" max="100000" data-testid="paper-wordcount"></div>';
    inner += '<div style="flex:1"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Type</label>';
    inner += '<select class="text-input" data-field="doctype" data-testid="paper-doctype"><option value="research_paper">Research Paper</option><option value="dissertation">Dissertation</option><option value="whitepaper">Whitepaper</option><option value="essay">Essay</option><option value="report">Report</option><option value="book_chapter">Book Chapter</option><option value="other">Other</option></select></div>';
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

    modal.querySelector('[data-testid="btn-start-paper"]').addEventListener('click', async function() {
      var title = modal.querySelector('[data-field="title"]').value.trim();
      var instructions = modal.querySelector('[data-field="instructions"]').value.trim();
      var wordcount = parseInt(modal.querySelector('[data-field="wordcount"]').value) || 10000;
      var doctype = modal.querySelector('[data-field="doctype"]').value;

      if (!title && !instructions) {
        notify('Enter at least a title', 'error');
        return;
      }

      modal.remove();
      els.chatInput.value = '';
      await ensureSession();
      if (!state.currentSession) return;

      var desc = 'Generate a ' + wordcount + '-word ' + doctype.replace(/_/g, ' ') + ': "' + (title || 'Untitled') + '"';
      if (instructions) desc += '\n\nInstructions: ' + instructions;
      addMessage('user', desc);
      scrollBottom();

      runCoherence({
        title: title,
        instructions: instructions,
        wordcount: wordcount,
        doctype: doctype
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
  els.chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  els.btnSend.addEventListener('click', sendMessage);

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
    if (els.fileInput.files.length > 0) {
      uploadFile(els.fileInput.files[0]);
      els.fileInput.value = '';
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
  document.getElementById('close-library').addEventListener('click', function() {
    els.libraryModal.classList.remove('active');
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
      uploadFile(e.dataTransfer.files[0]);
    }
  });
  document.addEventListener('dragleave', function(e) {
    if (e.relatedTarget === null) {
      clearTimeout(dragTimer);
      els.dropOverlay.classList.remove('active');
    }
  });

  els.libraryModal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });
  els.libraryModal.addEventListener('mousedown', function(e) {
    if (e.target === els.libraryModal) els.libraryModal.classList.remove('active');
  });
  els.projectModal.querySelector('.modal').addEventListener('mousedown', function(e) { e.stopPropagation(); });
  els.projectModal.addEventListener('mousedown', function(e) {
    if (e.target === els.projectModal) els.projectModal.classList.remove('active');
  });

  loadProjects();
})();
