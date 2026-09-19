(() => {
  const query = new URLSearchParams(location.search), token = query.get('token'), channel = query.get('channel') === 'preview' ? 'preview' : 'live';
  const stage = document.getElementById('stage'), error = document.getElementById('error');
  if (channel === 'preview') { document.body.classList.add('preview'); document.getElementById('preview-note').hidden = false; }
  let jobId = '', media = [], context = null, gain = null, state = null, generation = 0;
  const feedback = value => fetch('/feedback?token=' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }).catch(() => {});
  function fail(text) { feedback({ error: text }); if (channel === 'preview') { error.textContent = text; error.style.display = 'block'; } }
  function clear() { generation++; for (const el of media) { el.pause(); el.removeAttribute('src'); el.load(); } media = []; context?.close().catch(() => {}); context = null; gain = null; stage.replaceChildren(); error.style.display = 'none'; }
  function play(el) { const current = generation; el.play().catch(() => { if (current === generation) fail('再生できません。素材の形式・コーデックを確認し、PNG / WAV / MP4(H.264) / WebM をお試しください。'); }); }
  function apply(next) {
    state = next;
    const job = next.current;
    if ((job?.id || '') !== jobId) {
      clear(); jobId = job?.id || '';
      if (job) {
        const loaded = new Set(); let failed = false;
        const ready = id => { loaded.add(id); if (!failed && loaded.size === job.assets.length) feedback({ ok: true }); };
        const finished = () => feedback({ finished: true, jobId: job.id, channel });
        if (job.calibration) {
          const card = document.createElement('div'); card.className = 'calibration';
          const title = document.createElement('b'); title.textContent = '映像テスト';
          const bar = document.createElement('i'); const caption = document.createElement('small'); caption.textContent = 'バーの動きと短い確認音を確認してください';
          card.append(title, bar, caption); stage.append(card);
          if (!next.muted) {
            context = new AudioContext(); gain = context.createGain(); gain.gain.value = job.volume * .15; gain.connect(context.destination);
            const oscillator = context.createOscillator(); oscillator.frequency.value = 523; oscillator.connect(gain); oscillator.start(); oscillator.stop(context.currentTime + .6);
            context.resume().catch(() => fail('確認音を再生できませんでした。音声出力を確認してください。'));
          }
        }
        for (const a of job.assets) {
          const el = document.createElement(a.kind === 'image' ? 'img' : a.kind);
          el.src = '/media/' + a.id + '?token=' + token;
          el.onerror = () => { if (jobId === job.id) { failed = true; fail('「' + a.name + '」を再生できません。形式・コーデック、ファイル破損を確認してください。'); finished(); } };
          if (a.kind !== 'audio') { el.className = 'visual'; el.style.left = job.x + '%'; el.style.top = job.y + '%'; el.style.width = job.width + '%'; }
          if (a.kind === 'image') { el.alt = ''; el.onload = () => ready(a.id); }
          else {
            if (channel === 'preview' && a.kind === 'audio') {
              const label = document.createElement('div'); label.className = 'audio-label'; label.textContent = '♪ ' + a.name; stage.append(label);
              const meter = document.createElement('progress'); meter.className = 'audio-progress'; meter.setAttribute('aria-label', '音声の再生位置'); meter.max = 1; meter.value = 0; stage.append(meter);
              const status = document.createElement('div'); status.className = 'audio-state'; stage.append(status);
              el.ontimeupdate = () => { meter.max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 1; meter.value = el.currentTime; };
            }
            el.preload = 'auto'; el.playsInline = true; el.volume = Math.max(0, Math.min(1, job.volume)); el.muted = next.muted;
            el.onloadedmetadata = () => { if (jobId !== job.id) return; const elapsed = Math.max(0, (state.now - state.current.startedAt) / 1000); if (Number.isFinite(el.duration) && elapsed >= el.duration) return; if (elapsed > .3) el.currentTime = elapsed; if (!state.paused) play(el); };
            el.onplaying = () => ready(a.id); el.onended = () => { if (jobId === job.id && !job.assets.some(a => a.kind === 'image') && media.every(m => m.ended)) finished(); }; media.push(el);
          }
          stage.append(el);
        }
      }
    }
    for (const el of media) { el.muted = next.muted; if (next.paused) el.pause(); else if (el.paused && !el.ended && el.readyState >= 2) play(el); }
    const audioState = stage.querySelector('.audio-state'); if (audioState) audioState.textContent = next.muted ? '音声停止中' : next.paused ? '一時停止中' : '再生中';
    if (context) { if (next.paused) context.suspend().catch(() => {}); else context.resume().catch(() => {}); if (gain && next.muted) gain.gain.value = 0; }
    for (const animation of stage.getAnimations({ subtree: true })) next.paused ? animation.pause() : animation.play();
  }
  const source = new EventSource('/events?token=' + token + '&channel=' + channel);
  source.onmessage = event => { try { apply(JSON.parse(event.data)); } catch { fail('演出を表示できませんでした。プレビューを開き直してください。'); } };
  source.onerror = () => { clear(); jobId = ''; if (channel === 'preview') { error.textContent = 'アプリへの接続を待っています…'; error.style.display = 'block'; } };
  addEventListener('beforeunload', () => { source.close(); clear(); });
})();
