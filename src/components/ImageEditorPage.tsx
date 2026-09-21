import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { GiftMapping } from '../types';
import type { GiftAssignment } from '../types/electron';
import { useUnsavedChanges, useUnsavedGuard } from '../UnsavedChanges';
import { applyPanelTemplate, cardColors, clamp, createPanel, normalizePanel, panelFilename, panelId, panelLayout, readPanelLibrary, PANEL_STORAGE_KEY, TEMPLATES, TONES, toneForCategory, type PanelCard, type PanelDesign, type PanelLibrary } from '../lib/giftPanel';
import { drawGiftPanel, type PanelImages } from '../lib/giftPanelCanvas';

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type Meta = { name: string; title: string; category: string };
type History = { past: PanelDesign[]; present: PanelDesign; future: PanelDesign[] };
type Action = { type: 'edit' | 'replace'; value: PanelDesign } | { type: 'undo' } | { type: 'redo' };
function historyReducer(state: History, action: Action): History {
  if (action.type === 'undo') return state.past.length ? { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] } : state;
  if (action.type === 'redo') return state.future.length ? { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) } : state;
  if (action.type === 'replace') return { past: [], present: action.value, future: [] };
  if (JSON.stringify(state.present) === JSON.stringify(action.value)) return state;
  return { past: [...state.past.slice(-49), state.present], present: normalizePanel(action.value), future: [] };
}
function loadLibrary() {
  try { return { library: readPanelLibrary(localStorage.getItem(PANEL_STORAGE_KEY)), error: '' }; }
  catch { return { library: readPanelLibrary(null), error: '保存データを読み込めませんでした。元のデータを保護し、自動保存を止めています。' }; }
}
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return <label className="panel-field"><span>{label}</span><input type="number" min={min} max={max} value={value} onChange={e => onChange(clamp(e.target.value, min, max, value))} /></label>;
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return <label className="panel-color-field"><input type="color" aria-label={label} value={value} onChange={e => onChange(e.target.value)} /><span>{label}</span><small>{value.toUpperCase()}</small></label>;
}
function fitCards(design: PanelDesign, cards: PanelCard[]) {
  const columns = Math.max(design.columns, Math.ceil(cards.length / 8));
  const rows = Math.max(design.rows, Math.ceil(cards.length / columns));
  return { ...design, cards, columns, rows, height: Math.min(2160, Math.round(design.height / design.rows * rows)) };
}
const EMPTY_MAPPINGS: GiftMapping[] = [];

export default function ImageEditorPage({ mappings = EMPTY_MAPPINGS }: { mappings?: GiftMapping[] }) {
  const initial = useMemo(loadLibrary, []);
  const libraryRef = useRef<PanelLibrary>(initial.library);
  const [documents, setDocuments] = useState(initial.library.designs);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initial.library.designs.find(d => d.id === initial.library.activeId)!, future: [] });
  const design = history.present;
  const [storageError, setStorageError] = useState(initial.error);
  const [recoveryRequired, setRecoveryRequired] = useState(Boolean(initial.error));
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [metadata, setMetadata] = useState<Meta[]>([]);
  const [savedMappings, setSavedMappings] = useState<GiftAssignment[]>(mappings);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<'mapped' | 'all'>('mapped');
  const [search, setSearch] = useState('');
  const [controls, setControls] = useState<'template' | 'style' | 'card'>('template');
  const [preview, setPreview] = useState<'image' | 'vertical' | 'horizontal'>('image');
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [drawError, setDrawError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<string, { status: 'loading' | 'ready' | 'error'; image?: HTMLImageElement }>());
  const [imageTick, setImageTick] = useState(0);
  const alive = useRef(true);
  const dragId = useRef<string | null>(null);
  const { confirmDiscard } = useUnsavedGuard();
  useUnsavedChanges(Boolean(storageError), exporting);
  const commit = (value: PanelDesign) => { dispatch({ type: 'edit', value }); setNotice(''); };
  const patch = (value: Partial<PanelDesign>) => commit({ ...design, ...value });

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => {
    if (recoveryRequired) return;
    const current = libraryRef.current;
    const next: PanelLibrary = { version: 1, activeId: design.id, designs: current.designs.some(d => d.id === design.id) ? current.designs.map(d => d.id === design.id ? design : d) : [...current.designs, design] };
    libraryRef.current = next;
    setDocuments(next.designs);
    try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next)); setStorageError(''); }
    catch { setStorageError('自動保存できません。空き容量を確認してください。画面を閉じる前にPNGを保存できます。'); }
  }, [design, recoveryRequired]);
  useEffect(() => {
    let canceled = false; setLoading(true); setDataError('');
    Promise.all([window.mygamepack.giftsRead(), window.mygamepack.bridgeCommandsReadMeta(), window.mygamepack.configRead()])
      .then(([catalog, commands, config]: any[]) => {
        if (canceled) return;
        setGifts(Array.isArray(catalog?.gifts) ? catalog.gifts : []);
        setMetadata(Array.isArray(commands) ? commands : []);
        setSavedMappings(Array.isArray(config?.mappings) ? config.mappings : []);
      }).catch(e => { if (!canceled) setDataError('ギフトを読み込めませんでした: ' + String(e?.message || e)); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [reload]);
  const mappedCards = useMemo(() => savedMappings.filter(m => m.commandFile).map((m, i): PanelCard => {
    const gift = gifts.find(g => String(g.id) === String(m.giftId));
    const meta = metadata.find(c => c.name === m.commandFile);
    return { id: 'mapped-' + i, giftId: String(m.giftId), giftName: m.name || gift?.name || String(m.giftId),
      image: gift?.image || null, title: meta?.title || m.commandFile!.replace(/\.txt$/i, ''),
      repeat: m.repeat || 1, category: meta?.category || '', tone: toneForCategory(meta?.category || '') };
  }), [savedMappings, gifts, metadata]);
  const available = useMemo(() => {
    const cards = source === 'mapped' ? mappedCards : gifts.map((g): PanelCard => mappedCards.find(c => c.giftId === String(g.id)) || {
      id: 'gift-' + g.id, giftId: String(g.id), giftName: g.name, image: g.image || null, title: g.name, repeat: 1, category: '', tone: 'other',
    });
    const query = search.trim().toLocaleLowerCase();
    return cards.filter(c => [c.giftName, c.title, c.giftId].some(t => t.toLocaleLowerCase().includes(query)));
  }, [mappedCards, gifts, source, search]);

  useEffect(() => {
    const queue = [...new Set(design.cards.map(c => c.image).filter((u): u is string => Boolean(u)))].filter(url => !cache.current.has(url));
    queue.forEach(url => cache.current.set(url, { status: 'loading' }));
    const worker = async () => {
      while (queue.length && alive.current) {
        const url = queue.shift()!;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const image = await Promise.race([
            (async () => {
              const base64 = await window.mygamepack.gvGiftsFetchImageBase64(url);
              if (!base64) throw new Error('画像なし');
              return await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img); img.onerror = () => reject(new Error('画像を開けません'));
                img.src = base64.startsWith('data:') ? base64 : 'data:image/png;base64,' + base64;
              });
            })(),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('画像の読み込みがタイムアウトしました')), 20000); }),
          ]);
          cache.current.set(url, { status: 'ready', image });
        } catch { cache.current.set(url, { status: 'error' }); }
        finally { if (timer) clearTimeout(timer); if (alive.current) setImageTick(t => t + 1); }
      }
    };
    const workers = Math.min(4, queue.length);
    for (let i = 0; i < workers; i++) void worker();
  }, [design.cards, imageTick]);
  const images = useMemo<PanelImages>(() => new Map([...cache.current.entries()].filter(([, v]) => v.image).map(([url, v]) => [url, v.image!])), [imageTick]);
  useEffect(() => {
    if (!canvasRef.current) return;
    try { drawGiftPanel(canvasRef.current, design, images); setDrawError(''); }
    catch (e) { setDrawError('プレビューを描画できません: ' + String(e)); }
  }, [design, images]);
  const layout = panelLayout(design);
  const urls = [...new Set(design.cards.map(c => c.image).filter((url): url is string => Boolean(url)))];
  const pending = urls.filter(url => !cache.current.has(url) || cache.current.get(url)?.status === 'loading').length;
  const failed = urls.filter(url => cache.current.get(url)?.status === 'error');
  const selectedIndex = design.cards.findIndex(c => c.id === selected);
  const card = design.cards[selectedIndex];
  const updateCard = (value: Partial<PanelCard>) => patch({ cards: design.cards.map(c => c.id === selected ? { ...c, ...value } : c) });
  const removeCard = (id: string) => { patch({ cards: design.cards.filter(c => c.id !== id) }); if (selected === id) setSelected(null); };
  const moveCard = (fromId: string, to: number) => {
    const from = design.cards.findIndex(c => c.id === fromId);
    if (from < 0 || to < 0 || to >= design.cards.length || from === to) return;
    const next = [...design.cards]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    patch({ cards: next });
  };
  const addCards = (cards: PanelCard[]) => {
    const next = cards.slice(0, 96 - design.cards.length).map(c => ({ ...c, id: panelId() }));
    if (!next.length) return;
    commit(fitCards(design, [...design.cards, ...next])); setSelected(next[0].id);
  };
  const exportPng = async () => {
    if (exporting || pending || failed.length || layout.overflow || !design.cards.length) return;
    setExporting(true); setNotice('');
    try {
      await document.fonts.ready;
      const cleanCanvas = document.createElement('canvas');
      drawGiftPanel(cleanCanvas, design, images);
      const result = await window.mygamepack.giftPanelSavePng(cleanCanvas.toDataURL('image/png'), panelFilename(design));
      setNotice(result.canceled ? '保存をキャンセルしました。' : 'PNGを保存しました。OBSの「画像」ソースで選択してください。' + (result.path ? ' ' + result.path : ''));
    } catch (e) { setNotice('PNGを保存できませんでした: ' + String(e)); }
    finally { setExporting(false); }
  };
  const retryImages = () => { failed.forEach(url => cache.current.delete(url)); setImageTick(t => t + 1); };
  const addMapped = () => addCards(mappedCards.filter(c => !design.cards.some(d => d.giftId === c.giftId)));
  const switchDocument = (id: string) => {
    if (storageError && !confirmDiscard()) return;
    const next = libraryRef.current.designs.find(d => d.id === id); if (!next) return;
    dispatch({ type: 'replace', value: next }); setSelected(null); setNotice('');
  };
  const newDocument = () => {
    if (documents.length >= 20 || (storageError && !confirmDiscard())) return;
    dispatch({ type: 'replace', value: createPanel() }); setSelected(null); setNotice('');
  };
  const cardInspector = card ? <section className="panel-inspector" aria-label="選択したカードの編集">
          <div className="panel-inspector-heading"><div><b>{selectedIndex + 1}. {card.giftName}</b><small>文字・色・並び順を編集</small></div><div className="panel-inline-actions">
            <button className="studio-icon-button" aria-label="カードを前へ移動" disabled={selectedIndex <= 0} onClick={() => moveCard(card.id, selectedIndex - 1)}><i className="fa-solid fa-arrow-left" /></button>
            <button className="studio-icon-button" aria-label="カードを後ろへ移動" disabled={selectedIndex === design.cards.length - 1} onClick={() => moveCard(card.id, selectedIndex + 1)}><i className="fa-solid fa-arrow-right" /></button>
            <button className="studio-quiet" onClick={() => removeCard(card.id)}><i className="fa-regular fa-trash-can" />削除</button>
          </div></div>
          <p className="panel-hint">以下は画像の表示だけを変更します。</p>
          <div className="panel-inspector-fields"><label className="panel-field"><span>効果名・表示する文字</span><textarea rows={2} maxLength={120} value={card.title} onChange={e => updateCard({ title: e.target.value })} /></label><NumberField label="表示する回数" value={card.repeat} min={1} max={9999} onChange={repeat => updateCard({ repeat })} /><label className="panel-field"><span>内容のグループ</span><select value={card.tone} onChange={e => updateCard({ tone: e.target.value as PanelCard['tone'] })}>{TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label></div>
          <div className="panel-card-colors"><span>このカードの色</span>{TONES.map(t => <button key={t.id} className="panel-swatch" style={{ background: design.palette[t.id] }} aria-label={t.label + 'の色にする'} onClick={() => updateCard({ color: design.palette[t.id] })} />)}
            <input type="color" aria-label="カードの自由な色" value={cardColors(design, card).accent} onChange={e => updateCard({ color: e.target.value })} /><button className="studio-quiet" onClick={() => updateCard({ color: undefined, textColor: undefined })}>自動配色に戻す</button>
            <label className="panel-check"><input type="checkbox" checked={Boolean(card.textColor)} onChange={e => updateCard({ textColor: e.target.checked ? cardColors(design, card).text : undefined })} />文字色を指定</label>{card.textColor && <input type="color" aria-label="カードの文字色" value={card.textColor} onChange={e => updateCard({ textColor: e.target.value })} />}
          </div>
        </section> : <p className="panel-hint">プレビューのカードを選ぶと、表示する文字や色を編集できます。</p>;
  return <div className="panel-studio">
    <header className="studio-page-heading">
      <div><span className="studio-eyebrow">CREATOR STUDIO</span><h1>配信画像<span className="studio-tag">OBS用 PNG</span></h1><p>ギフトの楽しさを、ひと目で伝えよう。</p></div>
      <div className="panel-heading-actions">
        <span className={'panel-save-state' + (storageError ? ' is-error' : '')}><i className={'fa-solid ' + (storageError ? 'fa-circle-exclamation' : 'fa-check')} />{storageError ? '保存を確認' : '画像の編集は自動保存'}</span>
        <button className="studio-primary" disabled={!design.cards.length || Boolean(pending || failed.length || layout.overflow || drawError || exporting)} onClick={() => void exportPng()}><i className="fa-solid fa-download" />{exporting ? '保存中…' : 'PNGを保存'}</button>
      </div>
    </header>
    {storageError && <div className="studio-alert" role="alert">{storageError}{recoveryRequired && <button onClick={() => {
      try { localStorage.setItem(PANEL_STORAGE_KEY + '.recovery', localStorage.getItem(PANEL_STORAGE_KEY) || ''); setRecoveryRequired(false); } catch { setStorageError('退避できませんでした。ストレージの空き容量を確認してください。'); }
    }}>元データを退避して編集を保存</button>}</div>}
    {notice && <p className="studio-notice" role="status">{notice}</p>}
    <div className="panel-document-bar">
      <label>保存したデザイン<select aria-label="保存したデザイン" value={design.id} onChange={e => switchDocument(e.target.value)}>{documents.map(d => <option key={d.id} value={d.id}>{d.name || '名称未設定'}</option>)}</select></label>
      <button className="studio-quiet" onClick={newDocument} disabled={documents.length >= 20 || exporting}><i className="fa-solid fa-plus" />新しく作る</button>
      <span className="panel-toolbar-spacer" />
      <button className="studio-quiet" disabled={!history.past.length || exporting} onClick={() => dispatch({ type: 'undo' })}><i className="fa-solid fa-rotate-left" />画像を元に戻す</button>
      <button className="studio-icon-button" aria-label="やり直す" disabled={!history.future.length || exporting} onClick={() => dispatch({ type: 'redo' })}><i className="fa-solid fa-rotate-right" /></button>
    </div>
    <div className="panel-workbench">
      <aside className="panel-settings">
        <div className="panel-segments" aria-label="画像の設定"><button aria-pressed={controls === 'template'} onClick={() => setControls('template')}>テンプレート</button><button aria-pressed={controls === 'style'} onClick={() => setControls('style')}>色・配置</button><button aria-pressed={controls === 'card'} onClick={() => setControls('card')}>カード</button></div>
        {controls === 'template' ? <>
          <div className="panel-section-label"><span>01</span><h2>見せ方を選ぶ</h2></div>
          <div className="panel-template-list">{TEMPLATES.map(t => <button key={t.id} className={'panel-template' + (design.template === t.id ? ' is-active' : '')} aria-pressed={design.template === t.id} onClick={() => commit(applyPanelTemplate(design, t.id))}>
            <div className={'panel-template-art is-' + t.id} aria-hidden="true">{Array.from({ length: t.id === 'light' ? 6 : 12 }, (_, i) => <span key={i} />)}</div>
            <span className="panel-template-name">{t.name}<small>{t.badge}</small></span><span className="panel-template-description">{t.sub}</span>
          </button>)}</div>
          <p className="panel-hint">選んだギフトと表示名を保ったまま、見た目を切り替えられます。</p>
        </> : controls === 'style' ? <>
          <div className="panel-section-label"><span>03</span><h2>色とレイアウト</h2></div>
          <label className="panel-field"><span>色の分け方</span><select value={design.colorMode} onChange={e => patch({ colorMode: e.target.value as PanelDesign['colorMode'] })}><option value="uniform">全体を同じ色に</option><option value="category">内容のグループで色分け</option></select></label>
          <div className="panel-segments"><button aria-pressed={design.colorTarget === 'border'} onClick={() => patch({ colorTarget: 'border' })}>枠に色をつける</button><button aria-pressed={design.colorTarget === 'background'} onClick={() => patch({ colorTarget: 'background' })}>背景に色をつける</button></div>
          <ColorField label="基本の色・外枠" value={design.accent} onChange={accent => patch({ accent })} />
          <ColorField label="カードの背景" value={design.background} onChange={background => patch({ background })} />
          {design.colorMode === 'category' && <div className="panel-palette">{TONES.map(t => <ColorField key={t.id} label={t.label} value={design.palette[t.id]} onChange={color => patch({ palette: { ...design.palette, [t.id]: color } })} />)}</div>}
          <div className="panel-field-row"><NumberField label="列" value={design.columns} min={1} max={12} onChange={columns => patch({ columns })} /><NumberField label="段" value={design.rows} min={1} max={8} onChange={rows => patch({ rows })} /></div>
          <label className="panel-field"><span>文字サイズ <b>{design.fontSize}px</b></span><input type="range" min={10} max={96} value={design.fontSize} onChange={e => patch({ fontSize: Number(e.target.value) })} /></label>
          <details className="panel-details"><summary>サイズ・余白を細かく調整</summary><div className="panel-field-row"><NumberField label="幅 px" value={design.width} min={360} max={3840} onChange={width => patch({ width })} /><NumberField label="一覧の高さ px" value={design.height} min={120} max={2160} onChange={height => patch({ height })} /></div>
            <div className="panel-field-row"><NumberField label="間隔" value={design.gap} min={0} max={32} onChange={gap => patch({ gap })} /><NumberField label="外側の余白" value={design.padding} min={4} max={80} onChange={padding => patch({ padding })} /></div>
            <NumberField label="角の丸み" value={design.radius} min={0} max={32} onChange={radius => patch({ radius })} />
            <NumberField label="見出しの文字サイズ" value={design.headlineSize} min={24} max={120} onChange={headlineSize => patch({ headlineSize })} />
            <ColorField label="見出しの色" value={design.headlineColor} onChange={headlineColor => patch({ headlineColor })} />
            <label className="panel-check"><input type="checkbox" checked={design.showRepeat} onChange={e => patch({ showRepeat: e.target.checked })} />回数（×10など）を表示</label>
            <label className="panel-check"><input type="checkbox" checked={design.outerFrame} onChange={e => patch({ outerFrame: e.target.checked })} />全体を囲む枠</label>
          </details>
        </> : cardInspector}
        <label className="panel-field"><span>デザイン名</span><input value={design.name} maxLength={60} onChange={e => patch({ name: e.target.value })} /></label>
        <label className="panel-field"><span>見出し <small>任意・3行まで</small></span><textarea rows={2} value={design.headline} maxLength={80} placeholder={'ダイヤ64個\n集めたら勝ち'} onChange={e => patch({ headline: e.target.value.split('\n').slice(0, 3).join('\n') })} /></label>
        <details className="panel-details panel-obs-help"><summary><i className="fa-solid fa-circle-info" />OBSへの置き方</summary><ol><li>「PNGを保存」で画像を保存。</li><li>OBSの「ソース」の ＋ から「画像」を追加。</li><li>保存したPNGを選び、四隅をドラッグして配置。</li></ol><p>上下に分けて置く場合は、デザインを2つ作って別々のPNGにします。余白は透明です。</p></details>
      </aside>
      <section className="panel-main">
        <div className="panel-preview-shell">
          <div className="panel-preview-toolbar"><div><i className="fa-regular fa-image" /><b>プレビュー</b><small>{layout.width} × {layout.height}px</small></div><select aria-label="プレビューの表示" value={preview} onChange={e => setPreview(e.target.value as typeof preview)}><option value="image">完成画像</option><option value="vertical">縦配信 9:16</option><option value="horizontal">横配信 16:9</option></select></div>
          {preview !== 'image' && <div className="panel-placement"><span>配置イメージ</span><button aria-pressed={position === 'top'} onClick={() => setPosition('top')}>上に置く</button><button aria-pressed={position === 'bottom'} onClick={() => setPosition('bottom')}>下に置く</button><small>PNGには含まれません</small></div>}
          <div className={'panel-preview-stage is-' + preview}>
            <div className={'panel-scene is-' + preview + ' position-' + position}>
              <div className="panel-canvas-wrap" style={{ aspectRatio: layout.width + '/' + layout.height }}>
                <canvas ref={canvasRef} aria-label="ギフト案内画像のプレビュー" />
                {design.cards.slice(0, layout.slots).map((c, i) => <div key={c.id} className="panel-card-target" style={{
                  left: (layout.padding + i % design.columns * (layout.cardWidth + layout.gap)) / layout.width * 100 + '%',
                  top: (layout.headingHeight + layout.padding + Math.floor(i / design.columns) * (layout.cardHeight + layout.gap)) / layout.height * 100 + '%',
                  width: layout.cardWidth / layout.width * 100 + '%', height: layout.cardHeight / layout.height * 100 + '%',
                }}><button className={'panel-card-hit' + (selected === c.id ? ' is-selected' : '')} aria-label={(i + 1) + '番 ' + c.giftName + 'の表示を編集'} aria-pressed={selected === c.id} onClick={() => { setSelected(c.id); setControls('card'); }} /><button className="panel-card-remove" aria-label={(i + 1) + '番 ' + c.giftName + 'を画像から外す'} title="画像から外す" disabled={exporting} onClick={() => removeCard(c.id)}>×</button></div>)}
                {!design.cards.length && <div className="panel-empty"><i className="fa-solid fa-layer-group" /><h3>あなたの配信に、ひと目でわかる案内を。</h3><p>テンプレートを選んで、ギフトを追加しましょう。</p><button className="studio-primary" disabled={!mappedCards.length || loading} onClick={addMapped}>設定済みギフトをまとめて追加</button><small>または下の一覧から1つずつ選べます</small></div>}
              </div>
              {preview !== 'image' && <div className="panel-game-placeholder"><i className="fa-solid fa-video" /><span>ゲーム映像・カメラのスペース</span><small>{preview === 'vertical' ? '9 : 16' : '16 : 9'}</small></div>}
            </div>
          </div>
          <div className="panel-preview-footer"><span><i className="fa-solid fa-border-none" />余白は透明</span><span>{design.cards.length}枚 / {layout.slots}枠</span><span>カードを選んで表示を編集</span></div>
        </div>
        {(pending > 0 || failed.length > 0 || drawError || layout.overflow > 0) && <div className="studio-alert" role="status">
          {pending > 0 && <p>ギフト画像を読み込み中… 残り{pending}枚</p>}
          {failed.length > 0 && <p>{failed.length}枚の画像を読み込めませんでした。<button onClick={retryImages}>画像を再読み込み</button></p>}
          {drawError && <p>{drawError}</p>}
          {layout.overflow > 0 && <p>{layout.overflow}枚が枠に入りません。すべて入るまで保存を止めています。<button onClick={() => commit(fitCards(design, design.cards))}>すべて収まるように調整</button></p>}
        </div>}

        {design.cards.length > 0 && <div className="panel-order"><div className="panel-order-heading"><span>並び順 <small>ドラッグで入れ替え</small></span><button className="studio-quiet" onClick={() => { patch({ cards: [] }); setSelected(null); }}>すべて外す</button></div><div className="panel-order-strip">{design.cards.map((c, i) => <button key={c.id} className={selected === c.id ? 'is-selected' : ''} aria-label={(i + 1) + '番のカードを選択'} draggable onDragStart={() => { dragId.current = c.id; }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragId.current) moveCard(dragId.current, i); dragId.current = null; }} onDragEnd={() => { dragId.current = null; }} onClick={() => { setSelected(c.id); setControls('card'); }}><small>{i + 1}</small>{c.image && <img src={c.image} alt="" loading="lazy" />}<span>{c.title}</span></button>)}</div></div>}
        <section className="panel-library">
          <div className="panel-library-heading"><div className="panel-section-label"><span>02</span><h2>画像に使うギフト</h2></div><button className="studio-quiet" onClick={addMapped} disabled={!mappedCards.length || design.cards.length >= 96 || loading}>設定済みをまとめて追加</button></div>
          <div className="panel-library-tools"><div className="panel-segments"><button aria-pressed={source === 'mapped'} onClick={() => setSource('mapped')}>設定済み {mappedCards.length}</button><button aria-pressed={source === 'all'} onClick={() => setSource('all')}>すべて {gifts.length}</button></div><label className="panel-search"><i className="fa-solid fa-magnifying-glass" /><input aria-label="画像に使うギフトを検索" placeholder="ギフト名・効果名で検索" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
          {loading ? <p className="panel-library-empty" role="status">ギフトを読み込んでいます…</p> : dataError ? <div className="studio-alert" role="alert">{dataError}<button onClick={() => setReload(n => n + 1)}>再読み込み</button></div> : !available.length ? <p className="panel-library-empty">{source === 'mapped' && !mappedCards.length ? '「すべて」からギフトを選んで画像に追加できます。' : '一致するギフトがありません。検索する文字を変えてください。'}</p> : <div className="panel-gift-grid">{available.slice(0, 100).map(c => <article key={c.id} className="panel-gift-entry"><button className="panel-gift-add" aria-label={c.giftName + 'を画像に追加'} disabled={design.cards.length >= 96} onClick={() => addCards([c])} title={c.giftName + ' / ' + c.title}>
            <div>{c.image ? <img src={c.image} alt="" loading="lazy" /> : <i className="fa-solid fa-gift" />}<span className="panel-gift-plus">+</span></div><b>{c.giftName}</b><small>{c.title}</small>
          </button></article>)}</div>}
          {available.length > 100 && <p className="panel-hint">先頭100件を表示しています。検索してギフトを絞り込めます。</p>}
          {design.cards.length >= 96 && <p className="panel-hint">1つの画像には96枚まで追加できます。別のデザインに分けて作成してください。</p>}
        </section>
      </section>
    </div>
  </div>;
}
